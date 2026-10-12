import { join, resolve } from 'node:path'
import { defaultDevelopmentHome } from './runtime/profile-bootstrap.ts'

export interface AppPaths {
  readonly renderer: string
  readonly preload: string
  readonly artifacts: string
  readonly home: string
  /**
   * Explicit development model override (`CORN_DEV_MODEL_ENV_FILE`), honoured
   * only by unpackaged builds. Absent by default: the App boots keyless and is
   * configured through Settings.
   */
  readonly devModelOverrideFile: string | undefined
  /** Packaged builds seed Corn's profile from this verified bundle; development uses DSH's template. */
  readonly profileTemplate: string | undefined
}

export interface AppLocation {
  readonly isPackaged: boolean
  readonly appPath: string
  readonly userData: string
  readonly resourcesPath: string
}

/** Explicit `CORN_*` overrides exist for isolated smoke runs only. */
export function resolveAppPaths(
  location: AppLocation,
  env: NodeJS.ProcessEnv = process.env,
): AppPaths {
  const preload = join(location.appPath, 'dist/apps/desktop/src/preload.cjs')
  if (!location.isPackaged) {
    const root = resolve(location.appPath, '../..')
    return {
      renderer: join(root, 'apps/renderer/dist/index.html'),
      preload,
      artifacts: join(root, '.artifacts'),
      home: env.CORN_DSH_HOME ?? defaultDevelopmentHome(),
      devModelOverrideFile: env.CORN_DEV_MODEL_ENV_FILE || undefined,
      profileTemplate: undefined,
    }
  }
  return {
    renderer: join(location.appPath, 'renderer/index.html'),
    preload,
    artifacts: env.CORN_ARTIFACTS_DIR ?? join(location.userData, 'artifacts'),
    home: env.CORN_DSH_HOME ?? join(location.userData, 'dsh'),
    devModelOverrideFile: undefined,
    profileTemplate: join(location.resourcesPath, 'profile-template'),
  }
}
