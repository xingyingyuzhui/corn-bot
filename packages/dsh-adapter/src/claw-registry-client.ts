import { RemoteError, record } from './remote-error.ts'
import type { ClawPolicyPreset, HostTransport } from './transport.ts'

export interface ClawAgent {
  readonly agentId: string
  readonly workspaceId: string
  readonly canonicalRoot: string
  readonly dshPreset: string
}

/**
 * One `registry/list` agent row (Claw `projectAgent`). Paths to identity
 * files, the full policy and the per-agent model are deliberately dropped.
 */
export interface ClawAgentRow extends ClawAgent {
  /** Sanitized title (`sanitizeAgentTitle`), the live workspace title when present. */
  readonly title: string
  readonly status: 'active' | 'archived'
  /** Claw policy preset id (`agent.preset`). */
  readonly policyPreset: string
  /** Host clock, epoch ms, parsed from the registry ISO timestamp. */
  readonly createdAt: number
  readonly sessionIds: readonly string[]
  readonly workspacePresent: boolean
}

export type ClawBindingState = 'provisioning' | 'needs_model' | 'ready'
export type ClawBindingSource = 'create' | 'adopt' | 'migration'

export interface ClawBindingRow {
  readonly sessionId: string
  readonly agentId: string
  readonly workspaceId: string
  readonly presetId: string
  readonly state: ClawBindingState
  readonly source: ClawBindingSource
  readonly createdAt: number
  readonly updatedAt: number
}

export interface ClawRegistryList {
  readonly revision: number
  readonly agents: readonly ClawAgentRow[]
  readonly bindings: readonly ClawBindingRow[]
}

const BINDING_STATES = new Set<string>(['provisioning', 'needs_model', 'ready'])
const BINDING_SOURCES = new Set<string>(['create', 'adopt', 'migration'])

const invalid = (what: string) =>
  new RemoteError('corn/invalid-response', `Invalid Claw Registry ${what}`)

const isId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0

function timestamp(value: unknown, what: string): number {
  const time = typeof value === 'string' ? Date.parse(value) : Number.NaN
  if (!Number.isFinite(time)) throw invalid(what)
  return time
}

function identity(value: Record<string, unknown>): ClawAgent {
  if (
    !isId(value.agentId) ||
    !value.agentId.startsWith('wa_') ||
    !isId(value.workspaceId) ||
    typeof value.canonicalRoot !== 'string' ||
    !isId(value.dshPreset) ||
    !value.dshPreset.startsWith('wa-')
  )
    throw new Error('Claw Registry returned an invalid agent identity')
  return {
    agentId: value.agentId,
    workspaceId: value.workspaceId,
    canonicalRoot: value.canonicalRoot,
    dshPreset: value.dshPreset,
  }
}

function agentRow(raw: unknown): ClawAgentRow {
  const value = record(raw)
  const base = identity(value)
  if (
    typeof value.title !== 'string' ||
    (value.status !== 'active' && value.status !== 'archived') ||
    !isId(value.preset) ||
    !Array.isArray(value.sessionIds) ||
    !value.sessionIds.every(isId) ||
    typeof value.workspacePresent !== 'boolean'
  )
    throw invalid('agent row')
  return {
    ...base,
    title: value.title,
    status: value.status,
    policyPreset: value.preset,
    createdAt: timestamp(value.createdAt, 'agent time'),
    sessionIds: value.sessionIds as string[],
    workspacePresent: value.workspacePresent,
  }
}

function bindingRow(raw: unknown): ClawBindingRow {
  const value = record(raw)
  if (
    !isId(value.sessionId) ||
    !isId(value.agentId) ||
    typeof value.workspaceId !== 'string' ||
    typeof value.presetId !== 'string' ||
    typeof value.state !== 'string' ||
    !BINDING_STATES.has(value.state) ||
    typeof value.source !== 'string' ||
    !BINDING_SOURCES.has(value.source)
  )
    throw invalid('binding row')
  return {
    sessionId: value.sessionId,
    agentId: value.agentId,
    workspaceId: value.workspaceId,
    presetId: value.presetId,
    state: value.state as ClawBindingState,
    source: value.source as ClawBindingSource,
    createdAt: timestamp(value.createdAt, 'binding time'),
    updatedAt: timestamp(value.updatedAt, 'binding time'),
  }
}

export class ClawRegistryClient {
  readonly transport: HostTransport
  constructor(transport: HostTransport) {
    this.transport = transport
  }

  async create(name: string): Promise<ClawAgent> {
    const result = await this.transport.registry('create', { name })
    return identity(record(result.agent))
  }

  async ensurePreset(agent: ClawAgent): Promise<void> {
    const result = await this.transport.registry('preset/ensure', {
      agentId: agent.agentId,
    })
    if (result.presetId !== agent.dshPreset)
      throw new Error('Claw preset does not match the registered Bot')
  }

  async revision(
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<number> {
    const value = await this.transport.registry('list', {}, options)
    if (!Number.isSafeInteger(value.revision))
      throw new Error('Invalid Claw Registry revision')
    return value.revision as number
  }

  /**
   * Structured agents and Session bindings; one malformed row rejects the
   * whole list. Host paths (`home`, `clawHome`, identity `files`) are dropped.
   */
  async list(
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<ClawRegistryList> {
    const value = await this.transport.registry('list', {}, options)
    if (
      !Number.isSafeInteger(value.revision) ||
      !Array.isArray(value.agents) ||
      !Array.isArray(value.bindings)
    )
      throw invalid('list')
    return {
      revision: value.revision as number,
      agents: value.agents.map(agentRow),
      bindings: value.bindings.map(bindingRow),
    }
  }

  /** Sets a Claw policy preset; the transport admits only this exact shape. */
  async policy(agentId: string, preset: ClawPolicyPreset): Promise<void> {
    const result = await this.transport.registry('policy', {
      agentId,
      policy: { preset },
    })
    const agent = record(result.agent)
    if (agent.agentId !== agentId || agent.preset !== preset)
      throw new Error('Claw policy preset was not applied as requested')
  }

  async bind(agent: ClawAgent, sessionId: string): Promise<void> {
    await this.transport.registry('session/bind', {
      sessionId,
      agentId: agent.agentId,
      source: 'create',
      state: 'provisioning',
      expectedRevision: await this.revision(),
    })
  }

  async state(
    sessionId: string,
    state: 'ready' | 'needs_model',
  ): Promise<void> {
    await this.transport.registry('session/state', {
      sessionId,
      state,
      expectedRevision: await this.revision(),
    })
  }
}
