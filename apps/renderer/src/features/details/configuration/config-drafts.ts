import type {
  BotEditorController,
  DraftSaveResult,
} from '../../bot-editor/bot-editor-controller.ts'
import type { ConfigSubpage } from '../details-navigation.ts'

/** A mounted configuration editor, as the unsaved-changes prompt sees it. */
export interface ConfigDraftHandle {
  readonly botId: string
  readonly page: ConfigSubpage
  save(): Promise<DraftSaveResult>
  discard(): Promise<void>
}

/** The handle a subpage registers for its editor. */
export function configDraftHandle<D>(
  page: ConfigSubpage,
  controller: BotEditorController<D>,
): ConfigDraftHandle {
  return {
    botId: controller.botId,
    page,
    save: () => controller.saveDraft(),
    discard: () => controller.discard(),
  }
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

/** How the prompt ended; only `saved` and `discarded` let the held action run. */
export type UnsavedSettlement =
  | 'saved'
  | 'discarded'
  | 'cancelled'
  | 'failed'
  | 'unsaved'
  | 'missing'

/**
 * Carries out the choice. A failed save keeps the draft and stays; with no
 * editor left there is nothing to keep.
 */
export async function settleUnsaved(
  choice: UnsavedChoice,
  handle: ConfigDraftHandle | undefined,
): Promise<UnsavedSettlement> {
  switch (choice) {
    case 'save':
      return handle ? settlementOf(await handle.save()) : 'saved'
    case 'discard':
      await handle?.discard()
      return 'discarded'
    case 'cancel':
      return 'cancelled'
    default: {
      const unreachable: never = choice
      throw new Error(`Unknown choice ${String(unreachable)}`)
    }
  }
}

function settlementOf(result: DraftSaveResult): UnsavedSettlement {
  switch (result) {
    case 'saved':
    case 'unchanged':
      return 'saved'
    case 'unsaved':
      return 'unsaved'
    case 'failed':
      return 'failed'
    default: {
      const unreachable: never = result
      throw new Error(`Unknown save result ${String(unreachable)}`)
    }
  }
}

export function leavesAfter(settlement: UnsavedSettlement): boolean {
  switch (settlement) {
    case 'saved':
    case 'discarded':
      return true
    case 'cancelled':
    case 'failed':
    case 'unsaved':
    case 'missing':
      return false
    default: {
      const unreachable: never = settlement
      throw new Error(`Unknown settlement ${String(unreachable)}`)
    }
  }
}

/** The notice after the prompt; a failed save shows its errors on the page. */
export function settlementNotice(
  settlement: UnsavedSettlement,
  page: string,
): string | null {
  switch (settlement) {
    case 'saved':
      return `“${page}”已保存`
    case 'unsaved':
      return `“${page}”还有保存期间的新修改没有保存，请再次保存`
    case 'missing':
      return `没有找到“${page}”的编辑内容，修改没有保存`
    case 'discarded':
    case 'cancelled':
    case 'failed':
      return null
    default: {
      const unreachable: never = settlement
      throw new Error(`Unknown settlement ${String(unreachable)}`)
    }
  }
}
