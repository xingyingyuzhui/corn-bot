import { record } from './remote-error.ts'
import type { HostTransport } from './transport.ts'

export interface ClawAgent {
  readonly agentId: string
  readonly workspaceId: string
  readonly canonicalRoot: string
  readonly dshPreset: string
}

export class ClawRegistryClient {
  readonly transport: HostTransport
  constructor(transport: HostTransport) {
    this.transport = transport
  }

  async create(name: string): Promise<ClawAgent> {
    const result = await this.transport.registry('create', { name })
    const agent = record(result.agent)
    if (
      typeof agent.agentId !== 'string' ||
      !agent.agentId.startsWith('wa_') ||
      typeof agent.workspaceId !== 'string' ||
      typeof agent.canonicalRoot !== 'string' ||
      typeof agent.dshPreset !== 'string' ||
      !agent.dshPreset.startsWith('wa-')
    ) {
      throw new Error('Claw Registry returned an invalid agent identity')
    }
    return {
      agentId: agent.agentId,
      workspaceId: agent.workspaceId,
      canonicalRoot: agent.canonicalRoot,
      dshPreset: agent.dshPreset,
    }
  }

  async ensurePreset(agent: ClawAgent): Promise<void> {
    const result = await this.transport.registry('preset/ensure', {
      agentId: agent.agentId,
    })
    if (result.presetId !== agent.dshPreset)
      throw new Error('Claw preset does not match the registered Bot')
  }

  async revision(): Promise<number> {
    const value = await this.transport.registry('list', {})
    if (!Number.isSafeInteger(value.revision))
      throw new Error('Invalid Claw Registry revision')
    return value.revision as number
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
