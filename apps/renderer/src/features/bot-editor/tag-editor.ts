import type { TagId, TagView } from '../../model/workspace.ts'

const normalise = (text: string) => text.trim().toLocaleLowerCase()

/** Tags whose label contains the query, selected ones first, then by label. */
export function filterTags(
  tags: Readonly<Record<TagId, TagView>>,
  query: string,
  selected: readonly TagId[],
): readonly TagView[] {
  const needle = normalise(query)
  const chosen = new Set(selected)
  return Object.values(tags)
    .filter((tag) => normalise(tag.label).includes(needle))
    .sort(
      (a, b) =>
        Number(chosen.has(b.id)) - Number(chosen.has(a.id)) ||
        a.label.localeCompare(b.label, 'zh-CN'),
    )
}

/** Adds or removes one tag, keeping the order the user chose them in. */
export function toggleTag(
  selected: readonly TagId[],
  id: TagId,
): readonly TagId[] {
  return selected.includes(id)
    ? selected.filter((entry) => entry !== id)
    : [...selected, id]
}

export function sameTagSet(a: readonly TagId[], b: readonly TagId[]): boolean {
  const left = new Set(a)
  const right = new Set(b)
  return left.size === right.size && [...left].every((id) => right.has(id))
}

export type NewTagCheck =
  | { readonly kind: 'empty' }
  | { readonly kind: 'ok'; readonly label: string }
  | { readonly kind: 'existing'; readonly tag: TagView }
  | { readonly kind: 'too-long'; readonly message: string }

/**
 * Pre-checks a label typed into the filter before offering "create". The
 * repository stays the authority and re-validates on `createTag`.
 */
export function checkNewTag(
  query: string,
  tags: Readonly<Record<TagId, TagView>>,
  maxLength: number,
): NewTagCheck {
  const label = query.trim()
  if (!label) return { kind: 'empty' }
  const existing = Object.values(tags).find(
    (tag) => normalise(tag.label) === normalise(label),
  )
  if (existing) return { kind: 'existing', tag: existing }
  if ([...label].length > maxLength)
    return { kind: 'too-long', message: `标签最多 ${maxLength} 个字` }
  return { kind: 'ok', label }
}
