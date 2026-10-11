import { useEffect, useEffectEvent, useReducer, useState } from 'react'
import {
  VOICE_IDLE,
  type VoiceError,
  type VoiceState,
  voiceReducer,
} from './voice-model.ts'

/** Which outcome the simulated dictation ends in; picked on the dev route. */
export type VoiceScenario = 'success' | VoiceError

export const VOICE_SCENARIOS: readonly {
  readonly id: VoiceScenario
  readonly label: string
}[] = [
  { id: 'success', label: '正常结束' },
  { id: 'permission-denied', label: '没有麦克风权限' },
  { id: 'no-microphone', label: '没有麦克风' },
  { id: 'transcription-failed', label: '转写失败' },
]

const ACTIVATE_MS = 700
const STOP_MS = 500
const PROCESS_MS = 900

export interface VoiceFixture {
  readonly state: VoiceState
  readonly scenario: VoiceScenario
  readonly setScenario: (scenario: VoiceScenario) => void
  readonly start: () => void
  readonly stop: () => void
  readonly cancel: () => void
  readonly dismiss: () => void
}

/**
 * Timer-driven dictation for the `ui-states` route. It never opens a
 * microphone and never produces text; finishing only says so.
 */
export function useVoiceFixture(
  slotKey: string,
  onFinished: (message: string) => void,
): VoiceFixture {
  const [state, dispatch] = useReducer(voiceReducer, VOICE_IDLE)
  const [scenario, setScenario] = useState<VoiceScenario>('success')
  const [slot, setSlot] = useState(slotKey)
  if (slot !== slotKey) {
    setSlot(slotKey)
    dispatch({ type: 'reset' })
  }

  const activated = useEffectEvent((taskId: string) => {
    if (scenario === 'permission-denied' || scenario === 'no-microphone')
      dispatch({ type: 'fail', taskId, error: scenario })
    else dispatch({ type: 'activated', taskId, at: Date.now() })
  })
  const processed = useEffectEvent((taskId: string) => {
    if (scenario === 'transcription-failed') {
      dispatch({ type: 'fail', taskId, error: scenario })
      return
    }
    dispatch({ type: 'processed', taskId })
    onFinished('示例听写已结束：没有使用真实麦克风，也没有生成文字')
  })

  useEffect(() => {
    const after = (ms: number, run: () => void) => {
      const timer = setTimeout(run, ms)
      return () => clearTimeout(timer)
    }
    switch (state.phase) {
      case 'activating': {
        const { taskId } = state
        return after(ACTIVATE_MS, () => activated(taskId))
      }
      case 'stopping': {
        const { taskId } = state
        return after(STOP_MS, () => dispatch({ type: 'stopped', taskId }))
      }
      case 'processing': {
        const { taskId } = state
        return after(PROCESS_MS, () => processed(taskId))
      }
      case 'idle':
      case 'recording':
      case 'error':
        return undefined
      default: {
        const unreachable: never = state
        throw new Error(`Unknown voice state ${JSON.stringify(unreachable)}`)
      }
    }
  }, [state])

  return {
    state,
    scenario,
    setScenario,
    start: () => dispatch({ type: 'start', taskId: crypto.randomUUID() }),
    stop: () => dispatch({ type: 'stop' }),
    cancel: () => dispatch({ type: 'cancel' }),
    dismiss: () => dispatch({ type: 'dismiss' }),
  }
}
