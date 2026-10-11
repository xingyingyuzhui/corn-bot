import {
  ArrowUp,
  AudioLines,
  LoaderCircle,
  Mic,
  Plus,
  Square,
} from 'lucide-react'
import { type KeyboardEvent, useLayoutEffect, useRef } from 'react'
import {
  type ComposerDraft,
  hasPayload,
  type SendAttempt,
} from '../../model/draft.ts'
import { ActionButton } from '../../shared/ActionButton.tsx'
import { useNotice } from '../../shared/notice.tsx'
import { UNAVAILABLE } from '../../shared/unavailable.ts'
import { useVoiceFixture } from '../voice/use-voice-fixture.ts'
import { VoiceChip, VoiceScenarioPicker } from '../voice/VoiceChip.tsx'
import { AttachmentChips } from './AttachmentChips.tsx'
import {
  COMPOSER_FIELD_ID,
  type ComposerGlyph,
  composerAction,
  pastePlan,
  READ_ONLY_LABEL,
  shouldSubmit,
  stageAttachments,
} from './composer-model.ts'
import { useComposerSend } from './use-composer-send.ts'

const MAX_ROWS_HEIGHT = 160
const MAC = /Mac/u.test(navigator.userAgent)

interface MessageComposerProps {
  readonly botId: string
  readonly botName: string
  readonly draft: ComposerDraft
  readonly readOnly: boolean
  /** Why a send cannot go out right now, e.g. while the conversation loads. */
  readonly blockedReason: string | null
  /** Dev `ui-states` route only: simulated dictation states. */
  readonly voiceFixture: boolean
  readonly onDraft: (draft: ComposerDraft) => void
  readonly onSendSettled: (botId: string, sent: SendAttempt) => void
  readonly onSent: () => void
}

