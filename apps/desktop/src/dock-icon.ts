import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { App } from 'electron'

export type DockIconHost = Pick<App, 'isPackaged' | 'getAppPath' | 'dock'>

/** Written by `pnpm icons:mac` (and every `pnpm package:mac`); never committed. */
export function devDockIconPath(appPath: string): string {
  return resolve(appPath, '../../.build/icons/app-icon-1024.png')
}

/**
 * An unpackaged run shows Electron's own Dock icon unless one is set at
 * runtime; packaged builds get theirs from the bundle's `.icns`.
 */
export function applyDevDockIcon(
  host: DockIconHost,
  exists: (path: string) => boolean = existsSync,
): string | undefined {
  if (host.isPackaged || !host.dock) return undefined
  const icon = devDockIconPath(host.getAppPath())
  if (!exists(icon)) return undefined
  host.dock.setIcon(icon)
  return icon
}
