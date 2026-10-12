import { RemoteError, record } from './remote-error.ts'
import type { HostTransport } from './transport.ts'

export interface CatalogSelection {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

export interface CatalogModel {
  readonly id: string
  readonly name: string
  readonly efforts: readonly string[]
  readonly defaultEffort?: string
}

export interface CatalogGroup {
  readonly id: string
  readonly name: string
  readonly models: readonly CatalogModel[]
}

export interface ModelCatalog {
  readonly default: CatalogSelection | null
  readonly routableProviders: readonly string[]
  readonly groups: readonly CatalogGroup[]
  readonly failures: number
}

const invalid = () =>
  new RemoteError('corn/invalid-response', 'Invalid model catalog')
const isString = (value: unknown): value is string => typeof value === 'string'

export function parseSelection(value: unknown): CatalogSelection | null {
  if (value === null || value === undefined) return null
  const row = record(value)
  if (!isString(row.provider) || !isString(row.model)) throw invalid()
  return {
    provider: row.provider,
    model: row.model,
    ...(isString(row.reasoningEffort)
      ? { reasoningEffort: row.reasoningEffort }
      : {}),
  }
}

function parseModel(value: unknown): CatalogModel {
  const row = record(value)
  if (!isString(row.id)) throw invalid()
  const reasoning =
    row.reasoning === undefined || row.reasoning === null
      ? undefined
      : record(row.reasoning)
  const efforts = Array.isArray(reasoning?.efforts)
    ? reasoning.efforts.map((effort) => {
        const id = record(effort).id
        if (!isString(id)) throw invalid()
        return id
      })
    : []
  return {
    id: row.id,
    name: isString(row.name) ? row.name : row.id,
    efforts,
    ...(isString(reasoning?.defaultEffort)
      ? { defaultEffort: reasoning.defaultEffort }
      : {}),
  }
}

/** Official `session.modelCatalog`: routable groups and the stored global default. */
export class ModelCatalogClient {
  readonly transport: HostTransport

  constructor(transport: HostTransport) {
    this.transport = transport
  }

  async read(): Promise<ModelCatalog> {
    const value = record(await this.transport.rpc('session/modelCatalog', {}))
    if (
      !Array.isArray(value.groups) ||
      !Array.isArray(value.routableProviders) ||
      !value.routableProviders.every(isString)
    )
      throw invalid()
    return {
      default: parseSelection(value.default),
      routableProviders: value.routableProviders,
      groups: value.groups.map((item) => {
        const group = record(item)
        if (
          !isString(group.id) ||
          !isString(group.name) ||
          !Array.isArray(group.models)
        )
          throw invalid()
        return {
          id: group.id,
          name: group.name,
          models: group.models.map(parseModel),
        }
      }),
      failures: Array.isArray(value.failures) ? value.failures.length : 0,
    }
  }
}
