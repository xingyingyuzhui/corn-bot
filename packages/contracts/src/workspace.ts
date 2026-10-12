/**
 * The workspace boundary between Main and the Renderer: credential-free view
 * models, the data-layer status, the closed error set, the push event and the
 * structured commands with their runtime parsers.
 *
 * Four identities never cross or mix here (P3 plan §3.3). The Renderer mints
 * `clientId` per send action; Main mints and persists the DSH `requestId`
 * before any RPC and never returns it; transport `rpcId`s and DSH
 * turn/seq/attempt ids stay inside Main. Messages and approvals reach the
 * Renderer only as opaque Main-issued ids (`messageId`, approval `handle`).
 * Claw agent ids, DSH session ids, presets, paths and raw Host text never
 * cross this boundary.
 */
import { type CornAvatarVariantId, isCornAvatarVariantId } from './avatar.ts'

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/** Initial on a hue disc: the account look and every Bot's fallback. */
export interface PlaceholderAvatarSpec {
  readonly initial: string
  /** Hue in degrees for the placeholder disc. */
  readonly hue: number
}

export interface AvatarSpec extends PlaceholderAvatarSpec {
  /**
   * Corn role look the user chose, persisted as is. Never inferred from the
   * editable name; records without one, or with an unknown id, keep the
   * placeholder.
   */
  readonly variantId?: string
}

export type TagId = string

export interface TagView {
  readonly id: TagId
  readonly label: string
}

/** Bot activity is a separate dimension from message delivery. */
export type BotActivity = 'idle' | 'working' | 'offline'

/**
 * Where a Bot came from. `fixture` and `mock-created` Bots have no Claw
 * agent or DSH session behind them and must say so wherever they appear.
 */
export type BotOrigin = 'fixture' | 'mock-created' | 'live'

/**
 * Binding progress of a live Bot (Claw agent, DSH session, model). Fixture
 * Bots have none. `needs_repair` is resumed with `repairBot`; `needs_model`
 * waits for a model the catalog can run, Corn never substitutes one.
 */
export type BotProvisioning =
  | 'creating'
  | 'ready'
  | 'needs_repair'
  | 'needs_model'

export interface BotView {
  readonly id: string
  readonly name: string
  readonly summary: string
  readonly avatar: AvatarSpec
  /** 职责: what the Bot is responsible for. Live Bots keep it empty for now. */
  readonly role: string
  /** 工作风格: how it should work. Live Bots keep it empty for now. */
  readonly workStyle: string
  readonly tagIds: readonly TagId[]
  /**
   * A `ModelOption.id` from the same snapshot, or `null` to follow the global
   * default, which Main re-applies to the Bot's session before every send.
   */
  readonly modelOverride: string | null
  readonly activity: BotActivity
  readonly unread: boolean
  /** Optimistic-concurrency revision for profile, tag and model writes. */
  readonly revision: number
  readonly origin: BotOrigin
  /** Present on live Bots only. */
  readonly provisioning?: BotProvisioning
}

export interface BotGroupView {
  readonly id: string
  readonly label: string
  readonly botIds: readonly string[]
}

export interface RosterView {
  readonly pinnedBotIds: readonly string[]
  readonly hiddenBotIds: readonly string[]
  /** Always empty on live data: groups are not offered yet. */
  readonly groups: readonly BotGroupView[]
  readonly bots: Readonly<Record<string, BotView>>
  readonly tags: Readonly<Record<TagId, TagView>>
  readonly account: PlaceholderAvatarSpec
}

/**
 * Corn-side delivery of a user message. `accepted` means DSH accepted it,
 * not that the Bot replied. Absent on fixture history and once DSH has
 * recorded the message. Live admissions map as: pending → `queued`,
 * sending → `dispatching`, accepted → `accepted`, rejected or unconfirmed →
 * `failed` (with `failure`); a withdrawn message leaves the feed.
 */
export type DeliveryState = 'queued' | 'dispatching' | 'accepted' | 'failed'

/** A file the user picked; Corn has not uploaded it anywhere. */
export interface AttachmentView {
  readonly id: string
  readonly name: string
  readonly size: number
}

/**
 * DSH RC2 approval outcomes only. A Remote `cancel` frame, a replaced
 * generation, a stopped turn or a late reply all settle as `cancelled`;
 * Corn's own 30-minute timeout answers, and settles as, `rejected`.
 */
export type ApprovalStatus =
  | 'pending'
  | 'submitting'
  | 'allowed-once'
  | 'rejected'
  | 'cancelled'

