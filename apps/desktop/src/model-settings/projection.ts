import type {
  CatalogGroupView,
  CredentialSource,
  CredentialState,
  CustomProviderFields,
  ModelProviderView,
  ModelSelection,
  ModelSettingsSnapshot,
  ModelStatusView,
  ProviderKind,
} from '../../../../packages/contracts/src/model-settings.ts'
import {
  CREDENTIAL_REF_PATTERN,
  type CredentialInfo,
} from '../../../../packages/dsh-adapter/src/credentials-client.ts'
import type { ModelCatalog } from '../../../../packages/dsh-adapter/src/model-catalog-client.ts'
import type {
  ConfigurableProvider,
  LlmProvider,
  SerializedSchema,
  SettingsDescription,
  SettingsNamespace,
} from '../../../../packages/dsh-adapter/src/model-settings-client.ts'

export const DEFAULT_MODEL_NS = 'agent-default-model'
export const DEEPSEEK_NS = 'llm-deepseek'
export const PI_AI_NS = 'llm-pi-ai'
/** Account login is a separate authentication flow, not an API-key provider. */
export const ACCOUNT_PROVIDER = 'deepseek-account'
/** Profile fields Corn writes for a custom route; each must exist in the live schema. */
export const CUSTOM_PROFILE_FIELDS = [
  'displayName',
  'api',
  'baseURL',
  'models',
  'apiKeyEnv',
] as const

/** Host facts read in one pass from one Host generation. */
export interface HostFacts {
  readonly settings: SettingsDescription
  readonly registered: readonly LlmProvider[]
  readonly directory: readonly ConfigurableProvider[]
  readonly catalog: ModelCatalog
  readonly credentials: Readonly<Record<string, CredentialInfo>>
}

/** What the explicit development override injected into this Host generation. */
export interface DevOverrideFacts {
  readonly ref: string
  readonly lockedNamespaces: readonly string[]
}

/** Main-only provider record; `view` is the only part that crosses IPC. */
export interface ProviderRecord {
  readonly view: ModelProviderView
  readonly entry: ConfigurableProvider
  readonly namespace: SettingsNamespace | undefined
  /** The credential ref Main would use; undefined when the profile needs none. */
  readonly ref: string | undefined
  /** The profile already names `ref` as its `apiKeyEnv`. */
  readonly refNamed: boolean
}

/**
 * Official `deriveKeyRef` (`ui-settings-models/src/client/store.ts`): the
 * conventional credential reference for a route that names none yet.
 */
