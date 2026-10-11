import { Copy } from 'lucide-react'
import type { ReactNode } from 'react'
import { modelSummary } from '../../../model/models.ts'
import type {
  BotView,
  ModelSettings,
  PermissionRow,
} from '../../../model/workspace.ts'
import { ActionButton } from '../../../shared/ActionButton.tsx'
import { useCopy } from '../../../shared/use-copy.ts'
import { permissionSummary } from '../configuration/config-summaries.ts'
import { SectionStatus } from '../SectionStatus.tsx'
import type { SectionSource } from '../section-state.ts'
import {
  activityLabel,
  bindingLabel,
  botIdentityRows,
  ORIGIN_LABELS,
} from './bot-identity.ts'

interface BotOverviewProps {
  readonly bot: BotView
  readonly models: ModelSettings
  readonly permissions: readonly PermissionRow[] | undefined
  readonly sections: SectionSource
}

/** Summary of one Bot; binding and run state are shown as separate facts. */
export function BotOverview({
  bot,
  models,
  permissions,
  sections,
}: BotOverviewProps) {
  const copy = useCopy()
  return (
    <div className="corn-details__stack">
      <section className="corn-details__group" aria-labelledby="overview-about">
        <h3 id="overview-about" className="corn-details__group-title">
          职责与工作风格
        </h3>
        <dl className="corn-details__facts">
          <dt>职责</dt>
          <dd>{bot.role || <Muted>未填写</Muted>}</dd>
          <dt>工作风格</dt>
          <dd>{bot.workStyle || <Muted>未填写</Muted>}</dd>
        </dl>
      </section>

      <section className="corn-details__group" aria-labelledby="overview-state">
        <h3 id="overview-state" className="corn-details__group-title">
          状态
        </h3>
        <dl className="corn-details__facts">
          <dt>来源</dt>
          <dd>{ORIGIN_LABELS[bot.origin]}</dd>
          <dt>Claw 绑定</dt>
          <dd>{bindingLabel(bot.origin)}</dd>
          <dt>运行状态</dt>
          <dd>{activityLabel(bot)}</dd>
          <dt>工作区</dt>
          <dd>
            <SectionStatus state={sections(bot.id, 'workspace')} />
          </dd>
          <dt>模型</dt>
          <dd>{modelSummary(bot, models)}</dd>
          <dt>权限</dt>
          <dd>{permissionSummary(permissions)}</dd>
        </dl>
      </section>

      <section
        className="corn-details__group"
        aria-labelledby="overview-routines"
      >
        <h3 id="overview-routines" className="corn-details__group-title">
          例行任务
        </h3>
        <SectionStatus state={sections(bot.id, 'routines')} />
      </section>

      <section className="corn-details__group" aria-labelledby="overview-ids">
        <h3 id="overview-ids" className="corn-details__group-title">
          标识
        </h3>
        <dl className="corn-details__facts">
          {botIdentityRows(bot).map((row) => (
            <IdentityFact
              key={row.id}
              label={row.label}
              value={row.value}
              note={row.note}
              onCopy={(value) => void copy(value, '复制失败：系统剪贴板不可用')}
            />
          ))}
        </dl>
      </section>
    </div>
  )
}

function IdentityFact({
  label,
  value,
  note,
  onCopy,
}: {
  readonly label: string
  readonly value: string | null
  readonly note: string | null
  readonly onCopy: (value: string) => void
}) {
  return (
    <>
      <dt>{label}</dt>
      <dd className="corn-details__id">
        {value === null ? (
          <Muted>{note}</Muted>
        ) : (
          <>
            <code className="corn-details__id-value">{value}</code>
            <ActionButton
              className="corn-round-button corn-details__copy"
              label={`复制 ${label}`}
              onPress={() => onCopy(value)}
            >
              <Copy size={13} strokeWidth={2} aria-hidden />
            </ActionButton>
          </>
        )}
      </dd>
    </>
  )
}

function Muted({ children }: { readonly children: ReactNode }) {
  return <span className="corn-details__muted">{children}</span>
}
