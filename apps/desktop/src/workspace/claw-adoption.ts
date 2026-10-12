import type {
  ClawAgentRow,
  ClawRegistryList,
} from '../../../../packages/dsh-adapter/src/claw-registry-client.ts'

/** Claw `AGENT_TITLE_MAX` (dsh-claw-registry `registry-claw.mjs`, v0.3.0-rc.2). */
export const CLAW_TITLE_MAX = 80

// biome-ignore lint/suspicious/noControlCharactersInRegex: mirrors Claw's control-character rule
const CONTROL = /[\u0000-\u001f\u007f]/gu

/** Port of Claw `sanitizeAgentTitle`: the title `registry/create` stores for a name. */
export function sanitizeAgentTitle(name: string): string {
  const text = name.replace(CONTROL, ' ').replace(/\s+/gu, ' ').trim()
  return text.length > CLAW_TITLE_MAX
    ? text.slice(0, CLAW_TITLE_MAX).trim()
    : text
}

export interface AdoptionQuery {
  /** The name sent to `registry/create`; compared after Claw's sanitizing. */
  readonly name: string
  /** Corn clock when the create attempt was checkpointed. */
  readonly attemptedAt: number
  /** Allowance for the Host clock that stamps `createdAt` running behind Corn's. */
  readonly clockSkewMs: number
  /** The Session this Bot planned; the only binding a candidate may already carry. */
  readonly sessionId: string
  /** Agent ids some Corn Bot already maps (`claw_agents`). */
  readonly knownAgentIds: ReadonlySet<string>
}

export type AdoptionResult =
  | { readonly kind: 'adopt'; readonly agent: ClawAgentRow }
  | { readonly kind: 'none' }
  | { readonly kind: 'ambiguous'; readonly agentIds: readonly string[] }

/**
 * Decision 16A: after a lost `registry/create` reply, adopt only when exactly
 * one active agent has the sanitized title, was created after the attempt,
 * and no Corn Bot or other Session references it. Anything else is reported.
 */
export function findAdoptionCandidate(
  list: ClawRegistryList,
  query: AdoptionQuery,
): AdoptionResult {
  const title = sanitizeAgentTitle(query.name)
  const foreignBound = new Set(
    list.bindings
      .filter((binding) => binding.sessionId !== query.sessionId)
      .map((binding) => binding.agentId),
  )
  const candidates = list.agents.filter(
    (agent) =>
      agent.status === 'active' &&
      agent.title === title &&
      agent.createdAt >= query.attemptedAt - query.clockSkewMs &&
      !query.knownAgentIds.has(agent.agentId) &&
      !foreignBound.has(agent.agentId) &&
      agent.sessionIds.every((sessionId) => sessionId === query.sessionId),
  )
  const [only, ...rest] = candidates
  if (only === undefined) return { kind: 'none' }
  if (rest.length === 0) return { kind: 'adopt', agent: only }
  return {
    kind: 'ambiguous',
    agentIds: candidates.map((agent) => agent.agentId),
  }
}
