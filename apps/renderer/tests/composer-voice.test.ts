import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  formatDuration,
  VOICE_IDLE,
  type VoiceEvent,
  type VoiceState,
  voiceReducer,
} from '../src/features/voice/voice-model.ts'

const run = (events: readonly VoiceEvent[], from: VoiceState = VOICE_IDLE) =>
  events.reduce(voiceReducer, from)

test('dictation walks activating → recording → stopping → processing → idle', () => {
  const activating = run([{ type: 'start', taskId: 't1' }])
  assert.deepEqual(activating, { phase: 'activating', taskId: 't1' })
  const recording = voiceReducer(activating, {
    type: 'activated',
    taskId: 't1',
    at: 5,
  })
  assert.deepEqual(recording, {
    phase: 'recording',
    taskId: 't1',
    startedAt: 5,
  })
  const stopping = voiceReducer(recording, { type: 'stop' })
  assert.equal(stopping.phase, 'stopping')
  const processing = voiceReducer(stopping, { type: 'stopped', taskId: 't1' })
  assert.equal(processing.phase, 'processing')
  assert.equal(
    voiceReducer(processing, { type: 'processed', taskId: 't1' }),
    VOICE_IDLE,
  )
})

test('repeated starts or stops during a task never start a second one', () => {
  const recording = run([
    { type: 'start', taskId: 't1' },
    { type: 'activated', taskId: 't1', at: 0 },
  ])
  for (const state of [
    run([{ type: 'start', taskId: 't1' }]),
    recording,
    run([{ type: 'stop' }], recording),
    run([{ type: 'stop' }, { type: 'stopped', taskId: 't1' }], recording),
  ]) {
    assert.equal(voiceReducer(state, { type: 'start', taskId: 't2' }), state)
  }
  const stopping = voiceReducer(recording, { type: 'stop' })
  assert.equal(voiceReducer(stopping, { type: 'stop' }), stopping)
})

test('late events from a cancelled task are ignored', () => {
  const cancelled = run([
    { type: 'start', taskId: 't1' },
    { type: 'cancel' },
    { type: 'start', taskId: 't2' },
  ])
  assert.equal(
    voiceReducer(cancelled, { type: 'activated', taskId: 't1', at: 0 }),
    cancelled,
  )
  assert.equal(
    voiceReducer(cancelled, {
      type: 'fail',
      taskId: 't1',
      error: 'no-microphone',
    }),
    cancelled,
  )
})

test('errors are recoverable: dismiss or start again', () => {
  const denied = run([
    { type: 'start', taskId: 't1' },
    { type: 'fail', taskId: 't1', error: 'permission-denied' },
  ])
  assert.deepEqual(denied, { phase: 'error', error: 'permission-denied' })
  assert.equal(voiceReducer(denied, { type: 'dismiss' }), VOICE_IDLE)
  assert.equal(
    voiceReducer(denied, { type: 'start', taskId: 't2' }).phase,
    'activating',
  )
  const failed = run([
    { type: 'start', taskId: 't1' },
    { type: 'activated', taskId: 't1', at: 0 },
    { type: 'stop' },
    { type: 'stopped', taskId: 't1' },
    { type: 'fail', taskId: 't1', error: 'transcription-failed' },
  ])
  assert.deepEqual(failed, { phase: 'error', error: 'transcription-failed' })
})

test('stop-in-flight and processing cannot be cancelled away', () => {
  const stopping = run([
    { type: 'start', taskId: 't1' },
    { type: 'activated', taskId: 't1', at: 0 },
    { type: 'stop' },
  ])
  assert.equal(voiceReducer(stopping, { type: 'cancel' }), stopping)
})

test('switching Bot resets any task so late results are dropped', () => {
  const processing = run([
    { type: 'start', taskId: 't1' },
    { type: 'activated', taskId: 't1', at: 0 },
    { type: 'stop' },
    { type: 'stopped', taskId: 't1' },
  ])
  const reset = voiceReducer(processing, { type: 'reset' })
  assert.equal(reset, VOICE_IDLE)
  assert.equal(voiceReducer(reset, { type: 'processed', taskId: 't1' }), reset)
  assert.equal(voiceReducer(VOICE_IDLE, { type: 'reset' }), VOICE_IDLE)
})

test('durations format as m:ss', () => {
  assert.equal(formatDuration(0), '0:00')
  assert.equal(formatDuration(9_999), '0:09')
  assert.equal(formatDuration(75_000), '1:15')
  assert.equal(formatDuration(-5), '0:00')
})
