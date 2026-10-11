import { useEffect, useEffectEvent } from 'react'
import type { BotEditorController } from '../../bot-editor/bot-editor-controller.ts'
import type { ConfigSubpage } from '../details-navigation.ts'
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
