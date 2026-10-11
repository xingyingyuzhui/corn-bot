import type {
  ClearProviderKeyCommand,
  ModelSettingsError,
  ModelSettingsErrorCode,
  ModelSettingsResult,
  ModelSettingsSnapshot,
  ModelStatusView,
  RemoveCustomProviderCommand,
  SaveCustomProviderCommand,
  SetDefaultModelCommand,
  SetProviderKeyCommand,
} from '../../../../packages/contracts/src/model-settings.ts'
import { CredentialsClient } from '../../../../packages/dsh-adapter/src/credentials-client.ts'
import { ModelCatalogClient } from '../../../../packages/dsh-adapter/src/model-catalog-client.ts'
import {
  ModelSettingsClient,
  type SettingsNamespace,
  type SettingsPathOp,
} from '../../../../packages/dsh-adapter/src/model-settings-client.ts'
import { RemoteError } from '../../../../packages/dsh-adapter/src/remote-error.ts'
import {
  type HostAuthority,
  HostTransport,
} from '../../../../packages/dsh-adapter/src/transport.ts'
import {
  customProfileSupported,
  DEFAULT_MODEL_NS,
  type DevOverrideFacts,
  deriveKeyRef,
  getPath,
  type HostFacts,
  modelStatusOf,
  PI_AI_NS,
  type ProviderRecord,
  protocolChoices,
  providerRecords,
  sameSelection,
  selectionInCatalog,
  snapshotOf,
} from './projection.ts'

/** The official Remotes this service calls; tests substitute a fake Host. */
export interface HostModelApi {
  readonly settings: Pick<
    ModelSettingsClient,
    | 'describe'
    | 'replace'
    | 'mutate'
    | 'listProviders'
    | 'listConfigurableProviders'
  >
  readonly credentials: Pick<CredentialsClient, 'describe' | 'set' | 'unset'>
  readonly catalog: Pick<ModelCatalogClient, 'read'>
}

export function hostModelApi(authority: HostAuthority): HostModelApi {
  const transport = new HostTransport(authority)
  return {
    settings: new ModelSettingsClient(transport),
    credentials: new CredentialsClient(transport),
    catalog: new ModelCatalogClient(transport),
  }
}

export interface ModelSettingsServiceOptions {
  /** The committed Host's authority, or undefined while not ready; a new object per Host generation. */
  readonly authority: () => HostAuthority | undefined
  readonly devOverride: () => DevOverrideFacts | null
  readonly api?: (authority: HostAuthority) => HostModelApi
  readonly now?: () => number
}

interface Pinned {
  readonly generation: number
  readonly authority: HostAuthority
  readonly api: HostModelApi
}

interface HostState {
  readonly facts: HostFacts
  readonly records: readonly ProviderRecord[]
  readonly override: DevOverrideFacts | null
}

type Result = ModelSettingsResult<ModelSettingsSnapshot>
type Step =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: ModelSettingsErrorCode }

const STATUS_TTL_MS = 30_000

/**
 * Safe code for a failed Host call. A failure the Host did not answer leaves
 * a write's outcome unknown: settings and credential writes are not
 * cancellable, so only a read-back can tell.
 */
function classify(error: unknown): ModelSettingsErrorCode {
  if (!(error instanceof RemoteError)) return 'outcome_unknown'
  switch (error.code) {
    case 'settings/conflict':
      return 'conflict'
    case 'settings/rejected':
      return /overridden/iu.test(error.message) ? 'read_only' : 'rejected'
    case 'credential/rejected':
      return 'read_only'
    case 'gateway/bad-request':
    case 'corn/invalid-ref':
      return 'invalid_input'
    default:
      if (/^corn\/http-4/u.test(error.code)) return 'rejected'
      return error.code.startsWith('corn/') ? 'outcome_unknown' : 'host_error'
  }
}

/** Reads never have an unknown outcome; an unanswered read is a Host error. */
const readCode = (error: unknown): ModelSettingsErrorCode => {
  const code = classify(error)
  return code === 'outcome_unknown' ? 'host_error' : code
}

