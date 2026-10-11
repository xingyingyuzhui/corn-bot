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
  assert.equal(paths.renderer, '/repo/apps/renderer/src/index.html')
  assert.equal(paths.artifacts, '/repo/.artifacts')
  assert.equal(paths.profileTemplate, undefined)
})

test('packaged layout keeps data in userData and seeds from bundled resources', () => {
  const appPath = join(location.resourcesPath, 'app.asar')
  const paths = resolveAppPaths({ ...location, appPath, isPackaged: true }, {})
  assert.equal(paths.renderer, join(appPath, 'renderer/index.html'))
  assert.equal(paths.home, join(location.userData, 'dsh'))
  assert.equal(paths.modelEnvFile, join(location.userData, 'model.env'))
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
