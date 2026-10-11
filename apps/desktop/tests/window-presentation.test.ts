import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  applyAppPresentation,
  type PresentationApp,
  type PresentedWindow,
  presentationWindowOptions,
  presentWindow,
  windowPresentation,
} from '../src/window-presentation.ts'

function fakeApp() {
  const policies: string[] = []
  const value: PresentationApp = {
    setActivationPolicy: (policy) => policies.push(policy),
  }
  return { value, policies }
}

function fakeWindow() {
  const listeners = new Map<string, () => void>()
  let inactiveShows = 0
  const value = {
    once(event: string, listener: () => void) {
      listeners.set(event, listener)
      return value
    },
    showInactive: () => {
      inactiveShows++
    },
  } as unknown as PresentedWindow
  return {
    value,
    listeners,
    inactiveShows: () => inactiveShows,
  }
}

test('only CORN_DESKTOP_SMOKE=1 selects the background presentation', () => {
  assert.equal(windowPresentation({ CORN_DESKTOP_SMOKE: '1' }), 'background')
  for (const env of [
    {},
    { CORN_DESKTOP_SMOKE: '0' },
    { CORN_DESKTOP_SMOKE: 'true' },
    { CORN_DESKTOP_CRASH_SMOKE: '1' },
  ])
    assert.equal(windowPresentation(env), 'foreground')
})

test('normal launches keep the default shown, activating window', () => {
  assert.deepEqual(presentationWindowOptions('foreground'), {})
  const app = fakeApp()
  applyAppPresentation(app.value, 'foreground', 'darwin')
  assert.deepEqual(app.policies, [])
  const window = fakeWindow()
  presentWindow(window.value, 'foreground')
  assert.equal(window.listeners.size, 0)
  assert.equal(window.inactiveShows(), 0)
})

test('smoke windows start hidden, then show inactive once painted', () => {
  assert.deepEqual(presentationWindowOptions('background'), { show: false })
  const window = fakeWindow()
  presentWindow(window.value, 'background')
  assert.deepEqual([...window.listeners.keys()], ['ready-to-show'])
  assert.equal(window.inactiveShows(), 0)
  window.listeners.get('ready-to-show')?.()
  assert.equal(window.inactiveShows(), 1)
})

test('smoke runs never become a regular, activating macOS app', () => {
  const mac = fakeApp()
  applyAppPresentation(mac.value, 'background', 'darwin')
  assert.deepEqual(mac.policies, ['accessory'])
  const linux = fakeApp()
  applyAppPresentation(linux.value, 'background', 'linux')
  assert.deepEqual(linux.policies, [])
})