const ok = (value: ModelSettingsSnapshot): Result => ({ ok: true, value })

/**
 * Main's only path to the official model configuration services. Every write
 * re-reads the Host, validates against those facts, runs serialized and is
 * judged by a read-back from the same Host generation, never by the form.
 */
export class ModelSettingsService {
  readonly #authority: ModelSettingsServiceOptions['authority']
  readonly #devOverride: ModelSettingsServiceOptions['devOverride']
  readonly #api: (authority: HostAuthority) => HostModelApi
  readonly #now: () => number
  #seen: HostAuthority | undefined
  #pinned: Pinned | undefined
  #generation = 0
  #status:
    | {
        readonly generation: number
        readonly at: number
        readonly view: ModelStatusView
      }
    | undefined
  #refreshing: Promise<void> | undefined
  #queue: Promise<unknown> = Promise.resolve()

  constructor(options: ModelSettingsServiceOptions) {
    this.#authority = options.authority
    this.#devOverride = options.devOverride
    this.#api = options.api ?? hostModelApi
    this.#now = options.now ?? Date.now
  }

  /** Cached model status; a stale or missing reading refreshes in the background. */
  status(): ModelStatusView {
    const pinned = this.#pin()
    const devOverride = this.#devOverride() !== null
    if (!pinned)
      return { status: 'checking', reason: 'runtime_not_ready', devOverride }
    const cached =
      this.#status?.generation === pinned.generation ? this.#status : undefined
    if (!cached || this.#now() - cached.at > STATUS_TTL_MS)
      this.#refreshing ??= this.#read(pinned)
        .then(
          () => {},
          () => {
            if (this.#current(pinned))
              this.#record(pinned, {
                status: 'unavailable',
                reason: 'host_error',
                devOverride,
              })
          },
        )
        .finally(() => {
          this.#refreshing = undefined
        })
    return (
      cached?.view ?? { status: 'checking', reason: 'reading', devOverride }
    )
  }

