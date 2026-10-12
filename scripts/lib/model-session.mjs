import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { ClawRegistryClient } from '../../packages/dsh-adapter/src/claw-registry-client.ts'
import { record } from '../../packages/dsh-adapter/src/remote-error.ts'
import { SessionClient } from '../../packages/dsh-adapter/src/session-client.ts'
import { HostTransport } from '../../packages/dsh-adapter/src/transport.ts'

/** Same derivation dsh-claw-observability applies to a tool execution root call. */
export function toolCallTraceId(callId) {
  return `tr_${createHash('sha256').update(callId).digest('hex').slice(0, 12)}`
}

export async function eventually(read, predicate, label, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    const value = await read()
    if (predicate(value)) return value
    await delay(150)
  }
  throw new Error(`Deadline exceeded: ${label}`)
}

/** Authenticated script-side access to one owned Host; never used by the Renderer. */
export class ModelHarness {
  constructor(auth, model) {
    this.auth = auth
    this.model = model
    this.transport = new HostTransport(auth)
    this.sessions = new SessionClient(this.transport)
    this.registry = new ClawRegistryClient(this.transport)
    this.mux = undefined
  }

  async connect() {
    this.mux = await this.transport.connect()
    return this
  }

  close() {
    this.mux?.close()
    this.mux = undefined
  }

  /** Exact authenticated Claw Fetch routes used for evidence (policy, audit, observability). */
  async claw(path, body) {
    const response = await fetch(this.auth.url(`/api/dsh-claw/${path}`), {
      method: 'POST',
      headers: { ...this.auth.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    })
    const value = record(await response.json())
    assert.equal(response.status, 200, `Claw route ${path} failed`)
    assert.equal(value.ok, true, `Claw route ${path} rejected the request`)
    return value
  }

  async assertModelInCatalog() {
    const catalog = record(await this.sessions.modelCatalog())
    const group = (Array.isArray(catalog.groups) ? catalog.groups : [])
      .map(record)
      .find((item) => item.id === this.model.route)
    assert.ok(
      group && Array.isArray(group.models),
      `Corn model route ${this.model.route} must be available`,
    )
    assert.ok(
      group.models.map(record).some((item) => item.id === this.model.model),
      'Requested Corn model must be in the live catalog',
    )
  }

  /** A fresh Claw Bot, its preset and one bound, model-selected, ready Session. */
  async boundSession(label, policyPreset) {
    const agent = await this.registry.create(
      `Corn ${label} ${randomUUID().slice(0, 8)}`,
    )
    if (policyPreset)
      await this.claw('registry/policy', {
        agentId: agent.agentId,
        policy: { preset: policyPreset },
      })
    await this.registry.ensurePreset(agent)
    const sessionId = `corn-${label}-${randomUUID()}`
    await this.sessions.create({
      sessionId,
      cwd: agent.canonicalRoot,
      agentPreset: agent.dshPreset,
    })
    await this.registry.bind(agent, sessionId)
    await this.sessions.selectSessionModel({
      sessionId,
      provider: this.model.route,
      model: this.model.model,
    })
    await this.registry.state(sessionId, 'ready')
    return { agent, sessionId }
  }

  async prompt(sessionId, text, requestId = randomUUID()) {
    const receipt = record(
      await this.sessions.prompt({
        sessionId,
        requestId,
        mode: 'queue',
        content: [{ type: 'text', text }],
        clientTimeZone: 'Asia/Shanghai',
      }),
    )
    assert.equal(receipt.accepted, true)
    return requestId
  }

  /**
   * Follows one Session with live assistant stream frames. Durable events must
   * arrive contiguous after the snapshot cursor; content is never retained.
   */
  async follow(sessionId) {
    const state = {
      cursor: -1,
      chunks: 0,
      snapshot: undefined,
      events: [],
      failure: undefined,
    }
    const cancel = this.mux.open(
      'session/follow',
      {
        request: {
          address: { kind: 'session', sessionId },
          assistantStream: true,
          maxMessages: 100,
        },
      },
      (raw) => {
        const item = record(raw)
        try {
          if (item.type === 'snapshot') {
            assert.equal(typeof item.cursor, 'number')
            state.cursor = item.cursor
            state.snapshot = item
          } else if (item.type === 'assistant-stream') {
            if (record(item.frame).type === 'chunk') state.chunks++
          } else if (item.type === 'event') {
            const event = record(item.event)
            assert.equal(
              event.seq,
              state.cursor + 1,
              'Live durable events must be contiguous',
            )
            state.cursor = event.seq
            state.events.push(event)
          }
        } catch (error) {
          state.failure = error
        }
      },
      (error) => {
        state.failure = error
      },
    )
    const poll = (read, label, timeoutMs) =>
      eventually(
        async () => {
          if (state.failure) throw state.failure
          return read()
        },
        Boolean,
        label,
        timeoutMs,
      )
    await poll(() => state.snapshot, 'follow snapshot')
    return {
      state,
      cancel,
      waitFor: (predicate, label, timeoutMs) =>
        poll(() => state.events.find(predicate), label, timeoutMs),
      waitUntil: (predicate, label, timeoutMs) =>
        poll(() => predicate(state), label, timeoutMs),
    }
  }

  /** Durable history through a fresh snapshot cursor, independent of any live follow. */
  async page(sessionId) {
    let snapshot
    let failure
    const stop = this.mux.open(
      'session/follow',
      {
        request: { address: { kind: 'session', sessionId }, maxMessages: 100 },
      },
      (item) => {
        if (item.type === 'snapshot') snapshot = item
      },
      (error) => {
        failure = error
      },
    )
    try {
      await eventually(
        async () => {
          if (failure) throw failure
          return snapshot
        },
        Boolean,
        'page snapshot',
      )
    } finally {
      stop()
    }
    const page = record(
      await this.transport.rpc('session/page', {
        request: {
          address: { kind: 'session', sessionId },
          throughSeq: snapshot.cursor,
          maxMessages: 100,
        },
      }),
    )
    assert.ok(Array.isArray(page.records))
    return {
      snapshot,
      events: page.records.map(record).map((row) => record(row.event ?? row)),
    }
  }
}
