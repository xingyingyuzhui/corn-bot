/**
 * Redacted model-configuration facts and the structured commands the Renderer
 * may send. Host namespaces, settings paths, credential refs, revisions of
 * other namespaces, raw Host messages and stored keys never cross this
 * boundary; Main resolves all of them from the live Host.
 */

/** Model readiness, separate from runtime readiness. */
export const MODEL_STATUSES = [
  'checking',
  'needs_configuration',
  'available',
  'unavailable',
] as const
export type ModelStatus = (typeof MODEL_STATUSES)[number]

/** Why the status is what it is; a closed set the Renderer words itself. */
export const MODEL_STATUS_REASONS = [
  'runtime_not_ready',
  'reading',
  'no_default',
  'default_not_in_catalog',
  'provider_inactive',
  'credential_missing',
  'configured',
  'host_error',
] as const
export type ModelStatusReason = (typeof MODEL_STATUS_REASONS)[number]

export interface ModelStatusView {
  readonly status: ModelStatus
  readonly reason: ModelStatusReason
  /** The explicit development model override is in effect (never in packaged builds). */
  readonly devOverride: boolean
}

/** Where a provider's key comes from, as `credentials.describe` reports it. */
export const CREDENTIAL_SOURCES = [
  /** Corn's official local credential file, written from Settings. */
  'stored',
  /** The Host's launch environment: read-only, wins over the file. */
  'environment',
  /** The explicit development override injected this key: read-only. */
  'dev_override',
  /** A `.env` file in the Corn runtime home. */
  'home_env_file',
  'unknown',
] as const
export type CredentialSource = (typeof CREDENTIAL_SOURCES)[number]

export type CredentialState =
  | { readonly kind: 'missing'; readonly writable: boolean }
  | {
      readonly kind: 'configured'
      readonly source: CredentialSource
      readonly writable: boolean
    }
  /** The provider authenticates without a key Corn manages. */
  | { readonly kind: 'not_required' }
  /** Credential status could not be read. */
  | { readonly kind: 'unknown' }

/**
 * `builtin`: the official DeepSeek adapter. `catalog`: a route the pi-ai
 * catalog already describes. `custom`: a route the user declared.
 */
export type ProviderKind = 'builtin' | 'catalog' | 'custom'

export interface CustomProviderFields {
  readonly displayName: string
  readonly protocol: string
  readonly baseURL: string
  readonly models: readonly CustomModelEntry[]
}

export interface CustomModelEntry {
  readonly id: string
  readonly name?: string
}

export interface ModelProviderView {
  readonly id: string
  readonly name: string
  readonly kind: ProviderKind
  /** Routable by the Host right now. */
  readonly active: boolean
  /** A profile exists in some settings layer. */
  readonly configured: boolean
  /** The provider's settings may be written from Corn. */
  readonly settingsWritable: boolean
  readonly credential: CredentialState
  /** Other providers resolving to the same stored key. */
  readonly sharesKeyWith: readonly string[]
  /** Optimistic-concurrency token for this provider's settings, valid for one generation. */
  readonly revision: number
  /** Present for `custom` providers only, so they can be edited. */
  readonly custom?: CustomProviderFields
}

export interface CatalogModelView {
  readonly id: string
  readonly name: string
  readonly efforts: readonly string[]
  readonly defaultEffort?: string
}

export interface CatalogGroupView {
  readonly providerId: string
  readonly providerName: string
  readonly models: readonly CatalogModelView[]
}

export interface ModelSelection {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

export interface ModelSettingsSnapshot {
  /** Host generation the snapshot was read from; every command must echo it. */
  readonly generation: number
  readonly settingsWritable: boolean
  readonly providers: readonly ModelProviderView[]
  /** Wire protocols a custom provider may use, read from the official schema. */
  readonly protocols: readonly string[]
  readonly catalog: readonly CatalogGroupView[]
  /** Providers whose model list could not be read. */
  readonly catalogFailures: number
  readonly defaultModel: ModelSelection | null
  readonly defaultRevision: number
  /** Revision of the custom-provider settings; creating a provider echoes it. */
  readonly customRevision: number
  readonly status: ModelStatusView
}

export const MODEL_SETTINGS_ERROR_CODES = [
  'runtime_unavailable',
  'stale_generation',
  'conflict',
  'invalid_input',
  'unknown_provider',
  'unsupported_provider',
  'provider_exists',
  'model_not_in_catalog',
  'read_only',
  'rejected',
  'outcome_unknown',
  'partially_applied',
  'readback_mismatch',
  'host_error',
] as const
export type ModelSettingsErrorCode = (typeof MODEL_SETTINGS_ERROR_CODES)[number]

/** The step of a two-step write that did not complete. */
export type ModelSettingsStep = 'provider' | 'credential'

export interface ModelSettingsError {
  readonly code: ModelSettingsErrorCode
  /** For `partially_applied`: the step that failed after an earlier one succeeded. */
  readonly failedStep?: ModelSettingsStep
  /** For `partially_applied`: the failed step's own code. */
  readonly cause?: ModelSettingsErrorCode
  /** Read-back after a failure, when one could be taken in the same generation. */
  readonly snapshot?: ModelSettingsSnapshot
}

export type ModelSettingsResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ModelSettingsError }

