import type { BotOrigin } from '../../model/workspace.ts'

export const MOCK_CREATED_NOTE = '未创建真实 Claw Agent，M2 接通'

/** Locally created sample Bots must say so wherever they are listed. */
export function BotOriginBadge({ origin }: { readonly origin: BotOrigin }) {
  if (origin !== 'mock-created') return null
  return (
    <span className="corn-origin-badge" title={MOCK_CREATED_NOTE}>
      示例
      <span className="corn-visually-hidden">，{MOCK_CREATED_NOTE}</span>
    </span>
  )
}
