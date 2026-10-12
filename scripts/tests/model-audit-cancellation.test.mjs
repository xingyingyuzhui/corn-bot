import assert from 'node:assert/strict'
import { request } from 'node:http'
import { test } from 'node:test'
import {
  probeDiscoveryCancellation,
  startDiscoveryStub,
} from '../lib/model-audit-cancellation.mjs'
import { CapabilityFailure, settleReport } from '../lib/model-audit-report.mjs'

const FAST = { arrivalMs: 1_000, abortMs: 1_000, closeMs: 1_000 }
const abortError = () => new DOMException('aborted', 'AbortError')

async function withStub(t, options) {
  const stub = await startDiscoveryStub(options)
  t.after(() => stub.close())
  return stub
}

const hangUrl = (stub) => `http://127.0.0.1:${stub.port}/hang/v1/models`

/** A Host stand-in that forwards to the stub but never cancels its upstream request. */
function leakyForward(stub, signal) {
  const upstream = request(hangUrl(stub))
  upstream.on('error', () => {})
  upstream.end()
  return new Promise((_, reject) =>
    signal.addEventListener('abort', () => reject(abortError()), {
      once: true,
    }),
  )
}

async function failure(promise) {
  const started = Date.now()
  const error = await promise.then(
    () => assert.fail('cancellation probe must fail'),
    (caught) => caught,
  )
  assert.ok(error instanceof CapabilityFailure, String(error))
  assert.equal(error.record.capability, 'discovery-cancellation')
  assert.equal(error.record.status, 'fail')
  assert.ok(Date.now() - started < 5_000)
  return error.record
}

test('passes only when the abort reaches the client and closes the upstream request', async (t) => {
  const stub = await withStub(t)
  const record = await probeDiscoveryCancellation({
    ...FAST,
    stub,
    call: (signal) => fetch(hangUrl(stub), { signal }),
  })
  assert.equal(record.status, 'pass')
  assert.equal(record.client, 'AbortError')
  assert.equal(record.upstreamClosedByPeer, true)
  assert.equal(stub.seen.hangRequests, 1)
})

test('fails when the Host does not propagate the abort upstream', async (t) => {
  const stub = await withStub(t)
  const record = await failure(
    probeDiscoveryCancellation({
      ...FAST,
      stub,
      call: (signal) => leakyForward(stub, signal),
    }),
  )
  assert.equal(record.reason, 'upstream-not-closed')
  assert.equal(record.client, 'AbortError')
})

test('fails when the call never reaches the upstream stub', async (t) => {
  const stub = await withStub(t)
  const record = await failure(
    probeDiscoveryCancellation({
      ...FAST,
      stub,
      call: (signal) =>
        new Promise((_, reject) =>
          signal.addEventListener('abort', () => reject(abortError()), {
            once: true,
          }),
        ),
    }),
  )
  assert.equal(record.reason, 'upstream-never-reached')
  assert.equal(stub.seen.hangRequests, 0)
})

test('fails when the upstream answers before the abort', async (t) => {
  const stub = await withStub(t, { hang: false })
  const record = await failure(
    probeDiscoveryCancellation({
      ...FAST,
      stub,
      call: async (signal) => {
        const response = await fetch(hangUrl(stub), { signal })
        return response.json()
      },
    }),
  )
  assert.ok(
    [
      'call-settled-before-abort',
      'client-not-aborted',
      'upstream-completed',
    ].includes(record.reason),
    record.reason,
  )
})

test('fails when the client resolves instead of ending with AbortError', async (t) => {
  const stub = await withStub(t)
  const record = await failure(
    probeDiscoveryCancellation({
      ...FAST,
      stub,
      call: (signal) =>
        new Promise((resolve) => {
          leakyForward(stub, signal).catch(() => resolve([]))
        }),
    }),
  )
  assert.equal(record.reason, 'client-not-aborted')
})

test('fails within its bound when the client never settles after abort', async (t) => {
  const stub = await withStub(t)
  const record = await failure(
    probeDiscoveryCancellation({
      ...FAST,
      stub,
      call: () => {
        const upstream = request(hangUrl(stub))
        upstream.on('error', () => {})
        upstream.end()
        return new Promise(() => {})
      },
    }),
  )
  assert.equal(record.reason, 'client-not-settled')
})

test('closing the stub drops every hanging connection', async (t) => {
  const stub = await withStub(t)
  const controller = new AbortController()
  const leaked = leakyForward(stub, controller.signal).catch(() => {})
  await stub.hangArrived
  await stub.close()
  const closed = await stub.hangClosed
  assert.equal(closed.answered, false)
  controller.abort()
  await leaked
  await assert.rejects(fetch(hangUrl(stub)))
})

test('a recorded cancellation failure can never settle as a success exit', () => {
  const failed = settleReport({
    required: ['discovery-cancellation', 'global-default-write'],
    capabilities: {
      'discovery-cancellation': {
        status: 'fail',
        reason: 'upstream-not-closed',
        upstreamClosedByPeer: false,
      },
      'global-default-write': { status: 'pass' },
    },
    cleanup: { ok: true, removed: true },
  })
  assert.equal(failed.status, 'failed')
  assert.equal(failed.exitCode, 1)
  const smuggled = settleReport({
    required: ['discovery-cancellation'],
    capabilities: {
      'discovery-cancellation': { status: 'pass', upstreamClosedByPeer: false },
    },
    cleanup: { ok: true, removed: true },
  })
  assert.equal(smuggled.status, 'failed')
  assert.equal(smuggled.exitCode, 1)
  const passed = settleReport({
    required: ['discovery-cancellation'],
    capabilities: {
      'discovery-cancellation': {
        status: 'pass',
        client: 'AbortError',
        upstreamClosedByPeer: true,
      },
    },
    cleanup: { ok: true, removed: true },
  })
  assert.equal(passed.status, 'passed')
  assert.equal(passed.exitCode, 0)
})
