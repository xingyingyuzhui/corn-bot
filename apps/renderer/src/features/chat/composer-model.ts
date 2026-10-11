import type { ComposerDraft } from '../../app/layout-state.ts'
import type { AttachmentView } from '../../model/workspace.ts'
import type { VoicePhase } from '../voice/voice-model.ts'

export const MAX_ATTACHMENTS = 6
const limitMessage = (max: number) => `最多只能添加 ${max} 个附件`
export const ATTACHMENT_LIMIT_MESSAGE = limitMessage(MAX_ATTACHMENTS)
export const READ_ONLY_LABEL = '此聊天仅供查看'

export interface SubmitKey {
  readonly key: string
  readonly shiftKey: boolean
  readonly altKey?: boolean
  readonly metaKey: boolean
  readonly ctrlKey: boolean
  readonly isComposing: boolean
  readonly repeat: boolean
  /** Chromium reports 229 for keys an IME is still processing. */
  readonly keyCode?: number
}

export interface SubmitContext {
  readonly menuOpen: boolean
  /** Mod is Command on macOS and Control elsewhere. */
  readonly mac?: boolean
}

/**
 * Enter and Mod+Enter submit. Shift+Enter is a newline, IME composition and
 * key repeat never submit, and an open menu owns Enter.
 */
export function shouldSubmit(
  event: SubmitKey,
  context: SubmitContext,
): boolean {
  if (context.menuOpen || event.key !== 'Enter') return false
  if (event.isComposing || event.keyCode === 229 || event.repeat) return false
  const mac = context.mac ?? true
  const foreignModifier = mac ? event.ctrlKey : event.metaKey
  return !event.shiftKey && !event.altKey && !foreignModifier
}

export function hasPayload(draft: ComposerDraft): boolean {
  return draft.text.trim().length > 0 || draft.attachments.length > 0
}

export type ComposerActionKind =
  | 'none'
  | 'send'
  | 'voice-mode'
  | 'stop-voice'
  | 'wait-voice'

export type ComposerGlyph = 'arrow-up' | 'waveform' | 'stop' | 'spinner'

export interface ComposerActionInput {
  readonly hasPayload: boolean
  readonly canSend: boolean
  readonly readOnly: boolean
  readonly voice: VoicePhase
  /** A send for this draft is in flight. */
  readonly sending?: boolean
}

export interface ComposerAction {
  readonly action: ComposerActionKind
  readonly glyph: ComposerGlyph
  readonly disabled: boolean
  readonly busy: boolean
  readonly label: string
}

/** The trailing strong button: send with a payload, voice mode without. */
export function composerAction(input: ComposerActionInput): ComposerAction {
  if (input.readOnly)
    return {
      action: 'none',
      glyph: 'arrow-up',
      disabled: true,
      busy: false,
      label: READ_ONLY_LABEL,
    }
  switch (input.voice) {
    case 'recording':
      return {
        action: 'stop-voice',
        glyph: 'stop',
        disabled: false,
        busy: false,
        label: '停止录音（示例）',
      }
    case 'activating':
      return waitVoice('正在准备麦克风（示例）')
    case 'stopping':
      return waitVoice('正在停止录音（示例）')
    case 'processing':
      return waitVoice('正在转写（示例）')
    case 'idle':
    case 'error':
      break
    default: {
      const unreachable: never = input.voice
      throw new Error(`Unknown voice phase ${String(unreachable)}`)
    }
  }
  if (input.hasPayload)
    return {
      action: 'send',
      glyph: 'arrow-up',
      disabled: !input.canSend,
      busy: input.sending ?? false,
      label: input.sending ? '正在发送' : '发送',
    }
  return {
    action: 'voice-mode',
    glyph: 'waveform',
    disabled: !input.canSend,
    busy: false,
    label: '实时语音',
  }
}

const waitVoice = (label: string): ComposerAction => ({
  action: 'wait-voice',
  glyph: 'spinner',
  disabled: true,
  busy: true,
  label,
})

export interface StagedAttachments {
  readonly attachments: readonly AttachmentView[]
  readonly rejected: number
  /** Overflow feedback, `null` when everything fit. */
  readonly message: string | null
}

/** Adds files up to `max` in order; the overflow is reported, never dropped silently. */
export function stageAttachments(
  existing: readonly AttachmentView[],
  incoming: readonly AttachmentView[],
  max: number = MAX_ATTACHMENTS,
): StagedAttachments {
  const room = Math.max(0, max - existing.length)
  const accepted = incoming.slice(0, room)
  const rejected = incoming.length - accepted.length
  return {
    attachments: [...existing, ...accepted],
    rejected,
    message: rejected === 0 ? null : limitMessage(max),
  }
}

export interface PastePlan {
  readonly stageFiles: boolean
  /** Let the textarea insert the clipboard text itself. */
  readonly insertText: boolean
}

/** Mixed clipboards keep their text and stage their files exactly once. */
export function pastePlan(clip: {
  readonly text: string
  readonly fileCount: number
}): PastePlan {
  return {
    stageFiles: clip.fileCount > 0,
    insertText: clip.fileCount === 0 || clip.text.length > 0,
  }
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
  return samePayload(sent, current) ? { text: '', attachments: [] } : current
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}
