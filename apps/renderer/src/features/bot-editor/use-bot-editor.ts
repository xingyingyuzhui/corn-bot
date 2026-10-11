import { useEffect, useState, useSyncExternalStore } from 'react'
import { useRepository } from '../../app/workspace-context.tsx'
import type { BotView } from '../../model/workspace.ts'
import {
  BotEditorController,
  type BotEditorSpec,
  type BotEditorState,
} from './bot-editor-controller.ts'

export interface BotEditor<D> {
  readonly controller: BotEditorController<D>
  readonly state: BotEditorState<D>
}

/**
 * One controller per mounted editor. Callers key the editor by Bot id, so a
 * Bot switch always builds a new controller and detaches the old one.
 */
export function useBotEditor<D>(
  spec: BotEditorSpec<D>,
  bot: BotView,
): BotEditor<D> {
  const repository = useRepository()
  const [controller] = useState(
    () => new BotEditorController(repository, spec, bot),
  )
  if (controller.botId !== bot.id)
    throw new Error('A Bot editor must be keyed by its Bot id')
  useEffect(() => {
    controller.attach()
    return () => controller.detach()
  }, [controller])
  useEffect(() => controller.sync(bot), [controller, bot])
  const state = useSyncExternalStore(controller.subscribe, controller.getState)
  return { controller, state }
}
