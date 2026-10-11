import { createServer } from 'node:http'
import { settleWithin } from './model-audit-fixtures.mjs'
import { CapabilityFailure } from './model-audit-report.mjs'

const CAPABILITY = 'discovery-cancellation'

function listing(response) {
  response.writeHead(200, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify({ data: [{ id: 'corn-audit-stub-model' }] }))
}

/**
 * Loopback stand-in for an OpenAI-compatible listing endpoint; never a real
 * provider. Requests under `/hang/` stay open (or, with `hang: false`, are
 * answered at once) and report when they arrive and when their connection ends.
 */
export async function startDiscoveryStub({ fakeKey, hang = true } = {}) {
  const seen = { authorized: false, hangRequests: 0 }
  const sockets = new Set()
  let arrived
  let ended
  const hangArrived = new Promise((resolve) => {
    arrived = resolve
  })
  const hangClosed = new Promise((resolve) => {
    ended = resolve
  })
  const server = createServer((request, response) => {
    if (request.url?.startsWith('/hang/')) {
      seen.hangRequests++
      response.once('close', () =>
        ended({ answered: response.writableFinished }),
      )
      arrived()
      if (!hang) listing(response)
      return
    }
    seen.authorized =
      fakeKey !== undefined &&
      request.headers.authorization === `Bearer ${fakeKey}`
    listing(response)
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  let closing
  return {
    port: server.address().port,
    seen,
    hangArrived,
    hangClosed,
    /** Drops every connection, held or idle, then stops listening. */
    close() {
      closing ??= new Promise((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
        for (const socket of sockets) socket.destroy()
      })
      return closing
    },
  }
}

/**
 * Asserts discovery cancellation end to end: the request must reach the
 * hanging stub before the abort, the client must then end with AbortError, and
 * the upstream request must close unanswered, each within a bounded time.
 * Any other outcome throws a `CapabilityFailure`.
 */
export async function probeDiscoveryCancellation({
  call,
  stub,
  arrivalMs = 10_000,
  abortMs = 5_000,
  closeMs = 5_000,
}) {
  const controller = new AbortController()
  const started = performance.now()
  const outcome = Promise.resolve()
    .then(() => call(controller.signal))
    .then(
      () => 'resolved',
      (error) => (error?.name === 'AbortError' ? 'AbortError' : 'error'),
    )
  const fail = async (reason, facts = {}) => {
    controller.abort()
    await settleWithin(outcome, abortMs)
    throw new CapabilityFailure(CAPABILITY, reason, {
      hangRequests: stub.seen.hangRequests,
      ...facts,
    })
  }
  const first = await settleWithin(
    Promise.race([
      stub.hangArrived.then(() => 'arrived'),
      outcome.then(() => 'settled'),
    ]),
    arrivalMs,
  )
  if (!first.settled) return fail('upstream-never-reached')
  if (first.value === 'settled') return fail('call-settled-before-abort')
  const reachedAfterMs = Math.round(performance.now() - started)
  controller.abort()
  const aborted = performance.now()
  const client = await settleWithin(outcome, abortMs)
  if (!client.settled) return fail('client-not-settled')
  if (client.value !== 'AbortError')
    return fail('client-not-aborted', { client: client.value })
  const closed = await settleWithin(stub.hangClosed, closeMs)
  if (!closed.settled)
    return fail('upstream-not-closed', { client: 'AbortError' })
  if (closed.value.answered)
    return fail('upstream-completed', { client: 'AbortError' })
  return {
    capability: CAPABILITY,
    status: 'pass',
    client: 'AbortError',
    upstreamReached: true,
    upstreamClosedByPeer: true,
    hangRequests: stub.seen.hangRequests,
    reachedAfterMs,
    closedAfterAbortMs: Math.round(performance.now() - aborted),
  }
}
