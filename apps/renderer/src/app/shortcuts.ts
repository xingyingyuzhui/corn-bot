/**
 * Keyboard shortcut registry for the shell. Every action the kit registers
 * (ui-ux-spec §6, E40–E46, E59, E60) is listed with Corn's status, so a
 * shortcut is either wired, owned by another surface, or says why not.
 */

export type ShortcutPlatform = 'mac' | 'other'

export type ShortcutStatus = 'implemented' | 'deferred' | 'not-applicable'

/** `global` runs from the shell listener; `composer` is handled in the composer. */
export type ShortcutScope = 'global' | 'composer'

export type ShortcutId =
  | 'command-palette'
  | 'focus-search'
  | 'new-bot'
  | 'send'
  | 'focus-input'
  | 'find-in-chat'
  | 'toggle-sidebar'
  | 'open-settings'
  | 'bot-settings'
  | 'previous-bot'
  | 'next-bot'
  | 'navigate-back'
  | 'navigate-forward'
  | 'select-nth-bot'
  | 'add-selection'
  | 'open-tools'
  | 'open-skills'
  | 'toggle-details'
  | 'cycle-bots'

export interface ShortcutBinding {
  /** Command on macOS, Control elsewhere (kit E43). */
  readonly mod?: boolean
  /** Physical Control on every platform. */
  readonly ctrl?: boolean
  readonly alt?: boolean
  readonly shift?: boolean
  /** Lower-case letter, digit, or one of the named keys in `KEY_BY_CODE`. */
  readonly key: string
  readonly platform?: ShortcutPlatform
}

export interface ShortcutDefinition {
  readonly id: ShortcutId
  /** Action name in the kit's registry, for traceability. */
  readonly kitAction: string
  readonly label: string
  readonly bindings: readonly ShortcutBinding[]
  readonly status: ShortcutStatus
  readonly scope: ShortcutScope
  readonly reason: string
}

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

