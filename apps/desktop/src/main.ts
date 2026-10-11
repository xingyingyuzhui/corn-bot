import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'
import {
  DSH_VERSION,
  type RuntimeView,
} from '../../../packages/contracts/src/runtime.ts'
import { DshHostSupervisor } from './runtime/dsh-host-supervisor.ts'
import { defaultDevelopmentHome } from './runtime/profile-bootstrap.ts'
import { assertTrustedSender } from './security/ipc-allowlist.ts'

app.setName('Corn Bot')
let view: RuntimeView = {
  status: 'starting',
  dshVersion: DSH_VERSION,
  message: '正在启动 Corn 独立运行时…',
}
const supervisor = new DshHostSupervisor(
  process.env.CORN_DSH_HOME ?? defaultDevelopmentHome(),
  () => {
    view = {
      status: 'failed',
      dshVersion: DSH_VERSION,
      message: '独立运行时连接已断开。',
    }
  },
)
const currentStatus = (): RuntimeView['status'] => view.status
let startup: Promise<void> | undefined
let exitAllowed = false
let cleanup: Promise<void> | undefined

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('before-quit', (event) => {
    if (exitAllowed) return
    event.preventDefault()
    cleanup ??= (async () => {
      await startup?.catch(() => {})
      try {
        await supervisor.stop()
      } catch {
        process.exitCode = 1
      } finally {
        exitAllowed = true
        app.quit()
      }
    })()
  })
  app.on('window-all-closed', () => app.quit())

  void app.whenReady().then(async () => {
    const root = resolve(app.getAppPath(), '../..')
    const window = new BrowserWindow({
      width: 760,
      height: 520,
      title: 'Corn Bot · M0',
      backgroundColor: '#fafafa',
      webPreferences: {
        preload: join(app.getAppPath(), 'dist/apps/desktop/src/preload.cjs'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    window.webContents.on('will-attach-webview', (event) =>
      event.preventDefault(),
    )
    ipcMain.handle('corn:runtime:status', (event) => {
      assertTrustedSender(event, window)
      return view
    })
    await window.loadFile(join(root, 'apps/renderer/src/index.html'))
    if (cleanup) return
    startup = (async () => {
      try {
        await supervisor.start()
        view = {
          status: 'ready',
          dshVersion: DSH_VERSION,
          message: 'Corn 独立运行时已连接，等待全新的模型配置。',
        }
      } catch {
        view = {
          status: 'failed',
          dshVersion: DSH_VERSION,
          message: '独立运行时启动失败，请运行 pnpm smoke:host 检查。',
        }
      }
      if (process.env.CORN_DESKTOP_SMOKE === '1') {
        const crashSmoke = process.env.CORN_DESKTOP_CRASH_SMOKE === '1'
        if (crashSmoke) {
          const pid = supervisor.processId
          if (view.status !== 'ready' || pid === undefined)
            throw new Error('Crash smoke requires its own ready Host')
          process.kill(pid, 'SIGKILL')
          const deadline = Date.now() + 5_000
          while (currentStatus() === 'ready' && Date.now() < deadline)
            await new Promise((resolve) => setTimeout(resolve, 50))
          if (currentStatus() !== 'failed')
            throw new Error('Host crash did not update Main status')
        }
        const artifacts = join(root, '.artifacts')
        await mkdir(artifacts, { recursive: true, mode: 0o700 })
        const rendererView: unknown =
          await window.webContents.executeJavaScript(
            'window.corn.runtimeStatus()',
          )
        const bridgeVerified =
          typeof rendererView === 'object' &&
          rendererView !== null &&
          'status' in rendererView &&
          rendererView.status === view.status
        if (!bridgeVerified)
          throw new Error('Sandboxed renderer IPC smoke failed')
        await new Promise((resolve) => setTimeout(resolve, 1_000))
        await writeFile(
          join(
            artifacts,
            crashSmoke ? 'm0-electron-crash.png' : 'm0-electron.png',
          ),
          (await window.webContents.capturePage()).toPNG(),
          { mode: 0o600 },
        )
        await writeFile(
          join(
            artifacts,
            crashSmoke
              ? 'm0-electron-crash-smoke.json'
              : 'm0-electron-smoke.json',
          ),
          `${JSON.stringify({ ...view, electron: process.versions.electron, node: process.versions.node, independentRuntime: true, bridgeVerified }, null, 2)}\n`,
          { mode: 0o600 },
        )
        process.exitCode =
          view.status === (crashSmoke ? 'failed' : 'ready') ? 0 : 1
        app.quit()
      }
    })()
  })
}
