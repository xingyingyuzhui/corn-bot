import type {
  ConversationView,
  FeedItem,
  WorkspaceSnapshot,
} from '../model/workspace.ts'
import {
  type FixtureOptions,
  FixtureWorkspaceRepository,
} from './fixture-repository.ts'
import { M1_INITIAL_BOT_ID, m1FixtureSnapshot } from './m1-workspace.ts'

/** Answering this request settles it as `cancelled`, like a late DSH reply. */
export const UI_STATES_STALE_HANDLE = 'req-2'

/** Conversations that show the non-ready states, by Bot id. */
export const UI_STATES_BOTS = {
  readOnly: 'news',
  loading: 'excel',
  error: 'cad',
} as const

/** Dev-route states that the reference screenshots do not show. */
const STATE_ITEMS: readonly FeedItem[] = [
  {
    kind: 'approval',
    id: 'approval-1',
    handle: 'req-1',
    title: '运行终端命令',
    detail: 'pnpm install --frozen-lockfile',
    status: 'pending',
  },
  {
    kind: 'approval',
    id: 'approval-2',
    handle: UI_STATES_STALE_HANDLE,
    title: '修改工作区文件',
    detail: 'apps/renderer/src/styles/tokens.css',
    status: 'pending',
  },
  {
    kind: 'notice',
    id: 'notice-info',
    tone: 'info',
    text: '小黄已切换到 DeepSeek Reasoner（示例）',
  },
  {
    kind: 'message',
    id: 'state-queued',
    author: 'user',
    paragraphs: ['把这两份截图也一起发给前端工程师看看'],
    attachments: [
      { id: 'att-1', name: '首页-双栏.png', size: 482_133 },
      { id: 'att-2', name: '首页-三栏.png', size: 517_904 },
    ],
    delivery: 'queued',
  },
  {
    kind: 'message',
    id: 'state-dispatching',
    author: 'user',
    paragraphs: ['好的，就按这个来'],
    delivery: 'dispatching',
  },
  {
    kind: 'message',
    id: 'state-failed',
    author: 'user',
    paragraphs: ['稿子写好以后先发我看一眼'],
    delivery: 'failed',
    failure: '发送失败：连接 Bot 超时',
  },
  {
    kind: 'notice',
    id: 'notice-error',
    tone: 'error',
    text: '小黄的运行环境异常退出，正在等待重新连接（示例）',
  },
]

const NEWS_ITEMS: readonly FeedItem[] = [
  { kind: 'divider', id: 'news-d1', label: '10月10日 08:00' },
  {
    kind: 'message',
    id: 'news-m1',
    author: 'bot',
    paragraphs: [
      'AI 早报 · 10月10日',
      '这是一份已归档的示例早报，只能查看，不能继续对话。',
    ],
  },
]

const withState = (
  conversation: ConversationView | undefined,
  patch: Partial<ConversationView>,
): ConversationView => {
  if (!conversation) throw new Error('Fixture is missing a conversation')
  return { ...conversation, ...patch }
}

export function uiStatesSnapshot(): WorkspaceSnapshot {
  const base = m1FixtureSnapshot()
  const { conversations } = base
  const home = conversations[M1_INITIAL_BOT_ID]
  return {
    ...base,
    conversations: {
      ...conversations,
      [M1_INITIAL_BOT_ID]: withState(home, {
        items: [...(home?.items ?? []), ...STATE_ITEMS],
      }),
      [UI_STATES_BOTS.readOnly]: withState(
        conversations[UI_STATES_BOTS.readOnly],
        { readOnly: true, items: NEWS_ITEMS },
      ),
      [UI_STATES_BOTS.loading]: withState(
        conversations[UI_STATES_BOTS.loading],
        { state: 'loading' },
      ),
      [UI_STATES_BOTS.error]: withState(conversations[UI_STATES_BOTS.error], {
        state: 'error',
      }),
    },
  }
}

export function createUiStatesRepository(
  options: Pick<FixtureOptions, 'latencyMs'> = {},
): FixtureWorkspaceRepository {
  return new FixtureWorkspaceRepository(uiStatesSnapshot(), {
    latencyMs: options.latencyMs ?? 600,
    staleHandles: [UI_STATES_STALE_HANDLE],
  })
}
