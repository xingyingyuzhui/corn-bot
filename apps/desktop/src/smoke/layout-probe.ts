import { setTimeout as delay } from 'node:timers/promises'
import type { BrowserWindow } from 'electron'

/** `user-screenshots` calibration (ADR-0004): 1024×764 CSS px, DPR 2. */
const REFERENCE = {
  width: 1024,
  height: 764,
  sidebar: 276,
  detailsRatio: 0.367,
}

interface Box {
  readonly x: number
  readonly width: number
}

interface Regions {
  readonly viewport: number
  readonly roster: Box | null
  readonly chat: Box | null
  readonly details: Box | null
}

export interface LayoutProbe {
  readonly closed: Regions
  readonly open: Regions
  readonly sidebarShift: number | null
  readonly detailsRatio: number | null
  readonly draftKept: boolean
  readonly passed: boolean
  readonly screenshots: { readonly twoPane: Buffer; readonly threePane: Buffer }
}

const MEASURE = `(() => {
  const box = (selector) => {
    const element = document.querySelector(selector)
    if (!element) return null
    const rect = element.getBoundingClientRect()
    return { x: rect.x, width: rect.width }
  }
  return {
    viewport: window.innerWidth,
    roster: box('.corn-roster'),
    chat: box('.corn-chat'),
    details: box('.corn-details'),
  }
})()`

const DRAFT = '切换详情后草稿仍在'

async function run<T>(window: BrowserWindow, script: string): Promise<T> {
  const result: T = await window.webContents.executeJavaScript(script)
  await delay(120)
  return result
}

/** Drives the real shell at the reference size; diagnostic smoke only. */
export async function probeLayout(window: BrowserWindow): Promise<LayoutProbe> {
  window.setContentSize(REFERENCE.width, REFERENCE.height)
  // The real pointer may rest over the window; hover-only chrome must not leak
  // into the evidence screenshots.
  window.webContents.sendInputEvent({ type: 'mouseLeave', x: 0, y: 0 })
  await delay(300)
  await run(window, `document.querySelector('.corn-composer__field').focus()`)
  window.webContents.insertText(DRAFT)
  await delay(120)
  const closed = await run<Regions>(window, MEASURE)
  const twoPane = (await window.webContents.capturePage()).toPNG()
  await run(window, `document.querySelector('.corn-chat__title').click()`)
  const open = await run<Regions>(window, MEASURE)
  const threePane = (await window.webContents.capturePage()).toPNG()
  await run(
    window,
    `document.querySelector('.corn-details [aria-label="关闭详情"]').click()`,
  )
  const draft = await run<string>(
    window,
    `document.querySelector('.corn-composer__field').value`,
  )

  const sidebarShift =
    closed.roster && open.roster
      ? Math.abs(closed.roster.x - open.roster.x) +
        Math.abs(closed.roster.width - open.roster.width)
      : null
  const detailsRatio = open.details ? open.details.width / open.viewport : null
  const passed =
    closed.viewport === REFERENCE.width &&
    closed.details === null &&
    Math.abs((closed.roster?.width ?? 0) - REFERENCE.sidebar) <= 1 &&
    sidebarShift !== null &&
    sidebarShift < 1 &&
    detailsRatio !== null &&
    Math.abs(detailsRatio - REFERENCE.detailsRatio) <= 0.01 &&
    draft === DRAFT
  return {
    closed,
    open,
    sidebarShift,
    detailsRatio,
    draftKept: draft === DRAFT,
    passed,
    screenshots: { twoPane, threePane },
  }
}
