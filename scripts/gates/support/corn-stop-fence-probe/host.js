import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'

// PROBE-ONLY — NOT PRODUCT CODE. A gate fixture for U2 Option C
// (docs/milestones/U2-STOP-SETTLEMENT-DRAFT.md §4): an `agent/pre-step`
// listener that rejects every step of a fenced Session and of its subagent
// lineage, shaped like DSH's `archived-session-gate`. It only loads in a
// disposable gate home, and it records each pre-step it sees so the probe can
// count woken Turns. Never register it in a product profile; the real fence,
// if adopted, belongs to Corn run control behind a maintainer decision.

export const name = 'corn-stop-fence-probe'
export const inject = ['agents', 'connection', 'sessions']
const GATE_PURPOSE = 'dsh-headless-gate'
const MAX_ROWS = 500

export function apply(ctx, config = {}) {
  if (config.enabled !== true) return
  const home = realpathSync(process.env.DSH_HOME)
  const marker = JSON.parse(
    readFileSync(join(home, '.corn-bot-home.json'), 'utf8'),
  )
  if (
    home !== realpathSync(config.testHome) ||
    marker.owner !== 'corn-bot' ||
    marker.purpose !== GATE_PURPOSE
  )
    throw new Error('Stop-fence probe requires its disposable gate home')

  const fenced = new Set()
  const decisions = []

  /** The fenced Session that owns this Agent's lineage, if any. */
  function fencedOwner(agent) {
    let header = agent.session.header
    const visited = new Set()
    while (!visited.has(header.id)) {
      if (fenced.has(header.id)) return header.id
      visited.add(header.id)
      if (header.origin !== 'subagent' || header.parentSession === undefined)
        return null
      const parent = ctx.sessions.get(header.parentSession)
      if (parent === undefined)
        return fenced.has(header.parentSession) ? header.parentSession : null
      header = parent.header
    }
    return null
  }

  ctx.on(
    'agent/pre-step',
    (payload, next) => {
      const owner = fencedOwner(payload.agent)
      if (decisions.length < MAX_ROWS)
        decisions.push({
          at: Date.now(),
          sessionId: payload.agent.session.header.id,
          turn: payload.turn,
          step: payload.step,
          claimed: payload.messages.map((message) => ({
            source: message.source?.kind ?? null,
            form: message.source?.form ?? null,
          })),
          fencedBy: owner,
          decision: owner === null ? 'next' : 'reject',
        })
      return owner === null ? next() : Promise.resolve({ kind: 'reject' })
    },
    { prepend: config.prepend === true },
  )

  /** Owners of every `agent/pre-step` listener, outermost first. */
  function hookOrder() {
    const hooks = ctx.events?._hooks?.['agent/pre-step'] ?? []
    return hooks.map((hook) => ({
      plugin:
        hook.ctx?.fiber?.entry?.options?.name ??
        hook.ctx?.fiber?.runtime?.name ??
        null,
      entryId: hook.ctx?.fiber?.entry?.id ?? null,
      prepend: hook.prepend === true,
      probe: hook.ctx === ctx,
    }))
  }

  const actions = {
    fence({ sessionId }) {
      if (typeof sessionId !== 'string' || !ctx.agents.get(sessionId))
        throw new Error('Only a live Session may be fenced')
      fenced.add(sessionId)
      return { fenced: [...fenced] }
    },
    lift({ sessionId }) {
      fenced.delete(sessionId)
      return { fenced: [...fenced] }
    },
    state() {
      return {
        fenced: [...fenced],
        prepend: config.prepend === true,
        hookOrder: hookOrder(),
        decisions,
      }
    },
  }
  for (const [action, handle] of Object.entries(actions)) {
    const dispose = ctx.connection.fetch.register({
      path: `/api/corn-stop-fence-probe/${action}`,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const text = await request.text()
          if (text.length > 2048) throw new Error('Probe request too large')
          return Response.json(
            { ok: true, ...handle(JSON.parse(text || '{}')) },
            { headers: { 'Cache-Control': 'no-store' } },
          )
        } catch {
          return Response.json(
            { ok: false, error: 'Probe request rejected' },
            { status: 400 },
          )
        }
      },
    })
    ctx.effect(() => () => {
      void Promise.resolve(dispose).then((stop) => stop())
    })
  }
}