  async read(): Promise<Result> {
    const pinned = this.#pin()
    if (!pinned) return this.#error('runtime_unavailable')
    try {
      return ok(await this.#snapshot(pinned))
    } catch (error) {
      if (!this.#current(pinned)) return this.#error('stale_generation')
      return this.#error(readCode(error))
    }
  }

  setProviderKey(command: SetProviderKeyCommand): Promise<Result> {
    return this.#write(command.generation, async (pinned, state) => {
      const record = this.#provider(state, command.providerId)
      if (!record) return this.#fail(pinned, 'unknown_provider')
      const piAi = record.entry.settingsNs === PI_AI_NS
      const ref =
        record.ref ?? (piAi ? deriveKeyRef(record.entry.provider) : undefined)
      if (ref === undefined) return this.#fail(pinned, 'unsupported_provider')
      if (record.view.revision !== command.revision)
        return this.#fail(pinned, 'conflict')
      const writable = await this.#credentialWritable(pinned, ref)
      if (writable !== true)
        return this.#fail(pinned, writable === false ? 'read_only' : writable)
      const namesRef = piAi && !record.refNamed
      if (namesRef) {
        if (!record.view.settingsWritable || !record.namespace)
          return this.#fail(pinned, 'read_only')
        const path = record.entry.settingsPath
        const op: SettingsPathOp = record.view.configured
          ? { op: 'set', path: [...path, 'apiKeyEnv'], value: ref }
          : { op: 'set', path, value: { apiKeyEnv: ref } }
        const written = await this.#step(() =>
          pinned.api.settings.mutate(PI_AI_NS, [op], command.revision),
        )
        if (!written.ok) return this.#fail(pinned, written.code)
      }
      const stored = await this.#step(() =>
        pinned.api.credentials.set(ref, command.key),
      )
      if (!stored.ok)
        return namesRef
          ? this.#partial(pinned, stored.code)
          : this.#fail(pinned, stored.code)
      return this.#verify(pinned, (snapshot) => {
        const credential = snapshot.providers.find(
          (row) => row.id === command.providerId,
        )?.credential
        return (
          credential?.kind === 'configured' && credential.source === 'stored'
        )
      })
    })
  }

  clearProviderKey(command: ClearProviderKeyCommand): Promise<Result> {
    return this.#write(command.generation, async (pinned, state) => {
      const record = this.#provider(state, command.providerId)
      if (!record) return this.#fail(pinned, 'unknown_provider')
      if (record.ref === undefined)
        return this.#fail(pinned, 'unsupported_provider')
      const credential = record.view.credential
      if (credential.kind === 'missing') return this.#verify(pinned, () => true)
      if (credential.kind !== 'configured')
        return this.#fail(pinned, 'host_error')
      if (!credential.writable) return this.#fail(pinned, 'read_only')
      const ref = record.ref
      const removed = await this.#step(() => pinned.api.credentials.unset(ref))
      if (!removed.ok) return this.#fail(pinned, removed.code)
      return this.#verify(pinned, (snapshot) => {
        const after = snapshot.providers.find(
          (row) => row.id === command.providerId,
        )?.credential
        return after?.kind !== 'configured' || after.source !== 'stored'
      })
    })
  }

  saveCustomProvider(command: SaveCustomProviderCommand): Promise<Result> {
    return this.#write(command.generation, async (pinned, state) => {
      const namespace = this.#namespace(state, PI_AI_NS)
      if (!namespace || !customProfileSupported(namespace))
        return this.#fail(pinned, 'unsupported_provider')
      if (
        !state.facts.settings.writable ||
        state.override?.lockedNamespaces.includes(PI_AI_NS)
      )
        return this.#fail(pinned, 'read_only')
      if (!protocolChoices(namespace).includes(command.fields.protocol))
        return this.#fail(pinned, 'invalid_input')
      const { providerId: id, fields } = command
      const record = this.#provider(state, id)
      const path = ['providers', id]
      let ops: SettingsPathOp[]
      let ref: string
      if (command.mode === 'create') {
        const taken =
          record !== undefined ||
          state.facts.directory.some((entry) => entry.provider === id) ||
          state.facts.registered.some((provider) => provider.id === id)
        if (taken) return this.#fail(pinned, 'provider_exists')
        ref = deriveKeyRef(id)
        ops = [
          {
            op: 'set',
            path,
            value: {
              ...(fields.displayName
                ? { displayName: fields.displayName }
                : {}),
              api: fields.protocol,
              baseURL: fields.baseURL,
              models: fields.models,
              ...(command.key ? { apiKeyEnv: ref } : {}),
            },
          },
        ]
      } else {
        if (!record) return this.#fail(pinned, 'unknown_provider')
        if (record.view.kind !== 'custom')
          return this.#fail(pinned, 'unsupported_provider')
        ref = record.ref ?? deriveKeyRef(id)
        const hasName =
          getPath(namespace.user, [...path, 'displayName']) !== undefined
        ops = [
          { op: 'set', path: [...path, 'api'], value: fields.protocol },
          { op: 'set', path: [...path, 'baseURL'], value: fields.baseURL },
          { op: 'set', path: [...path, 'models'], value: fields.models },
          ...(fields.displayName
            ? [
                {
                  op: 'set',
                  path: [...path, 'displayName'],
                  value: fields.displayName,
                } as const,
              ]
            : hasName
              ? [{ op: 'unset', path: [...path, 'displayName'] } as const]
              : []),
          ...(command.key && !record.refNamed
            ? [{ op: 'set', path: [...path, 'apiKeyEnv'], value: ref } as const]
            : []),
        ]
      }
      if (namespace.revision !== command.revision)
        return this.#fail(pinned, 'conflict')
      const key = command.key
      if (key) {
        const writable = await this.#credentialWritable(pinned, ref)
        if (writable !== true)
          return this.#fail(pinned, writable === false ? 'read_only' : writable)
      }
      const written = await this.#step(() =>
        pinned.api.settings.mutate(PI_AI_NS, ops, command.revision),
      )
      if (!written.ok) return this.#fail(pinned, written.code)
      if (key) {
        const stored = await this.#step(() =>
          pinned.api.credentials.set(ref, key),
        )
        if (!stored.ok) return this.#partial(pinned, stored.code)
      }
      return this.#verify(pinned, (snapshot) => {
        const row = snapshot.providers.find((provider) => provider.id === id)
        return (
          row?.kind === 'custom' &&
          row.custom?.baseURL === fields.baseURL &&
          (!key || row.credential.kind === 'configured')
        )
      })
    })
  }

  removeCustomProvider(command: RemoveCustomProviderCommand): Promise<Result> {
    return this.#write(command.generation, async (pinned, state) => {
      const record = this.#provider(state, command.providerId)
      if (!record) return this.#fail(pinned, 'unknown_provider')
      if (record.view.kind !== 'custom')
        return this.#fail(pinned, 'unsupported_provider')
      if (!record.view.settingsWritable) return this.#fail(pinned, 'read_only')
      if (record.view.revision !== command.revision)
        return this.#fail(pinned, 'conflict')
      const removed = await this.#step(() =>
        pinned.api.settings.mutate(
          PI_AI_NS,
          [{ op: 'unset', path: record.entry.settingsPath }],
          command.revision,
        ),
      )
      if (!removed.ok) return this.#fail(pinned, removed.code)
      const { ref } = record
      const credential = record.view.credential
      const stillUsed = state.records.some(
        (other) => other !== record && other.refNamed && other.ref === ref,
      )
      if (
        ref !== undefined &&
        !stillUsed &&
        credential.kind === 'configured' &&
        credential.source === 'stored' &&
        credential.writable
      ) {
        const cleared = await this.#step(() =>
          pinned.api.credentials.unset(ref),
        )
        if (!cleared.ok) return this.#partial(pinned, cleared.code)
      }
      return this.#verify(
        pinned,
        (snapshot) =>
          !snapshot.providers.some((row) => row.id === command.providerId),
      )
    })
  }

  setDefaultModel(command: SetDefaultModelCommand): Promise<Result> {
    return this.#write(command.generation, async (pinned, state) => {
      const namespace = this.#namespace(state, DEFAULT_MODEL_NS)
      if (!namespace) return this.#fail(pinned, 'host_error')
      if (
        !state.facts.settings.writable ||
        state.override?.lockedNamespaces.includes(DEFAULT_MODEL_NS)
      )
        return this.#fail(pinned, 'read_only')
      const { selection } = command
      if (!selectionInCatalog(state.facts.catalog, selection))
        return this.#fail(pinned, 'model_not_in_catalog')
      if (namespace.revision !== command.revision)
        return this.#fail(pinned, 'conflict')
      const written = await this.#step(() =>
        pinned.api.settings.replace(
          DEFAULT_MODEL_NS,
          {
            provider: selection.provider,
            model: selection.model,
            ...(selection.reasoningEffort === undefined
              ? {}
              : { reasoningEffort: selection.reasoningEffort }),
          },
          command.revision,
        ),
      )
      if (!written.ok) return this.#fail(pinned, written.code)
      return this.#verify(pinned, (snapshot) =>
        sameSelection(snapshot.defaultModel, selection),
      )
    })
  }

  #pin(): Pinned | undefined {
    const authority = this.#authority()
    if (!authority) return undefined
    if (authority !== this.#seen || !this.#pinned) {
      this.#seen = authority
      this.#generation++
      this.#pinned = {
        generation: this.#generation,
        authority,
        api: this.#api(authority),
      }
    }
    return this.#pinned
  }

  #current(pinned: Pinned): boolean {
    return this.#authority() === pinned.authority
  }

  #record(pinned: Pinned, view: ModelStatusView): void {
    this.#status = { generation: pinned.generation, at: this.#now(), view }
  }

  async #read(pinned: Pinned): Promise<HostState> {
    const { api } = pinned
    const override = this.#devOverride()
    const [settings, registered, directory, catalog] = await Promise.all([
      api.settings.describe(),
      api.settings.listProviders(),
      api.settings.listConfigurableProviders(),
      api.catalog.read(),
    ])
    const unresolved = providerRecords(
      { settings, registered, directory, catalog, credentials: {} },
      override,
    )
    const refs = [
      ...new Set(
        unresolved.flatMap((row) => (row.ref === undefined ? [] : [row.ref])),
      ),
    ]
    const credentials =
      refs.length > 0 ? await api.credentials.describe(refs) : {}
    const facts = { settings, registered, directory, catalog, credentials }
    const records = providerRecords(facts, override)
    if (this.#current(pinned))
      this.#record(pinned, modelStatusOf(facts, records, override !== null))
    return { facts, records, override }
  }

  async #snapshot(pinned: Pinned): Promise<ModelSettingsSnapshot> {
    const state = await this.#read(pinned)
    if (!this.#current(pinned))
      throw new RemoteError(
        'corn/generation-changed',
        'Host generation changed',
      )
    return snapshotOf(
      state.facts,
      state.records,
      pinned.generation,
      state.override,
    )
  }

  #write(
    generation: number,
    body: (pinned: Pinned, state: HostState) => Promise<Result>,
  ): Promise<Result> {
    const run = this.#queue.then(async (): Promise<Result> => {
      const pinned = this.#pin()
      if (!pinned) return this.#error('runtime_unavailable')
      if (generation !== pinned.generation)
        return this.#error('stale_generation')
      let state: HostState
      try {
        state = await this.#read(pinned)
      } catch (error) {
        return this.#error(
          this.#current(pinned) ? readCode(error) : 'stale_generation',
        )
      }
      return body(pinned, state)
    })
    this.#queue = run.catch(() => {})
    return run
  }

  async #step(run: () => Promise<unknown>): Promise<Step> {
    try {
      await run()
      return { ok: true }
    } catch (error) {
      return { ok: false, code: classify(error) }
    }
  }

  /** `true`, `false` (read-only source) or the code of a failed describe. */
  async #credentialWritable(
    pinned: Pinned,
    ref: string,
  ): Promise<boolean | ModelSettingsErrorCode> {
    try {
      const info = (await pinned.api.credentials.describe([ref]))[ref]
      return info === undefined ? 'host_error' : info.writable
    } catch (error) {
      return readCode(error)
    }
  }

  #provider(state: HostState, id: string): ProviderRecord | undefined {
    return state.records.find((row) => row.view.id === id)
  }

  #namespace(state: HostState, ns: string): SettingsNamespace | undefined {
    return state.facts.settings.namespaces.find((row) => row.ns === ns)
  }

  #error(
    code: ModelSettingsErrorCode,
    extra: Partial<ModelSettingsError> = {},
  ): Result {
    return { ok: false, error: { code, ...extra } }
  }

  /** A failure with the Host's current state, read from the same generation when possible. */
  async #fail(
    pinned: Pinned,
    code: ModelSettingsErrorCode,
    extra: Partial<ModelSettingsError> = {},
  ): Promise<Result> {
    try {
      return this.#error(code, {
        ...extra,
        snapshot: await this.#snapshot(pinned),
      })
    } catch {
      return this.#error(code, extra)
    }
  }

  #partial(pinned: Pinned, cause: ModelSettingsErrorCode): Promise<Result> {
    return this.#fail(pinned, 'partially_applied', {
      failedStep: 'credential',
      cause,
    })
  }

  /** Success is what the Host reports after the write, not what was sent. */
  async #verify(
    pinned: Pinned,
    accept: (snapshot: ModelSettingsSnapshot) => boolean,
  ): Promise<Result> {
    let snapshot: ModelSettingsSnapshot
    try {
      snapshot = await this.#snapshot(pinned)
    } catch {
      return this.#error('outcome_unknown')
    }
    return accept(snapshot)
      ? ok(snapshot)
      : this.#error('readback_mismatch', { snapshot })
  }
}
