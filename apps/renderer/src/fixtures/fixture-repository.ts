import {
  type BotDraft,
  type BotProfilePatch,
  type CommandResult,
  done,
  fail,
  ok,
  type SendMessageInput,
  type WorkspaceRepository,
} from '../model/repository.ts'
import type {
  ApprovalAnswer,
  BotView,
  ConversationView,
  FeedItem,
  TagId,
  WorkspaceSnapshot,
} from '../model/workspace.ts'
import { M1_INITIAL_BOT_ID, m1FixtureSnapshot } from './m1-workspace.ts'

export const NAME_MAX = 24
export const TAG_MAX = 12
const UNGROUPED_ID = 'ungrouped'

export interface FixtureOptions {
  /** Artificial latency so pending states are visible; 0 in unit tests. */
  readonly latencyMs?: number
  /** Approval requests that settle as `cancelled`, as a late DSH reply would. */
  readonly staleRequestIds?: readonly string[]
}

const sameName = (a: string, b: string) =>
  a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase()

const hueOf = (text: string) =>
  [...text].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 360, 7)

/**
 * In-memory stand-in for M2's Main-backed repository. It changes only its own
 * snapshot: nothing is delivered, uploaded, created in Claw or shared. Queued
 * messages stay queued because no Bot is connected.
 */
export class FixtureWorkspaceRepository implements WorkspaceRepository {
  readonly label = 'fixture' as const
  readonly initialBotId: string
  #snapshot: WorkspaceSnapshot
  #listeners = new Set<() => void>()
  #sentClientIds = new Map<string, string>()
  #sequence = 0
  readonly #latencyMs: number
  readonly #stale: ReadonlySet<string>

  constructor(
    snapshot: WorkspaceSnapshot = m1FixtureSnapshot(),
    options: FixtureOptions = {},
    initialBotId: string = M1_INITIAL_BOT_ID,
  ) {
    this.#snapshot = snapshot
    this.initialBotId = initialBotId
    this.#latencyMs = options.latencyMs ?? 0
    this.#stale = new Set(options.staleRequestIds ?? [])
  }

