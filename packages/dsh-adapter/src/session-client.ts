import { record } from './remote-error.ts'
import type { HostTransport } from './transport.ts'

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

  selectModel(request: {
    sessionId: string
    provider: string
    model: string
    reasoningEffort?: string
  }): Promise<unknown> {
    return this.transport.rpc('session/selectModel', { request })
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
}
