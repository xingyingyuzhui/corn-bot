import type { SqlRow } from '../driver.ts'
import { LocalDbError } from '../errors.ts'
import { nullableTextColumn, requireText } from '../rows.ts'

/** Provider + model (+ optional reasoning effort), stored as three columns. */
export interface ModelChoice {
  readonly provider: string
  readonly model: string
  readonly effort: string | null
}

export function modelChoiceParams(
  choice: ModelChoice | null,
  field: string,
): { provider: string | null; model: string | null; effort: string | null } {
  if (choice === null) return { provider: null, model: null, effort: null }
  return {
    provider: requireText(choice.provider, `${field}.provider`),
    model: requireText(choice.model, `${field}.model`),
    effort:
      choice.effort === null
        ? null
        : requireText(choice.effort, `${field}.effort`),
  }
}

export function modelChoiceColumns(
  row: SqlRow,
  table: string,
  prefix: string,
): ModelChoice | null {
  const provider = nullableTextColumn(row, table, `${prefix}_provider`)
  const model = nullableTextColumn(row, table, `${prefix}_model`)
  const effort = nullableTextColumn(row, table, `${prefix}_effort`)
  if (provider === null && model === null && effort === null) return null
  if (provider === null || model === null) {
    throw new LocalDbError('invalid_row', `Invalid ${table}.${prefix}_*`)
  }
  return { provider, model, effort }
}