export type ApprovalAnswer = 'allowed-once' | 'rejected'

export type FeedItem =
  | { readonly kind: 'divider'; readonly id: string; readonly label: string }
  | {
      readonly kind: 'message'
      /** Opaque; for a live user message, the `messageId` `sendMessage` returned. */
      readonly id: string
      readonly author: 'user' | 'bot'
      readonly paragraphs: readonly string[]
      readonly attachments?: readonly AttachmentView[]
      readonly delivery?: DeliveryState
      /** User-facing reason when `delivery` is `failed`. */
      readonly failure?: string
      /** Provisional reply text from the live stream; the durable reply replaces it. */
      readonly streaming?: true
    }
  | {
      readonly kind: 'attachment-placeholder'
      readonly id: string
      readonly author: 'user' | 'bot'
      readonly width: number
      readonly height: number
    }
  | {
      readonly kind: 'handoff'
      readonly id: string
      readonly botIds: readonly string[]
    }
  | {
      readonly kind: 'approval'
      readonly id: string
      /** Opaque Main-issued handle; answers name it, never a DSH event or call id. */
      readonly handle: string
      readonly title: string
      readonly detail: string
      readonly status: ApprovalStatus
    }
  | {
      readonly kind: 'notice'
      readonly id: string
      readonly tone: 'info' | 'error'
      readonly text: string
    }

/** `reconnecting`: the live stream dropped; history stays, provisional text does not. */
export type ConversationState = 'ready' | 'loading' | 'reconnecting' | 'error'

/** The Bot's one main conversation, keyed by Bot id. */
export interface ConversationView {
  readonly botId: string
  readonly state: ConversationState
  /** Read-only conversations never accept a send. */
  readonly readOnly: boolean
  readonly items: readonly FeedItem[]
  /** Live only: older history can be fetched with `loadEarlier`. */
  readonly hasEarlier?: boolean
}

export interface ModelOption {
  readonly id: string
  readonly label: string
  readonly provider: string
  /** False when the catalog lists the model but it cannot run now. */
  readonly available: boolean
}

export interface ModelSettings {
  readonly catalog: readonly ModelOption[]
  readonly globalDefault: string | null
}

export type PermissionLevel = 'allow' | 'ask' | 'deny'

export interface PermissionRow {
  readonly capability: string
  readonly label: string
  readonly effective: PermissionLevel
  /** Hard policy ceiling; the UI can never grant more than this. */
  readonly ceiling: PermissionLevel
  readonly note: string
}

export interface ConnectorView {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly state: 'disconnected' | 'connected'
  /** Why the connector cannot be connected yet, when it cannot. */
  readonly unavailable?: string
}

export interface WorkspaceSnapshot {
  readonly roster: RosterView
  readonly conversations: Readonly<Record<string, ConversationView>>
  readonly models: ModelSettings
  readonly permissions: Readonly<Record<string, readonly PermissionRow[]>>
  readonly connectors: readonly ConnectorView[]
}

// ---------------------------------------------------------------------------
// Data-layer status
// ---------------------------------------------------------------------------

/**
 * Corn's local database, independent of `RuntimeStatus` and `ModelStatus`.
 * Anything but `ready` disables Bot management and chat; Corn never falls
 * back to fixtures and never deletes the database.
 */
export const DATA_STATUSES = [
  'opening',
  'ready',
  /** Another Corn process holds the data lock. */
  'locked',
  'corrupt',
  /** Written by a newer Corn; nothing is written. */
  'from_future',
  'migration_failed',
  'schema_tampered',
  'unavailable',
] as const
export type DataStatus = (typeof DATA_STATUSES)[number]

export interface DataStatusView {
  readonly status: DataStatus
}

export const DATA_CHANNELS = {
  status: 'corn:data:status',
} as const

// ---------------------------------------------------------------------------
// Errors and results
// ---------------------------------------------------------------------------

/** Closed set; the Renderer words each code itself. Host text never crosses. */
export const WORKSPACE_ERROR_CODES = [
  /** The payload failed its parser. */
  'validation',
  'not_found',
  /** A revision or uniqueness conflict, e.g. a duplicate tag label. */
  'conflict',
  /** The handle, message or view the command names is no longer current. */
  'stale',
  /** The operation cannot run in the Bot's current state. */
  'unavailable',
  'data_unavailable',
  'runtime_not_ready',
  'model_unavailable',
  /** The Bot's Claw agent or DSH session binding needs repair. */
  'binding_broken',
  'host_error',
] as const
export type WorkspaceErrorCode = (typeof WORKSPACE_ERROR_CODES)[number]

