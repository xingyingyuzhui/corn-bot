import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import {
  applyWorkspaceChange,
  BOT_NAME_MAX,
  type ConversationView,
  DATA_CHANNELS,
  DATA_STATUSES,
  MAX_ID_LENGTH,
  MAX_MESSAGE_LENGTH,
  MAX_MODEL_ID_LENGTH,
  MAX_TAGS_PER_BOT,
  POLICY_PRESETS,
  parseSetUiPref,
  TAG_LABEL_MAX,
  WORKSPACE_CHANNELS,
  WORKSPACE_ERROR_CODES,
  WORKSPACE_EVENTS,
  WORKSPACE_PARSERS,
  type WorkspaceCommandName,
  type WorkspaceSnapshot,
  type WorkspaceState,
} from '../src/workspace.ts'

const LONG_ID = `a${'b'.repeat(MAX_ID_LENGTH)}`
const ID = 'bot_0f8e6a52-7c1d-4e0b-9a43-1d2c3b4a5f60'
const CLIENT_ID = '4b3c2d1e-0f9a-4b8c-8d7e-6f5a4b3c2d1e'

interface CommandCase {
  readonly valid: Record<string, unknown>
  /** What the parser returns for `valid`, when it differs from `valid`. */
  readonly parsed?: Record<string, unknown>
  readonly overlong: ReadonlyArray<readonly [string, unknown]>
  readonly wrongType: ReadonlyArray<readonly [string, unknown]>
}

const CASES: Record<Exclude<WorkspaceCommandName, 'snapshot'>, CommandCase> = {
  createBot: {
    valid: { name: '周报助手', policyPreset: 'research', variantId: 'ppt' },
    overlong: [
      ['name', '字'.repeat(BOT_NAME_MAX + 1)],
      ['name', 'x'.repeat(10_000)],
    ],
    wrongType: [
      ['name', 7],
      ['policyPreset', 'admin'],
      ['policyPreset', ['research']],
      ['variantId', 'unknown-look'],
    ],
  },
  repairBot: {
    valid: { botId: ID },
    overlong: [['botId', LONG_ID]],
    wrongType: [
      ['botId', 1],
      ['botId', ''],
    ],
  },
  sendMessage: {
    valid: { botId: ID, clientId: CLIENT_ID, text: '你好\n\t第二行' },
    overlong: [
      ['text', 'x'.repeat(MAX_MESSAGE_LENGTH + 1)],
      ['clientId', LONG_ID],
      ['botId', LONG_ID],
    ],
    wrongType: [
      ['text', 42],
      ['text', '   \n '],
      ['text', 'a\rb'],
      ['text', 'a\u0000b'],
      ['clientId', null],
    ],
  },
  resend: {
    valid: { botId: ID, messageId: 'msg_1' },
    overlong: [['messageId', LONG_ID]],
    wrongType: [
      ['messageId', 3],
      ['messageId', '../x'],
    ],
  },
  cancelQueued: {
    valid: { botId: ID, messageId: 'msg_1' },
    overlong: [['messageId', LONG_ID]],
    wrongType: [['botId', false]],
  },
  cancelTurn: {
    valid: { botId: ID },
    overlong: [['botId', LONG_ID]],
    wrongType: [['botId', { id: ID }]],
  },
  answerApproval: {
    valid: { botId: ID, handle: 'apr_7', answer: 'allowed-once' },
    overlong: [['handle', LONG_ID]],
    wrongType: [
      ['answer', 'allowed-always'],
      ['answer', 'yes please'],
      ['handle', 7],
    ],
  },
  setPinned: {
    valid: { botId: ID, pinned: true },
    overlong: [['botId', LONG_ID]],
    wrongType: [['pinned', 'true']],
  },
  setHidden: {
    valid: { botId: ID, hidden: false },
    overlong: [['botId', LONG_ID]],
    wrongType: [['hidden', 0]],
  },
  updateBotProfile: {
    valid: {
      botId: ID,
      expectedRevision: 3,
      changes: { name: '新名字', variantId: 'word' },
    },
    overlong: [
      ['changes', { name: 'n'.repeat(BOT_NAME_MAX + 1) }],
      ['botId', LONG_ID],
    ],
    wrongType: [
      ['expectedRevision', '3'],
      ['expectedRevision', 0],
      ['expectedRevision', 1.5],
      ['changes', {}],
      ['changes', { role: '写周报' }],
      ['changes', { name: '新名字', workStyle: '简洁' }],
      ['changes', null],
    ],
  },
  setBotModel: {
    valid: { botId: ID, expectedRevision: 1, modelId: 'deepseek/deepseek-v4' },
    overlong: [['modelId', 'm'.repeat(MAX_MODEL_ID_LENGTH + 1)]],
    wrongType: [
      ['modelId', 7],
      ['modelId', ''],
      ['modelId', { provider: 'p', model: 'm' }],
      ['expectedRevision', -1],
    ],
  },
  createTag: {
    valid: { label: '日常' },
    overlong: [['label', '签'.repeat(TAG_LABEL_MAX + 1)]],
    wrongType: [
      ['label', ['日常']],
      ['label', ' 日常'],
      ['label', ''],
    ],
  },
  setBotTags: {
    valid: { botId: ID, expectedRevision: 2, tagIds: ['tag_1', 'tag_2'] },
    overlong: [
      [
        'tagIds',
        Array.from({ length: MAX_TAGS_PER_BOT + 1 }, (_, i) => `tag_${i}`),
      ],
      ['tagIds', [LONG_ID]],
    ],
    wrongType: [
      ['tagIds', 'tag_1'],
      ['tagIds', ['tag_1', 'tag_1']],
      ['tagIds', [1]],
    ],
  },
  setUiPref: {
    valid: { key: 'selectedBotId', value: ID },
    overlong: [['value', LONG_ID]],
    wrongType: [
      ['key', 'theme'],
      ['value', 1],
    ],
  },
  loadEarlier: {
    valid: { botId: ID },
    overlong: [['botId', LONG_ID]],
    wrongType: [['botId', []]],
  },
}

