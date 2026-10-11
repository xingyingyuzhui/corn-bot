import { Check, CircleSlash, Clock } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { useRepository } from '../../app/workspace-context.tsx'
import type { ApprovalAnswer, ApprovalStatus } from '../../model/workspace.ts'
import { Button } from '../../shared/Button.tsx'
import { approvalView } from './transcript-model.ts'

interface ApprovalCardProps {
  readonly botId: string
  readonly requestId: string
  readonly title: string
  readonly detail: string
  readonly status: ApprovalStatus
  readonly onOpenPermissions: () => void
}

/**
 * A Bot asking before it acts. Answers are DSH RC2 outcomes only; "始终允许"
 * is not an answer but a way into the Bot's permissions, where the hard
 * policy ceiling still applies.
 */
export function ApprovalCard({
  botId,
  requestId,
  title,
  detail,
  status,
  onOpenPermissions,
}: ApprovalCardProps) {
  const repository = useRepository()
  const titleId = useId()
  const inFlight = useRef(false)
  const [answering, setAnswering] = useState<ApprovalAnswer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const view = approvalView(status)
  const busy = view.kind === 'pending' && (view.busy || answering !== null)

  const answer = async (choice: ApprovalAnswer) => {
    if (inFlight.current || view.kind !== 'pending' || view.busy) return
    inFlight.current = true
    setAnswering(choice)
    setError(null)
    const result = await repository.answerApproval(botId, requestId, choice)
    inFlight.current = false
    setAnswering(null)
    if (!result.ok && result.error.code !== 'stale')
      setError(result.error.message)
  }

  return (
    <section
      className="corn-approval"
      aria-labelledby={titleId}
      aria-busy={busy || undefined}
    >
      <p className="corn-approval__eyebrow">需要你确认</p>
      <h2 id={titleId} className="corn-approval__title">
        {title}
      </h2>
      <code className="corn-approval__detail" data-selectable>
        {detail}
      </code>
      {view.kind === 'pending' ? (
        <div className="corn-approval__actions">
          <Button
            variant="primary"
            pending={answering === 'allowed-once'}
            disabled={busy}
            onClick={() => void answer('allowed-once')}
          >
            允许一次
          </Button>
          <Button
            pending={answering === 'rejected'}
            disabled={busy}
            onClick={() => void answer('rejected')}
          >
            拒绝
          </Button>
          <button
            type="button"
            className="corn-approval__link"
            aria-description="打开这个 Bot 的权限设置；系统的硬上限仍然有效"
            onClick={onOpenPermissions}
          >
            始终允许…
          </button>
        </div>
      ) : (
        <p className="corn-approval__status" data-outcome={status}>
          <OutcomeIcon status={status} />
          {view.text}
          {status === 'cancelled' ? (
            <span className="corn-approval__note">Bot 已不再等待这个回复</span>
          ) : null}
        </p>
      )}
      {error ? (
        <p className="corn-approval__error" role="alert">
          {error}
          {view.kind === 'pending' && !busy ? '，可以重新选择' : null}
        </p>
      ) : null}
    </section>
  )
}

function OutcomeIcon({ status }: { readonly status: ApprovalStatus }) {
  switch (status) {
    case 'allowed-once':
      return <Check size={14} strokeWidth={2.2} aria-hidden />
    case 'rejected':
      return <CircleSlash size={14} strokeWidth={2} aria-hidden />
    case 'cancelled':
      return <Clock size={14} strokeWidth={2} aria-hidden />
    case 'pending':
    case 'submitting':
      return null
    default: {
      const unreachable: never = status
      throw new Error(`Unknown approval status ${String(unreachable)}`)
    }
  }
}
