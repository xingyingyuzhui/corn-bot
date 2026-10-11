import { AlertCircle, LoaderCircle, Square, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { VOICE_SCENARIOS, type VoiceFixture } from './use-voice-fixture.ts'
import { formatDuration, VOICE_ERROR_TEXT } from './voice-model.ts'
import './voice.css'

interface VoiceChipProps {
  readonly voice: VoiceFixture
  readonly onRefocus: () => void
}

/** Visible state of a dictation task; renders nothing while idle. */
export function VoiceChip({ voice, onRefocus }: VoiceChipProps) {
  const { state } = voice
  switch (state.phase) {
    case 'idle':
      return null
    case 'activating':
      return (
        <div className="corn-voice" role="status">
          <LoaderCircle className="corn-voice__spin" size={14} aria-hidden />
          <span className="corn-voice__text">正在准备麦克风（示例）</span>
          <ChipButton
            label="取消"
            onPress={() => {
              voice.cancel()
              onRefocus()
            }}
          />
        </div>
      )
    case 'recording':
      return (
        <div className="corn-voice" role="status" data-phase="recording">
          <span className="corn-voice__dot" aria-hidden />
          <span className="corn-voice__text">
            正在听写（示例，未录制真实声音）
          </span>
          <Elapsed since={state.startedAt} />
          <ChipButton
            label="取消"
            onPress={() => {
              voice.cancel()
              onRefocus()
            }}
          />
          <ChipButton label="停止" icon onPress={voice.stop} />
        </div>
      )
    case 'stopping':
      return (
        <div className="corn-voice" role="status" aria-busy>
          <LoaderCircle className="corn-voice__spin" size={14} aria-hidden />
          <span className="corn-voice__text">正在停止录音（示例）</span>
        </div>
      )
    case 'processing':
      return (
        <div className="corn-voice" role="status" aria-busy>
          <LoaderCircle className="corn-voice__spin" size={14} aria-hidden />
          <span className="corn-voice__text">正在转写（示例）</span>
        </div>
      )
    case 'error':
      return (
        <div className="corn-voice" role="alert" data-phase="error">
          <AlertCircle size={14} aria-hidden />
          <span className="corn-voice__text">
            {VOICE_ERROR_TEXT[state.error]}（示例）
          </span>
          <ChipButton label="重试" onPress={voice.start} />
          <button
            type="button"
            className="corn-voice__close"
            aria-label="关闭语音提示"
            onClick={() => {
              voice.dismiss()
              onRefocus()
            }}
          >
            <X size={12} aria-hidden />
          </button>
        </div>
      )
    default: {
      const unreachable: never = state
      throw new Error(`Unknown voice state ${JSON.stringify(unreachable)}`)
    }
  }
}

function ChipButton({
  label,
  icon = false,
  onPress,
}: {
  readonly label: string
  readonly icon?: boolean
  readonly onPress: () => void
}) {
  return (
    <button type="button" className="corn-voice__button" onClick={onPress}>
      {icon ? <Square size={9} fill="currentColor" aria-hidden /> : null}
      {label}
    </button>
  )
}

function Elapsed({ since }: { readonly since: number }) {
  const [now, setNow] = useState(since)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [])
  return (
    <span className="corn-voice__time" aria-hidden>
      {formatDuration(now - since)}
    </span>
  )
}

/** Dev-route picker for how the next simulated dictation ends. */
export function VoiceScenarioPicker({
  voice,
}: {
  readonly voice: VoiceFixture
}) {
  return (
    <label className="corn-voice-scenario">
      <span>开发示例 · 听写结果</span>
      <select
        value={voice.scenario}
        onChange={(event) => {
          const next = VOICE_SCENARIOS.find(
            (entry) => entry.id === event.target.value,
          )
          if (next) voice.setScenario(next.id)
        }}
      >
        {VOICE_SCENARIOS.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.label}
          </option>
        ))}
      </select>
    </label>
  )
}
