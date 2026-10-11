/**
 * Credential-free view models the Renderer draws. M1 fills them from named
 * fixtures; M2 fills them from Main through typed IPC.
 */

export interface AvatarSpec {
  readonly initial: string
  /** Hue in degrees for Corn's placeholder avatar until PR-02D lands. */
  readonly hue: number
}

export interface BotView {
  readonly id: string
  readonly name: string
  readonly summary: string
  readonly avatar: AvatarSpec
}

export interface BotGroupView {
  readonly id: string
  readonly label: string
  readonly botIds: readonly string[]
}

export interface RosterView {
  readonly pinnedBotIds: readonly string[]
  readonly groups: readonly BotGroupView[]
  readonly bots: Readonly<Record<string, BotView>>
  readonly account: AvatarSpec
}

export type FeedItem =
  | { readonly kind: 'divider'; readonly id: string; readonly label: string }
  | {
      readonly kind: 'message'
      readonly id: string
      readonly author: 'user' | 'bot'
      readonly paragraphs: readonly string[]
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

export interface WorkspaceSource {
  /** Shown to the user whenever data is not from a real Bot. */
  readonly label: 'fixture' | 'live'
  readonly roster: RosterView
  readonly initialBotId: string
  conversation(botId: string): readonly FeedItem[]
}
