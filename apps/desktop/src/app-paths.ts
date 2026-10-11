import { join, resolve } from 'node:path'
import { defaultModelEnvFile } from './runtime/model-provider.ts'
import { defaultDevelopmentHome } from './runtime/profile-bootstrap.ts'

export interface AppPaths {
  readonly renderer: string
  readonly preload: string
  readonly artifacts: string
  readonly home: string
  readonly modelEnvFile: string
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
      modelEnvFile: env.CORN_MODEL_ENV_FILE ?? defaultModelEnvFile(),
      profileTemplate: undefined,
    }
  }
  return {
    renderer: join(location.appPath, 'renderer/index.html'),
    preload,
    artifacts: env.CORN_ARTIFACTS_DIR ?? join(location.userData, 'artifacts'),
    home: env.CORN_DSH_HOME ?? join(location.userData, 'dsh'),
    modelEnvFile:
      env.CORN_MODEL_ENV_FILE ?? join(location.userData, 'model.env'),
    profileTemplate: join(location.resourcesPath, 'profile-template'),
  }
}
