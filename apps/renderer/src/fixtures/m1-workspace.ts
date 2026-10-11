import type { CornAvatarVariantId } from '@corn-bot/contracts/avatar'
import { initialOf } from '../model/names.ts'
import type {
  BotView,
  ConnectorView,
  FeedItem,
  PermissionRow,
  WorkspaceSnapshot,
} from '../model/workspace.ts'

/**
 * M1 fixture mirroring the maintainer's reference screenshots. It is display
 * data only: no Bot exists, no model was called and nothing was delivered.
 */

/** Fixture ids are catalog role ids, so each Bot stores its own role look. */
const bot = (
  id: CornAvatarVariantId,
  name: string,
  summary: string,
  hue: number,
  role: string,
  tagIds: readonly string[] = [],
): BotView => ({
  id,
  name,
  summary,
  avatar: { initial: initialOf(name), hue, variantId: id },
  role,
  workStyle: '',
  tagIds,
  modelOverride: null,
  activity: 'idle',
  unread: false,
  revision: 1,
  origin: 'fixture',
})

const BOTS: readonly BotView[] = [
  bot(
    'xiaohuang',
    '小黄',
    '已经安排好了。',
    42,
    '总调度：理解你的需求，拆分任务并转交给合适的 Bot',
  ),
  bot(
    'ops',
    '运维管家',
    '音视频质检环境装好了，放在 /opt/av-tools',
    0,
    '维护运行环境和工具链',
  ),
  bot(
    'backend',
    '后端工程师',
    '我的头像已经换回默认的了。',
    174,
    '后端接口与数据处理',
  ),
  bot(
    'frontend',
    '前端工程师',
    '我把 16 张精细版头像重画完了，已经替换',
    168,
    '前端界面与视觉资产',
  ),
  bot(
    'architect',
    '架构师',
    '好的，我先待命。有设计或评审要做的时候叫我',
    24,
    '架构设计与技术评审',
  ),
  bot('news', '资讯专员', 'AI 早报 · 10月10日', 30, '每日 AI 资讯整理'),
  bot(
    'excel',
    'Excel专员',
    '头像已经恢复成默认了。',
    214,
    '表格整理与数据分析',
  ),
  bot('cad', 'CAD专员', '头像已经恢复成默认了。', 150, 'CAD 图纸查看与转换'),
  bot(
    'word',
    'Word专员',
    '小黄说你改主意了，所以我的头像已经换回来了',
    22,
    'Word 文档排版',
  ),
  bot(
    'pdf',
    'PDF专员',
    '我按小黄转达的新安排，把头像恢复成默认了',
    0,
    'PDF 整理与转换',
  ),
  bot(
    'ppt',
    'PPT专员',
    '我按小黄刚才转达的意思，把头像改回默认了',
    0,
    'PPT 制作',
  ),
  bot(
    'wechat',
    '公众号运营',
    '稿子已经交给你审了。',
    268,
    '公众号文章撰写与排版',
    ['tag-content'],
  ),
  bot(
    'video',
    '视频专员',
    '等稿子定了我再开始做解说视频。',
    36,
    '解说视频制作',
    ['tag-content'],
  ),
]

const XIAOHUANG_FEED: readonly FeedItem[] = [
  {
    kind: 'message',
    id: 'm1',
    author: 'bot',
    paragraphs: [
      '已经交给公众号运营了。我给的分工是：human-writing 负责把关材料是否真实、执行禁用套路的规则，最后再跑检查脚本；khazix-writer 负责长文的结构和节奏。两边规则冲突时，以 human-writing 为准。khazix-writer 只借它的写法，不模仿卡兹克本人的口头禅和经历，写出来还是你自己的声音。它会拿 Grok 那篇的开头做个前后对比，我收到后发你看。',
    ],
  },
  { kind: 'divider', id: 'd1', label: '今天 10:11' },
  {
    kind: 'attachment-placeholder',
    id: 'a1',
    author: 'user',
    width: 116,
    height: 180,
  },
  {
    kind: 'message',
    id: 'm2',
    author: 'user',
    paragraphs: [
      '这是马斯克刚刚发布的，嘲讽印度的帖子，你要把这个消息做成公众号文章，把这一趣闻的前因后果也给出来。然后交给视频专员，让他根据这个做个解说视频',
    ],
  },
  {
    kind: 'message',
    id: 'm3',
    author: 'bot',
    paragraphs: [
      '好，先让公众号运营去核实这条帖子的原文，把前因后果查清楚再写文章。稿子你审过之后，再交给视频专员做解说视频。',
    ],
  },
  { kind: 'handoff', id: 'h1', botIds: ['wechat', 'video'] },
  {
    kind: 'message',
    id: 'm4',
    author: 'bot',
    paragraphs: [
      '已经安排好了。提醒一个细节：帖子里的"安巴尼"应该是印度首富、电信公司 Jio 的老板穆克什·安巴尼，不是印度总理，那句"印度真正的老板"是在讽刺他，矛头未必是印度本身。所以我让公众号运营先找到英文原帖核实，标题和角度按事实来定。',
      '文章会把来龙去脉讲清楚：Starlink 进入印度时卡在牌照和频谱怎么分配上，Jio 等运营商是什么立场，以及发帖后各方的反应。你审过以后，它会把定稿交给视频专员做解说视频，配音和配乐由视频专员按新规范找音频专员。',
      '另外 khazix-writer 已经接上了，跟 human-writing 怎么配合也写进了公众号运营的写作流程，这篇就会按新流程来写。',
    ],
  },
]

