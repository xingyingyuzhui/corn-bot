import { useState } from 'react'
import { useRepository, useWorkspace } from '../../app/workspace-context.tsx'
import { effectiveModel, needsModelWarning } from '../../model/models.ts'
import type { CommandError } from '../../model/repository.ts'
import type { BotView, ModelSettings } from '../../model/workspace.ts'
import { Button } from '../../shared/Button.tsx'
import { Dialog } from '../../shared/Dialog.tsx'
import { useNotice } from '../../shared/notice.tsx'
import {
  ConflictNotice,
  EditorWarning,
  FormError,
  MissingBotDialog,
} from './EditorParts.tsx'
import { canSaveChoice, modelChoices } from './model-choice.ts'

export interface BotModelDialogProps {
  readonly botId: string
  readonly onClose: () => void
  readonly onOpenSettings: () => void
}

const TITLE = '模型'
const FOLLOW_GLOBAL = ''

export function BotModelDialog({
  botId,
  onClose,
  onOpenSettings,
}: BotModelDialogProps) {
  const workspace = useWorkspace()
  const bot = workspace.roster.bots[botId]
  return bot ? (
    <ModelPicker
      bot={bot}
      settings={workspace.models}
      onClose={onClose}
      onOpenSettings={onOpenSettings}
    />
  ) : (
    <MissingBotDialog title={TITLE} onClose={onClose} />
  )
}

function ModelPicker({
  bot,
  settings,
  onClose,
  onOpenSettings,
}: {
  readonly bot: BotView
  readonly settings: ModelSettings
  readonly onClose: () => void
  readonly onOpenSettings: () => void
}) {
  const repository = useRepository()
  const notify = useNotice()
  const [choice, setChoice] = useState<string | null>(bot.modelOverride)
  const [baseRevision, setBaseRevision] = useState(bot.revision)
  const [formError, setFormError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [pending, setPending] = useState(false)

  const choices = modelChoices(settings)
  const warning = needsModelWarning(effectiveModel(bot, settings), settings)

  const reload = () => {
    setChoice(bot.modelOverride)
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
    if (choice === bot.modelOverride) {
      onClose()
      return
    }
    if (!canSaveChoice(choices, bot.modelOverride, choice)) {
      setFormError('这个模型当前不可用，请选择其他模型')
      return
    }
    setPending(true)
    setFormError(null)
    const result = await repository.setBotModel(bot.id, choice, baseRevision)
    setPending(false)
    if (result.ok) {
      notify('模型已保存')
      onClose()
    } else showError(result.error)
  }

  return (
    <Dialog
      busy={pending}
      title={`${bot.name} 的模型`}
      description={
        repository.label === 'fixture'
          ? '模型目录是标注过的示例数据；M2 起读取 DSH modelCatalog 校验。'
          : '模型目录来自 DSH modelCatalog。'
      }
      onClose={onClose}
      actions={
        <>
          <span className="corn-editor__actions-start">
            <Button variant="ghost" disabled={pending} onClick={onOpenSettings}>
              在设置中修改全局默认
            </Button>
          </span>
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
      {warning ? (
        <EditorWarning>
          <p className="corn-editor__warning-text">{warning}</p>
        </EditorWarning>
      ) : null}
      <fieldset className="corn-editor__options corn-editor__card">
        <legend className="corn-visually-hidden">这个 Bot 使用的模型</legend>
        {choices.map((entry) => (
          <label
            key={entry.value ?? FOLLOW_GLOBAL}
            className="corn-editor__option"
            data-unavailable={entry.unavailable ? true : undefined}
          >
            <input
              type="radio"
              name="bot-model"
              value={entry.value ?? FOLLOW_GLOBAL}
              checked={choice === entry.value}
              disabled={entry.unavailable !== undefined}
              onChange={() => setChoice(entry.value)}
            />
            <span>
              {entry.label}
              <span className="corn-editor__option-detail">
                {entry.unavailable
                  ? `${entry.detail} · ${entry.unavailable}`
                  : entry.detail}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <FormError message={formError} />
    </Dialog>
  )
}
