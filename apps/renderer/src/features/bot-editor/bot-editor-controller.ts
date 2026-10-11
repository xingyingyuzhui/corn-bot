import type {
  CommandError,
  CommandResult,
  WorkspaceRepository,
} from '../../model/repository.ts'
import type { BotView } from '../../model/workspace.ts'

/** What one Bot editor edits and how it writes through the repository. */
export interface BotEditorSpec<D> {
  readonly fromBot: (bot: BotView) => D
  readonly changed: (bot: BotView, draft: D) => boolean
  /** Rejects a draft before any write; `null` lets it through. */
  readonly precheck: (
    repository: WorkspaceRepository,
    bot: BotView,
    draft: D,
  ) => string | null
  /** Revision-checked against `bot.revision`, the revision the draft started from. */
  readonly write: (
    repository: WorkspaceRepository,
    bot: BotView,
    draft: D,
  ) => Promise<CommandResult<number>>
  /** Field an error is shown on; `null` shows it under the form. */
  readonly fieldOf: (error: CommandError) => string | null
}

export interface BotEditorState<D> {
  /** The Bot as it was when the draft started; its revision guards the write. */
  readonly base: BotView
  readonly draft: D
  readonly saving: boolean
  readonly conflict: boolean
  readonly formError: string | null
  readonly fieldErrors: Readonly<Record<string, string>>
}

export type SaveOutcome = 'unchanged' | 'saved' | 'failed'

/** What a save means for the draft on screen; see `saveDraft`. */
export type DraftSaveResult = 'saved' | 'unchanged' | 'unsaved' | 'failed'

const fresh = <D>(spec: BotEditorSpec<D>, bot: BotView): BotEditorState<D> => ({
  base: bot,
  draft: spec.fromBot(bot),
  saving: false,
  conflict: false,
  formError: null,
  fieldErrors: {},
})

/**
 * Draft, save and conflict handling for one Bot, shared by the editor
 * dialogs and the configuration subpages. An instance belongs to the Bot it
 * was created for; once detached, a late write result still settles its
 * promise but never touches state or listeners again.
 */
export class BotEditorController<D> {
  readonly botId: string
  readonly #repository: WorkspaceRepository
  readonly #spec: BotEditorSpec<D>
  #state: BotEditorState<D>
  #listeners = new Set<() => void>()
  #inflight: Promise<SaveOutcome> | null = null
  #attached = true

  constructor(
    repository: WorkspaceRepository,
    spec: BotEditorSpec<D>,
    bot: BotView,
  ) {
    this.botId = bot.id
    this.#repository = repository
    this.#spec = spec
    this.#state = fresh(spec, bot)
  }

  getState = (): BotEditorState<D> => this.#state

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  get attached(): boolean {
    return this.#attached
  }

  get dirty(): boolean {
    return this.#spec.changed(this.#state.base, this.#state.draft)
  }

  attach() {
    this.#attached = true
  }

  detach() {
    this.#attached = false
  }

  edit(update: (draft: D) => D, field?: string) {
    const fieldErrors = Object.fromEntries(
      Object.entries(this.#state.fieldErrors).filter(([key]) => key !== field),
    )
    this.#set({ draft: update(this.#state.draft), fieldErrors })
  }

  /**
   * Starts over from the stored Bot, dropping the draft and any error. Not
   * while a write is in flight: its result still has to land here.
   */
  reload() {
    if (this.#inflight) return
    const bot = this.#readBot()
    if (bot) this.#replace(fresh(this.#spec, bot))
  }

  /** Follows outside changes while there is nothing of the user's to keep. */
  sync(bot: BotView) {
    const { base, saving } = this.#state
    if (bot.id !== this.botId || saving || this.dirty) return
    if (bot.revision !== base.revision) this.#replace(fresh(this.#spec, bot))
  }

  /** Repeated calls while a write is in flight share that write. */
  save(): Promise<SaveOutcome> {
    if (this.#inflight) return this.#inflight
    if (!this.dirty) return Promise.resolve('unchanged')
    const { base, draft } = this.#state
    const rejected = this.#spec.precheck(this.#repository, base, draft)
    if (rejected !== null) {
      this.#set({ formError: rejected })
      return Promise.resolve('failed')
    }
    this.#set({ saving: true, formError: null })
    const write = this.#spec
      .write(this.#repository, base, draft)
      .then((result): SaveOutcome => {
        this.#inflight = null
        if (result.ok) {
          this.#settleSaved(draft)
          return 'saved'
        }
        this.#settleFailed(result.error)
        return 'failed'
      })
    this.#inflight = write
    return write
  }

  /**
   * The save every close or leave goes through, answering for the draft as it
   * is now rather than the one sent: a shared earlier write can land under
   * newer edits, which is `unsaved` and starts no write by itself. A detached
   * editor's result is `failed`; nobody is left to confirm it.
   */
  async saveDraft(): Promise<DraftSaveResult> {
    const outcome = await this.save()
    if (outcome === 'failed' || !this.#attached) return 'failed'
    return this.dirty ? 'unsaved' : outcome
  }

  /**
   * Drops the draft. A write already sent cannot be taken back, so this waits
   * for it and then starts over from what is stored.
   */
  async discard(): Promise<void> {
    if (this.#inflight) await this.#inflight
    this.reload()
  }

  #settleSaved(sent: D) {
    if (!this.#attached) return
    const bot = this.#readBot() ?? this.#state.base
    const next = fresh(this.#spec, bot)
    const editedMeanwhile = this.#state.draft !== sent
    this.#replace(
      editedMeanwhile ? { ...next, draft: this.#state.draft } : next,
    )
  }

  #settleFailed(error: CommandError) {
    if (!this.#attached) return
    if (error.code === 'conflict') {
      this.#set({ saving: false, conflict: true })
      return
    }
    const field = this.#spec.fieldOf(error)
    this.#set(
      field === null
        ? { saving: false, formError: error.message }
        : {
            saving: false,
            fieldErrors: { ...this.#state.fieldErrors, [field]: error.message },
          },
    )
  }

  #readBot(): BotView | undefined {
    return this.#repository.getSnapshot().roster.bots[this.botId]
  }

  #set(patch: Partial<BotEditorState<D>>) {
    this.#replace({ ...this.#state, ...patch })
  }

  #replace(next: BotEditorState<D>) {
    if (!this.#attached) return
    this.#state = next
    for (const listener of this.#listeners) listener()
  }
}
