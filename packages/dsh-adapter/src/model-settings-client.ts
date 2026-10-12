import { RemoteError, record } from './remote-error.ts'
import type { HostTransport } from './transport.ts'

/** Serialized Schemastery graph as `settings.describe` publishes it. */
export interface SerializedSchema {
  readonly uid: number
  readonly refs: Readonly<Record<string, SchemaNode>>
}

export interface SchemaNode {
  readonly type: string
  readonly meta?: Readonly<Record<string, unknown>>
  readonly value?: unknown
  readonly inner?: number
  readonly list?: readonly number[]
  readonly dict?: Readonly<Record<string, number>>
}

/** One redacted settings namespace (`SettingsNamespaceView`). */
export interface SettingsNamespace {
  readonly ns: string
  readonly schema: SerializedSchema
  readonly value: unknown
  readonly base: unknown
  readonly user: unknown
  readonly revision: number
}

export interface SettingsDescription {
  readonly writable: boolean
  readonly namespaces: readonly SettingsNamespace[]
}

export type SettingsPathOp =
  | {
      readonly op: 'set'
      readonly path: readonly string[]
      readonly value: unknown
    }
  | { readonly op: 'unset'; readonly path: readonly string[] }

export interface LlmProvider {
  readonly id: string
  readonly name: string
}

export interface ConfigurableProvider {
  readonly provider: string
  readonly displayName: string
  readonly settingsNs: string
  readonly settingsPath: readonly string[]
  readonly declared?: boolean
}

const invalid = (what: string) =>
  new RemoteError('corn/invalid-response', `Invalid ${what}`)

const isString = (value: unknown): value is string => typeof value === 'string'
const isRevision = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0

function parseSchema(value: unknown): SerializedSchema {
  const schema = record(value)
  const refs = record(schema.refs)
  if (!Number.isSafeInteger(schema.uid)) throw invalid('settings schema')
  return { uid: schema.uid as number, refs: refs as SerializedSchema['refs'] }
}

export function parseNamespace(value: unknown): SettingsNamespace {
  const row = record(value)
  if (!isString(row.ns) || !isRevision(row.revision))
    throw invalid('settings namespace')
  return {
    ns: row.ns,
    schema: parseSchema(row.schema),
    value: row.value,
    base: row.base,
    user: row.user,
    revision: row.revision,
  }
}

/** Official settings and LLM-registry Remotes, limited to what Corn's Models page needs. */
export class ModelSettingsClient {
  readonly transport: HostTransport

  constructor(transport: HostTransport) {
    this.transport = transport
  }

  async describe(): Promise<SettingsDescription> {
    const value = record(await this.transport.rpc('settings/describe', {}))
    if (typeof value.writable !== 'boolean' || !Array.isArray(value.namespaces))
      throw invalid('settings description')
    return {
      writable: value.writable,
      namespaces: value.namespaces.map(parseNamespace),
    }
  }

  /** Resets the namespace's live fields to the composition base, then applies `section`. */
  async replace(
    ns: string,
    section: Readonly<Record<string, unknown>>,
    expectedRevision: number,
  ): Promise<SettingsNamespace> {
    return parseNamespace(
      await this.transport.rpc('settings/replace', {
        ns,
        section,
        expectedRevision,
      }),
    )
  }

  async mutate(
    ns: string,
    ops: readonly SettingsPathOp[],
    expectedRevision: number,
  ): Promise<SettingsNamespace> {
    return parseNamespace(
      await this.transport.rpc('settings/mutate', {
        ns,
        ops,
        expectedRevision,
      }),
    )
  }

  async listProviders(): Promise<readonly LlmProvider[]> {
    const value = await this.transport.rpc('llm/listProviders', {})
    if (!Array.isArray(value)) throw invalid('provider list')
    return value.map((item) => {
      const row = record(item)
      if (!isString(row.id) || !isString(row.name)) throw invalid('provider')
      return { id: row.id, name: row.name }
    })
  }

  async listConfigurableProviders(): Promise<readonly ConfigurableProvider[]> {
    const value = await this.transport.rpc('llm/listConfigurableProviders', {})
    if (!Array.isArray(value)) throw invalid('configurable provider list')
    return value.map((item) => {
      const row = record(item)
      if (
        !isString(row.provider) ||
        !isString(row.displayName) ||
        !isString(row.settingsNs) ||
        !Array.isArray(row.settingsPath) ||
        !row.settingsPath.every(isString)
      )
        throw invalid('configurable provider')
      return {
        provider: row.provider,
        displayName: row.displayName,
        settingsNs: row.settingsNs,
        settingsPath: row.settingsPath,
        ...(typeof row.declared === 'boolean'
          ? { declared: row.declared }
          : {}),
      }
    })
  }
}