export interface SetProviderKeyCommand {
  readonly generation: number
  readonly providerId: string
  readonly revision: number
  /** Typed by the user; travels once to Main and is never returned. */
  readonly key: string
}

export interface ClearProviderKeyCommand {
  readonly generation: number
  readonly providerId: string
}

export interface SaveCustomProviderCommand {
  readonly generation: number
  readonly mode: 'create' | 'update'
  readonly providerId: string
  readonly revision: number
  readonly fields: CustomProviderFields
  /** Optional on update; empty means keep the stored key. */
  readonly key?: string
}

export interface RemoveCustomProviderCommand {
  readonly generation: number
  readonly providerId: string
  readonly revision: number
}

export interface SetDefaultModelCommand {
  readonly generation: number
  readonly revision: number
  readonly selection: ModelSelection
}

/** The `window.corn.modelSettings` bridge. */
export interface ModelSettingsBridge {
  status(): Promise<ModelStatusView>
  read(): Promise<ModelSettingsResult<ModelSettingsSnapshot>>
  setProviderKey(
    command: SetProviderKeyCommand,
  ): Promise<ModelSettingsResult<ModelSettingsSnapshot>>
  clearProviderKey(
    command: ClearProviderKeyCommand,
  ): Promise<ModelSettingsResult<ModelSettingsSnapshot>>
  saveCustomProvider(
    command: SaveCustomProviderCommand,
  ): Promise<ModelSettingsResult<ModelSettingsSnapshot>>
  removeCustomProvider(
    command: RemoveCustomProviderCommand,
  ): Promise<ModelSettingsResult<ModelSettingsSnapshot>>
  setDefaultModel(
    command: SetDefaultModelCommand,
  ): Promise<ModelSettingsResult<ModelSettingsSnapshot>>
}

export const MODEL_SETTINGS_CHANNELS = {
  status: 'corn:model-settings:status',
  read: 'corn:model-settings:read',
  setProviderKey: 'corn:model-settings:set-key',
  clearProviderKey: 'corn:model-settings:clear-key',
  saveCustomProvider: 'corn:model-settings:save-provider',
  removeCustomProvider: 'corn:model-settings:remove-provider',
  setDefaultModel: 'corn:model-settings:set-default',
} as const satisfies Record<keyof ModelSettingsBridge, string>

/** Route ids a custom provider may take (official `CustomProviderCard` rule). */
export const CUSTOM_ROUTE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u
export const MAX_KEY_LENGTH = 4_096
export const MAX_CUSTOM_MODELS = 64
export const MAX_FIELD_LENGTH = 200
export const MAX_BASE_URL_LENGTH = 2_048

const LEGAL_API_KEY = /^[\x21-\x7E]+$/u
const ENV_LINE = /^[A-Z][A-Z0-9_]*=[^=]/u

export type ApiKeyProblem = 'blank' | 'format' | 'too_long'

/**
 * Mirrors the official `apiKeyFailure`: printable ASCII without spaces, not a
 * pasted `NAME=value` line, not wrapped in quotes. Callers trim first.
 */
export function apiKeyProblem(key: string): ApiKeyProblem | null {
  if (key.length === 0) return 'blank'
  if (key.length > MAX_KEY_LENGTH) return 'too_long'
  const quoted =
    key.length > 1 && /^["'`]/u.test(key) && key.endsWith(key[0] as string)
  if (ENV_LINE.test(key) || quoted || !LEGAL_API_KEY.test(key)) return 'format'
  return null
}

export function isHttpUrl(value: string): boolean {
  if (value.length === 0 || value.length > MAX_BASE_URL_LENGTH) return false
  try {
    const url = new URL(value)
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.username === '' &&
      url.password === ''
    )
  } catch {
    return false
  }
}
