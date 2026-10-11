import { useState } from 'react'
import { useRepository } from '../../app/workspace-context.tsx'
import type { DeliveryState } from '../../model/workspace.ts'
import { useNotice } from '../../shared/notice.tsx'
import { type DeliveryAction, deliveryLine } from './transcript-model.ts'

interface DeliveryStatusProps {
  readonly botId: string
  readonly messageId: string
  readonly delivery: DeliveryState
  readonly failure: string | undefined
}

const ACTION_LABEL: Readonly<Record<DeliveryAction, string>> = {
  cancel: '取消',
  resend: '重发',
}

/** Corn-side delivery under a user bubble; not the Bot's activity. */
export function DeliveryStatus({
  botId,
  messageId,
  delivery,
  failure,
}: DeliveryStatusProps) {
  const repository = useRepository()
  const notify = useNotice()
  const [pending, setPending] = useState<DeliveryAction | null>(null)
  const line = deliveryLine(delivery, failure)

  const run = async (action: DeliveryAction) => {
    if (pending) return
    setPending(action)
    const result =
      action === 'cancel'
        ? await repository.cancelQueued(botId, messageId)
        : await repository.resend(botId, messageId)
    setPending(null)
    if (!result.ok) notify(result.error.message)
  }

  return (
    <p className="corn-delivery" data-tone={line.tone}>
      <span>{line.text}</span>
      {line.actions.map((action) => (
        <button
          key={action}
          type="button"
          className="corn-delivery__action"
          aria-label={`${ACTION_LABEL[action]}这条消息`}
          aria-busy={pending === action || undefined}
          disabled={pending !== null && pending !== action}
          onClick={() => void run(action)}
        >
          {ACTION_LABEL[action]}
        </button>
      ))}
    </p>
  )
}
