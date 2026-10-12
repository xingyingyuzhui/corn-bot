import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { app, BrowserWindow, ipcMain } from 'electron'
import type { RuntimeStatus } from '../../../packages/contracts/src/runtime.ts'
import { ClawRegistryClient } from '../../../packages/dsh-adapter/src/claw-registry-client.ts'
import { HostTransport } from '../../../packages/dsh-adapter/src/transport.ts'
import { resolveAppPaths } from './app-paths.ts'
import { applyDevDockIcon } from './dock-icon.ts'
import { registerModelSettingsIpc } from './ipc/model-settings.ts'
import { ModelSettingsService } from './model-settings/service.ts'
import { redactHostDiagnostic } from './runtime/host-readiness.ts'
import { createAppRuntime } from './runtime/startup-control.ts'
import { assertTrustedSender } from './security/ipc-allowlist.ts'
import { probeLayout, probeRecoveringNotice } from './smoke/layout-probe.ts'
import {
  applyAppPresentation,
  presentationWindowOptions,
  presentWindow,
  windowPresentation,
} from './window-presentation.ts'

app.setName('Corn Bot')
const presentation = windowPresentation(process.env)
applyAppPresentation(app, presentation)
const paths = resolveAppPaths({
  isPackaged: app.isPackaged,
  appPath: app.getAppPath(),
  userData: app.getPath('userData'),
  resourcesPath: process.resourcesPath,
})
const { control, host: supervisor } = createAppRuntime(paths)
const modelSettings = new ModelSettingsService({
  authority: () => (control.view.status === 'ready' ? control.auth : undefined),
  devOverride: () => supervisor.modelOverride,
})
const currentStatus = (): RuntimeStatus => control.view.status
/** Two Renderer status polls: a recovery at least this long must show in the strip. */
const RECOVERY_VISIBLE_MS = 2_000
let exitAllowed = false
let cleanup: Promise<void> | undefined

async function untilStatus(
  accept: (status: RuntimeStatus) => boolean,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (!accept(currentStatus()) && Date.now() < deadline) await delay(50)
  return accept(currentStatus())
}

async function clawReady(): Promise<boolean> {
  const auth = control.auth
  if (!auth) return false
  try {
    await new ClawRegistryClient(new HostTransport(auth)).revision()
    return true
  } catch {
    return false
  }
}

/** Model status settles off `checking`, and the Renderer's read carries no ref, namespace or path. */
async function modelFacts(
  window: BrowserWindow,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 15_000
  while (modelSettings.status().status === 'checking' && Date.now() < deadline)
    await delay(100)
  const view = modelSettings.status()
  const reply: unknown = await window.webContents.executeJavaScript(
    'window.corn.modelSettings.read()',
  )
  return {
    modelStatus: view.status,
    modelStatusReason: view.reason,
    devModelOverride: view.devOverride,
    modelBridgeVerified:
      typeof reply === 'object' &&
      reply !== null &&
      'ok' in reply &&
      reply.ok === true,
    modelSnapshotRedacted:
      !/_API_KEY|apiKeyEnv|credentials\.yaml|settingsNs|"ns"/u.test(
        JSON.stringify(reply),
      ),
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
  facts.lastFailure = control.lastFailure ?? null
  facts.clawReady = await clawReady()
  if (currentStatus() === 'ready')
    Object.assign(facts, await modelFacts(window))
  if (crashSmoke) {
    const pid = supervisor.processId
    if (currentStatus() !== 'ready' || pid === undefined)
      throw new Error(
        `Crash smoke requires its own ready Host (status ${currentStatus()}, pid ${pid ?? 'none'}, last failure ${control.lastFailure ?? 'none'})`,
      )
    process.kill(pid, 'SIGKILL')
    facts.recoveringObserved = await untilStatus((s) => s !== 'ready', 5_000)
    const recoveringSince = Date.now()
    facts.rendererDuringRecovery = await window.webContents.executeJavaScript(
      'window.corn.runtimeStatus().then((view) => view.status)',
    )
    const notice = probeRecoveringNotice(window)
    facts.recovered = await untilStatus((s) => s === 'ready', 60_000)
    facts.recoveringMs = Date.now() - recoveringSince
    facts.recoveringNotice = await notice
    facts.hostReplaced =
      supervisor.processId !== undefined && supervisor.processId !== pid
    facts.clawReadyAfterRecovery = await clawReady()
    facts.modelStatusAfterRecovery = (await modelFacts(window)).modelStatus
  }
  const rendererView: unknown = await window.webContents.executeJavaScript(
    'window.corn.runtimeStatus()',
  )
  facts.bridgeVerified =
    typeof rendererView === 'object' &&
    rendererView !== null &&
    'status' in rendererView &&
    rendererView.status === control.view.status
  facts.hostSpawns = supervisor.spawnCount
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
    `${JSON.stringify({ ...control.view, ...facts }, null, 2)}\n`,
    { mode: 0o600 },
  )
  const recoveringNotice = facts.recoveringNotice as
    | { readonly shown: boolean; readonly failures: readonly string[] }
    | undefined
  const noticeHeld =
    recoveringNotice !== undefined &&
    recoveringNotice.failures.length === 0 &&
    (recoveringNotice.shown ||
      (facts.recoveringMs as number) < RECOVERY_VISIBLE_MS)
  const passed =
    control.view.status === 'ready' &&
    facts.bridgeVerified === true &&
    facts.clawReady === true &&
    facts.modelBridgeVerified === true &&
    facts.modelSnapshotRedacted === true &&
    facts.modelStatus !== 'checking' &&
    facts.modelStatus !== 'unavailable' &&
    (crashSmoke || (facts.layout as { passed?: boolean }).passed === true) &&
    (!crashSmoke ||
      (facts.recoveringObserved === true &&
        noticeHeld &&
        facts.hostReplaced === true &&
        facts.clawReadyAfterRecovery === true &&
        facts.modelStatusAfterRecovery === facts.modelStatus))
  process.exitCode = passed ? 0 : 1
  app.quit()
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('before-quit', (event) => {
    if (exitAllowed) return
    event.preventDefault()
    cleanup ??= (async () => {
      try {
        await control.shutdown()
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
    applyDevDockIcon(app)
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
      ...presentationWindowOptions(presentation),
      webPreferences: {
        preload: paths.preload,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    })
    presentWindow(window, presentation)
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    window.webContents.on('will-attach-webview', (event) =>
      event.preventDefault(),
    )
    ipcMain.handle('corn:runtime:status', (event) => {
      assertTrustedSender(event, window)
      return control.view
    })
    registerModelSettingsIpc(ipcMain, window, modelSettings)
    await window.loadFile(paths.renderer)
    if (cleanup) return
    await control.start()
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
