import type { AttachmentView } from './workspace.ts'

/** Per-Bot composer contents; attachments are staged locally, never uploaded. */
export interface ComposerDraft {
  readonly text: string
  readonly attachments: readonly AttachmentView[]
}

export const EMPTY_DRAFT: ComposerDraft = { text: '', attachments: [] }

export function hasPayload(draft: ComposerDraft): boolean {
  return draft.text.trim().length > 0 || draft.attachments.length > 0
}

export interface SendAttempt {
  readonly clientId: string
  readonly text: string
  readonly attachmentIds: readonly string[]
}

const samePayload = (attempt: SendAttempt, draft: ComposerDraft) =>
  attempt.text === draft.text &&
  attempt.attachmentIds.length === draft.attachments.length &&
  attempt.attachmentIds.every((id, i) => draft.attachments[i]?.id === id)

/** Retrying an unchanged draft reuses its client id, so it never enqueues twice. */
export function nextAttempt(
  previous: SendAttempt | undefined,
  draft: ComposerDraft,
  makeId: () => string,
): SendAttempt {
  if (previous && samePayload(previous, draft)) return previous
  return {
    clientId: makeId(),
    text: draft.text,
    attachmentIds: draft.attachments.map((file) => file.id),
  }
}

/** Clears the draft only if the user did not edit it while the send was in flight. */
export function draftAfterSend(
  current: ComposerDraft,
  sent: SendAttempt,
): ComposerDraft {
  return samePayload(sent, current) ? EMPTY_DRAFT : current
}
