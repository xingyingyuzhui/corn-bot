import { useId, useState } from 'react'
import { useRepository, useWorkspace } from '../../app/workspace-context.tsx'
import { NAME_MAX } from '../../model/limits.ts'
import { nameLength } from '../../model/names.ts'
import type { CommandError } from '../../model/repository.ts'
import type { BotView } from '../../model/workspace.ts'
import { ActionButton } from '../../shared/ActionButton.tsx'
import { Avatar } from '../../shared/Avatar.tsx'
import { Button } from '../../shared/Button.tsx'
import { Dialog } from '../../shared/Dialog.tsx'
import { useNotice } from '../../shared/notice.tsx'
import { TextField } from '../../shared/TextField.tsx'
import { UNAVAILABLE } from '../../shared/unavailable.ts'
import { AvatarPicker } from './AvatarPicker.tsx'
import { nameLengthError } from './create-bot-form.ts'
import { ConflictNotice, FormError, MissingBotDialog } from './EditorParts.tsx'
import {
  draftFromBot,
  isProfileField,
  type ProfileDraft,
  type ProfileField,
  profilePatch,
} from './profile-form.ts'

export interface BotProfileDialogProps {
  readonly botId: string
  readonly onClose: () => void
}

const TITLE = '编辑资料'

export function BotProfileDialog({ botId, onClose }: BotProfileDialogProps) {
  const bot = useWorkspace().roster.bots[botId]
  return bot ? (
    <ProfileForm bot={bot} onClose={onClose} />
  ) : (
    <MissingBotDialog title={TITLE} onClose={onClose} />
  )
}

type FieldErrors = Partial<Record<ProfileField, string>>

function ProfileForm({
  bot,
  onClose,
}: {
  readonly bot: BotView
  readonly onClose: () => void
}) {
  const repository = useRepository()
  const notify = useNotice()
  const formId = useId()
  const [draft, setDraft] = useState<ProfileDraft>(() => draftFromBot(bot))
  const [baseRevision, setBaseRevision] = useState(bot.revision)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [pending, setPending] = useState(false)

  const edit = (field: ProfileField) => (value: string) => {
    setDraft((current) => ({ ...current, [field]: value }))
    setErrors(({ [field]: _cleared, ...rest }) => rest)
  }

  const reload = () => {
    setDraft(draftFromBot(bot))
    setBaseRevision(bot.revision)
    setErrors({})
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
        if (isProfileField(error.field))
          setErrors({ [error.field]: error.message })
        else setFormError(error.message)
        return
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

  const submit = async () => {
    const patch = profilePatch(bot, draft)
    if (Object.keys(patch).length === 0) {
      onClose()
      return
    }
    setPending(true)
    setFormError(null)
    const result = await repository.updateBotProfile(
      bot.id,
      patch,
      baseRevision,
    )
    setPending(false)
    if (result.ok) {
      notify('资料已保存')
      onClose()
    } else showError(result.error)
  }

  const fieldError = (field: ProfileField) =>
    errors[field] === undefined ? {} : { error: errors[field] }

  const preview =
    draft.variantId === null
      ? bot.avatar
      : { ...bot.avatar, variantId: draft.variantId }

  return (
    <Dialog
      busy={pending}
      title={TITLE}
      description={
        repository.label === 'fixture'
          ? 'M1 只修改本地示例数据；M2 起改为通过 Claw Registry / Identity 受控写入。'
          : '修改会写入这个 Bot 的身份资料。'
      }
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" disabled={pending} onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            type="submit"
            form={formId}
            pending={pending}
            disabled={conflict}
          >
            {pending ? '正在保存…' : '保存'}
          </Button>
        </>
      }
    >
      {conflict ? <ConflictNotice onReload={reload} /> : null}
      <div className="corn-editor__avatar">
        <Avatar spec={preview} size={48} />
        <ActionButton
          className="corn-button corn-editor__soft-button"
          label="更换头像"
          unavailable={UNAVAILABLE.avatarUpload}
        >
          更换头像
        </ActionButton>
      </div>
      <form
        id={formId}
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          if (!pending) void submit()
        }}
      >
        <TextField
          label="名称"
          name="name"
          value={draft.name}
          onChange={edit('name')}
          required
          autoFocus
          hint={`${nameLength(draft.name)}/${NAME_MAX}`}
          error={errors.name ?? nameLengthError(draft.name, NAME_MAX)}
        />
        <TextField
          label="职责"
          name="role"
          value={draft.role}
          onChange={edit('role')}
          multiline
          required
          placeholder="它负责什么"
          {...fieldError('role')}
        />
        <TextField
          label="工作风格"
          name="workStyle"
          value={draft.workStyle}
          onChange={edit('workStyle')}
          multiline
          placeholder="它应该怎样做事，例如：先列计划，再动手"
          {...fieldError('workStyle')}
        />
        <AvatarPicker
          value={draft.variantId}
          onChange={edit('variantId')}
          emptyHint="当前是首字头像，可以选一个玉米角色"
          error={errors.variantId}
        />
      </form>
      <FormError message={formError} />
    </Dialog>
  )
}
