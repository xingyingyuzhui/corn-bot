import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'
import { resolveAppPaths } from '../src/app-paths.ts'

const location = {
  appPath: '/repo/apps/desktop',
  userData: '/Users/u/Library/Application Support/Corn Bot',
  resourcesPath: '/Applications/Corn Bot.app/Contents/Resources',
}

test('development layout uses the repository and DSH online template', () => {
  const paths = resolveAppPaths({ ...location, isPackaged: false }, {})
  assert.equal(paths.renderer, '/repo/apps/renderer/dist/index.html')
  assert.equal(paths.artifacts, '/repo/.artifacts')
  assert.equal(paths.profileTemplate, undefined)
  assert.equal(paths.devModelOverrideFile, undefined)
})

test('only an unpackaged build honours the explicit development model override', () => {
  const env = {
    CORN_DEV_MODEL_ENV_FILE: '/tmp/corn-dev-model.env',
    CORN_MODEL_ENV_FILE: '/tmp/legacy-model.env',
  }
  assert.equal(
    resolveAppPaths({ ...location, isPackaged: false }, env)
      .devModelOverrideFile,
    '/tmp/corn-dev-model.env',
  )
  assert.equal(
    resolveAppPaths(
      { ...location, isPackaged: false },
      { CORN_MODEL_ENV_FILE: '/tmp/legacy-model.env' },
    ).devModelOverrideFile,
    undefined,
    'the retired production variable selects nothing',
  )
  assert.equal(
    resolveAppPaths(
      {
        ...location,
        appPath: join(location.resourcesPath, 'app.asar'),
        isPackaged: true,
      },
      env,
    ).devModelOverrideFile,
    undefined,
  )
})

test('packaged layout keeps data in userData and seeds from bundled resources', () => {
  const appPath = join(location.resourcesPath, 'app.asar')
  const paths = resolveAppPaths({ ...location, appPath, isPackaged: true }, {})
  assert.equal(paths.renderer, join(appPath, 'renderer/index.html'))
  assert.equal(paths.home, join(location.userData, 'dsh'))
  assert.equal(paths.devModelOverrideFile, undefined)
  assert.equal(
    paths.profileTemplate,
    join(location.resourcesPath, 'profile-template'),
  )
  const isolated = resolveAppPaths(
    { ...location, appPath, isPackaged: true },
    { CORN_DSH_HOME: '/tmp/corn-a', CORN_ARTIFACTS_DIR: '/tmp/art' },
  )
  assert.equal(isolated.home, '/tmp/corn-a')
  assert.equal(isolated.artifacts, '/tmp/art')
})