export const SHORTCUTS: readonly ShortcutDefinition[] = [
  {
    id: 'command-palette',
    kitAction: 'commandPalette',
    label: '命令菜单',
    bindings: [{ mod: true, key: 'k' }],
    status: 'deferred',
    scope: 'global',
    reason: 'M1 没有命令菜单；需要先有可搜索的动作目录',
  },
  {
    id: 'focus-search',
    kitAction: 'focusSearch',
    label: '搜索 Bot',
    bindings: [{ mod: true, shift: true, key: 'f' }],
    status: 'implemented',
    scope: 'global',
    reason: '打开名册内搜索框并聚焦；名册收起时先展开',
  },
  {
    id: 'new-bot',
    kitAction: 'newAgent',
    label: '新建 Bot',
    bindings: [{ mod: true, key: 'n' }],
    status: 'implemented',
    scope: 'global',
    reason: '打开新建 Bot 对话框；M1 只创建本地示例 Bot',
  },
  {
    id: 'send',
    kitAction: 'send',
    label: '发送',
    bindings: [{ mod: true, key: 'enter' }],
    status: 'implemented',
    scope: 'composer',
    reason: '由输入框自己处理（implemented-by-composer），全局监听不接管',
  },
  {
    id: 'focus-input',
    kitAction: 'focusInput',
    label: '聚焦输入框',
    bindings: [{ mod: true, key: 'i' }],
    status: 'implemented',
    scope: 'global',
    reason: '聚焦 #corn-composer-field',
  },
  {
    id: 'find-in-chat',
    kitAction: 'findInChat',
    label: '在聊天中查找',
    bindings: [{ mod: true, key: 'f' }],
    status: 'deferred',
    scope: 'global',
    reason: 'M1 没有聊天内查找；不拦截，保留宿主默认行为',
  },
  {
    id: 'toggle-sidebar',
    kitAction: 'toggleSidebar',
    label: '展开或收起名册',
    bindings: [{ mod: true, key: 'b' }],
    status: 'implemented',
    scope: 'global',
    reason: '与聊天头部“显示名册”同一手动偏好',
  },
  {
    id: 'open-settings',
    kitAction: 'openSettings',
    label: '打开设置',
    bindings: [{ mod: true, key: ',' }],
    status: 'implemented',
    scope: 'global',
    reason: '打开设置的“通用”分区',
  },
  {
    id: 'bot-settings',
    kitAction: 'toggleAgentSettings',
    label: '打开当前 Bot 的核心设定',
    bindings: [{ mod: true, shift: true, key: ',' }],
    status: 'implemented',
    scope: 'global',
    reason: '打开详情面板的“配置 → 核心设定”并聚焦标题；有未保存的配置时先询问',
  },
  {
    id: 'previous-bot',
    kitAction: 'previousAgent',
    label: '上一个 Bot',
    bindings: [{ alt: true, key: 'arrowup' }],
    status: 'implemented',
    scope: 'global',
    reason: '按名册可见顺序选择上一个 Bot，到顶不循环',
  },
  {
    id: 'next-bot',
    kitAction: 'nextAgent',
    label: '下一个 Bot',
    bindings: [{ alt: true, key: 'arrowdown' }],
    status: 'implemented',
    scope: 'global',
    reason: '按名册可见顺序选择下一个 Bot，到底不循环',
  },
  {
    id: 'navigate-back',
    kitAction: 'navigateBack',
    label: '后退',
    bindings: [{ mod: true, key: '[' }],
    status: 'deferred',
    scope: 'global',
    reason: 'M1 外壳没有导航历史栈；等路由与历史记录落地',
  },
  {
    id: 'navigate-forward',
    kitAction: 'navigateForward',
    label: '前进',
    bindings: [{ mod: true, key: ']' }],
    status: 'deferred',
    scope: 'global',
    reason: 'M1 外壳没有导航历史栈；等路由与历史记录落地',
  },
  {
    id: 'select-nth-bot',
    kitAction: 'selectAgent(1…9)',
    label: '选择第 1…9 个 Bot',
    bindings: DIGITS.map((key) => ({ mod: true, key })),
    status: 'implemented',
    scope: 'global',
    reason: '按名册可见顺序（置顶在前，跳过隐藏和折叠分组中的 Bot）',
  },
  {
    id: 'add-selection',
    kitAction: 'addSelectionToPrompt',
    label: '把选中内容加入输入框',
    bindings: [{ mod: true, key: 'l' }],
    status: 'deferred',
    scope: 'global',
    reason: '输入框还不支持引用选中内容',
  },
  {
    id: 'open-tools',
    kitAction: 'openTools',
    label: '打开工具',
    bindings: [{ mod: true, shift: true, key: 'm' }],
    status: 'not-applicable',
    scope: 'global',
    reason: 'Corn 没有独立工具面板；Bot 能力由权限设置与 Claw 治理决定',
  },
  {
    id: 'open-skills',
    kitAction: 'openSkills',
    label: '打开技能',
    bindings: [{ mod: true, shift: true, key: 'w' }],
    status: 'not-applicable',
    scope: 'global',
    reason: 'Corn 没有独立技能面板；Bot 能力由权限设置与 Claw 治理决定',
  },
  {
    id: 'toggle-details',
    kitAction: 'toggleInfo',
    label: '显示或隐藏详情',
    bindings: [
      { mod: true, alt: true, key: 'b' },
      { mod: true, shift: true, key: 'i', platform: 'mac' },
    ],
    status: 'implemented',
    scope: 'global',
    reason: '与点击聊天头部 Bot 名称相同；Mac 另有 Mod+Shift+I 别名（E60）',
  },
  {
    id: 'cycle-bots',
    kitAction: 'cycle (Ctrl+Tab)',
    label: '循环切换 Bot',
    bindings: [
      { ctrl: true, key: 'tab' },
      { ctrl: true, shift: true, key: 'tab' },
    ],
    status: 'deferred',
    scope: 'global',
    reason: '需要按住 Ctrl 的切换游标浮层；Alt+↑/↓ 已覆盖相邻切换',
  },
]