const parse = (name: WorkspaceCommandName, payload: unknown) =>
  (WORKSPACE_PARSERS[name] as (payload: unknown) => unknown)(payload)

test('closed vocabularies are locked', () => {
  assert.deepEqual(WORKSPACE_ERROR_CODES, [
    'validation',
    'not_found',
    'conflict',
    'stale',
    'unavailable',
    'data_unavailable',
    'runtime_not_ready',
    'model_unavailable',
    'binding_broken',
    'host_error',
  ])
  assert.deepEqual(DATA_STATUSES, [
    'opening',
    'ready',
    'locked',
    'corrupt',
    'from_future',
    'migration_failed',
    'schema_tampered',
    'unavailable',
  ])
  assert.deepEqual(POLICY_PRESETS, ['research', 'developer'])
})

test('every command has one unique channel and one parser', () => {
  const names = Object.keys(WORKSPACE_CHANNELS).toSorted()
  assert.deepEqual(Object.keys(WORKSPACE_PARSERS).toSorted(), names)
  assert.deepEqual(
    Object.keys(CASES).toSorted(),
    names.filter((name) => name !== 'snapshot'),
  )
  const channels = [
    ...Object.values(WORKSPACE_CHANNELS),
    ...Object.values(WORKSPACE_EVENTS),
    ...Object.values(DATA_CHANNELS),
  ]
  assert.equal(new Set(channels).size, channels.length)
  for (const channel of channels)
    assert.match(channel, /^corn:(workspace|data):[a-z]+(-[a-z]+)*$/u)
  assert.ok(Object.isFrozen(WORKSPACE_PARSERS))
})