const READ_ONLY_PERMISSION_NOTE = '权限变更在 M2 接入 Claw Policy 后开放'

const permissions = (computer: 'ask' | 'deny'): readonly PermissionRow[] => [
  {
    capability: 'files.read',
    label: '读取工作区文件',
    effective: 'allow',
    ceiling: 'allow',
    note: READ_ONLY_PERMISSION_NOTE,
  },
  {
    capability: 'files.write',
    label: '修改工作区文件',
    effective: 'ask',
    ceiling: 'ask',
    note: '硬上限：每次修改都需要你确认',
  },
  {
    capability: 'shell.exec',
    label: '运行终端命令',
    effective: 'ask',
    ceiling: 'ask',
    note: '硬上限：每次运行都需要你确认',
  },
  {
    capability: 'network.fetch',
    label: '访问网络',
    effective: 'allow',
    ceiling: 'allow',
    note: READ_ONLY_PERMISSION_NOTE,
  },
  {
    capability: 'computer.control',
    label: '控制电脑',
    effective: computer,
    ceiling: 'ask',
    note: '电脑控制在 M3 接通',
  },
]

const CONNECTORS: readonly ConnectorView[] = [
  {
    id: 'github',
    name: 'GitHub',
    description: '读取仓库、Issue 和 Pull Request',
    state: 'disconnected',
    unavailable: '连接器授权在 M7 接入',
  },
  {
    id: 'feishu',
    name: '飞书',
    description: '读取文档和消息',
    state: 'disconnected',
    unavailable: '连接器授权在 M7 接入',
  },
  {
    id: 'notion',
    name: 'Notion',
    description: '读取和整理页面',
    state: 'disconnected',
    unavailable: '连接器授权在 M7 接入',
  },
]

const conversation = (botId: string, items: readonly FeedItem[] = []) => ({
  botId,
  state: 'ready' as const,
  readOnly: false,
  items,
})

export const M1_INITIAL_BOT_ID = 'xiaohuang'

export function m1FixtureSnapshot(): WorkspaceSnapshot {
  return {
    roster: {
      pinnedBotIds: ['xiaohuang'],
      hiddenBotIds: [],
      groups: [
        {
          id: 'tech',
          label: '技术组',
          botIds: ['ops', 'backend', 'frontend', 'architect'],
        },
        {
          id: 'office',
          label: '办公组',
          botIds: ['news', 'excel', 'cad', 'word', 'pdf', 'ppt'],
        },
        {
          id: 'content',
          label: '内容组',
          botIds: ['wechat', 'video'],
        },
      ],
      bots: Object.fromEntries(BOTS.map((entry) => [entry.id, entry])),
      tags: {
        'tag-dispatch': { id: 'tag-dispatch', label: '调度' },
        'tag-content': { id: 'tag-content', label: '内容' },
      },
      account: { initial: '老', hue: 0 },
    },
    conversations: Object.fromEntries(
      BOTS.map((entry) => [
        entry.id,
        conversation(
          entry.id,
          entry.id === M1_INITIAL_BOT_ID ? XIAOHUANG_FEED : [],
        ),
      ]),
    ),
    models: {
      catalog: [
        {
          id: 'deepseek-chat',
          label: 'DeepSeek Chat',
          provider: 'deepseek-official',
          available: true,
        },
        {
          id: 'deepseek-reasoner',
          label: 'DeepSeek Reasoner',
          provider: 'deepseek-official',
          available: true,
        },
        {
          id: 'mimo-v2-pro',
          label: 'MiMo V2 Pro',
          provider: 'xiaomi-token-plan-cn',
          available: false,
        },
      ],
      globalDefault: 'deepseek-chat',
    },
    permissions: Object.fromEntries(
      BOTS.map((entry) => [
        entry.id,
        permissions(entry.id === 'ops' ? 'ask' : 'deny'),
      ]),
    ),
    connectors: CONNECTORS,
  }
}
