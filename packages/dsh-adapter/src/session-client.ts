import { record } from './remote-error.ts'
import type { HostTransport } from './transport.ts'

export interface ModelSelection {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

export class SessionClient {
  readonly transport: HostTransport
  #inFlight = new Map<string, Promise<unknown>>()
  #lanes = new Map<string, Promise<unknown>>()

  constructor(transport: HostTransport) {
    this.transport = transport
  }

  async list(): Promise<readonly unknown[]> {
    const value = record(
      await this.transport.rpc('session/list', { _request: {} }),
    )
    if (!Array.isArray(value.items)) throw new Error('Invalid Session list')
    return value.items
  }

  async create(request: {
    sessionId: string
    cwd: string
    agentPreset: string
  }): Promise<{ sessionId: string; agentPreset: string }> {
    const value = record(
      await this.transport.rpc('session/create', { request }),
    )
    if (
      value.sessionId !== request.sessionId ||
      value.agentPreset !== request.agentPreset
    ) {
      throw new Error(
        'Session identity or preset differs from requested Claw binding',
      )
    }
    return { sessionId: request.sessionId, agentPreset: request.agentPreset }
  }

  modelCatalog(): Promise<unknown> {
    return this.transport.rpc('session/modelCatalog', {})
  }

  /**
   * Selects a model for this Session only (DSH patch U1); the global default
   * and every other Session stay unchanged. An unpatched Host would drop
   * `scope` and save the default, so a reply without the session scope is refused.
   */
  async selectSessionModel(
    request: { readonly sessionId: string } & ModelSelection,
  ): Promise<ModelSelection> {
    const value = record(
      await this.transport.rpc('session/selectModel', {
        request: { ...request, scope: 'session' },
      }),
    )
    if (value.scope !== 'session')
      throw new Error('Host did not apply a Session-only model selection')
    const selected = record(value.selected)
    const effort = selected.reasoningEffort
    if (
      selected.provider !== request.provider ||
      selected.model !== request.model ||
      (effort !== undefined && typeof effort !== 'string') ||
      (request.reasoningEffort !== undefined &&
        effort !== request.reasoningEffort)
    )
      throw new Error('Host selected a different model than requested')
    return {
      provider: request.provider,
      model: request.model,
      ...(typeof effort === 'string' ? { reasoningEffort: effort } : {}),
    }
  }

  /** Admission receipt only; completion must come from durable Turn events. */
  prompt(request: {
    sessionId: string
    requestId: string
    mode: 'queue' | 'steer'
    content: readonly { type: 'text'; text: string }[]
    clientTimeZone: string
  }): Promise<unknown> {
    const key = JSON.stringify([request.sessionId, request.requestId])
    const existing = this.#inFlight.get(key)
    if (existing) return existing
    const admitted = (this.#lanes.get(request.sessionId) ?? Promise.resolve())
      .catch(() => {})
      .then(() => this.transport.rpc('session/prompt', { request }))
    this.#inFlight.set(key, admitted)
    this.#lanes.set(request.sessionId, admitted)
    const release = () => {
      this.#inFlight.delete(key)
      if (this.#lanes.get(request.sessionId) === admitted)
        this.#lanes.delete(request.sessionId)
    }
    void admitted.then(release, release)
    return admitted
  }

  /** Cancels the active Turn; pending inbox messages remain. */
  cancel(sessionId: string): Promise<unknown> {
    return this.transport.rpc('session/cancel', { request: { sessionId } })
  }

  /** Non-activating projection baseline at `asOfSeq`; `null` for an unknown Session. */
  projections(sessionId: string): Promise<unknown> {
    return this.transport.rpc('session/projections', { request: { sessionId } })
  }

  /** Mutates one still-pending inbox item; the receipt is not an adoption record. */
  updateQueue(request: {
    sessionId: string
    itemId: string
    action:
      | { kind: 'edit'; content: readonly { type: 'text'; text: string }[] }
      | { kind: 'remove' }
      | { kind: 'steer' }
  }): Promise<unknown> {
    return this.transport.rpc('session/updateQueue', { request })
  }
}
