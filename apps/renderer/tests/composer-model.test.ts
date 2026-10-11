import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ATTACHMENT_LIMIT_MESSAGE,
  composerAction,
  draftAfterSend,
  formatBytes,
  hasPayload,
  nextAttempt,
  pastePlan,
  type SubmitKey,
  shouldSubmit,
  stageAttachments,
} from '../src/features/chat/composer-model.ts'
import type { AttachmentView } from '../src/model/workspace.ts'

const key = (patch: Partial<SubmitKey> = {}): SubmitKey => ({
  key: 'Enter',
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  isComposing: false,
  repeat: false,
  ...patch,
})
const closed = { menuOpen: false, mac: true }

test('Enter submits; Shift+Enter, other keys and an open menu do not', () => {
  assert.equal(shouldSubmit(key(), closed), true)
  assert.equal(shouldSubmit(key({ shiftKey: true }), closed), false)
  assert.equal(shouldSubmit(key({ key: 'a' }), closed), false)
  assert.equal(shouldSubmit(key(), { menuOpen: true, mac: true }), false)
  assert.equal(shouldSubmit(key({ altKey: true }), closed), false)
})

test('IME composition never submits, including Chromium keyCode 229', () => {
  assert.equal(shouldSubmit(key({ isComposing: true }), closed), false)
  assert.equal(shouldSubmit(key({ keyCode: 229 }), closed), false)
  assert.equal(shouldSubmit(key({ keyCode: 13 }), closed), true)
})

test('a held Enter (key repeat) never resubmits', () => {
  assert.equal(shouldSubmit(key({ repeat: true }), closed), false)
  assert.equal(
    shouldSubmit(key({ repeat: true, metaKey: true }), closed),
    false,
  )
})

test('Mod+Enter submits with Command on macOS and Control elsewhere', () => {
  assert.equal(shouldSubmit(key({ metaKey: true }), closed), true)
  assert.equal(shouldSubmit(key({ ctrlKey: true }), closed), false)
  const other = { menuOpen: false, mac: false }
  assert.equal(shouldSubmit(key({ ctrlKey: true }), other), true)
  assert.equal(shouldSubmit(key({ metaKey: true }), other), false)
  assert.equal(
    shouldSubmit(key({ metaKey: true }), { menuOpen: true, mac: true }),
    false,
  )
})

test('payload is trimmed text or at least one attachment', () => {
  const file = { id: 'f', name: 'a.png', size: 1 }
  assert.equal(hasPayload({ text: '  \n ', attachments: [] }), false)
  assert.equal(hasPayload({ text: ' hi ', attachments: [] }), true)
  assert.equal(hasPayload({ text: '', attachments: [file] }), true)
})

const files = (count: number, prefix = 'f'): AttachmentView[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `${prefix}${i}`,
    name: `${prefix}${i}.png`,
    size: 100,
  }))

test('staging accepts the 6th file and rejects the 7th with feedback', () => {
  const sixth = stageAttachments(files(5), files(1, 'n'))
  assert.equal(sixth.attachments.length, 6)
  assert.equal(sixth.rejected, 0)
  assert.equal(sixth.message, null)

  const seventh = stageAttachments(files(6), files(1, 'n'))
  assert.equal(seventh.attachments.length, 6)
  assert.equal(seventh.rejected, 1)
  assert.equal(seventh.message, ATTACHMENT_LIMIT_MESSAGE)
  assert.equal(ATTACHMENT_LIMIT_MESSAGE, '最多只能添加 6 个附件')
})

test('staging several at once keeps order and reports the overflow', () => {
  const many = stageAttachments([], files(8))
  assert.deepEqual(
    many.attachments.map((file) => file.id),
    ['f0', 'f1', 'f2', 'f3', 'f4', 'f5'],
  )
  assert.equal(many.rejected, 2)

  const fivePlusThree = stageAttachments(files(5), files(3, 'n'))
  assert.equal(fivePlusThree.attachments.length, 6)
  assert.equal(fivePlusThree.attachments[5]?.id, 'n0')
  assert.equal(fivePlusThree.rejected, 2)
  assert.equal(fivePlusThree.message, ATTACHMENT_LIMIT_MESSAGE)

  const custom = stageAttachments(files(1), files(2, 'n'), 2)
  assert.equal(custom.message, '最多只能添加 2 个附件')
})

