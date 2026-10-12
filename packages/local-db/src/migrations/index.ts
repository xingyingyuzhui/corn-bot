import { migration0001Core } from './0001-core.ts'
import type { Migration } from './types.ts'

export type { Migration } from './types.ts'

/** Ordered list of shipped migrations. Append only. */
export const MIGRATIONS: readonly Migration[] = [migration0001Core]
