import type { SqlRow } from './driver.ts'
import { LocalDbError } from './errors.ts'

/**
 * Row and input validation shared by the stores. Reads fail closed with
 * `invalid_row`; caller input fails with `invalid_input`.
 */

const MAX_ID_LENGTH = 200
const ERROR_CODE = /^[a-z][a-z0-9_]{0,63}$/u
// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
const CONTROL = /[\u0000-\u001f\u007f]/u

function invalidRow(table: string, column: string): LocalDbError {
  return new LocalDbError('invalid_row', `Invalid ${table}.${column}`)
}

export function invalidInput(field: string): LocalDbError {
  return new LocalDbError('invalid_input', `Invalid ${field}`)
}

export function textColumn(row: SqlRow, table: string, column: string): string {
  const value = row[column]
  if (typeof value !== 'string') throw invalidRow(table, column)
  return value
}

export function nullableTextColumn(
  row: SqlRow,
  table: string,
  column: string,
): string | null {
  const value = row[column]
  if (value === null) return null
  if (typeof value !== 'string') throw invalidRow(table, column)
  return value
}

export function integerColumn(
  row: SqlRow,
  table: string,
  column: string,
): number {
  const value = row[column]
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw invalidRow(table, column)
  }
  return value
}

export function nullableIntegerColumn(
  row: SqlRow,
  table: string,
  column: string,
): number | null {
  return row[column] === null ? null : integerColumn(row, table, column)
}

export function flagColumn(
  row: SqlRow,
  table: string,
  column: string,
): boolean {
  const value = row[column]
  if (value === 0) return false
  if (value === 1) return true
  throw invalidRow(table, column)
}

export function enumColumn<const T extends readonly string[]>(
  values: T,
  row: SqlRow,
  table: string,
  column: string,
): T[number] {
  const value = row[column]
  const match = values.find((candidate) => candidate === value)
  if (match === undefined) throw invalidRow(table, column)
  return match
}

export function errorCodeColumn(
  row: SqlRow,
  table: string,
  column: string,
): string | null {
  const value = nullableTextColumn(row, table, column)
  if (value !== null && !ERROR_CODE.test(value)) {
    throw invalidRow(table, column)
  }
  return value
}

export function requireId(value: string, field: string): string {
  if (
    value.length === 0 ||
    value.length > MAX_ID_LENGTH ||
    CONTROL.test(value) ||
    value.trim() !== value
  ) {
    throw invalidInput(field)
  }
  return value
}

export function requireText(value: string, field: string): string {
  if (value.length === 0) throw invalidInput(field)
  return value
}

export function requireTimestamp(value: number, field = 'timestamp'): number {
  if (!Number.isSafeInteger(value) || value < 0) throw invalidInput(field)
  return value
}

/** Closed error codes only; Host or driver text never reaches the database. */
export function requireErrorCode(
  value: string | null,
  field = 'lastError',
): string | null {
  if (value !== null && !ERROR_CODE.test(value)) throw invalidInput(field)
  return value
}

export function requireOne<const T extends readonly string[]>(
  values: T,
  value: string,
  field: string,
): T[number] {
  const match = values.find((candidate) => candidate === value)
  if (match === undefined) throw invalidInput(field)
  return match
}

export function flagValue(value: boolean): number {
  return value ? 1 : 0
}