  getSnapshot = (): WorkspaceSnapshot => this.#snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  async sendMessage(input: SendMessageInput): Promise<CommandResult<string>> {
    const known = this.#sentClientIds.get(input.clientId)
    if (known) return ok(known)
    const conversation = this.#snapshot.conversations[input.botId]
    if (!conversation) return fail('not-found', '找不到这个 Bot')
    if (conversation.readOnly)
      return fail('read-only', '此聊天仅供查看，不能发送')
    const text = input.text.trim()
    if (!text && input.attachments.length === 0)
      return fail('validation', '消息不能为空')
    const id = `local-${input.clientId}`
    this.#sentClientIds.set(input.clientId, id)
    this.#updateConversation(input.botId, (items) => [
      ...items,
      {
        kind: 'message',
        id,
        author: 'user',
        paragraphs: text ? text.split(/\n{2,}/u) : [],
        attachments: input.attachments,
        delivery: 'queued',
      },
    ])
    return ok(id)
  }

  async cancelQueued(botId: string, messageId: string): Promise<CommandResult> {
    const message = this.#message(botId, messageId)
    if (!message) return fail('not-found', '找不到这条消息')
    if (message.delivery !== 'queued' && message.delivery !== 'failed')
      return fail('conflict', '消息已经开始发送，不能取消')
    this.#updateConversation(botId, (items) =>
      items.filter((item) => item.id !== messageId),
    )
    return done
  }

  async resend(botId: string, messageId: string): Promise<CommandResult> {
    const message = this.#message(botId, messageId)
    if (!message) return fail('not-found', '找不到这条消息')
    if (message.delivery !== 'failed')
      return fail('conflict', '只有发送失败的消息可以重发')
    this.#updateConversation(botId, (items) =>
      items.map((item) => {
        if (item.id !== messageId || item.kind !== 'message') return item
        const { failure: _failure, ...rest } = item
        return { ...rest, delivery: 'queued' as const }
      }),
    )
    return done
  }

  async answerApproval(
    botId: string,
    requestId: string,
    answer: ApprovalAnswer,
  ): Promise<CommandResult> {
    const card = this.#snapshot.conversations[botId]?.items.find(
      (item) => item.kind === 'approval' && item.requestId === requestId,
    )
    if (card?.kind !== 'approval') return fail('not-found', '找不到这个请求')
    if (card.status !== 'pending')
      return fail('conflict', '这个请求已经处理过了')
    this.#setApproval(botId, requestId, 'submitting')
    await this.#settle()
    if (this.#stale.has(requestId)) {
      this.#setApproval(botId, requestId, 'cancelled')
      return fail('stale', '这个请求已失效，Bot 已不再等待回复')
    }
    this.#setApproval(botId, requestId, answer)
    return done
  }

  async createBot(draft: BotDraft): Promise<CommandResult<string>> {
    const name = draft.name.trim()
    const role = draft.role.trim()
    const invalid = this.#validateName(name)
    if (invalid) return invalid
    if (!role) return fail('validation', '请填写职责', 'role')
    const { roster } = this.#snapshot
    if (
      draft.groupId !== null &&
      !roster.groups.some((group) => group.id === draft.groupId)
    )
      return fail('not-found', '找不到这个分组', 'groupId')
    await this.#settle()
    const id = `mock-${++this.#sequence}`
    const bot: BotView = {
      id,
      name,
      summary: '示例 Bot，尚未创建真实 Claw Agent',
      avatar: { initial: name.slice(0, 1), hue: hueOf(name) },
      role,
      workStyle: draft.workStyle.trim(),
      tagIds: [],
      modelOverride: null,
      activity: 'offline',
      unread: false,
      revision: 1,
      origin: 'mock-created',
    }
    const groupId = draft.groupId ?? UNGROUPED_ID
    const groups = roster.groups.some((group) => group.id === groupId)
      ? roster.groups.map((group) =>
          group.id === groupId
            ? { ...group, botIds: [...group.botIds, id] }
            : group,
        )
      : [...roster.groups, { id: groupId, label: '未分组', botIds: [id] }]
    this.#commit({
      ...this.#snapshot,
      roster: { ...roster, groups, bots: { ...roster.bots, [id]: bot } },
      conversations: {
        ...this.#snapshot.conversations,
        [id]: { botId: id, state: 'ready', readOnly: false, items: [] },
      },
      permissions: {
        ...this.#snapshot.permissions,
        [id]: this.#snapshot.permissions[this.initialBotId] ?? [],
      },
    })
    return ok(id)
  }

  async setPinned(botId: string, pinned: boolean): Promise<CommandResult> {
    const { roster } = this.#snapshot
    if (!roster.bots[botId]) return fail('not-found', '找不到这个 Bot')
    const without = roster.pinnedBotIds.filter((id) => id !== botId)
    this.#commit({
      ...this.#snapshot,
      roster: {
        ...roster,
        pinnedBotIds: pinned ? [...without, botId] : without,
      },
    })
    return done
  }

  async setHidden(botId: string, hidden: boolean): Promise<CommandResult> {
    const { roster } = this.#snapshot
    if (!roster.bots[botId]) return fail('not-found', '找不到这个 Bot')
    const without = roster.hiddenBotIds.filter((id) => id !== botId)
    this.#commit({
      ...this.#snapshot,
      roster: {
        ...roster,
        hiddenBotIds: hidden ? [...without, botId] : without,
      },
    })
    return done
  }

  async updateBotProfile(
    botId: string,
    patch: BotProfilePatch,
    expectedRevision: number,
  ): Promise<CommandResult<number>> {
    const bot = this.#snapshot.roster.bots[botId]
    if (!bot) return fail('not-found', '找不到这个 Bot')
    if (bot.revision !== expectedRevision) return this.#conflict()
    const name = patch.name?.trim() ?? bot.name
    const invalid = this.#validateName(name, botId)
    if (invalid) return invalid
    const role = patch.role?.trim() ?? bot.role
    if (!role) return fail('validation', '请填写职责', 'role')
    await this.#settle()
    return ok(
      this.#updateBot(botId, {
        name,
        role,
        workStyle: patch.workStyle?.trim() ?? bot.workStyle,
        avatar: { ...bot.avatar, initial: name.slice(0, 1) },
      }),
    )
  }

  async createTag(label: string): Promise<CommandResult<TagId>> {
    const text = label.trim()
    if (!text) return fail('validation', '标签不能为空', 'label')
    if ([...text].length > TAG_MAX)
      return fail('validation', `标签最多 ${TAG_MAX} 个字`, 'label')
    const { roster } = this.#snapshot
    if (Object.values(roster.tags).some((tag) => sameName(tag.label, text)))
      return fail('duplicate', '已经有同名标签', 'label')
    const id = `tag-${++this.#sequence}`
    this.#commit({
      ...this.#snapshot,
      roster: {
        ...roster,
        tags: { ...roster.tags, [id]: { id, label: text } },
      },
    })
    return ok(id)
  }

  async setBotTags(
    botId: string,
    tagIds: readonly TagId[],
    expectedRevision: number,
  ): Promise<CommandResult<number>> {
    const { roster } = this.#snapshot
    const bot = roster.bots[botId]
    if (!bot) return fail('not-found', '找不到这个 Bot')
    if (bot.revision !== expectedRevision) return this.#conflict()
    if (tagIds.some((id) => !roster.tags[id]))
      return fail('not-found', '标签已被删除，请刷新后重试')
    await this.#settle()
    return ok(this.#updateBot(botId, { tagIds: [...new Set(tagIds)] }))
  }

  async setGlobalModel(modelId: string): Promise<CommandResult> {
    const model = this.#snapshot.models.catalog.find(
      (entry) => entry.id === modelId,
    )
    if (!model?.available)
      return fail('validation', '这个模型当前不可用', 'model')
    await this.#settle()
    this.#commit({
      ...this.#snapshot,
      models: { ...this.#snapshot.models, globalDefault: modelId },
    })
    return done
  }

  async setBotModel(
    botId: string,
    modelId: string | null,
    expectedRevision: number,
  ): Promise<CommandResult<number>> {
    const bot = this.#snapshot.roster.bots[botId]
    if (!bot) return fail('not-found', '找不到这个 Bot')
    if (bot.revision !== expectedRevision) return this.#conflict()
    if (modelId !== null) {
      const model = this.#snapshot.models.catalog.find(
        (entry) => entry.id === modelId,
      )
      if (!model?.available)
        return fail('validation', '这个模型当前不可用', 'model')
    }
    await this.#settle()
    return ok(this.#updateBot(botId, { modelOverride: modelId }))
  }

  #validateName(name: string, selfId?: string): CommandResult<never> | null {
    if (!name) return fail('validation', '请填写名称', 'name')
    if ([...name].length > NAME_MAX)
      return fail('validation', `名称最多 ${NAME_MAX} 个字`, 'name')
    const clash = Object.values(this.#snapshot.roster.bots).some(
      (bot) => bot.id !== selfId && sameName(bot.name, name),
    )
    return clash ? fail('duplicate', '已经有同名的 Bot', 'name') : null
  }

  #conflict<T>(): CommandResult<T> {
    return fail('conflict', '资料已在别处更新，请重新打开后再改')
  }

  #message(botId: string, messageId: string) {
    const item = this.#snapshot.conversations[botId]?.items.find(
      (entry) => entry.id === messageId,
    )
    return item?.kind === 'message' ? item : undefined
  }

  #setApproval(
    botId: string,
    requestId: string,
    status: Extract<FeedItem, { kind: 'approval' }>['status'],
  ) {
    this.#updateConversation(botId, (items) =>
      items.map((item) =>
        item.kind === 'approval' && item.requestId === requestId
          ? { ...item, status }
          : item,
      ),
    )
  }

  #updateBot(botId: string, patch: Partial<BotView>): number {
    const { roster } = this.#snapshot
    const bot = roster.bots[botId]
    if (!bot) throw new Error(`Unknown Bot ${botId}`)
    const revision = bot.revision + 1
    this.#commit({
      ...this.#snapshot,
      roster: {
        ...roster,
        bots: { ...roster.bots, [botId]: { ...bot, ...patch, revision } },
      },
    })
    return revision
  }

  #updateConversation(
    botId: string,
    update: (items: readonly FeedItem[]) => readonly FeedItem[],
  ) {
    const conversation = this.#snapshot.conversations[botId]
    if (!conversation) return
    const next: ConversationView = {
      ...conversation,
      items: update(conversation.items),
    }
    this.#commit({
      ...this.#snapshot,
      conversations: { ...this.#snapshot.conversations, [botId]: next },
    })
  }

  #commit(next: WorkspaceSnapshot) {
    this.#snapshot = next
    for (const listener of this.#listeners) listener()
  }

  #settle(): Promise<void> {
    return this.#latencyMs > 0
      ? new Promise((resolve) => setTimeout(resolve, this.#latencyMs))
      : Promise.resolve()
  }
}
