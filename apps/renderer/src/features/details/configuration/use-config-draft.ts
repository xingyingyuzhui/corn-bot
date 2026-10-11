import { type FormEvent, useEffect, useEffectEvent, useRef } from 'react'
import { useNotice } from '../../../shared/notice.tsx'
import type { BotEditorController } from '../../bot-editor/bot-editor-controller.ts'
import { DRAFT_STILL_UNSAVED } from '../../bot-editor/editor-specs.ts'
import type { ConfigSubpage } from '../details-navigation.ts'
import { PAGE_HEADING_SELECTOR } from './ConfigSubpageFrame.tsx'
import { type ConfigDraftRegistry, configDraftHandle } from './config-drafts.ts'

/**
 * Makes a subpage editor answerable to the unsaved-changes prompt and
 * reports whether it holds changes. Unmounting always reports clean.
 */
export function useConfigDraft<D>(
  registry: ConfigDraftRegistry,
  page: ConfigSubpage,
  controller: BotEditorController<D>,
  onDirtyChange: (dirty: boolean) => void,
) {
  const dirty = controller.dirty
  const report = useEffectEvent((next: boolean) => onDirtyChange(next))

  useEffect(
    () => registry.register(configDraftHandle(page, controller)),
    [registry, page, controller],
  )
  useEffect(() => report(dirty), [dirty])
  useEffect(() => () => report(false), [])
}

interface FocusBeforeSave {
  readonly target: HTMLElement
  readonly heading: HTMLElement | null
}

/**
 * Submit handler for a subpage form. Says saved only when the draft on screen
 * is stored. The fields lock while the write runs, which drops focus to
 * <body>; once it settles, focus returns to where it was, or to the heading
 * when that control stays disabled.
 */
export function useSubpageSave<D>(
  controller: BotEditorController<D>,
  savedNotice: string,
) {
  const notify = useNotice()
  const { saving } = controller.getState()
  const before = useRef<FocusBeforeSave | null>(null)

  useEffect(() => {
    const focus = before.current
    if (saving || !focus) return
    before.current = null
    const active = document.activeElement
    if (active && active !== document.body && active !== focus.target) return
    if (focus.target.isConnected && !focus.target.matches(':disabled'))
      focus.target.focus()
    else focus.heading?.focus()
  }, [saving])

  const save = async () => {
    const result = await controller.saveDraft()
    switch (result) {
      case 'saved':
        notify(savedNotice)
        return
      case 'unsaved':
        notify(DRAFT_STILL_UNSAVED)
        return
      case 'unchanged':
      case 'failed':
        return
      default: {
        const unreachable: never = result
        throw new Error(`Unknown save result ${String(unreachable)}`)
      }
    }
  }

  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving) return
    const target = document.activeElement
    before.current =
      target instanceof HTMLElement
        ? {
            target,
            heading:
              event.currentTarget
                .closest('.corn-details__subpage')
                ?.querySelector<HTMLElement>(PAGE_HEADING_SELECTOR) ?? null,
          }
        : null
    void save()
  }
}
