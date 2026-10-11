import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  matchShortcut,
  platformOf,
  SHORTCUTS,
  type ShortcutContext,
  type ShortcutKeyEvent,
  shouldRunShortcut,
} from '../src/app/shortcuts.ts'

const key = (
  partial: Partial<ShortcutKeyEvent> & Pick<ShortcutKeyEvent, 'key' | 'code'>,
): ShortcutKeyEvent => ({
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...partial,
})

const idOf = (event: ShortcutKeyEvent, platform: 'mac' | 'other') =>
  matchShortcut(event, platform)?.definition.id ?? null

const KIT_ACTIONS = [
  'command-palette',
  'focus-search',
  'new-bot',
  'send',
  'focus-input',
  'find-in-chat',
  'toggle-sidebar',
  'open-settings',
  'bot-settings',
  'previous-bot',
  'next-bot',
  'navigate-back',
  'navigate-forward',
  'select-nth-bot',
  'add-selection',
  'open-tools',
  'open-skills',
  'toggle-details',
  'cycle-bots',
]

test('registry lists every kit action once, each with a status and a reason', () => {
  const ids = SHORTCUTS.map((entry) => entry.id)
  assert.deepEqual([...ids].sort(), [...KIT_ACTIONS].sort())
  assert.equal(new Set(ids).size, ids.length)
  for (const entry of SHORTCUTS) {
    assert.ok(
      ['implemented', 'deferred', 'not-applicable'].includes(entry.status),
      entry.id,
    )
    assert.ok(entry.reason.trim().length > 0, `${entry.id} needs a reason`)
    assert.ok(entry.bindings.length > 0, `${entry.id} needs a binding`)
  }
})

test('the implemented set is exactly what the shell and composer handle', () => {
  const implemented = SHORTCUTS.filter(
    (entry) => entry.status === 'implemented',
  )
  assert.deepEqual(implemented.map((entry) => entry.id).sort(), [
    'bot-settings',
    'focus-input',
    'focus-search',
    'new-bot',
    'next-bot',
    'open-settings',
    'previous-bot',
    'select-nth-bot',
    'send',
    'toggle-details',
    'toggle-sidebar',
  ])
  assert.equal(
    SHORTCUTS.find((entry) => entry.id === 'send')?.scope,
    'composer',
  )
})

test('Mod is Command on macOS and Control elsewhere', () => {
  const cmdN = key({ key: 'n', code: 'KeyN', metaKey: true })
  const ctrlN = key({ key: 'n', code: 'KeyN', ctrlKey: true })
  assert.equal(idOf(cmdN, 'mac'), 'new-bot')
  assert.equal(idOf(ctrlN, 'mac'), null)
  assert.equal(idOf(ctrlN, 'other'), 'new-bot')
  assert.equal(idOf(cmdN, 'other'), null)
})

test('modifiers must match exactly', () => {
  const modF = key({ key: 'f', code: 'KeyF', metaKey: true })
  assert.equal(idOf(modF, 'mac'), 'find-in-chat')
  assert.equal(
    idOf({ ...modF, shiftKey: true, key: 'F' }, 'mac'),
    'focus-search',
  )
  assert.equal(idOf({ ...modF, altKey: true }, 'mac'), null)
})

test('shifted and Option-rewritten keys fall back to the physical key', () => {
  const modShiftComma = key({
    key: '<',
    code: 'Comma',
    metaKey: true,
    shiftKey: true,
  })
  assert.equal(idOf(modShiftComma, 'mac'), 'bot-settings')
  assert.equal(
    idOf(key({ key: ',', code: 'Comma', ctrlKey: true }), 'other'),
    'open-settings',
  )
  const optionB = key({ key: '∫', code: 'KeyB', metaKey: true, altKey: true })
  assert.equal(idOf(optionB, 'mac'), 'toggle-details')
  assert.equal(
    idOf(key({ key: 'ArrowUp', code: 'ArrowUp', altKey: true }), 'mac'),
    'previous-bot',
  )
  assert.equal(
    idOf(key({ key: 'ArrowDown', code: 'ArrowDown', altKey: true }), 'other'),
    'next-bot',
  )
})

