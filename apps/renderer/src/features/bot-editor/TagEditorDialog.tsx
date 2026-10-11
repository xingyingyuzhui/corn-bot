import { Plus } from 'lucide-react'
import { useId, useState } from 'react'
import { useRepository, useWorkspace } from '../../app/workspace-context.tsx'
import { TAG_MAX } from '../../model/limits.ts'
import type { CommandError } from '../../model/repository.ts'
import type { BotView, TagId } from '../../model/workspace.ts'
import { Button } from '../../shared/Button.tsx'
import { Dialog } from '../../shared/Dialog.tsx'
import { useNotice } from '../../shared/notice.tsx'
import { ConflictNotice, FormError, MissingBotDialog } from './EditorParts.tsx'
import { checkNewTag, filterTags, sameTagSet, toggleTag } from './tag-editor.ts'

export interface TagEditorDialogProps {
  readonly botId: string
  readonly onClose: () => void
}

const TITLE = '编辑标签'

export function TagEditorDialog({ botId, onClose }: TagEditorDialogProps) {
  const bot = useWorkspace().roster.bots[botId]
  return bot ? (
    <TagEditor bot={bot} onClose={onClose} />
  ) : (
    <MissingBotDialog title={TITLE} onClose={onClose} />
  )
}

function TagEditor({
  bot,
  onClose,
}: {
  readonly bot: BotView
  readonly onClose: () => void
}) {
  const repository = useRepository()
  const { tags } = useWorkspace().roster
  const notify = useNotice()
  const filterId = useId()
  const createMessageId = useId()
  const [selected, setSelected] = useState<readonly TagId[]>(bot.tagIds)
  const [openedWith, setOpenedWith] = useState<readonly TagId[]>(bot.tagIds)
  const [baseRevision, setBaseRevision] = useState(bot.revision)
  const [query, setQuery] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [creating, setCreating] = useState(false)
  const [pending, setPending] = useState(false)

  const visible = filterTags(tags, query, openedWith)
  const check = checkNewTag(query, tags, TAG_MAX)
  const createMessage =
    createError ??
    (check.kind === 'too-long'
      ? check.message
      : check.kind === 'existing'
        ? `已有标签「${check.tag.label}」，勾选即可`
        : null)

  const create = async () => {
    if (check.kind !== 'ok' || creating) return
    setCreating(true)
    const result = await repository.createTag(check.label)
    setCreating(false)
    if (result.ok) {
      setSelected((current) => [...current, result.value])
      setQuery('')
      setCreateError(null)
      notify(`已新建标签「${check.label}」`)
    } else setCreateError(result.error.message)
  }

  const reload = () => {
    setSelected(bot.tagIds)
    setOpenedWith(bot.tagIds)
    setBaseRevision(bot.revision)
    setFormError(null)
    setConflict(false)
  }

  const showError = (error: CommandError) => {
    switch (error.code) {
      case 'conflict':
        setConflict(true)
        return
      case 'validation':
      case 'duplicate':
      case 'not-found':
      case 'stale':
      case 'read-only':
      case 'unavailable':
        setFormError(error.message)
        return
      default: {
        const unreachable: never = error.code
        throw new Error(`Unknown error code ${JSON.stringify(unreachable)}`)
      }
    }
  }

  const save = async () => {
    if (sameTagSet(selected, bot.tagIds)) {
      onClose()
      return
    }
    setPending(true)
    setFormError(null)
    const result = await repository.setBotTags(bot.id, selected, baseRevision)
    setPending(false)
    if (result.ok) {
      notify('标签已保存')
      onClose()
    } else showError(result.error)
  }

  return (
    <Dialog
      busy={pending}
      title={TITLE}
      description={`为「${bot.name}」选择一个或多个标签。`}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" disabled={pending} onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            pending={pending}
            disabled={conflict}
            onClick={() => {
              if (!pending) void save()
            }}
          >
            {pending ? '正在保存…' : '保存'}
          </Button>
        </>
      }
    >
      {conflict ? <ConflictNotice onReload={reload} /> : null}
      <p className="corn-editor__lead">
        标签用来描述 Bot
        的特点，方便筛选。标签不是左侧名册的分组，改标签不会移动 Bot。
      </p>
      <div
        className="corn-field corn-editor__filter"
        data-invalid={
          createError || check.kind === 'too-long' ? true : undefined
        }
      >
        <label htmlFor={filterId} className="corn-field__label">
          筛选或新建标签
        </label>
        <input
          id={filterId}
          className="corn-field__input"
          type="text"
          value={query}
          placeholder="输入标签名，回车新建"
          data-autofocus
          aria-describedby={createMessage ? createMessageId : undefined}
          aria-invalid={
            createError || check.kind === 'too-long' ? true : undefined
          }
          onChange={(event) => {
            setQuery(event.target.value)
            setCreateError(null)
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
            event.preventDefault()
            if (check.kind === 'existing')
              setSelected((current) =>
                current.includes(check.tag.id)
                  ? current
                  : [...current, check.tag.id],
              )
            else void create()
          }}
        />
        {createMessage ? (
          <p
            id={createMessageId}
            className="corn-field__message"
            role={createError ? 'alert' : undefined}
          >
            {createMessage}
          </p>
        ) : null}
      </div>
      {check.kind === 'ok' ? (
        <div className="corn-editor__create">
          <Button pending={creating} onClick={() => void create()}>
            <Plus size={14} strokeWidth={2} aria-hidden />
            新建标签「{check.label}」
          </Button>
        </div>
      ) : null}
      <fieldset className="corn-editor__options corn-editor__card">
        <legend className="corn-visually-hidden">已有标签</legend>
        {visible.length === 0 ? (
          <p className="corn-editor__empty">
            {Object.keys(tags).length === 0 ? '还没有标签' : '没有匹配的标签'}
          </p>
        ) : (
          visible.map((tag) => (
            <label key={tag.id} className="corn-editor__option">
              <input
                type="checkbox"
                checked={selected.includes(tag.id)}
                onChange={() =>
                  setSelected((current) => toggleTag(current, tag.id))
                }
              />
              <span>{tag.label}</span>
            </label>
          ))
        )}
      </fieldset>
      <p className="corn-editor__footnote" aria-live="polite">
        已选 {selected.length} 个
      </p>
      <FormError message={formError} />
    </Dialog>
  )
}
