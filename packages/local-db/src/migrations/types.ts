export interface Migration {
  /** 1-based and contiguous; becomes `PRAGMA user_version` once applied. */
  readonly version: number
  readonly name: string
  readonly sql: string
}
