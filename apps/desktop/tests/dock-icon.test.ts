import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Dock } from 'electron'
import {
  applyDevDockIcon,
  type DockIconHost,
  devDockIconPath,
} from '../src/dock-icon.ts'

const ICON = '/repo/.build/icons/app-icon-1024.png'

function host(isPackaged: boolean, withDock = true) {
  const set: string[] = []
  const dock = { setIcon: (icon: string) => set.push(icon) } as unknown as Dock
  const value: DockIconHost = {
    isPackaged,
    getAppPath: () => '/repo/apps/desktop',
    dock: withDock ? dock : undefined,
  }
  return { value, set }
}

test('development runs use the generated icon from the repository build dir', () => {
  assert.equal(devDockIconPath('/repo/apps/desktop'), ICON)
  const dev = host(false)
  assert.equal(
    applyDevDockIcon(dev.value, () => true),
    ICON,
  )
  assert.deepEqual(dev.set, [ICON])
})

test('packaged builds, missing icons and dockless platforms leave the Dock alone', () => {
  for (const [candidate, exists] of [
    [host(true), true],
    [host(false), false],
    [host(false, false), true],
  ] as const) {
    assert.equal(
      applyDevDockIcon(candidate.value, () => exists),
      undefined,
    )
    assert.deepEqual(candidate.set, [])
  }
})
