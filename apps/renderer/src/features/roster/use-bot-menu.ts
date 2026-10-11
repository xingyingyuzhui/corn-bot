import type { Overlay } from '../../app/layout-state.ts'
import { useRepository, useWorkspace } from '../../app/workspace-context.tsx'
import type { CommandResult } from '../../model/repository.ts'
import type { BotView } from '../../model/workspace.ts'
import type { MenuItem } from '../../shared/Menu.tsx'
import { useNotice } from '../../shared/notice.tsx'

/** Row actions shared by list rows and pinned cards. Hiding is not deleting. */
export function useBotMenu(
  bot: BotView,
  onOpenOverlay: (overlay: Overlay) => void,
): readonly MenuItem[] {
  const repository = useRepository()
  const { roster } = useWorkspace()
  const notify = useNotice()
  const pinned = roster.pinnedBotIds.includes(bot.id)

  const report = async (
    command: Promise<CommandResult>,
    success?: string,
  ): Promise<void> => {
    const result = await command
    if (!result.ok) notify(result.error.message)
    else if (success) notify(success)
  }

  return [
    {
      id: 'pin',
      label: pinned ? '取消置顶' : '置顶',
      onSelect: () => void report(repository.setPinned(bot.id, !pinned)),
    },
    {
      id: 'profile',
      label: '编辑资料…',
      onSelect: () => onOpenOverlay({ kind: 'bot-profile', botId: bot.id }),
    },
    {
      id: 'hide',
      label: '从名册隐藏',
      onSelect: () =>
        void report(
          repository.setHidden(bot.id, true),
          `已隐藏“${bot.name}”，可在名册底部“已隐藏”中恢复`,
        ),
    },
  ]
}
