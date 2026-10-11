import { spawn } from 'node:child_process'
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, Platform } from 'electron-builder'
import { cornBuilderConfig } from '../apps/desktop/electron-builder.config.ts'
import { buildProfileTemplate } from './lib/profile-template-build.mjs'

// Unsigned arm64 developer package. Run: pnpm package:mac
if (process.platform !== 'darwin' || process.arch !== 'arm64')
  throw new Error('M0 packaging targets macOS arm64 only')

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const require = createRequire(import.meta.url)
const staging = join(root, '.build')
const app = join(staging, 'app')
const template = join(staging, 'profile-template')
const runtimeModules = join(staging, 'node_modules')
const output = join(root, 'release')

async function run(command, args) {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit' })
  await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} failed (${code})`)),
    )
  })
}

await run('pnpm', ['build'])
await rm(staging, { recursive: true, force: true })
await mkdir(staging, { recursive: true })

// Production dependencies as a plain hoisted tree: no pnpm links for electron-builder to resolve.
// `pnpm deploy` records its prod/hoisted settings as the workspace install state, which
// makes later pnpm commands demand a destructive reinstall; restore the developer state.
const workspaceState = join(root, 'node_modules/.pnpm-workspace-state-v1.json')
const savedState = await readFile(workspaceState)
try {
  await run('pnpm', [
    '--filter',
    '@corn-bot/desktop',
    'deploy',
    '--prod',
    '--legacy',
    '--config.node-linker=hoisted',
    app,
  ])
} finally {
  await writeFile(workspaceState, savedState)
}
const desktop = JSON.parse(
  await readFile(join(root, 'apps/desktop/package.json'), 'utf8'),
)
const rootManifest = JSON.parse(
  await readFile(join(root, 'package.json'), 'utf8'),
)
for (const entry of ['dist', 'src', 'tests', 'tsconfig.build.json'])
  await rm(join(app, entry), { recursive: true, force: true })
await rename(join(app, 'node_modules'), runtimeModules)
await cp(join(root, 'apps/desktop/dist'), join(app, 'dist'), {
  recursive: true,
  filter: (source) => !source.endsWith('.map'),
})
await cp(join(root, 'apps/renderer/dist'), join(app, 'renderer'), {
  recursive: true,
  filter: (source) => !source.endsWith('.map'),
})
await writeFile(
  join(app, 'package.json'),
  `${JSON.stringify(
    {
      name: 'corn-bot',
      productName: 'Corn Bot',
      version: rootManifest.version,
      description: 'Corn Bot desktop app with its own DSH runtime',
      author: 'xingyingyuzhui',
      license: rootManifest.license,
      type: 'module',
      main: desktop.main,
    },
    null,
    2,
  )}\n`,
)

await buildProfileTemplate(template)

await build({
  targets: Platform.MAC.createTarget(),
  publish: 'never',
  config: cornBuilderConfig({
    app,
    runtimeModules,
    output,
    electronDist: join(
      dirname(require.resolve('electron/package.json')),
      'dist',
    ),
    profileTemplate: template,
  }),
})
console.log(`Unsigned Corn Bot.app written to ${join(output, 'mac-arm64')}`)