test('paste: text-only stays native, files stage once, mixed keeps both', () => {
  assert.deepEqual(pastePlan({ text: 'hi', fileCount: 0 }), {
    stageFiles: false,
    insertText: true,
  })
  assert.deepEqual(pastePlan({ text: '', fileCount: 2 }), {
    stageFiles: true,
    insertText: false,
  })
  assert.deepEqual(pastePlan({ text: 'a.png', fileCount: 1 }), {
    stageFiles: true,
    insertText: true,
  })
})

const idle = {
  hasPayload: false,
  canSend: true,
  readOnly: false,
  voice: 'idle',
} as const

test('action: empty shows voice mode, payload shows send', () => {
  assert.deepEqual(composerAction(idle), {
    action: 'voice-mode',
    glyph: 'waveform',
    disabled: false,
    busy: false,
    label: '实时语音',
  })
  const send = composerAction({ ...idle, hasPayload: true })
  assert.equal(send.action, 'send')
  assert.equal(send.glyph, 'arrow-up')
  assert.equal(send.disabled, false)
})

test('action: payload with canSend=false is disabled; in-flight is busy', () => {
  const blocked = composerAction({ ...idle, hasPayload: true, canSend: false })
  assert.equal(blocked.action, 'send')
  assert.equal(blocked.disabled, true)
  const sending = composerAction({ ...idle, hasPayload: true, sending: true })
  assert.equal(sending.busy, true)
  assert.equal(sending.label, '正在发送')
})

test('action: read-only conversations never send', () => {
  for (const hasPayload of [false, true]) {
    const action = composerAction({ ...idle, hasPayload, readOnly: true })
    assert.equal(action.action, 'none')
    assert.equal(action.disabled, true)
    assert.equal(action.label, '此聊天仅供查看')
  }
})

test('action: voice states take over the button until they finish', () => {
  const recording = composerAction({
    ...idle,
    hasPayload: true,
    voice: 'recording',
  })
  assert.equal(recording.action, 'stop-voice')
  assert.equal(recording.glyph, 'stop')
  assert.equal(recording.disabled, false)
  for (const voice of ['activating', 'stopping', 'processing'] as const) {
    const wait = composerAction({ ...idle, voice })
    assert.equal(wait.action, 'wait-voice')
    assert.equal(wait.disabled, true)
    assert.equal(wait.busy, true)
  }
  assert.equal(composerAction({ ...idle, voice: 'error' }).action, 'voice-mode')
  assert.equal(
    composerAction({ ...idle, hasPayload: true, voice: 'error' }).action,
    'send',
  )
})

test('a retry of an unchanged draft reuses its client id', () => {
  let n = 0
  const makeId = () => `c${++n}`
  const draft = { text: 'hi', attachments: files(1) }
  const first = nextAttempt(undefined, draft, makeId)
  assert.equal(first.clientId, 'c1')
  assert.equal(nextAttempt(first, draft, makeId).clientId, 'c1')
  assert.equal(
    nextAttempt(first, { ...draft, text: 'hi!' }, makeId).clientId,
    'c2',
  )
  assert.equal(
    nextAttempt(first, { ...draft, attachments: [] }, makeId).clientId,
    'c3',
  )
})

test('a successful send clears the draft unless it was edited meanwhile', () => {
  const draft = { text: 'hi', attachments: files(2) }
  const sent = nextAttempt(undefined, draft, () => 'c1')
  assert.deepEqual(draftAfterSend(draft, sent), { text: '', attachments: [] })
  const edited = { ...draft, text: 'hi there' }
  assert.equal(draftAfterSend(edited, sent), edited)
})

test('attachment sizes are human-readable', () => {
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(482_133), '471 KB')
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB')
})
