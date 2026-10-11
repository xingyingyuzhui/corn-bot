import type {
  BotView,
  TagView,
  WorkspaceSnapshot,
} from '../../model/workspace.ts'

export const REDACTED_PATH = '[已移除路径]'
export const REDACTED_SECRET = '[已移除密钥]'

const STOP = String.raw`\s'"\x60<>，。；：！？、,;)）\]}`

/**
 * Secrets go first: a base64 token may contain `/` and would otherwise be
 * half-matched as a path.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  /\b(api[_-]?key|access[_-]?token|token|secret|password|passwd|pwd)(["']?\s*[:=]\s*["']?)[^\s,;，；"']+/giu,
  /\bBearer\s+[\w.~+/-]+=*/gu,
  /\bBasic\s+[A-Za-z0-9+/]{8,}={0,2}/gu,
  /\beyJ[\w-]+\.[\w-]+\.[\w-]+/gu,
  /\b(?:sk|tp|pk|rk)-[\w-]{6,}/gu,
  /\bgh[pousr]_\w{20,}/gu,
  /\bxox[abprs]-[\w-]{10,}/gu,
  /\bAKIA[0-9A-Z]{16}\b/gu,
  /\b[0-9a-f]{32,}\b/giu,
  /(?<![\w+/=-])(?=[\w+/=-]*\d)(?=[\w+/=-]*[A-Za-z])[\w+/-]{32,}={0,2}/gu,
]

/** A path keeps going across spaces while the next word still holds a separator. */
const unixTail = String.raw`(?:[ \t]+[^${STOP}]*\/[^${STOP}]*)*`
const windowsTail = String.raw`(?:[ \t]+[^${STOP}]*\\[^${STOP}]*)*`

const PATH_PATTERNS: readonly RegExp[] = [
  /\bfile:\/\/\S+/giu,
  /** `读/写` stays: a path segment must start with an ASCII name character. */
  new RegExp(
    String.raw`(?<![\w.:/~\\-])~?\/[\w.@~-][^${STOP}]*${unixTail}`,
    'gu',
  ),
  new RegExp(String.raw`\b[A-Za-z]:\\[^${STOP}]*${windowsTail}`, 'gu'),
  new RegExp(String.raw`(?<![\w\\])\\\\[^${STOP}]+${windowsTail}`, 'gu'),
]

export interface Redacted {
  readonly text: string
  readonly redactions: number
}

/**
 * Removes absolute paths and anything that looks like a credential from free
 * text. It errs on the side of removing too much: a false positive costs a
 * word, a false negative leaks a path or key.
 */
export function redactText(input: string): Redacted {
  let redactions = 0
  let text = input
  for (const pattern of SECRET_PATTERNS)
    text = text.replace(pattern, (_match, key?: string, separator?: string) => {
      redactions += 1
      return typeof key === 'string' && typeof separator === 'string'
        ? `${key}${separator}${REDACTED_SECRET}`
        : REDACTED_SECRET
    })
  for (const pattern of PATH_PATTERNS)
    text = text.replace(pattern, () => {
      redactions += 1
      return REDACTED_PATH
    })
  return { text, redactions }
}

export type IncludedFieldKey =
  | 'name'
  | 'role'
  | 'workStyle'
  | 'summary'
  | 'tags'
  | 'model'

export interface IncludedField {
  readonly key: IncludedFieldKey
  readonly label: string
  /** Redacted display value; empty when the Bot has nothing for this field. */
  readonly value: string
}

export type ExcludedCategoryId =
  | 'memory'
  | 'conversations'
  | 'api-keys'
  | 'credentials'
  | 'absolute-paths'
  | 'policy'
  | 'workspace'

export interface ExcludedCategory {
  readonly id: ExcludedCategoryId
  readonly label: string
  readonly reason: string
}

export const EXCLUDED_CATEGORIES: readonly ExcludedCategory[] = [
  { id: 'memory', label: '记忆（Memory）', reason: '长期记忆只属于本机的 Bot' },
  {
    id: 'conversations',
    label: '对话记录',
    reason: '聊天内容和附件不随配置导出',
  },
  { id: 'api-keys', label: 'API Key', reason: '模型和服务密钥从不导出' },
  { id: 'credentials', label: '凭据', reason: '登录信息与授权令牌从不导出' },
  {
    id: 'absolute-paths',
    label: '绝对路径',
    reason: '文本里的本机路径会替换为占位符',
  },
  {
    id: 'policy',
    label: '内部策略细节',
    reason: '权限级别、硬上限和策略规则不导出',
  },
  {
    id: 'workspace',
    label: '工作区内容',
    reason: '文件、资料库和电脑画面不导出',
  },
]

export const RESTRICTED_EXPORT_FORMAT = 'corn-bot/restricted-profile'

export interface RestrictedExport {
  readonly included: readonly IncludedField[]
  readonly excluded: readonly ExcludedCategory[]
  /** How many paths or secret-like tokens were removed from free text. */
  readonly redactions: number
  readonly json: string
}

const tagLabels = (bot: BotView, tags: Readonly<Record<string, TagView>>) =>
  bot.tagIds.flatMap((id) => {
    const tag = tags[id]
    return tag ? [tag.label] : []
  })

/**
 * Builds the shareable profile from an allow-list of fields. Nothing outside
 * the allow-list is read, so new snapshot data can never leak into an export
 * by default.
 */
export function buildRestrictedExport(
  bot: BotView,
  snapshot: Pick<WorkspaceSnapshot, 'roster' | 'models'>,
): RestrictedExport {
  let redactions = 0
  const clean = (value: string) => {
    const result = redactText(value)
    redactions += result.redactions
    return result.text
  }
  const name = clean(bot.name)
  const role = clean(bot.role)
  const workStyle = clean(bot.workStyle)
  const summary = clean(bot.summary)
  const tags = tagLabels(bot, snapshot.roster.tags).map(clean)
  const model =
    bot.modelOverride === null
      ? null
      : (snapshot.models.catalog.find((entry) => entry.id === bot.modelOverride)
          ?.id ?? clean(bot.modelOverride))
  const modelLabel =
    model === null
      ? '跟随导入方的全局默认模型'
      : (snapshot.models.catalog.find((entry) => entry.id === model)?.label ??
        model)

  const included: readonly IncludedField[] = [
    { key: 'name', label: '名称', value: name },
    { key: 'role', label: '职责', value: role },
    { key: 'workStyle', label: '工作风格', value: workStyle },
    { key: 'summary', label: '简介', value: summary },
    { key: 'tags', label: '标签', value: tags.join('、') },
    { key: 'model', label: '模型偏好', value: modelLabel },
  ]
  const json = JSON.stringify(
    {
      format: RESTRICTED_EXPORT_FORMAT,
      version: 1,
      bot: { name, role, workStyle, summary, tags, model },
    },
    null,
    2,
  )
  return { included, excluded: EXCLUDED_CATEGORIES, redactions, json }
}

/** Plain-text card for "复制 Bot 简介"; free text is redacted the same way. */
export function botBrief(
  bot: BotView,
  tags: Readonly<Record<string, TagView>>,
): string {
  const labels = tagLabels(bot, tags)
  return [
    redactText(bot.name).text,
    `职责：${redactText(bot.role).text || '未填写'}`,
    bot.workStyle.trim() ? `工作风格：${redactText(bot.workStyle).text}` : null,
    labels.length
      ? `标签：${labels.map((l) => redactText(l).text).join('、')}`
      : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
}