export interface WorkspaceError {
  readonly code: WorkspaceErrorCode
}

export type WorkspaceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: WorkspaceError }

// ---------------------------------------------------------------------------
// UI preferences
// ---------------------------------------------------------------------------

/**
 * Whitelisted, rebuildable UI preferences. `selectedBotId` also tells Main
 * which conversation to follow live; only the selected one is followed.
 */
export interface UiPrefs {
  readonly selectedBotId: string | null
  readonly detailsOpen: boolean
  readonly sidebarCollapsed: boolean
}
export type UiPrefKey = keyof UiPrefs

export const UI_PREF_KEYS = [
  'selectedBotId',
  'detailsOpen',
  'sidebarCollapsed',
] as const satisfies readonly UiPrefKey[]

export type SetUiPrefCommand = {
  readonly [K in UiPrefKey]: { readonly key: K; readonly value: UiPrefs[K] }
}[UiPrefKey]

// ---------------------------------------------------------------------------
// State and push
// ---------------------------------------------------------------------------

/** What `snapshot` returns: the whole workspace at one revision. */
export interface WorkspaceState {
  /** Main-process counter; every pushed change advances it by exactly one. */
  readonly revision: number
  readonly workspace: WorkspaceSnapshot
  readonly uiPrefs: UiPrefs
}

/**
 * Pushed on `WORKSPACE_EVENTS.changed`, coalesced per frame. Present slices
 * replace the current ones; `conversations` and `permissions` replace per
 * Bot and leave unlisted Bots untouched. Bots are never removed (hide only).
 */
export interface WorkspaceChange {
  readonly revision: number
  readonly roster?: RosterView
  readonly models?: ModelSettings
  readonly connectors?: readonly ConnectorView[]
  readonly conversations?: Readonly<Record<string, ConversationView>>
  readonly permissions?: Readonly<Record<string, readonly PermissionRow[]>>
  readonly uiPrefs?: UiPrefs
}

/**
 * Applies a pushed change, or returns `null` when its revision is not the
 * next one; the Renderer then pulls a fresh `snapshot` instead of guessing.
 */
