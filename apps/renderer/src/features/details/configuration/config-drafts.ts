import type { ConfigSubpage } from '../details-navigation.ts'

/** A mounted configuration editor, as the unsaved-changes prompt sees it. */
export interface ConfigDraftHandle {
  readonly botId: string
  readonly page: ConfigSubpage
  /** Resolves `false` when the write failed; the draft is kept. */
  save(): Promise<boolean>
  discard(): void
}

/** Mounted editors by Bot and page; the prompt saves through these. */
export class ConfigDraftRegistry {
  #handles = new Set<ConfigDraftHandle>()

  register(handle: ConfigDraftHandle): () => void {
    this.#handles.add(handle)
    return () => this.#handles.delete(handle)
  }

  find(botId: string, page: ConfigSubpage): ConfigDraftHandle | undefined {
    for (const handle of this.#handles)
      if (handle.botId === botId && handle.page === page) return handle
    return undefined
  }
}

export type UnsavedChoice = 'save' | 'discard' | 'cancel'

/**
 * Whether the held navigation may go ahead. A failed save keeps the draft
 * and stays; with no editor left there is nothing to keep.
 */
export async function settleUnsaved(
  choice: UnsavedChoice,
  handle: ConfigDraftHandle | undefined,
): Promise<boolean> {
  switch (choice) {
    case 'save':
      return handle ? handle.save() : true
    case 'discard':
      handle?.discard()
      return true
    case 'cancel':
      return false
    default: {
      const unreachable: never = choice
      throw new Error(`Unknown choice ${String(unreachable)}`)
    }
  }
}
