import { Fragment } from 'react'
import type { BotView } from '../../model/workspace.ts'
import { Avatar } from '../../shared/Avatar.tsx'

interface HandoffNoticeProps {
  readonly bots: Readonly<Record<string, BotView>>
  readonly botIds: readonly string[]
}

/** A delivery event between Bots, not a Bot reply. */
export function HandoffNotice({ bots, botIds }: HandoffNoticeProps) {
  const targets = botIds.flatMap((id) => {
    const bot = bots[id]
    return bot ? [bot] : []
  })
  return (
    <p className="corn-handoff">
      已发消息给
      {targets.map((bot, index) => (
        <Fragment key={bot.id}>
          {index > 0 ? <span>和</span> : null}
          <span className="corn-handoff__bot">
            <Avatar spec={bot.avatar} size={14} />
            {bot.name}
          </span>
        </Fragment>
      ))}
    </p>
  )
}
