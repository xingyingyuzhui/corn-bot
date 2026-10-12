import {
  apiKeyProblem,
  type ClearProviderKeyCommand,
  CUSTOM_ROUTE_PATTERN,
  type CustomModelEntry,
  type CustomProviderFields,
  isHttpUrl,
  MAX_CUSTOM_MODELS,
  MAX_FIELD_LENGTH,
  type ModelSelection,
  type RemoveCustomProviderCommand,
  type SaveCustomProviderCommand,
  type SetDefaultModelCommand,
  type SetProviderKeyCommand,
} from '../../../../packages/contracts/src/model-settings.ts'

/**
 * Runtime validation of Renderer payloads. TypeScript types do not cross IPC,
 * so every command is rebuilt from exactly the allowed keys; anything else is
 * refused before Main reads the Host.
 */
type Fields = Readonly<Record<string, unknown>>

function exact(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Fields | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return null
  if (Object.getPrototypeOf(value) !== Object.prototype) return null
  const keys = Object.keys(value)
  const allowed = new Set([...required, ...optional])
  if (!required.every((key) => keys.includes(key))) return null
  if (!keys.every((key) => allowed.has(key))) return null
  return value as Fields
}

const isCounter = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0

const isText = (value: unknown, max = MAX_FIELD_LENGTH): value is string =>
  typeof value === 'string' &&
  value.length <= max &&
  value.trim() === value &&
  !/\p{Cc}/u.test(value)

const isId = (value: unknown): value is string =>
  isText(value) && (value as string).length > 0

/** The key is trimmed of paste whitespace, then must pass the official charset rule. */
function key(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return apiKeyProblem(trimmed) === null ? trimmed : null
}

function selection(value: unknown): ModelSelection | null {
  const row = exact(value, ['provider', 'model'], ['reasoningEffort'])
  if (!row || !isId(row.provider) || !isId(row.model)) return null
  if (row.reasoningEffort === undefined)
    return { provider: row.provider, model: row.model }
  if (!isId(row.reasoningEffort)) return null
  return {
    provider: row.provider,
    model: row.model,
    reasoningEffort: row.reasoningEffort,
  }
}

function model(value: unknown): CustomModelEntry | null {
  const row = exact(value, ['id'], ['name'])
  if (!row || !isId(row.id)) return null
  if (row.name === undefined || row.name === '') return { id: row.id }
  return isText(row.name) ? { id: row.id, name: row.name } : null
}

function fields(value: unknown): CustomProviderFields | null {
  const row = exact(value, ['displayName', 'protocol', 'baseURL', 'models'])
  if (
    !row ||
    !isText(row.displayName) ||
    !isId(row.protocol) ||
    typeof row.baseURL !== 'string' ||
    !isHttpUrl(row.baseURL) ||
    !Array.isArray(row.models) ||
    row.models.length === 0 ||
    row.models.length > MAX_CUSTOM_MODELS
  )
    return null
  const models = row.models.map(model)
  if (models.some((entry) => entry === null)) return null
  const ids = models.map((entry) => entry?.id)
  if (new Set(ids).size !== ids.length) return null
  return {
    displayName: row.displayName,
    protocol: row.protocol,
    baseURL: row.baseURL,
    models: models as CustomModelEntry[],
  }
}

export function parseSetProviderKey(
  value: unknown,
): SetProviderKeyCommand | null {
  const row = exact(value, ['generation', 'providerId', 'revision', 'key'])
  if (!row || !isCounter(row.generation) || !isCounter(row.revision))
    return null
  const typed = key(row.key)
  if (!isId(row.providerId) || typed === null) return null
  return {
    generation: row.generation,
    providerId: row.providerId,
    revision: row.revision,
    key: typed,
  }
}

export function parseClearProviderKey(
  value: unknown,
): ClearProviderKeyCommand | null {
  const row = exact(value, ['generation', 'providerId'])
  if (!row || !isCounter(row.generation) || !isId(row.providerId)) return null
  return { generation: row.generation, providerId: row.providerId }
}

export function parseSaveCustomProvider(
  value: unknown,
): SaveCustomProviderCommand | null {
  const row = exact(
    value,
    ['generation', 'mode', 'providerId', 'revision', 'fields'],
    ['key'],
  )
  if (
    !row ||
    !isCounter(row.generation) ||
    !isCounter(row.revision) ||
    (row.mode !== 'create' && row.mode !== 'update') ||
    typeof row.providerId !== 'string' ||
    !CUSTOM_ROUTE_PATTERN.test(row.providerId) ||
    row.providerId.length > MAX_FIELD_LENGTH
  )
    return null
  const parsed = fields(row.fields)
  if (!parsed) return null
  const command = {
    generation: row.generation,
    mode: row.mode,
    providerId: row.providerId,
    revision: row.revision,
    fields: parsed,
  } as const
  if (row.key === undefined || row.key === '') return command
  const typed = key(row.key)
  return typed === null ? null : { ...command, key: typed }
}

export function parseRemoveCustomProvider(
  value: unknown,
): RemoveCustomProviderCommand | null {
  const row = exact(value, ['generation', 'providerId', 'revision'])
  if (
    !row ||
    !isCounter(row.generation) ||
    !isCounter(row.revision) ||
    !isId(row.providerId)
  )
    return null
  return {
    generation: row.generation,
    providerId: row.providerId,
    revision: row.revision,
  }
}

export function parseSetDefaultModel(
  value: unknown,
): SetDefaultModelCommand | null {
  const row = exact(value, ['generation', 'revision', 'selection'])
  if (!row || !isCounter(row.generation) || !isCounter(row.revision))
    return null
  const parsed = selection(row.selection)
  return parsed
    ? { generation: row.generation, revision: row.revision, selection: parsed }
    : null
}
