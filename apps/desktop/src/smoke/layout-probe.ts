import { setTimeout as delay } from 'node:timers/promises'
import type { BrowserWindow } from 'electron'

/** `user-screenshots` calibration (ADR-0004): 1024×764 CSS px, DPR 2. */
const REFERENCE = {
  width: 1024,
  height: 764,
  sidebar: 276,
  detailsRatio: 0.367,
}

/** Smallest window Main allows (`minWidth`/`minHeight`). */
const NARROW = { width: 720, height: 520 }

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

/** One real-geometry check of the sample marker and runtime status. */
export interface NoticeCheck {
  readonly scenario: string
  readonly details: string | null
  readonly sidebar: string | null
  readonly runtimeStatus: string | null
  readonly failures: readonly string[]
}

export interface LayoutProbe {
  readonly closed: Regions
  readonly open: Regions
  readonly sidebarShift: number | null
  readonly detailsRatio: number | null
  readonly draftKept: boolean
  readonly notices: readonly NoticeCheck[]
  /** Live-region mutations during Bot switches and layout changes. */
  readonly announcerMutations: number | null
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

const SAMPLE_TEXT = '示例数据，未连接真实 Bot'

/**
 * Finds the sample marker by its text (so the same check runs against any
 * markup) and the runtime status by `data-runtime-status`. Each must be
 * rendered inside the chat pane, in normal flow, outside every scroll or
 * live container, unclipped, uncovered at its centre and clear of the
 * composer, Bot pill, roster and details.
 */
const NOTICE_CHECK = `(async () => {
  const failures = []
  const shell = document.querySelector('.corn-shell')
  const chat = document.querySelector('.corn-chat')
  if (!shell || !chat) return { details: null, sidebar: null, runtimeStatus: null, failures: ['chat pane missing'] }
  const chatBox = chat.getBoundingClientRect()
  const blockers = [
    ['composer', document.querySelector('.corn-composer')],
    ['Bot pill', document.querySelector('.corn-chat__title')],
    ['roster', document.querySelector('.corn-roster')],
    ['details', document.querySelector('.corn-details')],
  ]
  const overlaps = (a, b) =>
    a.left < b.right - 0.5 && b.left < a.right - 0.5 &&
    a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5
  const outside = (inner, outer) =>
    inner.left < outer.left - 0.5 || inner.right > outer.right + 0.5 ||
    inner.top < outer.top - 0.5 || inner.bottom > outer.bottom + 0.5
  const check = (name, element) => {
    if (!element) return failures.push(name + ': missing')
    const box = element.getBoundingClientRect()
    if (box.width < 1 || box.height < 1 || !element.checkVisibility({ opacityProperty: true, visibilityProperty: true }))
      failures.push(name + ': not rendered')
    if (outside(box, chatBox) || box.right > innerWidth + 0.5 || box.bottom > innerHeight + 0.5)
      failures.push(name + ': outside the visible chat pane')
    for (let node = element; node && node !== chat; node = node.parentElement) {
      const style = getComputedStyle(node)
      if (/auto|scroll/.test(style.overflowX + style.overflowY))
        failures.push(name + ': inside a scroll container')
      if ((style.overflowX !== 'visible' || style.overflowY !== 'visible') && node !== element && outside(box, node.getBoundingClientRect()))
        failures.push(name + ': clipped')
      if (/absolute|fixed|sticky/.test(style.position))
        failures.push(name + ': out of the layout flow')
    }
    if (element.closest('[aria-live], [role="status"], [role="log"], [role="alert"]'))
      failures.push(name + ': inside a live region')
    for (const [label, blocker] of blockers)
      if (blocker && !blocker.contains(element) && overlaps(box, blocker.getBoundingClientRect()))
        failures.push(name + ': overlaps the ' + label)
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    if (!hit || !element.contains(hit)) failures.push(name + ': covered')
  }
  const walker = document.createTreeWalker(chat, NodeFilter.SHOW_TEXT)
  let sample = null
  while (!sample && walker.nextNode())
    if (walker.currentNode.data.includes(${JSON.stringify(SAMPLE_TEXT)})) sample = walker.currentNode.parentElement
  check('sample marker', sample)
  const runtime = chat.querySelector('[data-runtime-status]')
  check('runtime status', runtime)
  const view = window.corn ? await window.corn.runtimeStatus().catch(() => null) : null
  const expected = view ? view.status : 'unavailable'
  if (runtime && runtime.dataset.runtimeStatus !== expected)
    failures.push('runtime status: shows ' + runtime.dataset.runtimeStatus + ', Main reports ' + expected)
  if (runtime && runtime.textContent.includes('Bot'))
    failures.push('runtime status: reads as a Bot connection')
  const announcers = document.querySelectorAll('[data-runtime-announcer]')
  const announcer = announcers[0]
  if (announcers.length !== 1) failures.push('announcer: expected one, found ' + announcers.length)
  else if (announcer.getAttribute('aria-live') !== 'polite' || announcer.getAttribute('aria-atomic') !== 'true' || chat.contains(announcer))
    failures.push('announcer: not a polite atomic region outside the chat pane')
  return {
    details: shell.dataset.details ?? null,
    sidebar: shell.dataset.sidebar ?? null,
    runtimeStatus: runtime ? runtime.dataset.runtimeStatus : null,
    failures,
  }
})()`

const WATCH_ANNOUNCER = `(() => {
  const region = document.querySelector('[data-runtime-announcer]')
  if (!region) return false
  window.__cornAnnouncerMutations = 0
  new MutationObserver((records) => {
    window.__cornAnnouncerMutations += records.length
  }).observe(region, { childList: true, subtree: true, characterData: true })
  return true
})()`

const DRAFT = '切换详情后草稿仍在'

async function run<T>(window: BrowserWindow, script: string): Promise<T> {
  const result: T = await window.webContents.executeJavaScript(script)
  await delay(120)
  return result
}

const scrollFeed = (window: BrowserWindow, to: 'top' | 'bottom') =>
  run(
    window,
    `(() => {
      const feed = document.querySelector('.corn-feed')
      feed.scrollTop = ${to === 'top' ? '0' : 'feed.scrollHeight'}
    })()`,
  )

const toggleDetails = (window: BrowserWindow) =>
  run(window, `document.querySelector('.corn-chat__title').click()`)

const toggleRoster = (window: BrowserWindow) =>
  run(
    window,
    `window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'b', code: 'KeyB', metaKey: true, bubbles: true, cancelable: true,
    }))`,
  )

/** Clicks the expanded roster's Bot at `index`, or the first unselected one; returns the previous index. */
const selectBot = (window: BrowserWindow, index: number | null) =>
  run<number>(
    window,
    `(() => {
      const bots = [...document.querySelectorAll('.corn-pinned, .corn-bot-row__select')]
      const current = bots.findIndex((bot) => bot.getAttribute('aria-current') === 'page')
      const target = ${index ?? "bots.findIndex((bot) => bot.getAttribute('aria-current') !== 'page')"}
      bots[target].click()
      return current
    })()`,
  )

async function resize(window: BrowserWindow, size: typeof NARROW) {
  window.setContentSize(size.width, size.height)
  await delay(400)
}

async function checkNotice(
  window: BrowserWindow,
  scenario: string,
  expect: { readonly details?: string; readonly sidebar?: string } = {},
): Promise<NoticeCheck> {
  const result = await run<Omit<NoticeCheck, 'scenario'>>(window, NOTICE_CHECK)
  const failures = [...result.failures]
  if (expect.details && result.details !== expect.details)
    failures.push(
      `layout: details ${result.details}, expected ${expect.details}`,
    )
  if (expect.sidebar && result.sidebar !== expect.sidebar)
    failures.push(
      `layout: sidebar ${result.sidebar}, expected ${expect.sidebar}`,
    )
  return { ...result, scenario, failures }
}

/**
 * Walks the acceptance scenarios for the fixed notice strip and restores the
 * reference layout, selected Bot and its draft afterwards.
 */
async function probeNotices(window: BrowserWindow): Promise<{
  readonly notices: NoticeCheck[]
  readonly announcerMutations: number | null
  readonly draft: string
}> {
  const watching = await run<boolean>(window, WATCH_ANNOUNCER)
  const notices: NoticeCheck[] = []
  await scrollFeed(window, 'bottom')
  notices.push(
    await checkNotice(window, 'two-pane, feed at bottom', {
      details: 'closed',
    }),
  )
  await scrollFeed(window, 'top')
  notices.push(
    await checkNotice(window, 'two-pane, feed at top', { details: 'closed' }),
  )
  await toggleDetails(window)
  notices.push(await checkNotice(window, 'three-pane', { details: 'column' }))
  const home = await selectBot(window, null)
  await scrollFeed(window, 'bottom')
  notices.push(
    await checkNotice(window, 'three-pane, other Bot', { details: 'column' }),
  )
  await toggleRoster(window)
  notices.push(
    await checkNotice(window, 'roster collapsed', { sidebar: 'collapsed' }),
  )
  await toggleRoster(window)
  await resize(window, NARROW)
  notices.push(
    await checkNotice(window, '720×520, details overlay', {
      details: 'overlay',
      sidebar: 'expanded',
    }),
  )
  await toggleDetails(window)
  await scrollFeed(window, 'top')
  notices.push(
    await checkNotice(window, '720×520, feed at top', { details: 'closed' }),
  )
  await resize(window, REFERENCE)
  await selectBot(window, home)
  notices.push(
    await checkNotice(window, 'two-pane, back on first Bot', {
      details: 'closed',
    }),
  )
  const announcerMutations = watching
    ? await run<number>(window, 'window.__cornAnnouncerMutations')
    : null
  const draft = await run<string>(
    window,
    `document.querySelector('.corn-composer__field').value`,
  )
  return { notices, announcerMutations, draft }
}

/**
 * Crash smoke: once Main is recovering, waits for the window to show it and
 * checks the notice geometry. Passes only if the strip shows `recovering`.
 */
export async function probeRecoveringNotice(
  window: BrowserWindow,
): Promise<NoticeCheck & { readonly passed: boolean }> {
  const shown = await run<boolean>(
    window,
    `new Promise((resolve) => {
      const deadline = Date.now() + 5000
      const poll = () => {
        if (document.querySelector('[data-runtime-status="recovering"]')) resolve(true)
        else if (Date.now() > deadline) resolve(false)
        else setTimeout(poll, 50)
      }
      poll()
    })`,
  )
  const check = await checkNotice(window, 'crash recovery')
  const failures = shown
    ? check.failures
    : [...check.failures, 'runtime status: recovering never shown']
  return { ...check, failures, passed: failures.length === 0 }
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
  await toggleDetails(window)
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
  const notices = await probeNotices(window)

  const sidebarShift =
    closed.roster && open.roster
      ? Math.abs(closed.roster.x - open.roster.x) +
        Math.abs(closed.roster.width - open.roster.width)
      : null
  const detailsRatio = open.details ? open.details.width / open.viewport : null
  const draftKept = draft === DRAFT && notices.draft === DRAFT
  const passed =
    closed.viewport === REFERENCE.width &&
    closed.details === null &&
    Math.abs((closed.roster?.width ?? 0) - REFERENCE.sidebar) <= 1 &&
    sidebarShift !== null &&
    sidebarShift < 1 &&
    detailsRatio !== null &&
    Math.abs(detailsRatio - REFERENCE.detailsRatio) <= 0.01 &&
    draftKept &&
    notices.notices.every((check) => check.failures.length === 0) &&
    notices.announcerMutations === 0
  return {
    closed,
    open,
    sidebarShift,
    detailsRatio,
    draftKept,
    notices: notices.notices,
    announcerMutations: notices.announcerMutations,
    passed,
    screenshots: { twoPane, threePane },
  }
}
