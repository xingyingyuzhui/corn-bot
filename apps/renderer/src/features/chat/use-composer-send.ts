import { useLayoutEffect, useRef, useState } from 'react'
import { useRepository } from '../../app/workspace-context.tsx'
import {
  type ComposerDraft,
  hasPayload,
  nextAttempt,
  type SendAttempt,
} from '../../model/draft.ts'

export interface ComposerSend {
  readonly submit: () => void
  readonly sending: boolean
  readonly error: string | null
  readonly clearError: () => void
}

/**
 * Sends the draft to the local queue. One attempt per Bot is in flight at a
 * time; a retry of an unchanged draft reuses its client id, so the
 * repository never enqueues it twice. The composer is shared across Bots, so
 * a settled send is reported with the Bot it was sent from.
 */
export function useComposerSend(
  botId: string,
  draft: ComposerDraft,
  onSettled: (botId: string, sent: SendAttempt) => void,
  onSent: () => void,
): ComposerSend {
  const repository = useRepository()
  const attempts = useRef(new Map<string, SendAttempt>())
  const inFlight = useRef(new Set<string>())
  const [sendingBots, setSendingBots] = useState<readonly string[]>([])
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({})
  const currentBot = useRef(botId)
  useLayoutEffect(() => {
    currentBot.current = botId
  })

  const setError = (target: string, message: string | null) =>
    setErrors(({ [target]: _previous, ...rest }) =>
      message === null ? rest : { ...rest, [target]: message },
    )

  const submit = async () => {
    const target = botId
    if (inFlight.current.has(target) || !hasPayload(draft)) return
    const attempt = nextAttempt(attempts.current.get(target), draft, () =>
      crypto.randomUUID(),
    )
    attempts.current.set(target, attempt)
    inFlight.current.add(target)
    setSendingBots((list) => [...list, target])
    setError(target, null)
    const result = await repository.sendMessage({
      botId: target,
      clientId: attempt.clientId,
      text: draft.text,
      attachments: draft.attachments,
    })
    inFlight.current.delete(target)
    setSendingBots((list) => list.filter((id) => id !== target))
    if (!result.ok) {
      setError(target, result.error.message)
      return
    }
    attempts.current.delete(target)
    onSettled(target, attempt)
    if (currentBot.current === target) onSent()
  }

  return {
    submit: () => void submit(),
    sending: sendingBots.includes(botId),
    error: errors[botId] ?? null,
    clearError: () => {
      if (errors[botId] !== undefined) setError(botId, null)
    },
  }
}
