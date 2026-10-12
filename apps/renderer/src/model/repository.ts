import type {
  ApprovalAnswer,
  AttachmentView,
  TagId,
  WorkspaceSnapshot,
} from './workspace.ts'

export type CommandErrorCode =
  | 'validation'
  | 'duplicate'
  | 'conflict'
  | 'not-found'
  | 'stale'
  | 'read-only'
  | 'unavailable'

export interface CommandError {
  readonly code: CommandErrorCode
  /** User-facing, already localised. */
  readonly message: string
  /** Form field the error belongs to, when it belongs to one. */
  readonly field?: string
}

export type CommandResult<T = undefined> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: CommandError }

export const ok = <T>(value: T): CommandResult<T> => ({ ok: true, value })
export const done: CommandResult = { ok: true, value: undefined }
export const fail = <T = undefined>(
  code: CommandErrorCode,
  message: string,
  field?: string,
): CommandResult<T> => ({
  ok: false,
  error: field === undefined ? { code, message } : { code, message, field },
})

export interface SendMessageInput {
  readonly botId: string
  /** Client-generated; repeating a send with the same id never enqueues twice. */
  readonly clientId: string
  readonly text: string
  readonly attachments: readonly AttachmentView[]
}

export interface BotDraft {
  readonly name: string
  readonly role: string
  readonly workStyle: string
  readonly groupId: string | null
  /** Omitted: the repository picks a default from the new Bot's id. */
  readonly variantId?: string
}

export interface BotProfilePatch {
  readonly name?: string
  readonly role?: string
  readonly workStyle?: string
  readonly variantId?: string
}

/**
 * The only write path from the Renderer. Every command resolves to a typed
 * result instead of throwing, so callers always render success or a reason.
 * M1 binds the labelled fixture implementation; M2 binds typed IPC to Main.
 */
export interface WorkspaceRepository {
  readonly label: 'fixture' | 'live'
  readonly initialBotId: string
  getSnapshot(): WorkspaceSnapshot
  subscribe(listener: () => void): () => void

  sendMessage(input: SendMessageInput): Promise<CommandResult<string>>
  cancelQueued(botId: string, messageId: string): Promise<CommandResult>
  resend(botId: string, messageId: string): Promise<CommandResult>
  answerApproval(
    botId: string,
    handle: string,
    answer: ApprovalAnswer,
  ): Promise<CommandResult>

  createBot(draft: BotDraft): Promise<CommandResult<string>>
  setPinned(botId: string, pinned: boolean): Promise<CommandResult>
  setHidden(botId: string, hidden: boolean): Promise<CommandResult>

  updateBotProfile(
    botId: string,
    patch: BotProfilePatch,
    expectedRevision: number,
  ): Promise<CommandResult<number>>
  createTag(label: string): Promise<CommandResult<TagId>>
  setBotTags(
    botId: string,
    tagIds: readonly TagId[],
    expectedRevision: number,
  ): Promise<CommandResult<number>>

  setGlobalModel(modelId: string): Promise<CommandResult>
  setBotModel(
    botId: string,
    modelId: string | null,
    expectedRevision: number,
  ): Promise<CommandResult<number>>
}