test('snapshot takes no payload', () => {
  assert.equal(parse('snapshot', undefined), undefined)
  for (const payload of [null, {}, [], 'snapshot', 0])
    assert.equal(parse('snapshot', payload), null)
})

for (const [name, spec] of Object.entries(CASES) as Array<
  [Exclude<WorkspaceCommandName, 'snapshot'>, CommandCase]
>) {
  test(`${name}: valid, missing, extra, overlong and wrong-type payloads`, () => {
    const parsed = parse(name, spec.valid)
    assert.deepEqual(parsed, spec.parsed ?? spec.valid)
    assert.notEqual(parsed, spec.valid, 'rebuilt, not passed through')

    for (const key of Object.keys(spec.valid)) {
      const { [key]: _dropped, ...missing } = spec.valid
      if (name === 'createBot' && key === 'variantId') continue
      assert.equal(parse(name, missing), null, `missing ${key}`)
    }
    for (const extra of ['extra', 'requestId', 'sessionId', 'agentId', 'rpcId'])
      assert.equal(
        parse(name, { ...spec.valid, [extra]: 'x' }),
        null,
        `extra ${extra}`,
      )
    for (const [key, value] of spec.overlong)
      assert.equal(
        parse(name, { ...spec.valid, [key]: value }),
        null,
        `overlong ${key}`,
      )
    for (const [key, value] of spec.wrongType)
      assert.equal(
        parse(name, { ...spec.valid, [key]: value }),
        null,
        `wrong ${key}=${JSON.stringify(value)}`,
      )
    const shapes = [
      undefined,
      null,
      'x',
      [spec.valid],
      Object.assign(Object.create(null), spec.valid),
      new (class Payload {})(),
    ]
    for (const [index, payload] of shapes.entries())
      assert.equal(parse(name, payload), null, `shape #${index}`)
  })
}

test('createBot: variant is optional, names count user-perceived characters', () => {
  assert.deepEqual(
    parse('createBot', { name: 'A', policyPreset: 'developer' }),
    {
      name: 'A',
      policyPreset: 'developer',
    },
  )
  const family = '👨‍👩‍👧'
  assert.ok(
    parse('createBot', {
      name: family.repeat(BOT_NAME_MAX),
      policyPreset: 'research',
    }),
  )
  for (const name of [' 周报', '周报 ', 'a\nb', 'a\u2028b', 'a\u0007b'])
    assert.equal(parse('createBot', { name, policyPreset: 'research' }), null)
  for (const key of ['role', 'workStyle', 'groupId'])
    assert.equal(
      parse('createBot', { name: 'A', policyPreset: 'research', [key]: '' }),
      null,
      key,
    )
})

test('sendMessage: no attachments, length limit is inclusive', () => {
  const base = { botId: ID, clientId: CLIENT_ID }
  assert.ok(
    parse('sendMessage', { ...base, text: 'x'.repeat(MAX_MESSAGE_LENGTH) }),
  )
  assert.equal(
    parse('sendMessage', { ...base, text: 'hi', attachments: [] }),
    null,
  )
})

test('updateBotProfile keeps only the fields given', () => {
  assert.deepEqual(
    parse('updateBotProfile', {
      botId: ID,
      expectedRevision: 1,
      changes: { variantId: 'cad' },
    }),
    { botId: ID, expectedRevision: 1, changes: { variantId: 'cad' } },
  )
})

test('setBotModel: null follows the global default', () => {
  assert.deepEqual(
    parse('setBotModel', { botId: ID, expectedRevision: 4, modelId: null }),
    { botId: ID, expectedRevision: 4, modelId: null },
  )
})

test('setBotTags copies the list and accepts an empty one', () => {
  const tagIds = ['tag_1']
  const parsed = parse('setBotTags', { botId: ID, expectedRevision: 1, tagIds })
  assert.notEqual((parsed as { tagIds: unknown }).tagIds, tagIds)
  assert.deepEqual(
    parse('setBotTags', { botId: ID, expectedRevision: 1, tagIds: [] }),
    { botId: ID, expectedRevision: 1, tagIds: [] },
  )
})

