import { useId } from 'react'
import { useRepository } from '../../../app/workspace-context.tsx'
import type { BotView, ModelSettings } from '../../../model/workspace.ts'
import { Button } from '../../../shared/Button.tsx'
import { useNotice } from '../../../shared/notice.tsx'
import { ConflictNotice, FormError } from '../../bot-editor/EditorParts.tsx'
import { MODEL_EDITOR } from '../../bot-editor/editor-specs.ts'
import { ModelChoiceFields } from '../../bot-editor/ModelChoiceFields.tsx'
import { useBotEditor } from '../../bot-editor/use-bot-editor.ts'
import type { ConfigDraftRegistry } from './config-drafts.ts'
import { SubpageFormActions } from './SubpageFormActions.tsx'
import { useConfigDraft } from './use-config-draft.ts'

interface ModelSettingsSectionProps {
  readonly bot: BotView
  readonly settings: ModelSettings
  readonly drafts: ConfigDraftRegistry
  readonly onDirtyChange: (dirty: boolean) => void
  readonly onOpenSettings: () => void
}

/** This Bot's model only; the global default and keys stay in Settings. */
export function ModelSettingsSection({
  bot,
  settings,
  drafts,
  onDirtyChange,
  onOpenSettings,
}: ModelSettingsSectionProps) {
  const repository = useRepository()
  const notify = useNotice()
  const formId = useId()
  const { controller, state } = useBotEditor(MODEL_EDITOR, bot)
  useConfigDraft(drafts, 'model', controller, onDirtyChange)

  const submit = async () => {
    const outcome = await controller.save()
    if (outcome === 'saved' && controller.attached) notify('模型已保存')
  }

  return (
    <section className="corn-details__group" aria-label="这个 Bot 的模型">
      <p className="corn-details__note">
        {repository.label === 'fixture'
          ? '模型目录是标注过的示例数据；M2 起读取 DSH modelCatalog 校验。'
          : '模型目录来自 DSH modelCatalog。'}
        全局默认模型和 API Key 在“设置”中管理。
      </p>
      {state.conflict ? (
        <ConflictNotice onReload={() => controller.reload()} />
      ) : null}
      <form
        id={formId}
        noValidate
        aria-busy={state.saving || undefined}
        onSubmit={(event) => {
          event.preventDefault()
          if (!state.saving) void submit()
        }}
      >
        <ModelChoiceFields
          bot={bot}
          settings={settings}
          choice={state.draft}
          onChoose={(choice) => controller.edit(() => choice)}
        />
      </form>
      <FormError message={state.formError} />
      <SubpageFormActions
        formId={formId}
        dirty={controller.dirty}
        saving={state.saving}
        conflict={state.conflict}
        onDiscard={() => controller.reload()}
      />
      <Button variant="ghost" disabled={state.saving} onClick={onOpenSettings}>
        在设置中修改全局默认
      </Button>
    </section>
  )
}
