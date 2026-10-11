import { cp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Configuration } from 'electron-builder'

export interface BuilderPaths {
  /** Staged app code only: package.json, dist and renderer. */
  readonly app: string
  /** Complete hoisted production tree from `pnpm deploy`, peers included. */
  readonly runtimeModules: string
  readonly output: string
  readonly electronDist: string
  readonly profileTemplate: string
  /** Absolute path to the `.icns` from `scripts/generate-app-icons.mjs`. */
  readonly icon: string
}

export const APP_ID = 'io.github.xingyingyuzhui.cornbot'

/** M0 developer build: unsigned arm64 `.app`; signing and notarization are out of scope. */
export function cornBuilderConfig(paths: BuilderPaths): Configuration {
  return {
    appId: APP_ID,
    productName: 'Corn Bot',
    directories: { app: paths.app, output: paths.output },
    electronVersion: '44.7.0',
    electronDist: paths.electronDist,
    npmRebuild: false,
    asar: true,
    files: ['package.json', 'dist/**', 'renderer/**'],
    // electron-builder's collector skips peer dependencies and extraResources drops
    // node_modules, so the verified trees are copied verbatim before any signing step.
    // Resources/node_modules resolves from app.asar and lets the DSH Host run from real files.
    afterPack: async ({ appOutDir }) => {
      const resources = join(appOutDir, 'Corn Bot.app/Contents/Resources')
      await rm(join(resources, 'default_app.asar'), { force: true })
      await cp(paths.runtimeModules, join(resources, 'node_modules'), {
        recursive: true,
        verbatimSymlinks: true,
      })
      await cp(paths.profileTemplate, join(resources, 'profile-template'), {
        recursive: true,
      })
    },
    mac: {
      target: [{ target: 'dir', arch: ['arm64'] }],
      category: 'public.app-category.productivity',
      icon: paths.icon,
      identity: null,
      hardenedRuntime: false,
    },
  }
}
