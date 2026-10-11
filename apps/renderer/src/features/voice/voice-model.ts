/**
 * Dictation state machine for the dev `ui-states` route. No microphone is
 * opened: the fixture drives these transitions on timers so each state can be
 * reviewed. Every async step carries the task id it belongs to, so a late
 * timer from a cancelled or replaced task can never move the current one.
 */

export type VoiceError =
  | 'permission-denied'
  | 'no-microphone'
  | 'transcription-failed'

export type VoiceState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'activating'; readonly taskId: string }
  | {
      readonly phase: 'recording'
      readonly taskId: string
      readonly startedAt: number
    }
  | { readonly phase: 'stopping'; readonly taskId: string }
  | { readonly phase: 'processing'; readonly taskId: string }
  | { readonly phase: 'error'; readonly error: VoiceError }

export type VoicePhase = VoiceState['phase']

export type VoiceEvent =
  | { readonly type: 'start'; readonly taskId: string }
  | { readonly type: 'activated'; readonly taskId: string; readonly at: number }
  | { readonly type: 'stop' }
  | { readonly type: 'stopped'; readonly taskId: string }
  | { readonly type: 'processed'; readonly taskId: string }
  | {
      readonly type: 'fail'
      readonly taskId: string
      readonly error: VoiceError
    }
  | { readonly type: 'cancel' }
  | { readonly type: 'dismiss' }

export const VOICE_IDLE: VoiceState = { phase: 'idle' }

export function voiceReducer(state: VoiceState, event: VoiceEvent): VoiceState {
  switch (event.type) {
    case 'start':
      return state.phase === 'idle' || state.phase === 'error'
        ? { phase: 'activating', taskId: event.taskId }
        : state
    case 'activated':
      return state.phase === 'activating' && state.taskId === event.taskId
        ? { phase: 'recording', taskId: event.taskId, startedAt: event.at }
        : state
    case 'stop':
      return state.phase === 'recording'
        ? { phase: 'stopping', taskId: state.taskId }
        : state
    case 'stopped':
      return state.phase === 'stopping' && state.taskId === event.taskId
        ? { phase: 'processing', taskId: event.taskId }
        : state
    case 'processed':
      return state.phase === 'processing' && state.taskId === event.taskId
        ? VOICE_IDLE
        : state
    case 'fail':
      return taskOf(state) === event.taskId
        ? { phase: 'error', error: event.error }
        : state
    case 'cancel':
      return state.phase === 'activating' || state.phase === 'recording'
        ? VOICE_IDLE
        : state
    case 'dismiss':
      return state.phase === 'error' ? VOICE_IDLE : state
    default: {
      const unreachable: never = event
      throw new Error(`Unknown voice event ${JSON.stringify(unreachable)}`)
    }
  }
}

export function taskOf(state: VoiceState): string | null {
  switch (state.phase) {
    case 'activating':
    case 'recording':
    case 'stopping':
    case 'processing':
      return state.taskId
    case 'idle':
    case 'error':
      return null
    default: {
      const unreachable: never = state
      throw new Error(`Unknown voice state ${JSON.stringify(unreachable)}`)
    }
  }
}

export const VOICE_ERROR_TEXT: Readonly<Record<VoiceError, string>> = {
  'permission-denied': '没有麦克风权限，请在系统设置中允许 Corn Bot 使用麦克风',
  'no-microphone': '没有找到可用的麦克风',
  'transcription-failed': '转写失败，草稿已保留，可以重试',
}

/** `m:ss`; recordings longer than an hour are not a dictation case. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const seconds = total % 60
  return `${Math.floor(total / 60)}:${String(seconds).padStart(2, '0')}`
}
