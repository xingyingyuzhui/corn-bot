import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  botBrief,
  buildRestrictedExport,
  EXCLUDED_CATEGORIES,
  REDACTED_PATH,
  REDACTED_SECRET,
  redactText,
} from '../src/features/bot-editor/share-export.ts'
import { m1FixtureSnapshot } from '../src/fixtures/m1-workspace.ts'
import type { BotView, WorkspaceSnapshot } from '../src/model/workspace.ts'

const snapshot = m1FixtureSnapshot()
const botOf = (id: string): BotView => {
  const bot = snapshot.roster.bots[id]
  if (!bot) throw new Error(`fixture Bot ${id} missing`)
  return bot
}

const withBot = (bot: BotView): WorkspaceSnapshot => ({
  ...snapshot,
  roster: {
    ...snapshot.roster,
    bots: { ...snapshot.roster.bots, [bot.id]: bot },
  },
})

test('the fixture ops summary loses its absolute path', () => {
  const result = buildRestrictedExport(botOf('ops'), snapshot)
  assert.ok(!result.json.includes('/opt'))
  assert.ok(result.json.includes(REDACTED_PATH))
  assert.equal(result.redactions, 1)
  const summary = result.included.find((field) => field.key === 'summary')
  assert.equal(summary?.value, `音视频质检环境装好了，放在 ${REDACTED_PATH}`)
})

test('included fields are exactly the allow-list', () => {
  const result = buildRestrictedExport(botOf('xiaohuang'), snapshot)
  assert.deepEqual(
    result.included.map((field) => field.key),
    ['name', 'role', 'workStyle', 'summary', 'tags', 'model'],
  )
  const parsed = JSON.parse(result.json) as {
    format: string
    version: number
    bot: Record<string, unknown>
  }
  assert.equal(parsed.format, 'corn-bot/restricted-profile')
  assert.deepEqual(Object.keys(parsed.bot).sort(), [
    'model',
    'name',
    'role',
    'summary',
    'tags',
    'workStyle',
  ])
  assert.deepEqual(parsed.bot.tags, ['调度'])
  assert.equal(parsed.bot.model, null)
})

test('excluded categories never reach the export', () => {
  const bot = botOf('xiaohuang')
  const result = buildRestrictedExport(bot, snapshot)
  assert.deepEqual(
    result.excluded.map((entry) => entry.id),
    [
      'memory',
      'conversations',
      'api-keys',
      'credentials',
      'absolute-paths',
      'policy',
      'workspace',
    ],
  )
  const conversation = snapshot.conversations[bot.id]
  for (const item of conversation?.items ?? [])
    if (item.kind === 'message')
      for (const paragraph of item.paragraphs)
        assert.ok(!result.json.includes(paragraph.slice(0, 12)))
  for (const row of snapshot.permissions[bot.id] ?? []) {
    assert.ok(!result.json.includes(row.capability))
    assert.ok(!result.json.includes(row.note))
  }
  for (const key of [
    'id',
    'revision',
    'origin',
    'avatar',
    'permissions',
    'conversations',
    'memory',
  ])
    assert.ok(!result.json.includes(`"${key}"`), key)
})

test('secrets and every path shape are redacted from free text', () => {
  const leaky: BotView = {
    ...botOf('backend'),
    role: '用 sk-abcdef1234567890 调用，备用 tp-9f8e7d6c5b4a',
    workStyle:
      '日志写到 /Users/qin/logs/app.log 和 ~/secrets/keys，Windows 是 C:\\Users\\qin\\corn',
    summary:
      'token: abc123 password=hunter2 hash 0123456789abcdef0123456789abcdef 以及 QmFzZTY0VG9rZW5XaXRoRGlnaXRzMTIzNDU2Nzg5',
  }
  const result = buildRestrictedExport(leaky, withBot(leaky))
  for (const secret of [
    'sk-abc',
    'tp-9f8e',
    '/Users',
    '~/secrets',
    'C:\\',
    'abc123',
    'hunter2',
    '0123456789abcdef',
    'QmFzZTY0',
  ])
    assert.ok(!result.json.includes(secret), secret)
  assert.ok(result.json.includes(REDACTED_SECRET))
  assert.ok(result.json.includes(REDACTED_PATH))
  assert.equal(result.redactions, 9)
})

test('ordinary text, dates, ratios and URLs survive redaction', () => {
  for (const text of [
    'AI 早报 · 10月10日',
    '读/写 两种权限，比例 1/2',
    '参考 https://example.com/docs 的说明',
    '前端界面与视觉资产',
    'task-force 与 desk-top 不是密钥',
  ])
    assert.deepEqual(redactText(text), { text, redactions: 0 })
})

test('an unknown model override is kept as a redacted id, never resolved', () => {
  const bot: BotView = { ...botOf('cad'), modelOverride: 'mimo-v2-pro' }
  const result = buildRestrictedExport(bot, withBot(bot))
  const parsed = JSON.parse(result.json) as { bot: { model: string } }
  assert.equal(parsed.bot.model, 'mimo-v2-pro')
  assert.equal(
    result.included.find((field) => field.key === 'model')?.value,
    'MiMo V2 Pro',
  )
})

test('excluded list is stable and explains each category', () => {
  for (const category of EXCLUDED_CATEGORIES) {
    assert.ok(category.label.length > 0)
    assert.ok(category.reason.length > 0)
  }
})

test('Bot brief carries name, role, work style and tag labels', () => {
  const bot: BotView = { ...botOf('wechat'), workStyle: '先列提纲再写' }
  assert.equal(
    botBrief(bot, snapshot.roster.tags),
    '公众号运营\n职责：公众号文章撰写与排版\n工作风格：先列提纲再写\n标签：内容',
  )
  assert.equal(
    botBrief(botOf('ops'), snapshot.roster.tags),
    '运维管家\n职责：维护运行环境和工具链',
  )
})
