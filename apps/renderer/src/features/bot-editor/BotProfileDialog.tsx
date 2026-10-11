import { useId } from 'react'
import { useRepository, useWorkspace } from '../../app/workspace-context.tsx'
import type { BotView } from '../../model/workspace.ts'
import { ActionButton } from '../../shared/ActionButton.tsx'
import { Avatar } from '../../shared/Avatar.tsx'
import { Button } from '../../shared/Button.tsx'
import { Dialog } from '../../shared/Dialog.tsx'
import { useNotice } from '../../shared/notice.tsx'
import { UNAVAILABLE } from '../../shared/unavailable.ts'
import { ConflictNotice, FormError, MissingBotDialog } from './EditorParts.tsx'
import { PROFILE_EDITOR } from './editor-specs.ts'
import { ProfileFields } from './ProfileFields.tsx'
import { useBotEditor } from './use-bot-editor.ts'

export interface BotProfileDialogProps {
  readonly botId: string
  readonly onClose: () => void
}

const TITLE = '编辑资料'

export function BotProfileDialog({ botId, onClose }: BotProfileDialogProps) {
  const bot = useWorkspace().roster.bots[botId]
  return bot ? (
    <ProfileForm key={bot.id} bot={bot} onClose={onClose} />
  ) : (
    <MissingBotDialog title={TITLE} onClose={onClose} />
  )
}

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
  const editor = useBotEditor(PROFILE_EDITOR, bot)
  const { controller, state } = editor
  const pending = state.saving

  const submit = async () => {
    const outcome = await controller.saveDraft()
    if (!controller.attached) return
    if (outcome === 'saved') notify('资料已保存')
    if (outcome !== 'failed') onClose()
  }

  const preview =
    state.draft.variantId === null
      ? bot.avatar
      : { ...bot.avatar, variantId: state.draft.variantId }

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
            disabled={state.conflict}
          >
            {pending ? '正在保存…' : '保存'}
          </Button>
        </>
      }
    >
      {state.conflict ? (
        <ConflictNotice onReload={() => controller.reload()} />
      ) : null}
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
        <ProfileFields editor={editor} autoFocus />
      </form>
      <FormError message={state.formError} />
    </Dialog>
  )
}
