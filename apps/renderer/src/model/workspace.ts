/**
 * Credential-free view models the Renderer draws. M1 fills them from named
 * fixtures; M2 fills them from Main through typed IPC.
 */

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

export interface BotView {
  readonly id: string
  readonly name: string
  readonly summary: string
  readonly avatar: AvatarSpec
  /** 职责: what the Bot is responsible for. */
  readonly role: string
  /** 工作风格: how it should work. */
  readonly workStyle: string
  readonly tagIds: readonly TagId[]
  /** `null` follows the global default model. */
  readonly modelOverride: string | null
  readonly activity: BotActivity
  readonly unread: boolean
  /** Optimistic-concurrency revision for profile, tag and model writes. */
  readonly revision: number
  readonly origin: BotOrigin
}

export interface BotGroupView {
  readonly id: string
  readonly label: string
  readonly botIds: readonly string[]
}

export interface RosterView {
  readonly pinnedBotIds: readonly string[]
  readonly hiddenBotIds: readonly string[]
  readonly groups: readonly BotGroupView[]
  readonly bots: Readonly<Record<string, BotView>>
  readonly tags: Readonly<Record<TagId, TagView>>
  readonly account: PlaceholderAvatarSpec
}

/**
 * Corn-side delivery of a user message. `accepted` means DSH accepted it,
 * not that the Bot replied. Absent on fixture history.
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
 * generation or a late reply all settle as `cancelled`.
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
      readonly id: string
      readonly author: 'user' | 'bot'
      readonly paragraphs: readonly string[]
      readonly attachments?: readonly AttachmentView[]
      readonly delivery?: DeliveryState
      /** User-facing reason when `delivery` is `failed`. */
      readonly failure?: string
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
      readonly requestId: string
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

export type ConversationState = 'ready' | 'loading' | 'error'

export interface ConversationView {
  readonly botId: string
  readonly state: ConversationState
  /** Read-only conversations never accept a send. */
  readonly readOnly: boolean
  readonly items: readonly FeedItem[]
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
