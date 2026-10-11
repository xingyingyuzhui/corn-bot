import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { assertTrustedSender } from '../src/security/ipc-allowlist.ts'

test('IPC accepts only the owned window main frame, rejecting another window and nested/detached frames', () => {
  const mainFrame = {}
  const webContents = { mainFrame }
  const window = { webContents } as BrowserWindow
  const event = (sender: unknown, senderFrame: unknown) =>
    ({ sender, senderFrame }) as IpcMainInvokeEvent
  assert.doesNotThrow(() =>
    assertTrustedSender(event(webContents, mainFrame), window),
  )
  for (const untrusted of [
    event({ mainFrame }, mainFrame),
    event(webContents, {}),
    event(webContents, null),
  ])
    assert.throws(() => assertTrustedSender(untrusted, window), /Untrusted/u)
})
