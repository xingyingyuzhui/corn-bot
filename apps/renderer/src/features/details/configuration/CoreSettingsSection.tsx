import { useId } from 'react'
import { useRepository } from '../../../app/workspace-context.tsx'
import type { BotView } from '../../../model/workspace.ts'
import { useNotice } from '../../../shared/notice.tsx'
import { ConflictNotice, FormError } from '../../bot-editor/EditorParts.tsx'
import { PROFILE_EDITOR } from '../../bot-editor/editor-specs.ts'
import { ProfileFields } from '../../bot-editor/ProfileFields.tsx'
import { useBotEditor } from '../../bot-editor/use-bot-editor.ts'
import { SectionStatus } from '../SectionStatus.tsx'
import type { SectionState } from '../section-state.ts'
import type { ConfigDraftRegistry } from './config-drafts.ts'
import { SubpageFormActions } from './SubpageFormActions.tsx'
import { useConfigDraft } from './use-config-draft.ts'

/** Friendly names for the Claw identity files; contents are not read in M1. */
const IDENTITY_DOCUMENTS = [
  { file: 'SOUL.md', label: '性格与底线', detail: '语气、价值观和做事的底线' },
  { file: 'IDENTITY.md', label: '身份', detail: '名字、角色与自我介绍' },
  { file: 'AGENTS.md', label: '工作约定', detail: '工作流程、协作方式和规则' },
  { file: 'TOOLS.md', label: '工具说明', detail: '可用工具与使用注意事项' },
  { file: 'HEARTBEAT.md', label: '定时自检', detail: '定期醒来时要检查的事项' },
] as const

interface CoreSettingsSectionProps {
  readonly bot: BotView
  readonly identity: SectionState
  readonly drafts: ConfigDraftRegistry
  readonly onDirtyChange: (dirty: boolean) => void
  readonly onOpenMemory: () => void
}

export function CoreSettingsSection({
  bot,
  identity,
  drafts,
  onDirtyChange,
  onOpenMemory,
}: CoreSettingsSectionProps) {
  const repository = useRepository()
  const notify = useNotice()
  const formId = useId()
  const editor = useBotEditor(PROFILE_EDITOR, bot)
  const { controller, state } = editor
  useConfigDraft(drafts, 'core', controller, onDirtyChange)

  const submit = async () => {
    const outcome = await controller.save()
    if (outcome === 'saved' && controller.attached) notify('资料已保存')
  }

  return (
    <>
      <section className="corn-details__group" aria-labelledby={`${formId}-h`}>
        <h4 id={`${formId}-h`} className="corn-details__group-title">
          基本资料
        </h4>
        {repository.label === 'fixture' ? (
          <p className="corn-details__note">
            M1 只修改本地示例数据；M2 起改为通过 Claw Registry / Identity
            受控写入。
          </p>
        ) : null}
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
          <ProfileFields editor={editor} />
        </form>
        <FormError message={state.formError} />
        <SubpageFormActions
          formId={formId}
          dirty={controller.dirty}
          saving={state.saving}
          conflict={state.conflict}
          onDiscard={() => controller.reload()}
        />
      </section>

      <section
        className="corn-details__group"
        aria-labelledby={`${formId}-identity`}
      >
        <h4 id={`${formId}-identity`} className="corn-details__group-title">
          行为与身份设定
        </h4>
        <ul className="corn-details__list">
          {IDENTITY_DOCUMENTS.map((document) => (
            <li key={document.file} className="corn-details__list-item">
              <span className="corn-details__list-label">
                {document.label}
                <span className="corn-details__file">{document.file}</span>
              </span>
              <span className="corn-details__list-detail">
                {document.detail}
              </span>
            </li>
          ))}
        </ul>
        <SectionStatus state={identity} />
        <p className="corn-details__note">
          关于你（USER）与长期记忆（MEMORY）放在
          <button
            type="button"
            className="corn-details__link"
            onClick={onOpenMemory}
          >
            资料库 · 记忆
          </button>
          中。
        </p>
      </section>
    </>
  )
}