const KEY_BY_CODE: Readonly<Record<string, string>> = {
  Comma: ',',
  BracketLeft: '[',
  BracketRight: ']',
  ArrowUp: 'arrowup',
  ArrowDown: 'arrowdown',
  Enter: 'enter',
  NumpadEnter: 'enter',
  Tab: 'tab',
}

export interface ShortcutKeyEvent {
  readonly key: string
  readonly code: string
  readonly metaKey: boolean
  readonly ctrlKey: boolean
  readonly altKey: boolean
  readonly shiftKey: boolean
}

/**
 * Letters follow the active layout (`key`); everything else falls back to the
 * physical key (`code`) because Shift and Option rewrite `key` on macOS
 * (Shift+, is `<`, Option+B is `∫`).
 */
export function shortcutKeyOf(event: ShortcutKeyEvent): string | null {
  if (/^[a-z]$/iu.test(event.key)) return event.key.toLowerCase()
  const letter = /^Key([A-Z])$/u.exec(event.code)
  if (letter?.[1]) return letter[1].toLowerCase()
  const digit = /^Digit([0-9])$/u.exec(event.code)
  if (digit?.[1]) return digit[1]
  return KEY_BY_CODE[event.code] ?? null
}

function bindingMatches(
  binding: ShortcutBinding,
  event: ShortcutKeyEvent,
  key: string,
  platform: ShortcutPlatform,
): boolean {
  if (binding.platform && binding.platform !== platform) return false
  if (binding.key !== key) return false
  const mod = binding.mod === true
  const ctrl = binding.ctrl === true
  const wantMeta = platform === 'mac' ? mod : false
  const wantCtrl = platform === 'mac' ? ctrl : mod || ctrl
  return (
    event.metaKey === wantMeta &&
    event.ctrlKey === wantCtrl &&
    event.altKey === (binding.alt === true) &&
    event.shiftKey === (binding.shift === true)
  )
}

export interface ShortcutMatch {
  readonly definition: ShortcutDefinition
  /** 1-based position for `select-nth-bot`. */
  readonly position?: number
}

export function matchShortcut(
  event: ShortcutKeyEvent,
  platform: ShortcutPlatform,
): ShortcutMatch | null {
  const key = shortcutKeyOf(event)
  if (key === null) return null
  for (const definition of SHORTCUTS) {
    for (const binding of definition.bindings) {
      if (!bindingMatches(binding, event, key, platform)) continue
      return definition.id === 'select-nth-bot'
        ? { definition, position: Number(key) }
        : { definition }
    }
  }
  return null
}

export interface ShortcutContext {
  /** A modal dialog owns the keyboard. */
  readonly overlayOpen: boolean
  /** IME composition in progress. */
  readonly composing: boolean
  /** Focus is inside a popover menu, which handles its own keys. */
  readonly inMenu: boolean
  readonly repeat: boolean
}

const REPEATABLE: ReadonlySet<ShortcutId> = new Set([
  'previous-bot',
  'next-bot',
])

/**
 * Focus-scope gate (kit §6): only implemented global shortcuts run, never
 * under a modal, a menu or IME composition, and toggles ignore key repeat.
 * Clipboard and undo chords are never in the registry, so text fields keep
 * Mod+A/C/V/X/Z.
 */
export function shouldRunShortcut(
  match: ShortcutMatch,
  context: ShortcutContext,
): boolean {
  const { definition } = match
  if (definition.status !== 'implemented' || definition.scope !== 'global')
    return false
  if (context.overlayOpen || context.composing || context.inMenu) return false
  return !context.repeat || REPEATABLE.has(definition.id)
}

export function platformOf(navigatorPlatform: string): ShortcutPlatform {
  return /mac|iphone|ipad/iu.test(navigatorPlatform) ? 'mac' : 'other'
}
