import { RemoteError, record } from './remote-error.ts'
import type { HostTransport } from './transport.ts'

/** The official credential reference grammar (`credentials.ts` request schema). */
export const CREDENTIAL_REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u
/** `credentials/describe` accepts at most this many refs per request. */
export const MAX_DESCRIBE_REFS = 64

export interface CredentialInfo {
  readonly configured: boolean
  /** `file`, `env`, `project-env` or a future provider's own label. */
  readonly source?: string
  readonly writable: boolean
}

function assertRef(ref: string): void {
  if (!CREDENTIAL_REF_PATTERN.test(ref))
    throw new RemoteError('corn/invalid-ref', 'Invalid credential reference')
}

/**
 * Official `credentials.*` Remote. Reads never return a value; `set` sends the
 * key once and nothing echoes it back.
 */
export class CredentialsClient {
  readonly transport: HostTransport

  constructor(transport: HostTransport) {
    this.transport = transport
  }

  async describe(
    refs: readonly string[],
  ): Promise<Readonly<Record<string, CredentialInfo>>> {
    const result: Record<string, CredentialInfo> = {}
    for (let start = 0; start < refs.length; start += MAX_DESCRIBE_REFS) {
      const chunk = refs.slice(start, start + MAX_DESCRIBE_REFS)
      for (const ref of chunk) assertRef(ref)
      const value = record(
        await this.transport.rpc('credentials/describe', { refs: chunk }),
      )
      for (const ref of chunk) {
        const info = record(value[ref])
        if (
          typeof info.configured !== 'boolean' ||
          typeof info.writable !== 'boolean'
        )
          throw new RemoteError(
            'corn/invalid-response',
            'Invalid credential state',
          )
        result[ref] = {
          configured: info.configured,
          writable: info.writable,
          ...(typeof info.source === 'string' ? { source: info.source } : {}),
        }
      }
    }
    return result
  }

  async set(ref: string, value: string): Promise<void> {
    assertRef(ref)
    await this.transport.rpc('credentials/set', { ref, value })
  }

  async unset(ref: string): Promise<void> {
    assertRef(ref)
    await this.transport.rpc('credentials/unset', { ref })
  }
}