test('setUiPref validates each whitelisted key against its own type', () => {
  assert.deepEqual(parseSetUiPref({ key: 'selectedBotId', value: null }), {
    key: 'selectedBotId',
    value: null,
  })
  assert.deepEqual(parseSetUiPref({ key: 'detailsOpen', value: true }), {
    key: 'detailsOpen',
    value: true,
  })
  assert.deepEqual(parseSetUiPref({ key: 'sidebarCollapsed', value: false }), {
    key: 'sidebarCollapsed',
    value: false,
  })
  for (const payload of [
    { key: 'detailsOpen', value: 'yes' },
    { key: 'sidebarCollapsed', value: null },
    { key: 'selectedBotId', value: false },
    { key: 'toString', value: true },
    { key: '__proto__', value: true },
  ])
    assert.equal(parseSetUiPref(payload), null, JSON.stringify(payload))
})

const conversation = (botId: string, text: string): ConversationView => ({
  botId,
  state: 'ready',
  readOnly: false,
  items: [{ kind: 'notice', id: `${botId}-n`, tone: 'info', text }],
})

const STATE: WorkspaceState = {
  revision: 7,
  uiPrefs: { selectedBotId: 'a', detailsOpen: false, sidebarCollapsed: false },
  workspace: {
    roster: {
      pinnedBotIds: [],
      hiddenBotIds: [],
      groups: [],
      bots: {},
      tags: {},
      account: { initial: 'Q', hue: 40 },
    },
    conversations: { a: conversation('a', 'old a'), b: conversation('b', 'b') },
    models: { catalog: [], globalDefault: null },
    permissions: {},
    connectors: [],
  } satisfies WorkspaceSnapshot,
}

test('a pushed change applies only at the next revision and merges per Bot', () => {
  const next = applyWorkspaceChange(STATE, {
    revision: 8,
    conversations: { a: conversation('a', 'new a') },
    uiPrefs: { selectedBotId: 'b', detailsOpen: true, sidebarCollapsed: false },
  })
  assert.ok(next)
  assert.equal(next.revision, 8)
  assert.equal(next.workspace.conversations.a?.items[0]?.kind, 'notice')
  assert.deepEqual(next.workspace.conversations.a, conversation('a', 'new a'))
  assert.equal(next.workspace.conversations.b, STATE.workspace.conversations.b)
  assert.equal(next.workspace.roster, STATE.workspace.roster)
  assert.equal(next.uiPrefs.selectedBotId, 'b')
  assert.deepEqual(STATE.workspace.conversations.a, conversation('a', 'old a'))

  for (const revision of [7, 9, 6])
    assert.equal(applyWorkspaceChange(STATE, { revision }), null, `${revision}`)
})

const PRELOAD = new URL(
  '../../../apps/desktop/src/preload.cts',
  import.meta.url,
)

test('the preload exposes every workspace channel and the change subscription', {
  todo: 'W1 wires the workspace bridge into the preload',
}, async () => {
  const preload = await readFile(PRELOAD, 'utf8')
  for (const [method, channel] of Object.entries(WORKSPACE_CHANNELS)) {
    assert.ok(preload.includes(`'${channel}'`), channel)
    assert.match(preload, new RegExp(`\\b${method}: `, 'u'))
  }
  assert.ok(preload.includes(`'${WORKSPACE_EVENTS.changed}'`))
  assert.match(preload, /\bonChanged: /u)
  assert.doesNotMatch(preload, /ipcRenderer\.(send|sendSync)\b/u)
})

test('the preload exposes the data status channel', async () => {
  const preload = await readFile(PRELOAD, 'utf8')
  assert.ok(preload.includes(`'${DATA_CHANNELS.status}'`))
  assert.match(preload, /\bdataStatus: /u)
})
