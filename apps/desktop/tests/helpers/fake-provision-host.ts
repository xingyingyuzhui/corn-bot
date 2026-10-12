import type { ModelSelection } from '../../../../packages/contracts/src/model-settings.ts'
import { ClawRegistryClient } from '../../../../packages/dsh-adapter/src/claw-registry-client.ts'
import { ModelCatalogClient } from '../../../../packages/dsh-adapter/src/model-catalog-client.ts'
import { RemoteError } from '../../../../packages/dsh-adapter/src/remote-error.ts'
import { SessionClient } from '../../../../packages/dsh-adapter/src/session-client.ts'
import type { HostTransport } from '../../../../packages/dsh-adapter/src/transport.ts'
import { sanitizeAgentTitle } from '../../src/workspace/claw-adoption.ts'

export type FakeOp =
  | 'registry/create'
  | 'registry/preset/ensure'
  | 'registry/policy'
  | 'registry/list'
  | 'registry/session/bind'
  | 'registry/session/state'
  | 'session/create'
  | 'session/selectModel'
  | 'session/modelCatalog'

/**
 * `reject`: a closed Host/Claw error before anything is applied.
 * `dropped`: the request never arrived (network error, nothing applied).
 * `lost`: applied, then the reply is lost (network error).
 */
export type Fault =
  | { readonly mode: 'reject'; readonly code: string }
  | { readonly mode: 'dropped' }
  | { readonly mode: 'lost' }

interface AgentRecord {
  readonly agentId: string
  readonly workspaceId: string
  readonly canonicalRoot: string
  readonly dshPreset: string
  readonly title: string
  preset: string
  readonly createdAt: number
}

interface BindingRecord {
  readonly sessionId: string
  readonly agentId: string
  state: string
  readonly createdAt: number
  updatedAt: number
}

export const CATALOG_PROVIDER = 'fake'
export const MODEL_A: ModelSelection = {
  provider: CATALOG_PROVIDER,
  model: 'corn-gate-model',
}
export const MODEL_ALT: ModelSelection = {
  provider: CATALOG_PROVIDER,
  model: 'corn-gate-model-alt',
}
export const MODEL_THIRD: ModelSelection = {
  provider: CATALOG_PROVIDER,
  model: 'corn-gate-model-third',
  reasoningEffort: 'high',
}
const CATALOG_MODELS = [MODEL_A.model, MODEL_ALT.model, MODEL_THIRD.model]

const iso = (time: number) => new Date(time).toISOString()

/** Claw Registry + DSH Session RPC as Corn sees them on the wire (v0.3.0-rc.2 / dsh-v0.2.0-rc.2). */
export class FakeProvisionHost {
  readonly clock: { value: number }
  /** Host clock offset from Corn's, ms. */
  hostOffsetMs = 0
  revision = 1
  readonly agents = new Map<string, AgentRecord>()
  readonly bindings = new Map<string, BindingRecord>()
  readonly sessions = new Map<
    string,
    { readonly cwd: string; readonly agentPreset: string }
  >()
  readonly calls: { readonly op: string; readonly body: unknown }[] = []
  readonly faults = new Map<FakeOp, Fault[]>()
  readonly holds = new Map<FakeOp, Promise<void>>()
  globalDefault: ModelSelection | null = MODEL_A
  /** Replaces the `selectModel` echo (wrong model) when set. */
  selectEcho: ModelSelection | null = null
  /** Replaces the `session/create` echo's preset when set (Session still created). */
  createEchoPreset: string | null = null
  #agentSeq = 0

  constructor(clock: { value: number }) {
    this.clock = clock
  }

  get transport(): HostTransport {
    return this as unknown as HostTransport
  }

  clients() {
    return {
      registry: new ClawRegistryClient(this.transport),
      sessions: new SessionClient(this.transport),
      catalog: new ModelCatalogClient(this.transport),
    }
  }

  fail(op: FakeOp, ...faults: Fault[]): void {
    this.faults.set(op, [...(this.faults.get(op) ?? []), ...faults])
  }

