import type { CredentialInfo } from '../../../../packages/dsh-adapter/src/credentials-client.ts'
import type {
  CatalogGroup,
  ModelCatalog,
} from '../../../../packages/dsh-adapter/src/model-catalog-client.ts'
import type {
  ConfigurableProvider,
  LlmProvider,
  SerializedSchema,
  SettingsDescription,
  SettingsNamespace,
  SettingsPathOp,
} from '../../../../packages/dsh-adapter/src/model-settings-client.ts'
import { RemoteError } from '../../../../packages/dsh-adapter/src/remote-error.ts'
import type { HostModelApi } from '../../src/model-settings/service.ts'

/** Shapes observed on RC2 (`docs/milestones/MODEL-CONFIG-API-AUDIT.md`), trimmed to what Corn reads. */
const PI_AI_SCHEMA: SerializedSchema = {
  uid: 1,
  refs: {
    '1': { type: 'object', dict: { providers: 2 } },
    '2': { type: 'dict', inner: 3 },
    '3': {
      type: 'object',
      dict: {
        apiKeyEnv: 10,
        displayName: 11,
        api: 4,
        baseURL: 12,
        models: 13,
      },
    },
    '4': { type: 'union', list: [5, 6, 7] },
    '5': { type: 'const', value: 'openai-completions' },
    '6': { type: 'const', value: 'openai-responses' },
    '7': { type: 'const', value: 'anthropic-messages' },
    '10': { type: 'string', meta: { role: 'credential-ref' } },
    '11': { type: 'string' },
    '12': { type: 'string' },
    '13': { type: 'array' },
  },
}
const FLAT_SCHEMA: SerializedSchema = {
  uid: 1,
  refs: { '1': { type: 'object', dict: {} } },
}
const EFFORTS = ['off', 'low', 'high', 'max']
export const CATALOG_ROUTES = ['anthropic', 'openai', 'xiaomi-token-plan-cn']

type Json = Record<string, unknown>
type Method =
  | 'describe'
  | 'replace'
  | 'mutate'
  | 'listProviders'
  | 'listConfigurableProviders'
  | 'credentials.describe'
  | 'credentials.set'
  | 'credentials.unset'
  | 'catalog.read'

interface Namespace {
  readonly schema: SerializedSchema
  readonly base: Json
  user: Json
  revision: number
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function merge(base: unknown, user: unknown): unknown {
  if (
    typeof base !== 'object' ||
    base === null ||
    Array.isArray(base) ||
    typeof user !== 'object' ||
    user === null ||
    Array.isArray(user)
  )
    return user === undefined ? base : user
  const out: Json = { ...(base as Json) }
  for (const [key, value] of Object.entries(user as Json))
    out[key] = merge((base as Json)[key], value)
  return out
}

function setPath(target: Json, path: readonly string[], value: unknown): void {
  let node = target
  for (const key of path.slice(0, -1)) {
    if (typeof node[key] !== 'object' || node[key] === null) node[key] = {}
    node = node[key] as Json
  }
  node[path.at(-1) as string] = clone(value)
}

function unsetPath(target: Json, path: readonly string[]): void {
  let node: unknown = target
  for (const key of path.slice(0, -1)) node = (node as Json | undefined)?.[key]
  if (typeof node === 'object' && node !== null)
    delete (node as Json)[path.at(-1) as string]
}

export interface StoredCredential {
  readonly value: string
  readonly source: 'file' | 'env' | 'project-env'
}

/** In-memory stand-in for the official settings, credentials, LLM and catalog Remotes. */
export class FakeModelHost implements HostModelApi {
  writable = true
  readonly calls: Array<{ readonly method: Method; readonly args: unknown[] }> =
    []
  readonly credentialStore = new Map<string, StoredCredential>()
  readonly namespaces = new Map<string, Namespace>([
    [
      'llm-deepseek',
      {
        schema: FLAT_SCHEMA,
        base: { apiKeyEnv: 'DEEPSEEK_API_KEY' },
        user: {},
        revision: 0,
      },
    ],
    [
      'llm-pi-ai',
      { schema: PI_AI_SCHEMA, base: { providers: {} }, user: {}, revision: 0 },
    ],
    [
      'agent-default-model',
      {
        schema: FLAT_SCHEMA,
        base: { provider: 'deepseek-official', model: 'deepseek-flash' },
        user: {},
        revision: 0,
      },
    ],
  ])
  /** Next call of `method` fails with this error (once). */
  readonly failures = new Map<Method, unknown>()
  /** Runs before a method answers; lets a test change the world mid-call. */
  readonly before = new Map<Method, () => void | Promise<void>>()

  async #enter(method: Method, args: unknown[]): Promise<void> {
    this.calls.push({ method, args: clone(args) })
    await this.before.get(method)?.()
    const failure = this.failures.get(method)
    if (failure !== undefined) {
      this.failures.delete(method)
      throw failure
    }
  }

