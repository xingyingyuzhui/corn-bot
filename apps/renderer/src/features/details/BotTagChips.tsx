import type { BotView, TagId, TagView } from '../../model/workspace.ts'
import { ActionButton } from '../../shared/ActionButton.tsx'

interface BotTagChipsProps {
  readonly bot: BotView
  readonly tags: Readonly<Record<TagId, TagView>>
  readonly onEdit: () => void
}

/** With no tags this is the reference "添加标签" pill, unchanged. */
export function BotTagChips({ bot, tags, onEdit }: BotTagChipsProps) {
  const chips = bot.tagIds.flatMap((id) => {
    const tag = tags[id]
    return tag ? [tag] : []
  })
  if (chips.length === 0)
    return (
      <ActionButton
        className="corn-details__tags"
        label="添加标签"
        onPress={onEdit}
      >
        添加标签
      </ActionButton>
    )
  return (
    <div className="corn-details__tag-row">
      <ul className="corn-details__chips" aria-label="标签">
        {chips.map((tag) => (
          <li key={tag.id} className="corn-details__chip">
            {tag.label}
          </li>
        ))}
      </ul>
      <ActionButton
        className="corn-details__tags"
        label="编辑标签"
        onPress={onEdit}
      >
        编辑
      </ActionButton>
    </div>
  )
}
