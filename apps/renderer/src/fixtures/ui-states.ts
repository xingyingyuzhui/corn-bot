import type { FeedItem, WorkspaceSnapshot } from '../model/workspace.ts'
import { FixtureWorkspaceRepository } from './fixture-repository.ts'
import { M1_INITIAL_BOT_ID, m1FixtureSnapshot } from './m1-workspace.ts'

/** Dev-route states that the reference screenshots do not show. */
const STATE_ITEMS: readonly FeedItem[] = [
  {
    kind: 'approval',
    id: 'approval-1',
    requestId: 'req-1',
    title: '运行终端命令',
    detail: 'pnpm install --frozen-lockfile',
    status: 'pending',
  },
]

export function uiStatesSnapshot(): WorkspaceSnapshot {
  const base = m1FixtureSnapshot()
  const home = base.conversations[M1_INITIAL_BOT_ID]
  if (!home) throw new Error('Fixture is missing its initial conversation')
  return {
    ...base,
    conversations: {
      ...base.conversations,
      [M1_INITIAL_BOT_ID]: { ...home, items: [...home.items, ...STATE_ITEMS] },
    },
  }
}

export function createUiStatesRepository(): FixtureWorkspaceRepository {
  return new FixtureWorkspaceRepository(uiStatesSnapshot(), { latencyMs: 600 })
}
