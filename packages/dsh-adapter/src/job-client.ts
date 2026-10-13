import { RemoteError, record } from './remote-error.ts'
import type { HostStreamMux, HostTransport, RpcOptions } from './transport.ts'

export type JobStatus =
  | 'running'
  | 'stopping'
  | 'completed'
  | 'failed'
  | 'killed'

/** One `job.list` roster row; output metadata is not retained. */
export interface JobRow {
  readonly id: string
  readonly kind: string
  readonly label: string
  readonly owner: string | null
  readonly status: JobStatus
  readonly detail: string | null
  readonly startedAt: number
  readonly finishedAt: number | null
}

const STATUSES = new Set<string>([
  'running',
  'stopping',
  'completed',
  'failed',
  'killed',
])

function jobRow(raw: unknown): JobRow {
  const value = record(raw)
  if (
    typeof value.id !== 'string' ||
    typeof value.kind !== 'string' ||
    typeof value.status !== 'string' ||
    !STATUSES.has(value.status) ||
    typeof value.startedAt !== 'number'
  )
    throw new RemoteError('corn/invalid-response', 'Invalid job row')
  return {
    id: value.id,
    kind: value.kind,
    label: typeof value.label === 'string' ? value.label : '',
    owner: typeof value.owner === 'string' ? value.owner : null,
    status: value.status as JobStatus,
    detail: typeof value.detail === 'string' ? value.detail : null,
    startedAt: value.startedAt,
    finishedAt: typeof value.finishedAt === 'number' ? value.finishedAt : null,
  }
}

/**
 * DSH job control for one Session's visible roster (its own jobs plus every
 * unowned job). Output follow is deliberately not exposed.
 */
export class JobClient {
  readonly transport: HostTransport

  constructor(transport: HostTransport) {
    this.transport = transport
  }

  /** Human-side stop of one visible job; the registry owner fence applies. */
  async kill(
    sessionId: string,
    jobId: string,
    options: RpcOptions = {},
  ): Promise<'requested' | 'already-finished'> {
    const value = record(
      await this.transport.rpc(
        'job/kill',
        { request: { sessionId, jobId } },
        options,
      ),
    )
    if (value.outcome !== 'requested' && value.outcome !== 'already-finished')
      throw new RemoteError('corn/invalid-response', 'Invalid job kill result')
    return value.outcome
  }

  /** The roster's first whole-set frame; the stream is closed afterwards. */
  rows(
    mux: HostStreamMux,
    sessionId: string,
    timeoutMs = 5_000,
    signal?: AbortSignal,
  ): Promise<readonly JobRow[]> {
    return new Promise((resolve, reject) => {
      let close = () => {}
      const fail = (error: unknown) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        close()
        reject(error)
      }
      const onAbort = () =>
        fail(new RemoteError('corn/timeout', 'Job roster timed out'))
      const timer = setTimeout(() => {
        fail(new RemoteError('corn/timeout', 'Job roster timed out'))
      }, timeoutMs)
      if (signal?.aborted === true) {
        fail(new RemoteError('corn/timeout', 'Job roster timed out'))
        return
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      const settle = (done: () => void) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        close()
        done()
      }
      close = mux.open(
        'job/list',
        { request: { sessionId } },
        (raw) => {
          const frame = record(raw)
          if (frame.type !== 'rows' || !Array.isArray(frame.jobs)) return
          try {
            const rows = frame.jobs.map(jobRow)
            settle(() => resolve(rows))
          } catch (error) {
            settle(() => reject(error))
          }
        },
        (error) => settle(() => reject(error)),
      )
    })
  }
}
