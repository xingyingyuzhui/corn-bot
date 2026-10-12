import { parseDocument, type ScalarTag } from 'yaml'
import { RuntimeFailure } from './runtime-failure.ts'

export type Entry = Record<string, unknown>

export function isEntry(value: unknown): value is Entry {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** DSH's entry-list dialect: `!!js` scalars stay opaque expressions and are never evaluated here. */
const JS_EXPRESSION_TAG: ScalarTag = {
  tag: 'tag:yaml.org,2002:js',
  resolve: (source) => ({ __jsExpr: source }),
}

/**
 * Parses one patch list in DSH's dialect. Anything Corn cannot read without
 * errors or warnings (other tags, syntax errors) is treated as possibly
 * disabling Claw.
 */
export function parsePatchLayer(text: string): readonly unknown[] {
  const document = parseDocument(text, { customTags: [JS_EXPRESSION_TAG] })
  const value: unknown =
    document.errors.length === 0 && document.warnings.length === 0
      ? document.toJS()
      : undefined
  if (value === null) return []
  if (!Array.isArray(value))
    throw new RuntimeFailure(
      'claw_disabled',
      'A profile patch layer cannot be verified',
    )
  return value
}

/** The only options a Claw row may carry after composition. */
const APPROVED_ROW_KEYS: ReadonlySet<string> = new Set([
  'id',
  'name',
  'disabled',
])
/** Loader options that move an entry's service symbols into another realm. */
const SCOPE_KEYS = ['isolate', 'intercept'] as const

function unverifiable(message: string): RuntimeFailure {
  return new RuntimeFailure('claw_disabled', message)
}

/**
 * Port of `applyEntryPatches` in `@deepseek-ai/cordis-plugin-include`
 * (`vendor/include/src/index.ts` at DSH `639ed015`): one pass over every
 * layer's patches, flattened in launch order, over an empty root. Inserted
 * rows are indexed (with group children) as they are added; an id-targeted
 * insert appends to a group; any other id-targeted patch overwrites every key
 * except `id`/`name`, and is skipped when its `name` differs from the target.
 * A patch the Loader could not apply at all is refused rather than guessed.
 */
export function composeEntries(patches: readonly unknown[]): unknown[] {
  const data: unknown[] = []
  const index = new Map<unknown, Entry>()
  const indexRows = (rows: readonly unknown[]) => {
    for (const row of rows) {
      if (!isEntry(row)) continue
      if (row.id) index.set(row.id, row)
      if (row.group && Array.isArray(row.config)) indexRows(row.config)
    }
  }
  for (const patch of structuredClone(patches)) {
    if (!isEntry(patch))
      throw unverifiable('A profile patch entry is not a mapping')
    const { id, insert, name, ...overrides } = patch
    if (insert) {
      if (!Array.isArray(insert) || !insert.every(isEntry))
        throw unverifiable('A profile patch inserts rows that are not mappings')
      if (id) {
        const target = index.get(id)
        if (!target?.group) continue
        if (!Array.isArray(target.config)) target.config = []
        ;(target.config as unknown[]).push(...insert)
      } else data.push(...insert)
      indexRows(insert)
      continue
    }
    if (!id) continue
    const target = index.get(id)
    if (!target) continue
    if (name && name !== target.name) continue
    for (const [key, value] of Object.entries(overrides)) target[key] = value
  }
  return data
}

function isApprovedRow(row: Entry): boolean {
  return (
    Object.keys(row).every((key) => APPROVED_ROW_KEYS.has(key)) &&
    row.name === row.id &&
    (row.disabled === undefined ||
      row.disabled === null ||
      row.disabled === false)
  )
}

/**
 * Claw rows must be mounted exactly once, at the root of the composed tree
 * (no ancestor group, so no inherited realm), with no option beyond `id`,
 * `name` and a literal not-disabled flag. Anywhere in the tree, including
 * nested group and preset plugin lists, no other entry may load a Claw
 * package or id, and none may isolate or intercept a service a Claw row
 * injects: that would split a Claw row from the tools it governs.
 */
export function verifyClawTopology(
  entries: readonly unknown[],
  rows: ReadonlySet<string>,
  services: ReadonlySet<string>,
): void {
  const mounted = new Set<Entry>()
  for (const row of entries) {
    if (!isEntry(row) || typeof row.id !== 'string' || !rows.has(row.id))
      continue
    if (mounted.has(row) || !isApprovedRow(row))
      throw unverifiable(`A profile patch layer changes how ${row.id} mounts`)
    mounted.add(row)
  }
  for (const id of rows)
    if ([...mounted].filter((row) => row.id === id).length !== 1)
      throw unverifiable(`${id} is not mounted exactly once at the root`)
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }
    if (!isEntry(node)) return
    if (
      !mounted.has(node) &&
      ((typeof node.id === 'string' && rows.has(node.id)) ||
        (typeof node.name === 'string' && rows.has(node.name)))
    )
      throw unverifiable('A profile patch layer mounts a Claw row again')
    for (const key of SCOPE_KEYS) {
      const scope = node[key]
      if (scope === undefined || scope === null) continue
      if (!isEntry(scope)) {
        if (typeof node.name === 'string')
          throw unverifiable(`A profile entry has an unverifiable ${key}`)
        continue
      }
      for (const service of Object.keys(scope))
        if (services.has(service))
          throw unverifiable(
            `A profile entry moves the ${service} service out of Claw's scope`,
          )
    }
    for (const value of Object.values(node)) visit(value)
  }
  visit(entries)
}
