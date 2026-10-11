import type { PermissionLevel, PermissionRow } from '../../model/workspace.ts'

export const LEVEL_LABELS: Readonly<Record<PermissionLevel, string>> = {
  allow: '允许',
  ask: '询问',
  deny: '拒绝',
}

const RANK: Readonly<Record<PermissionLevel, number>> = {
  deny: 0,
  ask: 1,
  allow: 2,
}

/** True when `level` grants more than `ceiling`; the UI must never offer it. */
export const exceedsCeiling = (
  level: PermissionLevel,
  ceiling: PermissionLevel,
): boolean => RANK[level] > RANK[ceiling]

/**
 * What the Bot can actually do: the effective level clamped to the hard
 * ceiling, so inconsistent data can only ever show less access, not more.
 */
export const enforcedLevel = (row: PermissionRow): PermissionLevel =>
  exceedsCeiling(row.effective, row.ceiling) ? row.ceiling : row.effective