export function applyWorkspaceChange(
  state: WorkspaceState,
  change: WorkspaceChange,
): WorkspaceState | null {
  if (change.revision !== state.revision + 1) return null
  const current = state.workspace
  return {
    revision: change.revision,
    uiPrefs: change.uiPrefs ?? state.uiPrefs,
    workspace: {
      roster: change.roster ?? current.roster,
      models: change.models ?? current.models,
      connectors: change.connectors ?? current.connectors,
      conversations: change.conversations
        ? { ...current.conversations, ...change.conversations }
        : current.conversations,
      permissions: change.permissions
        ? { ...current.permissions, ...change.permissions }
        : current.permissions,
    },
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/** Claw policy preset a new Bot starts with; nothing wider is accepted. */
export const POLICY_PRESETS = ['research', 'developer'] as const
export type PolicyPreset = (typeof POLICY_PRESETS)[number]
export const DEFAULT_POLICY_PRESET: PolicyPreset = 'research'

/** 职责, 工作风格 and groups are not accepted yet; tags have their own commands. */
export interface CreateBotCommand {
  readonly name: string
  readonly policyPreset: PolicyPreset
  /** Omitted: Main picks the default look from the new Bot's id. */
  readonly variantId?: CornAvatarVariantId
}

/** `repairBot`, `cancelTurn` and `loadEarlier` name only the Bot. */
export interface BotCommand {
  readonly botId: string
}

export interface SendMessageCommand {
  readonly botId: string
  /** Renderer-minted per send action; repeating it never enqueues twice. */
  readonly clientId: string
  readonly text: string
}

/** `resend` reuses the message's original DSH request; `cancelQueued` withdraws it. */
export interface MessageCommand {
  readonly botId: string
  readonly messageId: string
}

export interface AnswerApprovalCommand {
  readonly botId: string
  readonly handle: string
  readonly answer: ApprovalAnswer
}

export interface SetPinnedCommand {
  readonly botId: string
  readonly pinned: boolean
}

/** Hiding is the only removal: Bots are never deleted. */
export interface SetHiddenCommand {
  readonly botId: string
  readonly hidden: boolean
}

/** At least one field. */
export interface BotProfileChanges {
  readonly name?: string
  readonly variantId?: CornAvatarVariantId
}

export interface UpdateBotProfileCommand {
  readonly botId: string
  readonly expectedRevision: number
  readonly changes: BotProfileChanges
}

export interface SetBotModelCommand {
  readonly botId: string
  readonly expectedRevision: number
  /** A `ModelOption.id` from the current catalog; `null` follows the global default. */
  readonly modelId: string | null
}

export interface CreateTagCommand {
  readonly label: string
}

export interface SetBotTagsCommand {
  readonly botId: string
  readonly expectedRevision: number
  readonly tagIds: readonly TagId[]
}

/**
 * The `window.corn.workspace` bridge. Every command resolves to a closed
 * result and never rejects; changes arrive through `onChanged`.
 */
export interface WorkspaceBridge {
  snapshot(): Promise<WorkspaceResult<WorkspaceState>>
  /** Resolves to the new Bot id once its local record exists. */
  createBot(command: CreateBotCommand): Promise<WorkspaceResult<string>>
  /** Resumes binding from the last checkpoint; never rebinds to another session. */
  repairBot(command: BotCommand): Promise<WorkspaceResult<null>>
  /** Resolves to the message id; a repeated `clientId` returns the original. */
  sendMessage(command: SendMessageCommand): Promise<WorkspaceResult<string>>
  resend(command: MessageCommand): Promise<WorkspaceResult<null>>
  cancelQueued(command: MessageCommand): Promise<WorkspaceResult<null>>
  /**
   * Stops this conversation's turn: its own child sessions and jobs first,
   * leaf first, then the turn. Queued messages stay queued.
   */
  cancelTurn(command: BotCommand): Promise<WorkspaceResult<null>>
  answerApproval(command: AnswerApprovalCommand): Promise<WorkspaceResult<null>>
  setPinned(command: SetPinnedCommand): Promise<WorkspaceResult<null>>
  setHidden(command: SetHiddenCommand): Promise<WorkspaceResult<null>>
  /** Resolves to the Bot's new revision. */
  updateBotProfile(
    command: UpdateBotProfileCommand,
  ): Promise<WorkspaceResult<number>>
  /** Resolves to the Bot's new revision. */
  setBotModel(command: SetBotModelCommand): Promise<WorkspaceResult<number>>
  /** Resolves to the new tag id. */
  createTag(command: CreateTagCommand): Promise<WorkspaceResult<TagId>>
  /** Resolves to the Bot's new revision. */
  setBotTags(command: SetBotTagsCommand): Promise<WorkspaceResult<number>>
  setUiPref(command: SetUiPrefCommand): Promise<WorkspaceResult<null>>
  loadEarlier(command: BotCommand): Promise<WorkspaceResult<null>>
  /** Receives change payloads only, never the IPC event; returns an unsubscribe. */
  onChanged(listener: (change: WorkspaceChange) => void): () => void
}

export type WorkspaceCommandName = Exclude<keyof WorkspaceBridge, 'onChanged'>

export const WORKSPACE_CHANNELS = {
  snapshot: 'corn:workspace:snapshot',
  createBot: 'corn:workspace:create-bot',
  repairBot: 'corn:workspace:repair-bot',
  sendMessage: 'corn:workspace:send-message',
  resend: 'corn:workspace:resend',
  cancelQueued: 'corn:workspace:cancel-queued',
  cancelTurn: 'corn:workspace:cancel-turn',
  answerApproval: 'corn:workspace:answer-approval',
  setPinned: 'corn:workspace:set-pinned',
  setHidden: 'corn:workspace:set-hidden',
  updateBotProfile: 'corn:workspace:update-bot-profile',
  setBotModel: 'corn:workspace:set-bot-model',
  createTag: 'corn:workspace:create-tag',
  setBotTags: 'corn:workspace:set-bot-tags',
  setUiPref: 'corn:workspace:set-ui-pref',
  loadEarlier: 'corn:workspace:load-earlier',
} as const satisfies Record<WorkspaceCommandName, string>

/** Main → Renderer push channels (`webContents.send`). */
export const WORKSPACE_EVENTS = {
  changed: 'corn:workspace:changed',
} as const

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/** Bot name length in user-perceived characters, after trimming. */
export const BOT_NAME_MAX = 24
/** Tag label length in user-perceived characters, after trimming. */
export const TAG_LABEL_MAX = 12
/** Code-unit ceiling for any label, checked before counting characters. */
export const MAX_LABEL_UNITS = 256
export const MAX_ID_LENGTH = 128
export const MAX_MODEL_ID_LENGTH = 200
/** Message body ceiling in UTF-16 code units. */
export const MAX_MESSAGE_LENGTH = 32_000
export const MAX_TAGS_PER_BOT = 32

/** Opaque ids Main issues and the Renderer echoes; UUIDs fit. */
const ID_PATTERN = /^[A-Za-z0-9][\w.:-]*$/u
const LINE_BREAK = /[\p{Zl}\p{Zp}]/u
const CONTROL = /\p{Cc}/u
const MESSAGE_WHITESPACE = /[\n\t]/gu

const graphemes = new Intl.Segmenter('zh', { granularity: 'grapheme' })

/** Length in user-perceived characters, as the Renderer's name rule counts. */
export const labelLength = (text: string): number =>
  Array.from(graphemes.segment(text)).length

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/*
 * TypeScript types do not cross IPC. Each parser rebuilds its command from
 * exactly the allowed keys and returns `null` for anything else, so Main
 * answers `validation` before it reads a store or the Host.
 */
type Fields = Readonly<Record<string, unknown>>

function exact(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Fields | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return null
  if (Object.getPrototypeOf(value) !== Object.prototype) return null
  const keys = Object.keys(value)
  const allowed = new Set([...required, ...optional])
  if (!required.every((key) => keys.includes(key))) return null
  if (!keys.every((key) => allowed.has(key))) return null
  return value as Fields
}

const isId = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= MAX_ID_LENGTH &&
  ID_PATTERN.test(value)

const isRevision = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 1

/** Trimmed, single-line, free of control characters, 1..max characters. */
const isLabel = (value: unknown, max: number): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= MAX_LABEL_UNITS &&
  value.trim() === value &&
  !CONTROL.test(value) &&
  !LINE_BREAK.test(value) &&
  labelLength(value) <= max

/** Multi-line text: newlines and tabs allowed, other control characters not. */
const isMessageText = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= MAX_MESSAGE_LENGTH &&
  value.trim().length > 0 &&
  !CONTROL.test(value.replace(MESSAGE_WHITESPACE, ''))

const isModelId = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= MAX_MODEL_ID_LENGTH &&
  value.trim() === value &&
  !CONTROL.test(value)

const isPolicyPreset = (value: unknown): value is PolicyPreset =>
  (POLICY_PRESETS as readonly unknown[]).includes(value)

const isAnswer = (value: unknown): value is ApprovalAnswer =>
  value === 'allowed-once' || value === 'rejected'

export function parseSnapshot(value: unknown): undefined | null {
  return value === undefined ? undefined : null
}

export function parseCreateBot(value: unknown): CreateBotCommand | null {
  const row = exact(value, ['name', 'policyPreset'], ['variantId'])
  if (
    !row ||
    !isLabel(row.name, BOT_NAME_MAX) ||
    !isPolicyPreset(row.policyPreset)
  )
    return null
  const command = { name: row.name, policyPreset: row.policyPreset }
  if (row.variantId === undefined) return command
  return isCornAvatarVariantId(row.variantId)
    ? { ...command, variantId: row.variantId }
    : null
}

export function parseBotCommand(value: unknown): BotCommand | null {
  const row = exact(value, ['botId'])
  return row && isId(row.botId) ? { botId: row.botId } : null
}

export function parseSendMessage(value: unknown): SendMessageCommand | null {
  const row = exact(value, ['botId', 'clientId', 'text'])
  if (
    !row ||
    !isId(row.botId) ||
    !isId(row.clientId) ||
    !isMessageText(row.text)
  )
    return null
  return { botId: row.botId, clientId: row.clientId, text: row.text }
}

export function parseMessageCommand(value: unknown): MessageCommand | null {
  const row = exact(value, ['botId', 'messageId'])
  if (!row || !isId(row.botId) || !isId(row.messageId)) return null
  return { botId: row.botId, messageId: row.messageId }
}

export function parseAnswerApproval(
  value: unknown,
): AnswerApprovalCommand | null {
  const row = exact(value, ['botId', 'handle', 'answer'])
  if (!row || !isId(row.botId) || !isId(row.handle) || !isAnswer(row.answer))
    return null
  return { botId: row.botId, handle: row.handle, answer: row.answer }
}

export function parseSetPinned(value: unknown): SetPinnedCommand | null {
  const row = exact(value, ['botId', 'pinned'])
  if (!row || !isId(row.botId) || typeof row.pinned !== 'boolean') return null
  return { botId: row.botId, pinned: row.pinned }
}

export function parseSetHidden(value: unknown): SetHiddenCommand | null {
  const row = exact(value, ['botId', 'hidden'])
  if (!row || !isId(row.botId) || typeof row.hidden !== 'boolean') return null
  return { botId: row.botId, hidden: row.hidden }
}

function profileChanges(value: unknown): BotProfileChanges | null {
  const row = exact(value, [], ['name', 'variantId'])
  if (!row || (row.name === undefined && row.variantId === undefined))
    return null
  if (row.name !== undefined && !isLabel(row.name, BOT_NAME_MAX)) return null
  if (row.variantId !== undefined && !isCornAvatarVariantId(row.variantId))
    return null
  return {
    ...(row.name === undefined ? {} : { name: row.name }),
    ...(row.variantId === undefined ? {} : { variantId: row.variantId }),
  }
}

export function parseUpdateBotProfile(
  value: unknown,
): UpdateBotProfileCommand | null {
  const row = exact(value, ['botId', 'expectedRevision', 'changes'])
  if (!row || !isId(row.botId) || !isRevision(row.expectedRevision)) return null
  const changes = profileChanges(row.changes)
  return changes
    ? { botId: row.botId, expectedRevision: row.expectedRevision, changes }
    : null
}

export function parseSetBotModel(value: unknown): SetBotModelCommand | null {
  const row = exact(value, ['botId', 'expectedRevision', 'modelId'])
  if (
    !row ||
    !isId(row.botId) ||
    !isRevision(row.expectedRevision) ||
    (row.modelId !== null && !isModelId(row.modelId))
  )
    return null
  return {
    botId: row.botId,
    expectedRevision: row.expectedRevision,
    modelId: row.modelId,
  }
}

export function parseCreateTag(value: unknown): CreateTagCommand | null {
  const row = exact(value, ['label'])
  return row && isLabel(row.label, TAG_LABEL_MAX) ? { label: row.label } : null
}

export function parseSetBotTags(value: unknown): SetBotTagsCommand | null {
  const row = exact(value, ['botId', 'expectedRevision', 'tagIds'])
  if (
    !row ||
    !isId(row.botId) ||
    !isRevision(row.expectedRevision) ||
    !Array.isArray(row.tagIds) ||
    row.tagIds.length > MAX_TAGS_PER_BOT ||
    !row.tagIds.every(isId) ||
    new Set(row.tagIds).size !== row.tagIds.length
  )
    return null
  return {
    botId: row.botId,
    expectedRevision: row.expectedRevision,
    tagIds: [...row.tagIds],
  }
}

export function parseSetUiPref(value: unknown): SetUiPrefCommand | null {
  const row = exact(value, ['key', 'value'])
  if (!row || !(UI_PREF_KEYS as readonly unknown[]).includes(row.key))
    return null
  const key = row.key as UiPrefKey
  switch (key) {
    case 'selectedBotId':
      return row.value === null || isId(row.value)
        ? { key, value: row.value }
        : null
    case 'detailsOpen':
    case 'sidebarCollapsed':
      return typeof row.value === 'boolean' ? { key, value: row.value } : null
    default: {
      const unreachable: never = key
      throw new Error(`Unknown UI preference ${String(unreachable)}`)
    }
  }
}

type CommandOf<K extends WorkspaceCommandName> =
  Parameters<WorkspaceBridge[K]> extends [infer Command] ? Command : undefined

/** One parser per invoke channel; `null` means the payload is refused. */
export const WORKSPACE_PARSERS: {
  readonly [K in WorkspaceCommandName]: (
    payload: unknown,
  ) => CommandOf<K> | null
} = Object.freeze({
  snapshot: parseSnapshot,
  createBot: parseCreateBot,
  repairBot: parseBotCommand,
  sendMessage: parseSendMessage,
  resend: parseMessageCommand,
  cancelQueued: parseMessageCommand,
  cancelTurn: parseBotCommand,
  answerApproval: parseAnswerApproval,
  setPinned: parseSetPinned,
  setHidden: parseSetHidden,
  updateBotProfile: parseUpdateBotProfile,
  setBotModel: parseSetBotModel,
  createTag: parseCreateTag,
  setBotTags: parseSetBotTags,
  setUiPref: parseSetUiPref,
  loadEarlier: parseBotCommand,
})
