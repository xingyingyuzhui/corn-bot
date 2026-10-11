import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { app, BrowserWindow, ipcMain } from 'electron'
import {
  DSH_VERSION,
  type RuntimeStatus,
  type RuntimeView,
} from '../../../packages/contracts/src/runtime.ts'
import { ClawRegistryClient } from '../../../packages/dsh-adapter/src/claw-registry-client.ts'
import { HostTransport } from '../../../packages/dsh-adapter/src/transport.ts'
import { resolveAppPaths } from './app-paths.ts'
import { DshHostSupervisor } from './runtime/dsh-host-supervisor.ts'
import type { HostAuth } from './runtime/host-auth.ts'
import { redactHostDiagnostic } from './runtime/host-readiness.ts'
import { HostRecovery } from './runtime/host-recovery.ts'
import { resolveCornModelConfig } from './runtime/model-provider.ts'
import { assertTrustedSender } from './security/ipc-allowlist.ts'
import { probeLayout } from './smoke/layout-probe.ts'

app.setName('Corn Bot')
const paths = resolveAppPaths({
  isPackaged: app.isPackaged,
  appPath: app.getAppPath(),
  userData: app.getPath('userData'),
  resourcesPath: process.resourcesPath,
})
const MESSAGES: Record<RuntimeStatus, string> = {
  stopped: 'Corn 独立运行时已停止。',
  starting: '正在启动 Corn 独立运行时…',
  ready: 'Corn 独立运行时已连接。',
  recovering: '独立运行时意外退出，正在自动恢复…',
  failed: '独立运行时多次启动失败，已停止自动恢复。',
}
let view: RuntimeView = {
  status: 'starting',
  dshVersion: DSH_VERSION,
  message: MESSAGES.starting,
}
const setStatus = (status: RuntimeStatus) => {
  view = { status, dshVersion: DSH_VERSION, message: MESSAGES[status] }
}
const currentStatus = (): RuntimeStatus => view.status

const recovery = new HostRecovery()
let auth: HostAuth | undefined
/** Main-only, redacted; surfaced in smoke reports, never over Renderer IPC. */
let lastFailure: string | undefined
let startup: Promise<void> | undefined
let booting = false
let recoveryTimer: ReturnType<typeof setTimeout> | undefined
let exitAllowed = false
let cleanup: Promise<void> | undefined

const supervisor = new DshHostSupervisor(paths.home, {
  model: resolveCornModelConfig({
    ...process.env,
    CORN_MODEL_ENV_FILE: paths.modelEnvFile,
  }),
  profileTemplate: paths.profileTemplate,
  onFailure: () => scheduleRecovery(),
})

/** One boot or restart at a time; failures feed the bounded recovery budget. */
function boot(stopFirst: boolean): Promise<void> {
  booting = true
  startup = (async () => {
    try {
      if (stopFirst) await supervisor.stop()
      if (cleanup) return
      auth = await supervisor.start()
      setStatus('ready')
    } catch (error) {
      auth = undefined
      lastFailure = redactHostDiagnostic(String(error)).slice(-2_000)
      booting = false
      scheduleRecovery()
    } finally {
      booting = false
    }
  })()
  return startup
}

function scheduleRecovery(): void {
  if (cleanup || booting || recoveryTimer) return
  auth = undefined
  const wait = recovery.nextDelay()
  if (wait === null) {
    setStatus('failed')
    return
  }
  setStatus('recovering')
  recoveryTimer = setTimeout(() => {
    recoveryTimer = undefined
    void boot(true)
  }, wait)
}

async function untilStatus(
  accept: (status: RuntimeStatus) => boolean,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (!accept(currentStatus()) && Date.now() < deadline) await delay(50)
  return accept(currentStatus())
}

async function clawReady(): Promise<boolean> {
  if (!auth) return false
  try {
    await new ClawRegistryClient(new HostTransport(auth)).revision()
    return true
  } catch {
    return false
  }
}