  /** Holds `op` until the returned release is called. */
  hold(op: FakeOp): () => void {
    let release = () => {}
    this.holds.set(
      op,
      new Promise<void>((resolve) => {
        release = () => {
          this.holds.delete(op)
          resolve()
        }
      }),
    )
    return release
  }

  count(op: string): number {
    return this.calls.filter((call) => call.op === op).length
  }

  bodies(op: string): unknown[] {
    return this.calls.filter((call) => call.op === op).map((call) => call.body)
  }

  /** An agent created out of band, e.g. a duplicate from a lost create. */
  addAgent(name: string, createdAt = this.#hostNow()): string {
    return this.#createAgent(name, createdAt).agentId
  }

  #hostNow(): number {
    return this.clock.value + this.hostOffsetMs
  }

  async #enter(op: FakeOp, body: unknown): Promise<Fault | null> {
    this.calls.push({ op, body: structuredClone(body) })
    const hold = this.holds.get(op)
    if (hold !== undefined) await hold
    const fault = this.faults.get(op)?.shift() ?? null
    if (fault?.mode === 'reject') throw new RemoteError(fault.code, 'rejected')
    if (fault?.mode === 'dropped') throw new TypeError('fetch failed')
    return fault
  }

  #exit<T>(fault: Fault | null, value: T): T {
    if (fault?.mode === 'lost') throw new TypeError('fetch failed')
    return value
  }

  async registry(
    action: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const op = `registry/${action}` as FakeOp
    const fault = await this.#enter(op, body)
    return this.#exit(fault, { ok: true, ...this.#registry(action, body) })
  }

  async rpc(endpoint: string, args: Record<string, unknown>): Promise<unknown> {
    const fault = await this.#enter(endpoint as FakeOp, args)
    return this.#exit(fault, this.#rpc(endpoint, args))
  }

  #createAgent(name: string, createdAt: number): AgentRecord {
    this.#agentSeq += 1
    const n = this.#agentSeq
    const title = sanitizeAgentTitle(name)
    const agent: AgentRecord = {
      agentId: `wa_${n}`,
      workspaceId: `ws_${n}`,
      canonicalRoot: `/claw/agent-${n}`,
      dshPreset: `wa-agent-${n}`,
      title,
      preset: 'research',
      createdAt,
    }
    this.agents.set(agent.agentId, agent)
    this.revision += 1
    return agent
  }

  #agentWire(agent: AgentRecord) {
    return {
      agentId: agent.agentId,
      workspaceId: agent.workspaceId,
      canonicalRoot: agent.canonicalRoot,
      dshPreset: agent.dshPreset,
    }
  }

  #requireAgent(agentId: unknown): AgentRecord {
    const agent = this.agents.get(String(agentId))
    if (agent === undefined)
      throw new RemoteError('REGISTRY_AGENT_NOT_FOUND', 'agent not found')
    return agent
  }

  #checkRevision(expected: unknown): void {
    if (expected !== undefined && expected !== this.revision)
      throw new RemoteError('REGISTRY_REVISION_CONFLICT', 'revision conflict')
  }

  #registry(
    action: string,
    body: Record<string, unknown>,
  ): Record<string, unknown> {
    switch (action) {
      case 'create': {
        const name = String(body.name ?? '')
        if (sanitizeAgentTitle(name) === '')
          throw new RemoteError('REGISTRY_NAME_INVALID', 'name required')
        const agent = this.#createAgent(name, this.#hostNow())
        return { agent: this.#agentWire(agent) }
      }
      case 'preset/ensure':
        return { presetId: this.#requireAgent(body.agentId).dshPreset }
      case 'policy': {
        const agent = this.#requireAgent(body.agentId)
        agent.preset = String((body.policy as { preset: string }).preset)
        this.revision += 1
        return { agent: { agentId: agent.agentId, preset: agent.preset } }
      }
      case 'list':
        return {
          revision: this.revision,
          agents: [...this.agents.values()].map((agent) => ({
            ...this.#agentWire(agent),
            title: agent.title,
            status: 'active',
            preset: agent.preset,
            createdAt: iso(agent.createdAt),
            sessionIds: [...this.bindings.values()]
              .filter((binding) => binding.agentId === agent.agentId)
              .map((binding) => binding.sessionId),
            workspacePresent: true,
          })),
          bindings: [...this.bindings.values()].map((binding) => {
            const agent = this.#requireAgent(binding.agentId)
            return {
              sessionId: binding.sessionId,
              agentId: binding.agentId,
              workspaceId: agent.workspaceId,
              presetId: agent.dshPreset,
              state: binding.state,
              source: 'create',
              createdAt: iso(binding.createdAt),
              updatedAt: iso(binding.updatedAt),
            }
          }),
        }
      case 'session/bind': {
        this.#checkRevision(body.expectedRevision)
        const agent = this.#requireAgent(body.agentId)
        const sessionId = String(body.sessionId)
        const session = this.sessions.get(sessionId)
        if (session === undefined)
          throw new RemoteError('REGISTRY_SESSION_NOT_FOUND', 'no session')
        if (session.agentPreset !== agent.dshPreset)
          throw new RemoteError('REGISTRY_PRESET_MISMATCH', 'preset mismatch')
        if (session.cwd !== agent.canonicalRoot)
          throw new RemoteError('REGISTRY_WORKSPACE_MISMATCH', 'cwd mismatch')
        const existing = this.bindings.get(sessionId)
        if (existing !== undefined) {
          if (existing.agentId === agent.agentId)
            return { revision: this.revision, idempotent: true }
          throw new RemoteError('REGISTRY_BIND_CONFLICT', 'bound elsewhere')
        }
        const now = this.#hostNow()
        this.bindings.set(sessionId, {
          sessionId,
          agentId: agent.agentId,
          state: String(body.state),
          createdAt: now,
          updatedAt: now,
        })
        this.revision += 1
        return { revision: this.revision }
      }
      case 'session/state': {
        this.#checkRevision(body.expectedRevision)
        const binding = this.bindings.get(String(body.sessionId))
        if (binding === undefined)
          throw new RemoteError('REGISTRY_SESSION_NOT_FOUND', 'no binding')
        binding.state = String(body.state)
        binding.updatedAt = this.#hostNow()
        this.revision += 1
        return { revision: this.revision }
      }
      default:
        throw new RemoteError('corn/endpoint-denied', `unexpected ${action}`)
    }
  }

  #catalogWire() {
    return {
      default: this.globalDefault,
      routableProviders: [CATALOG_PROVIDER],
      groups: [
        {
          id: CATALOG_PROVIDER,
          name: 'Fake',
          models: CATALOG_MODELS.map((id) => ({
            id,
            name: id,
            reasoning: { efforts: [{ id: 'low' }, { id: 'high' }] },
          })),
        },
      ],
      failures: [],
    }
  }

  #rpc(endpoint: string, args: Record<string, unknown>): unknown {
    switch (endpoint) {
      case 'session/create': {
        const request = args.request as {
          sessionId: string
          cwd: string
          agentPreset: string
        }
        const existing = this.sessions.get(request.sessionId)
        if (existing !== undefined) {
          if (existing.agentPreset !== request.agentPreset)
            throw new RemoteError('agent-preset/conflict', 'preset differs')
          if (existing.cwd !== request.cwd)
            throw new RemoteError('session/conflict', 'cwd differs')
        } else {
          this.sessions.set(request.sessionId, {
            cwd: request.cwd,
            agentPreset: request.agentPreset,
          })
        }
        return {
          sessionId: request.sessionId,
          agentPreset:
            this.createEchoPreset ??
            this.sessions.get(request.sessionId)?.agentPreset,
        }
      }
      case 'session/modelCatalog':
        return this.#catalogWire()
      case 'session/selectModel': {
        const request = args.request as ModelSelection & {
          sessionId: string
          scope?: string
        }
        if (!this.sessions.has(request.sessionId))
          throw new RemoteError('session/not-found', 'no session')
        const selected = this.selectEcho ?? {
          provider: request.provider,
          model: request.model,
          ...(request.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: request.reasoningEffort }),
        }
        return { scope: request.scope, selected }
      }
      default:
        throw new RemoteError('corn/endpoint-denied', `unexpected ${endpoint}`)
    }
  }
}
