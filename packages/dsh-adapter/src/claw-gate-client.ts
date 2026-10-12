import type { HostTransport } from './transport.ts'

/** The official route reads at least one row; asking for one keeps the probe minimal. */
const AUDIT_PROBE_LIMIT = 1

/**
 * Main-only proof that the Claw Gate reached its `apply`: the locked
 * `dsh-claw-gate` registers `/api/dsh-claw/gate/audit` (POST `{ limit }` →
 * `{ ok: true, items: [...] }`) right after installing its tool guard. Audit
 * rows are checked for shape only and never returned, logged or forwarded.
 */
export class ClawGateClient {
  readonly transport: HostTransport
  constructor(transport: HostTransport) {
    this.transport = transport
  }

  async verifyMounted(
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<void> {
    const result = await this.transport.claw(
      'gate/audit',
      { limit: AUDIT_PROBE_LIMIT },
      options,
    )
    const items: unknown = result.items
    if (!Array.isArray(items) || items.length > AUDIT_PROBE_LIMIT)
      throw new Error('Invalid Claw Gate audit response')
  }
}