test('letters follow the active layout before the physical key', () => {
  const azertyQ = key({ key: 'b', code: 'KeyQ', metaKey: true })
  assert.equal(idOf(azertyQ, 'mac'), 'toggle-sidebar')
  const cyrillic = key({ key: 'и', code: 'KeyB', metaKey: true })
  assert.equal(idOf(cyrillic, 'mac'), 'toggle-sidebar')
})

test('Mod+Shift+I is a toggle-details alias on macOS only', () => {
  const event = key({ key: 'I', code: 'KeyI', shiftKey: true })
  assert.equal(idOf({ ...event, metaKey: true }, 'mac'), 'toggle-details')
  assert.equal(idOf({ ...event, ctrlKey: true }, 'other'), null)
  assert.equal(
    idOf(key({ key: 'b', code: 'KeyB', ctrlKey: true, altKey: true }), 'other'),
    'toggle-details',
  )
})

test('Mod+1…9 reports the 1-based position', () => {
  for (let n = 1; n <= 9; n += 1) {
    const match = matchShortcut(
      key({ key: String(n), code: `Digit${n}`, metaKey: true }),
      'mac',
    )
    assert.equal(match?.definition.id, 'select-nth-bot')
    assert.equal(match?.position, n)
  }
  assert.equal(
    idOf(key({ key: '0', code: 'Digit0', metaKey: true }), 'mac'),
    null,
  )
})

test('Ctrl+Tab is physical Control on every platform', () => {
  const ctrlTab = key({ key: 'Tab', code: 'Tab', ctrlKey: true })
  assert.equal(idOf(ctrlTab, 'mac'), 'cycle-bots')
  assert.equal(idOf(ctrlTab, 'other'), 'cycle-bots')
  assert.equal(idOf({ ...ctrlTab, shiftKey: true }, 'mac'), 'cycle-bots')
  assert.equal(
    idOf(key({ key: 'Tab', code: 'Tab', metaKey: true }), 'mac'),
    null,
  )
})

test('clipboard and undo chords are never claimed', () => {
  for (const letter of ['a', 'c', 'v', 'x', 'z']) {
    const code = `Key${letter.toUpperCase()}`
    assert.equal(idOf(key({ key: letter, code, metaKey: true }), 'mac'), null)
    assert.equal(idOf(key({ key: letter, code, ctrlKey: true }), 'other'), null)
  }
})

const calm: ShortcutContext = {
  overlayOpen: false,
  composing: false,
  inMenu: false,
  repeat: false,
}

const matchOf = (event: ShortcutKeyEvent) => {
  const match = matchShortcut(event, 'mac')
  assert.ok(match)
  return match
}

test('focus scope: overlays, menus and IME composition block global shortcuts', () => {
  const toggle = matchOf(key({ key: 'b', code: 'KeyB', metaKey: true }))
  assert.equal(shouldRunShortcut(toggle, calm), true)
  assert.equal(shouldRunShortcut(toggle, { ...calm, overlayOpen: true }), false)
  assert.equal(shouldRunShortcut(toggle, { ...calm, inMenu: true }), false)
  assert.equal(shouldRunShortcut(toggle, { ...calm, composing: true }), false)
})

test('only navigation repeats; deferred and composer shortcuts never run globally', () => {
  const toggle = matchOf(key({ key: 'b', code: 'KeyB', metaKey: true }))
  const next = matchOf(
    key({ key: 'ArrowDown', code: 'ArrowDown', altKey: true }),
  )
  assert.equal(shouldRunShortcut(toggle, { ...calm, repeat: true }), false)
  assert.equal(shouldRunShortcut(next, { ...calm, repeat: true }), true)
  const send = matchOf(key({ key: 'Enter', code: 'Enter', metaKey: true }))
  assert.equal(shouldRunShortcut(send, calm), false)
  const palette = matchOf(key({ key: 'k', code: 'KeyK', metaKey: true }))
  assert.equal(shouldRunShortcut(palette, calm), false)
})

test('platform detection', () => {
  assert.equal(platformOf('MacIntel'), 'mac')
  assert.equal(platformOf('Win32'), 'other')
  assert.equal(platformOf('Linux x86_64'), 'other')
  assert.equal(platformOf(''), 'other')
})