export function deriveKeyRef(provider: string): string {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]+/gu, '_')}_API_KEY`
}

export function getPath(value: unknown, path: readonly string[]): unknown {
  let current = value
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

const nonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

function schemaNode(schema: SerializedSchema, uid: number | undefined) {
  return uid === undefined ? undefined : schema.refs[String(uid)]
}

/** The pi-ai provider profile node: `providers` is a dict of profiles. */
function profileNode(namespace: SettingsNamespace) {
  const { schema } = namespace
  const root = schemaNode(schema, schema.uid)
  const providers = schemaNode(schema, root?.dict?.providers)
  return schemaNode(schema, providers?.inner)
}

/** Wire protocols a hand-declared route may name, read from the live schema. */
export function protocolChoices(
  namespace: SettingsNamespace | undefined,
): readonly string[] {
  if (!namespace) return []
  const profile = profileNode(namespace)
  const api = schemaNode(namespace.schema, profile?.dict?.api)
  if (api?.type !== 'union') return []
  return (api.list ?? [])
    .map((uid) => schemaNode(namespace.schema, uid))
    .filter((node) => node?.type === 'const')
    .map((node) => node?.value)
    .filter((value): value is string => typeof value === 'string')
}

/** The live pi-ai schema still accepts every field a custom profile writes. */
export function customProfileSupported(
  namespace: SettingsNamespace | undefined,
): boolean {
  const fields = namespace ? profileNode(namespace)?.dict : undefined
  return (
    fields !== undefined &&
    CUSTOM_PROFILE_FIELDS.every((field) => field in fields)
  )
}

function credentialSource(
  info: CredentialInfo,
  ref: string,
  override: DevOverrideFacts | null,
): CredentialSource {
  switch (info.source) {
    case 'file':
      return 'stored'
    case 'env':
      return override?.ref === ref ? 'dev_override' : 'environment'
    case 'project-env':
      return 'home_env_file'
    default:
      return 'unknown'
  }
}

function credentialState(
  ref: string | undefined,
  credentials: HostFacts['credentials'],
  override: DevOverrideFacts | null,
): CredentialState {
  if (ref === undefined) return { kind: 'not_required' }
  const info = credentials[ref]
  if (!info) return { kind: 'unknown' }
  return info.configured
    ? {
        kind: 'configured',
        source: credentialSource(info, ref, override),
        writable: info.writable,
      }
    : { kind: 'missing', writable: info.writable }
}

function customFields(profile: unknown): CustomProviderFields | undefined {
  const api = getPath(profile, ['api'])
  const baseURL = getPath(profile, ['baseURL'])
  if (!nonEmptyString(api) || !nonEmptyString(baseURL)) return undefined
  const models = getPath(profile, ['models'])
  const displayName = getPath(profile, ['displayName'])
  return {
    displayName: nonEmptyString(displayName) ? displayName : '',
    protocol: api,
    baseURL,
    models: (Array.isArray(models) ? models : []).flatMap((model) => {
      const id = getPath(model, ['id'])
      const name = getPath(model, ['name'])
      if (!nonEmptyString(id)) return []
      return [nonEmptyString(name) ? { id, name } : { id }]
    }),
  }
}

function kindOf(
  entry: ConfigurableProvider,
  custom: CustomProviderFields | undefined,
  namespace: SettingsNamespace | undefined,
): ProviderKind {
  if (entry.settingsPath.length === 0) return 'builtin'
  const removable =
    getPath(namespace?.user, entry.settingsPath) !== undefined &&
    getPath(namespace?.base, entry.settingsPath) === undefined
  return custom && removable ? 'custom' : 'catalog'
}

/**
 * Directory entries joined with live routes, settings and credentials. The
 * account route is excluded: it signs in rather than storing a key.
 */
export function providerRecords(
  facts: HostFacts,
  override: DevOverrideFacts | null,
): readonly ProviderRecord[] {
  const namespaces = new Map(facts.settings.namespaces.map((ns) => [ns.ns, ns]))
  const active = new Set(facts.registered.map((provider) => provider.id))
  const drafts = facts.directory
    .filter((entry) => entry.provider !== ACCOUNT_PROVIDER)
    .map((entry) => {
      const namespace = namespaces.get(entry.settingsNs)
      const profile = getPath(namespace?.value, entry.settingsPath)
      const named = getPath(profile, ['apiKeyEnv'])
      const refNamed =
        nonEmptyString(named) && CREDENTIAL_REF_PATTERN.test(named)
      const ref = refNamed
        ? named
        : profile !== undefined && entry.settingsPath.length > 0
          ? undefined
          : deriveKeyRef(entry.provider)
      const custom = customFields(profile)
      const kind = kindOf(entry, custom, namespace)
      return { entry, namespace, profile, ref, refNamed, custom, kind }
    })
  const records = drafts.map((draft): ProviderRecord => {
    const { entry, namespace, ref, kind } = draft
    const locked =
      !namespace || override?.lockedNamespaces.includes(entry.settingsNs)
    const view: ModelProviderView = {
      id: entry.provider,
      name: draft.custom?.displayName || entry.displayName,
      kind,
      active: active.has(entry.provider),
      configured: draft.profile !== undefined,
      settingsWritable: facts.settings.writable && !locked,
      credential: credentialState(ref, facts.credentials, override),
      sharesKeyWith: drafts
        .filter(
          (other) =>
            other.entry.provider !== entry.provider &&
            ref !== undefined &&
            other.ref === ref,
        )
        .map((other) => other.entry.provider),
      revision: namespace?.revision ?? 0,
      ...(kind === 'custom' && draft.custom ? { custom: draft.custom } : {}),
    }
    return { view, entry, namespace, ref, refNamed: draft.refNamed }
  })
  const rank = (kind: ProviderKind) =>
    kind === 'builtin' ? 0 : kind === 'custom' ? 1 : 2
  return records.toSorted((a, b) => rank(a.view.kind) - rank(b.view.kind))
}

/** `(provider, model, reasoningEffort)` must name a live catalog entry; DSH does not check. */
export function selectionInCatalog(
  catalog: ModelCatalog,
  selection: ModelSelection,
): boolean {
  if (!catalog.routableProviders.includes(selection.provider)) return false
  const model = catalog.groups
    .find((group) => group.id === selection.provider)
    ?.models.find((entry) => entry.id === selection.model)
  if (!model) return false
  return (
    selection.reasoningEffort === undefined ||
    model.efforts.includes(selection.reasoningEffort)
  )
}

export function sameSelection(
  a: ModelSelection | null,
  b: ModelSelection | null,
): boolean {
  return (
    a?.provider === b?.provider &&
    a?.model === b?.model &&
    a?.reasoningEffort === b?.reasoningEffort
  )
}

export function modelStatusOf(
  facts: HostFacts,
  records: readonly ProviderRecord[],
  devOverride: boolean,
): ModelStatusView {
  const view = (
    status: ModelStatusView['status'],
    reason: ModelStatusView['reason'],
  ): ModelStatusView => ({ status, reason, devOverride })
  const selection = facts.catalog.default
  if (!selection) return view('needs_configuration', 'no_default')
  if (!selectionInCatalog(facts.catalog, selection))
    return view('needs_configuration', 'default_not_in_catalog')
  const provider = records.find((row) => row.view.id === selection.provider)
  if (!provider?.view.active)
    return view('needs_configuration', 'provider_inactive')
  const { credential } = provider.view
  switch (credential.kind) {
    case 'missing':
      return view('needs_configuration', 'credential_missing')
    case 'unknown':
      return view('unavailable', 'host_error')
    case 'configured':
    case 'not_required':
      return view('available', 'configured')
    default: {
      const unreachable: never = credential
      throw new Error(`Unknown credential state ${String(unreachable)}`)
    }
  }
}

export function catalogView(
  catalog: ModelCatalog,
): readonly CatalogGroupView[] {
  return catalog.groups.map((group) => ({
    providerId: group.id,
    providerName: group.name,
    models: group.models.map((model) => ({
      id: model.id,
      name: model.name,
      efforts: model.efforts,
      ...(model.defaultEffort === undefined
        ? {}
        : { defaultEffort: model.defaultEffort }),
    })),
  }))
}

export function snapshotOf(
  facts: HostFacts,
  records: readonly ProviderRecord[],
  generation: number,
  override: DevOverrideFacts | null,
): ModelSettingsSnapshot {
  const namespaces = new Map(facts.settings.namespaces.map((ns) => [ns.ns, ns]))
  return {
    generation,
    settingsWritable: facts.settings.writable,
    providers: records.map((row) => row.view),
    protocols: protocolChoices(namespaces.get(PI_AI_NS)),
    catalog: catalogView(facts.catalog),
    catalogFailures: facts.catalog.failures,
    defaultModel: facts.catalog.default,
    defaultRevision: namespaces.get(DEFAULT_MODEL_NS)?.revision ?? 0,
    status: modelStatusOf(facts, records, override !== null),
  }
}