/** Diagnostic self-check for development and packaged smoke runs; exits the app. */
async function runSmoke(window: BrowserWindow): Promise<void> {
  const crashSmoke = process.env.CORN_DESKTOP_CRASH_SMOKE === '1'
  const facts: Record<string, unknown> = {
    packaged: app.isPackaged,
    bundledProfile: paths.profileTemplate !== undefined,
    electron: process.versions.electron,
    node: process.versions.node,
    independentRuntime: true,
  }
  facts.initialStatus = currentStatus()
  facts.lastFailure = lastFailure ?? null
  facts.clawReady = await clawReady()
  if (crashSmoke) {
    const pid = supervisor.processId
    if (currentStatus() !== 'ready' || pid === undefined)
      throw new Error(
        `Crash smoke requires its own ready Host (status ${currentStatus()}, pid ${pid ?? 'none'}, last failure ${lastFailure ?? 'none'})`,
      )
    process.kill(pid, 'SIGKILL')
    facts.recoveringObserved = await untilStatus((s) => s !== 'ready', 5_000)
    facts.rendererDuringRecovery = await window.webContents.executeJavaScript(
      'window.corn.runtimeStatus().then((view) => view.status)',
    )
    facts.recovered = await untilStatus((s) => s === 'ready', 60_000)
    facts.hostReplaced =
      supervisor.processId !== undefined && supervisor.processId !== pid
    facts.clawReadyAfterRecovery = await clawReady()
  }
  const rendererView: unknown = await window.webContents.executeJavaScript(
    'window.corn.runtimeStatus()',
  )
  facts.bridgeVerified =
    typeof rendererView === 'object' &&
    rendererView !== null &&
    'status' in rendererView &&
    rendererView.status === view.status
  await delay(1_000)
  await mkdir(paths.artifacts, { recursive: true, mode: 0o700 })
  if (!crashSmoke) {
    const { screenshots, ...layout } = await probeLayout(window)
    facts.layout = layout
    await writeFile(
      join(paths.artifacts, 'm1-layout-two-pane.png'),
      screenshots.twoPane,
      { mode: 0o600 },
    )
    await writeFile(
      join(paths.artifacts, 'm1-layout-three-pane.png'),
      screenshots.threePane,
      { mode: 0o600 },
    )
  }
  const name = crashSmoke ? 'm0-electron-crash' : 'm0-electron'
  await writeFile(
    join(paths.artifacts, `${name}.png`),
    (await window.webContents.capturePage()).toPNG(),
    { mode: 0o600 },
  )
  await writeFile(
    join(paths.artifacts, `${name}-smoke.json`),
    `${JSON.stringify({ ...view, ...facts }, null, 2)}\n`,
    { mode: 0o600 },
  )
  const passed =
    view.status === 'ready' &&
    facts.bridgeVerified === true &&
    facts.clawReady === true &&
    (crashSmoke || (facts.layout as { passed?: boolean }).passed === true) &&
    (!crashSmoke ||
      (facts.recoveringObserved === true &&
        facts.hostReplaced === true &&
        facts.clawReadyAfterRecovery === true))
  process.exitCode = passed ? 0 : 1
  app.quit()
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('before-quit', (event) => {
    if (exitAllowed) return
    event.preventDefault()
    cleanup ??= (async () => {
      clearTimeout(recoveryTimer)
      await startup?.catch(() => {})
      try {
        await supervisor.stop()
      } catch {
        process.exitCode = 1
      } finally {
        exitAllowed = true
        app.exit(Number(process.exitCode ?? 0))
      }
    })()
  })
  app.on('window-all-closed', () => app.quit())

  void app.whenReady().then(async () => {
    const window = new BrowserWindow({
      width: 1024,
      height: 764,
      useContentSize: true,
      minWidth: 720,
      minHeight: 520,
      title: 'Corn Bot',
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 11, y: 12 },
      backgroundColor: '#fcfcfc',
      webPreferences: {
        preload: paths.preload,
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
    await window.loadFile(paths.renderer)
    if (cleanup) return
    await boot(false)
    if (process.env.CORN_DESKTOP_SMOKE === '1') {
      await untilStatus((s) => s === 'ready' || s === 'failed', 120_000)
      await runSmoke(window).catch((error: unknown) => {
        console.error(
          'Corn smoke failed:',
          redactHostDiagnostic(
            error instanceof Error ? error.message : String(error),
          ),
        )
        process.exitCode = 1
        app.quit()
      })
    }
  })
}
