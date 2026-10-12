import type WebSocket from 'ws'

/** A Remote stream mux socket that records client frames and injects server items. */
export function fakeSocket() {
  const handlers = new Map<string, (...args: unknown[]) => void>()
  const sent: Record<string, unknown>[] = []
  const socket = {
    readyState: 1,
    on(event: string, handler: (...args: unknown[]) => void) {
      handlers.set(event, handler)
      return socket
    },
    send(text: string) {
      sent.push(JSON.parse(text))
    },
    close() {},
  }
  const message = (frame: unknown) =>
    handlers.get('message')?.(Buffer.from(JSON.stringify(frame)), false)
  const deliver = (streamId: string, value: unknown) =>
    message({ type: 'item', streamId, value })
  const fail = (streamId: string, code: string) =>
    message({
      type: 'error',
      streamId,
      error: { code, message: 'stream failed', details: {} },
    })
  return { socket: socket as unknown as WebSocket, sent, deliver, fail }
}
