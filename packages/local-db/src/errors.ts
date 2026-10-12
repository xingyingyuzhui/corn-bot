export type LocalDbErrorCode =
  | 'async_transaction'
  | 'nested_transaction'
  | 'transaction_closed'
  | 'constraint'
  | 'invalid_input'
  | 'invalid_row'
  | 'invalid_transition'
  | 'not_found'
  | 'revision_conflict'
  | 'closed'

export type ConstraintKind =
  | 'unique'
  | 'primary_key'
  | 'foreign_key'
  | 'check'
  | 'not_null'
  | 'datatype'
  | 'other'

export class LocalDbError extends Error {
  readonly code: LocalDbErrorCode
  readonly constraint: ConstraintKind | null

  constructor(
    code: LocalDbErrorCode,
    message: string,
    options: {
      readonly constraint?: ConstraintKind
      readonly cause?: unknown
    } = {},
  ) {
    super(message, options.cause === undefined ? {} : { cause: options.cause })
    this.name = 'LocalDbError'
    this.code = code
    this.constraint = options.constraint ?? null
  }
}

export function isLocalDbError(
  value: unknown,
  code?: LocalDbErrorCode,
): value is LocalDbError {
  return (
    value instanceof LocalDbError && (code === undefined || value.code === code)
  )
}
