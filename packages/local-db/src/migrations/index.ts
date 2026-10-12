import { migration0001Core } from './0001-core.ts'
import { migration0002ProvisionerIntent } from './0002-provisioner-intent.ts'
import type { Migration } from './types.ts'

export type { Migration } from './types.ts'

/** Ordered list of shipped migrations. Append only. */
export const MIGRATIONS: readonly Migration[] = [
  migration0001Core,
  migration0002ProvisionerIntent,
]