export function MessageComposer({
  botId,
  botName,
  draft,
  readOnly,
  blockedReason,
  voiceFixture,
  onDraft,
  onSendSettled,
  onSent,
}: MessageComposerProps) {
  const notify = useNotice()
  const field = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const latest = useRef(draft)
  useLayoutEffect(() => {
    latest.current = draft
  })
  const commit = (next: ComposerDraft) => {
    latest.current = next
    onDraft(next)
  }
  const send = useComposerSend(botId, draft, onSendSettled, onSent)
  const voice = useVoiceFixture(botId, notify)
  const voicePhase = voiceFixture ? voice.state.phase : 'idle'
  const action = composerAction({
    hasPayload: hasPayload(draft),
    canSend: blockedReason === null,
    readOnly,
    voice: voicePhase,
    sending: send.sending,
  })

  useLayoutEffect(() => {
    const element = field.current
    if (!element) return
    element.style.blockSize = 'auto'
    element.style.blockSize = `${Math.min(element.scrollHeight, MAX_ROWS_HEIGHT)}px`
  })

  const refocus = () => field.current?.focus()

  const stage = (files: readonly File[]) => {
    if (files.length === 0) return
    const current = latest.current
    const staged = stageAttachments(
      current.attachments,
      files.map((file) => ({
        id: crypto.randomUUID(),
        name: file.name || '未命名文件',
        size: file.size,
      })),
    )
    if (staged.attachments.length !== current.attachments.length)
      commit({ ...current, attachments: staged.attachments })
    if (staged.message) notify(staged.message)
  }

  const runAction = () => {
    switch (action.action) {
      case 'send':
        if (!action.disabled && !action.busy) send.submit()
        return
      case 'stop-voice':
        voice.stop()
        return
      case 'none':
      case 'voice-mode':
      case 'wait-voice':
        return
      default: {
        const unreachable: never = action.action
        throw new Error(`Unknown composer action ${String(unreachable)}`)
      }
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const composing = event.nativeEvent.isComposing || event.keyCode === 229
    if (event.key === 'Escape' && !composing) {
      if (voicePhase === 'activating' || voicePhase === 'recording') {
        voice.cancel()
        return
      }
      event.currentTarget.blur()
      return
    }
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !composing &&
      event.repeat
    ) {
      event.preventDefault()
      return
    }
    if (
      shouldSubmit(
        {
          key: event.key,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          isComposing: event.nativeEvent.isComposing,
          repeat: event.repeat,
          keyCode: event.keyCode,
        },
        { menuOpen: false, mac: MAC },
      )
    ) {
      event.preventDefault()
      if (action.action === 'send') runAction()
    }
  }

  const voiceActive = voicePhase !== 'idle' && voicePhase !== 'error'
  return (
    <>
      {voiceFixture ? <VoiceScenarioPicker voice={voice} /> : null}
      <div className="corn-composer" data-readonly={readOnly || undefined}>
        {voiceFixture ? <VoiceChip voice={voice} onRefocus={refocus} /> : null}
        {send.error ? (
          <p className="corn-composer__error" role="alert">
            {send.error}
          </p>
        ) : null}
        <AttachmentChips
          attachments={draft.attachments}
          onRemove={(id) => {
            const current = latest.current
            commit({
              ...current,
              attachments: current.attachments.filter((file) => file.id !== id),
            })
            refocus()
          }}
        />
        <button
          type="button"
          className="corn-composer__action"
          aria-label="添加附件"
          title="添加附件（仅在本机暂存，不会上传）"
          disabled={readOnly}
          onClick={() => picker.current?.click()}
        >
          <Plus size={18} strokeWidth={2} aria-hidden />
        </button>
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          tabIndex={-1}
          onChange={(event) => {
            stage([...(event.target.files ?? [])])
            event.target.value = ''
            refocus()
          }}
        />
        <textarea
          ref={field}
          id={COMPOSER_FIELD_ID}
          className="corn-composer__field"
          rows={1}
          value={draft.text}
          readOnly={readOnly}
          placeholder={readOnly ? READ_ONLY_LABEL : `给 ${botName} 发消息`}
          aria-label={`给 ${botName} 发消息`}
          aria-description={readOnly ? READ_ONLY_LABEL : undefined}
          onChange={(event) => {
            send.clearError()
            commit({ ...latest.current, text: event.target.value })
          }}
          onKeyDown={onKeyDown}
          onPaste={(event) => {
            if (readOnly) return
            const files = [...event.clipboardData.files]
            const plan = pastePlan({
              text: event.clipboardData.getData('text/plain'),
              fileCount: files.length,
            })
            if (plan.stageFiles) stage(files)
            if (!plan.insertText) event.preventDefault()
          }}
        />
        {voiceFixture ? (
          <button
            type="button"
            className="corn-composer__action"
            aria-label="语音听写（示例）"
            aria-pressed={voiceActive}
            title="语音听写（示例，不使用真实麦克风）"
            disabled={readOnly}
            onClick={voice.start}
          >
            <Mic size={16} strokeWidth={2} aria-hidden />
          </button>
        ) : (
          <ActionButton
            className="corn-composer__action"
            label="语音听写"
            unavailable={UNAVAILABLE.dictation}
          >
            <Mic size={16} strokeWidth={2} aria-hidden />
          </ActionButton>
        )}
        {action.action === 'voice-mode' ? (
          <ActionButton
            className="corn-composer__action corn-composer__action--strong"
            label="实时语音"
            unavailable={UNAVAILABLE.voiceMode}
          >
            <AudioLines size={16} strokeWidth={2.2} aria-hidden />
          </ActionButton>
        ) : (
          <button
            type="button"
            className="corn-composer__action corn-composer__action--strong"
            aria-label={action.label}
            title={
              action.action === 'send' && blockedReason
                ? blockedReason
                : action.label
            }
            aria-busy={action.busy || undefined}
            disabled={action.disabled}
            onClick={runAction}
          >
            <ActionGlyph glyph={action.glyph} />
          </button>
        )}
      </div>
    </>
  )
}

function ActionGlyph({ glyph }: { readonly glyph: ComposerGlyph }) {
  switch (glyph) {
    case 'arrow-up':
      return <ArrowUp size={16} strokeWidth={2.4} aria-hidden />
    case 'waveform':
      return <AudioLines size={16} strokeWidth={2.2} aria-hidden />
    case 'stop':
      return <Square size={11} fill="currentColor" aria-hidden />
    case 'spinner':
      return (
        <LoaderCircle
          className="corn-composer__spin"
          size={16}
          strokeWidth={2.2}
          aria-hidden
        />
      )
    default: {
      const unreachable: never = glyph
      throw new Error(`Unknown composer glyph ${String(unreachable)}`)
    }
  }
}
