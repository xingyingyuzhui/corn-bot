import { randomUUID } from 'node:crypto'
import {
  parseRemoteStreamServerMessage,
  REMOTE_STREAM_MUX_PATH,
} from '@deepseek-ai/dsh-api-gateway/stream-protocol'
import WebSocket from 'ws'
import { RemoteError, record } from './remote-error.ts'

/** Node-only transport authority. A Renderer cannot construct or receive this handle. */
export interface HostAuthority {
  readonly origin: string
  url(path: string): URL
  headers(): Record<string, string>
}

/**
 * Settings writes are limited to `replace` and path `mutate`: `update` merges
 * and would keep stale fields of a complete selection.
 */
const RPC_ENDPOINTS = new Set([
  'session/list',
  'session/create',
  'session/prompt',
  'session/cancel',
  'session/page',
  'session/modelCatalog',
  'session/selectModel',
  '$events/result',
  'settings/describe',
  'settings/replace',
  'settings/mutate',
  'credentials/describe',
  'credentials/set',
  'credentials/unset',
  'llm/listProviders',
  'llm/listConfigurableProviders',
])
const STREAM_ENDPOINTS = new Set([
  'session/follow',
  'session/control',
  '$events',
])

export class HostTransport {
  readonly authority: HostAuthority

  constructor(authority: HostAuthority) {
    this.authority = authority
  }

  async rpc(endpoint: string, args: Record<string, unknown>): Promise<unknown> {
    if (!RPC_ENDPOINTS.has(endpoint))
      throw new RemoteError(
        'corn/endpoint-denied',
        'RPC endpoint is not allowed',
      )
    const rpcId = randomUUID()
    const response = await fetch(this.authority.url(`/api/${endpoint}`), {
      method: 'POST',
      headers: {
        ...this.authority.headers(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'client-request',
        rpcId,
        method: endpoint,
        payload: { args },
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok)
      throw new RemoteError(
        `corn/http-${response.status}`,
        'Host rejected the RPC request',
      )
    const envelope = record(await response.json())
    if (envelope.type !== 'server-response' || envelope.rpcId !== rpcId) {
      throw new RemoteError(
        'corn/correlation-mismatch',
        'Host RPC correlation failed',
      )
    }
    const result = record(envelope.result)
    // JSON omits undefined results from official void endpoints such as $events/result.
    if (result.ok === true) return result.value
    if (result.ok === false) {
      const error = record(result.error)
      if (typeof error.code === 'string' && typeof error.message === 'string') {
        throw new RemoteError(error.code, error.message)
      }
    }
    throw new RemoteError(
      'corn/invalid-response',
      'Invalid Host result envelope',
    )
  }

  /** Claw routes are exact authenticated Fetch routes, not Typert Remote methods. */
  async registry(
    action:
      | 'list'
      | 'create'
      | 'preset/ensure'
      | 'session/bind'
      | 'session/state',
    body: Record<string, unknown>,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<Record<string, unknown>> {
    const response = await fetch(
      this.authority.url(`/api/dsh-claw/registry/${action}`),
      {
        method: 'POST',
        headers: {
          ...this.authority.headers(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: options.signal ?? AbortSignal.timeout(30_000),
      },
    )
    const result = record(await response.json())
    if (!response.ok || result.ok !== true) {
      throw new RemoteError(
        typeof result.code === 'string'
          ? result.code
          : `corn/http-${response.status}`,
        typeof result.error === 'string'
          ? result.error
          : 'Claw Registry rejected the request',
      )
    }
    return result
  }

  async connect(): Promise<HostStreamMux> {
    const url = this.authority.url(REMOTE_STREAM_MUX_PATH)
    url.protocol = 'ws:'
    const socket = new WebSocket(url, {
      headers: this.authority.headers(),
      maxPayload: 8 * 1024 * 1024,
    })
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.terminate()
        reject(new Error('Host WS handshake timed out'))
      }, 10_000)
      socket.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      socket.once('open', () => {
        clearTimeout(timer)
        resolve(new HostStreamMux(socket))
      })
    })
  }
}

interface Listener {
  readonly onItem: (value: unknown) => void
  readonly onError: (error: Error) => void
}

export class HostStreamMux {
  #socket: WebSocket
  #listeners = new Map<string, Listener>()

  constructor(socket: WebSocket) {
    this.#socket = socket
    socket.on('message', (data, binary) => {
      try {
        if (binary) throw new Error('Unexpected binary Remote frame')
        const frame = parseRemoteStreamServerMessage(data.toString())
        const listener = this.#listeners.get(frame.streamId)
        if (!listener) return
        if (frame.type === 'item') listener.onItem(frame.value)
        else {
          this.#listeners.delete(frame.streamId)
          if (frame.type === 'error')
            listener.onError(
              new RemoteError(frame.error.code, frame.error.message),
            )
        }
      } catch (error) {
        this.#fail(
          error instanceof Error ? error : new Error('Invalid Remote stream'),
        )
        socket.close(1002)
      }
    })
    socket.on('error', (error) => this.#fail(error))
    socket.on('close', () =>
      this.#fail(
        new RemoteError('corn/disconnected', 'Host event stream disconnected'),
      ),
    )
  }

  open(
    endpoint: string,
    args: Record<string, unknown>,
    onItem: Listener['onItem'],
    onError: Listener['onError'],
  ): () => void {
    if (!STREAM_ENDPOINTS.has(endpoint))
      throw new RemoteError(
        'corn/endpoint-denied',
        'Stream endpoint is not allowed',
      )
    if (this.#socket.readyState !== WebSocket.OPEN)
      throw new Error('Host stream is not connected')
    const streamId = randomUUID()
    this.#listeners.set(streamId, { onItem, onError })
    this.#socket.send(
      JSON.stringify({ type: 'open', streamId, endpoint, payload: { args } }),
    )
    return () => {
      if (!this.#listeners.delete(streamId)) return
      if (this.#socket.readyState === WebSocket.OPEN)
        this.#socket.send(JSON.stringify({ type: 'cancel', streamId }))
    }
  }

  close(): void {
    this.#listeners.clear()
    this.#socket.close()
  }

  #fail(error: Error): void {
    const listeners = [...this.#listeners.values()]
    this.#listeners.clear()
    for (const listener of listeners) listener.onError(error)
  }
}