  #view(ns: string): SettingsNamespace {
    const row = this.namespaces.get(ns)
    if (!row) throw new RemoteError('settings/rejected', `No entry "${ns}"`)
    return {
      ns,
      schema: row.schema,
      value: merge(clone(row.base), clone(row.user)),
      base: clone(row.base),
      user: clone(row.user),
      revision: row.revision,
    }
  }

  #write(ns: string, expectedRevision: number): Namespace {
    const row = this.namespaces.get(ns)
    if (!row) throw new RemoteError('settings/rejected', `No entry "${ns}"`)
    if (row.revision !== expectedRevision)
      throw new RemoteError(
        'settings/conflict',
        `settings namespace "${ns}" changed since it was read`,
      )
    return row
  }

  #userProviders(): Json {
    const providers = (this.namespaces.get('llm-pi-ai')?.user.providers ??
      {}) as Json
    return providers
  }

  readonly settings: HostModelApi['settings'] = {
    describe: async (): Promise<SettingsDescription> => {
      await this.#enter('describe', [])
      return {
        writable: this.writable,
        namespaces: [...this.namespaces.keys()].map((ns) => this.#view(ns)),
      }
    },
    replace: async (ns, section, expectedRevision) => {
      await this.#enter('replace', [ns, section, expectedRevision])
      const row = this.#write(ns, expectedRevision)
      row.user = clone(section) as Json
      row.revision++
      return this.#view(ns)
    },
    mutate: async (ns, ops: readonly SettingsPathOp[], expectedRevision) => {
      await this.#enter('mutate', [ns, ops, expectedRevision])
      const row = this.#write(ns, expectedRevision)
      for (const op of ops)
        if (op.op === 'set') setPath(row.user, op.path, op.value)
        else unsetPath(row.user, op.path)
      row.revision++
      return this.#view(ns)
    },
    listProviders: async (): Promise<readonly LlmProvider[]> => {
      await this.#enter('listProviders', [])
      return [
        { id: 'deepseek-official', name: 'DeepSeek' },
        { id: 'deepseek-account', name: 'DeepSeek Account' },
        ...Object.keys(this.#userProviders()).map((id) => ({ id, name: id })),
      ]
    },
    listConfigurableProviders: async (): Promise<
      readonly ConfigurableProvider[]
    > => {
      await this.#enter('listConfigurableProviders', [])
      const user = this.#userProviders()
      const pi = (provider: string, declared: boolean) => ({
        provider,
        displayName:
          ((user[provider] as Json | undefined)?.displayName as string) ??
          provider,
        settingsNs: 'llm-pi-ai',
        settingsPath: ['providers', provider],
        declared,
      })
      return [
        ...CATALOG_ROUTES.map((route) => pi(route, route in user)),
        ...Object.keys(user)
          .filter((route) => !CATALOG_ROUTES.includes(route))
          .map((route) => pi(route, true)),
        {
          provider: 'deepseek-official',
          displayName: 'DeepSeek',
          settingsNs: 'llm-deepseek',
          settingsPath: [],
        },
        {
          provider: 'deepseek-account',
          displayName: 'DeepSeek Account',
          settingsNs: 'llm-deepseek-account',
          settingsPath: [],
        },
      ]
    },
  }

  readonly credentials: HostModelApi['credentials'] = {
    describe: async (refs) => {
      await this.#enter('credentials.describe', [refs])
      const out: Record<string, CredentialInfo> = {}
      for (const ref of refs) {
        const stored = this.credentialStore.get(ref)
        out[ref] = stored
          ? {
              configured: true,
              source: stored.source,
              writable: stored.source !== 'env',
            }
          : { configured: false, writable: true }
      }
      return out
    },
    set: async (ref, value) => {
      await this.#enter('credentials.set', [ref, '<redacted>'])
      if (this.credentialStore.get(ref)?.source === 'env')
        throw new RemoteError(
          'credential/rejected',
          `credentials-local: "${ref}" is supplied read-only by the launching environment`,
        )
      this.credentialStore.set(ref, { value, source: 'file' })
    },
    unset: async (ref) => {
      await this.#enter('credentials.unset', [ref])
      if (this.credentialStore.get(ref)?.source === 'env')
        throw new RemoteError('credential/rejected', 'read-only')
      this.credentialStore.delete(ref)
    },
  }

  readonly catalog: HostModelApi['catalog'] = {
    read: async (): Promise<ModelCatalog> => {
      await this.#enter('catalog.read', [])
      const user = this.#userProviders()
      const groups: CatalogGroup[] = [
        {
          id: 'deepseek-official',
          name: 'DeepSeek',
          models: ['deepseek-flash', 'deepseek-v4-pro'].map((id) => ({
            id,
            name: id,
            efforts: EFFORTS,
            defaultEffort: 'high',
          })),
        },
        ...Object.entries(user).map(([id, profile]) => {
          const models = (profile as Json).models
          return {
            id,
            name: id,
            models: (Array.isArray(models)
              ? (models as Json[]).map((model) => String(model.id))
              : [`${id}-model`]
            ).map((model) => ({ id: model, name: model, efforts: [] })),
          }
        }),
      ]
      const selection = this.#view('agent-default-model').value as Json
      return {
        default: {
          provider: String(selection.provider),
          model: String(selection.model),
          ...(typeof selection.reasoningEffort === 'string'
            ? { reasoningEffort: selection.reasoningEffort }
            : {}),
        },
        routableProviders: groups.map((group) => group.id),
        groups,
        failures: 0,
      }
    },
  }

  writes(): Array<{ readonly method: Method; readonly args: unknown[] }> {
    return this.calls.filter((call) =>
      ['replace', 'mutate', 'credentials.set', 'credentials.unset'].includes(
        call.method,
      ),
    )
  }
}
