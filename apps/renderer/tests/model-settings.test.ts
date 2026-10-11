import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  type CredentialState,
  MODEL_SETTINGS_ERROR_CODES,
  MODEL_STATUS_REASONS,
  MODEL_STATUSES,
  type ModelProviderView,
  type ModelSettingsBridge,
  type ModelSettingsSnapshot,
} from '@corn-bot/contracts/model-settings'
import {
  addableProviders,
  type CustomProviderDraft,
  credentialLabel,
  defaultModelOptions,
  emptyCustomDraft,
  errorText,
  INITIAL_PAGE,
  keyError,
  type ModelSettingsPageState,
  modelStatusText,
  type Operation,
  type PageAction,
  pageReducer,
  providerActions,
  providerBadge,
  selectionFor,
  validateCustomDraft,
  visibleProviders,
} from '../src/features/settings/model-settings-controller.ts'
import {
  ModelSettingsFixture,
  modelSettingsFixtureSnapshot,
} from '../src/fixtures/model-settings-fixture.ts'
import { livePort } from '../src/model/model-settings-port.ts'

const FAKE_KEY = 'sk-corn-wp3-FAKE-0000'

const snapshot = modelSettingsFixtureSnapshot()

const provider = (
  patch: Partial<ModelProviderView> = {},
): ModelProviderView => ({
  id: 'p',
  name: 'P',
  kind: 'catalog',
  active: true,
  configured: true,
  settingsWritable: true,
  credential: { kind: 'configured', source: 'stored', writable: true },
  sharesKeyWith: [],
  revision: 1,
  ...patch,
})

/* ── Wording ─────────────────────────────────────────────────────────── */

test('every error code has its own Chinese text and never leaks the code', () => {
  const texts = MODEL_SETTINGS_ERROR_CODES.map((code) => errorText({ code }))
  assert.equal(new Set(texts).size, MODEL_SETTINGS_ERROR_CODES.length)
  for (const [index, text] of texts.entries()) {
    assert.ok(text.length > 0)
    assert.ok(!text.includes(MODEL_SETTINGS_ERROR_CODES[index] as string))
    assert.doesNotMatch(text, /[a-z]+_[a-z]+/u)
  }
  assert.equal(
    errorText({ code: 'stale_generation' }),
    '运行时已重新启动，已重新读取设置，请再试一次',
  )
})

test('a partial write says which step failed, with the cause in words', () => {
  const text = errorText({
    code: 'partially_applied',
    failedStep: 'credential',
    cause: 'read_only',
  })
  assert.match(text, /^提供方配置已保存，密钥未保存：/u)
  assert.match(text, /只读/u)
  assert.match(text, /请重新输入密钥再试$/u)
  assert.doesNotMatch(text, /read_only|_/u)
  assert.match(
    errorText({ code: 'partially_applied', failedStep: 'credential' }),
    /原因未知/u,
  )
  assert.match(
    errorText({
      code: 'partially_applied',
      failedStep: 'provider',
      cause: 'conflict',
    }),
    /^密钥已更新，提供方配置未保存/u,
  )
})

test('credential labels name the source; environment and dev override are read-only', () => {
  const cases: readonly [CredentialState, string][] = [
    [{ kind: 'missing', writable: true }, '未配置'],
    [{ kind: 'configured', source: 'stored', writable: true }, '已保存'],
    [
      { kind: 'configured', source: 'environment', writable: false },
      '由启动环境提供（只读）',
    ],
    [
      { kind: 'configured', source: 'dev_override', writable: false },
      '开发测试覆盖（只读）',
    ],
    [
      { kind: 'configured', source: 'home_env_file', writable: true },
      '由运行时目录的 .env 提供',
    ],
    [{ kind: 'configured', source: 'unknown', writable: true }, '已配置'],
    [{ kind: 'not_required' }, '无需密钥'],
    [{ kind: 'unknown' }, '状态未知'],
  ]
  for (const [state, label] of cases)
    assert.equal(credentialLabel(state), label)
})

test('every model status and reason has wording; the dev override is marked', () => {
  for (const status of MODEL_STATUSES)
    for (const reason of MODEL_STATUS_REASONS) {
      const text = modelStatusText({ status, reason, devOverride: false })
      assert.ok(text.length > 0)
      assert.doesNotMatch(text, /_/u)
      assert.match(
        modelStatusText({ status, reason, devOverride: true }),
        /（开发测试覆盖生效中）$/u,
      )
    }
  assert.equal(
    modelStatusText({
      status: 'needs_configuration',
      reason: 'credential_missing',
      devOverride: false,
    }),
    '模型未配置：默认模型的提供方还没有密钥',
  )
  assert.match(
    modelStatusText({
      status: 'available',
      reason: 'configured',
      devOverride: false,
    }),
    /首次发送时才会真正连接/u,
  )
})

/* ── Badges and actions ──────────────────────────────────────────────── */

test('badge: 可用 needs an active route and a usable key', () => {
  assert.equal(providerBadge(provider()).text, '可用')
  assert.equal(
    providerBadge(provider({ credential: { kind: 'not_required' } })).text,
    '可用',
  )
  assert.equal(
    providerBadge(provider({ credential: { kind: 'missing', writable: true } }))
      .text,
    '未配置',
  )
  assert.equal(providerBadge(provider({ active: false })).text, '不可用')
  assert.equal(
    providerBadge(
      provider({
        active: false,
        configured: false,
        credential: { kind: 'missing', writable: true },
      }),
    ).text,
    '未配置',
  )
})

test('badge: read-only settings or a locked key read 只读 unless usable', () => {
  assert.equal(
    providerBadge(provider({ active: false, settingsWritable: false })).text,
    '只读',
  )
  assert.equal(
    providerBadge(
      provider({ credential: { kind: 'missing', writable: false } }),
    ).text,
    '只读',
  )
  const envKey = provider({
    active: false,
    credential: { kind: 'configured', source: 'environment', writable: false },
  })
  assert.equal(providerBadge(envKey).text, '只读')
  assert.equal(providerBadge({ ...envKey, active: true }).text, '可用')
})

test('read-only providers expose no write actions and say why', () => {
  const env = providerActions(
    provider({
      credential: {
        kind: 'configured',
        source: 'environment',
        writable: false,
      },
    }),
    snapshot,
  )
  assert.deepEqual(
    [env.setKey, env.replaceKey, env.clearKey, env.edit, env.remove],
    [false, false, false, false, false],
  )
  assert.match(env.readOnly ?? '', /启动环境/u)
  const locked = providerActions(provider({ kind: 'custom' }), {
    settingsWritable: false,
  })
  assert.equal(locked.edit, false)
  assert.equal(locked.replaceKey, false)
  assert.ok(locked.readOnly)
  const writable = providerActions(provider({ kind: 'custom' }), snapshot)
  assert.deepEqual(
    [writable.replaceKey, writable.clearKey, writable.edit, writable.remove],
    [true, true, true, true],
  )
  assert.equal(writable.readOnly, null)
})

test('list shows builtin, custom and configured routes; the rest are addable', () => {
  assert.deepEqual(
    visibleProviders(snapshot).map((entry) => entry.id),
    ['deepseek-official', 'local-compatible'],
  )
  assert.deepEqual(
    addableProviders(snapshot).map((entry) => entry.id),
    ['openai', 'xiaomi-token-plan-cn', 'moonshotai'],
  )
})

test('default-model options group by provider and mark a missing key', () => {
  const groups = defaultModelOptions(snapshot)
  assert.deepEqual(
    groups.map((group) => group.providerId),
    ['deepseek-official', 'local-compatible'],
  )
  const deepseek = groups[0]?.options ?? []
  assert.ok(
    deepseek.every((option) => option.label.endsWith('（需要先配置密钥）')),
  )
  assert.ok(deepseek.every((option) => !option.disabled))
  const inactive: ModelSettingsSnapshot = {
    ...snapshot,
    providers: snapshot.providers.map((entry) =>
      entry.id === 'local-compatible' ? { ...entry, active: false } : entry,
    ),
  }
  assert.ok(
    defaultModelOptions(inactive)[1]?.options.every(
      (option) => option.disabled,
    ),
  )
  const value = deepseek[1]?.value ?? ''
  assert.deepEqual(selectionFor(snapshot, value), {
    provider: 'deepseek-official',
    model: 'deepseek-v4-pro',
    reasoningEffort: 'high',
  })
  assert.equal(selectionFor(snapshot, 'nope'), null)
})

/* ── Validation ──────────────────────────────────────────────────────── */

test('key problems: blank, whitespace, pasted env line, quotes, spaces, length', () => {
  assert.equal(keyError(FAKE_KEY), null)
  assert.equal(keyError(`  ${FAKE_KEY}\n`), null)
  assert.equal(keyError(''), '请输入密钥')
  assert.equal(keyError('   '), '密钥不能只包含空白')
  const format = '密钥格式不正确，请重新粘贴'
  assert.equal(keyError(`DEEPSEEK_API_KEY=${FAKE_KEY}`), format)
  assert.equal(keyError(`"${FAKE_KEY}"`), format)
  assert.equal(keyError(`'${FAKE_KEY}'`), format)
  assert.equal(keyError('sk corn fake'), format)
  assert.equal(keyError('x'.repeat(4_097)), '密钥过长')
})

const draft = (
  patch: Partial<CustomProviderDraft> = {},
): CustomProviderDraft => ({
  ...emptyCustomDraft(snapshot),
  routeId: 'my-gateway',
  displayName: '我的网关',
  baseURL: 'https://gateway.example.com/v1',
  models: [{ rowKey: 0, id: 'model-a', name: '' }],
  ...patch,
})

const errorsOf = (
  input: CustomProviderDraft,
  mode: 'create' | 'update' = 'create',
) => {
  const result = validateCustomDraft(input, snapshot, mode)
  return result.ok ? {} : result.errors
}

test('a valid custom draft trims fields and drops empty model rows', () => {
  const result = validateCustomDraft(
    draft({
      displayName: '  我的网关 ',
      models: [
        { rowKey: 0, id: ' model-a ', name: ' A ' },
        { rowKey: 1, id: '', name: '' },
        { rowKey: 2, id: 'model-b', name: '' },
      ],
    }),
    snapshot,
    'create',
  )
  assert.deepEqual(result, {
    ok: true,
    fields: {
      displayName: '我的网关',
      protocol: 'openai-completions',
      baseURL: 'https://gateway.example.com/v1',
      models: [{ id: 'model-a', name: 'A' }, { id: 'model-b' }],
    },
  })
})

test('route ids follow the official pattern and cannot be taken', () => {
  assert.match(errorsOf(draft({ routeId: '' })).routeId ?? '', /请填写/u)
  for (const bad of ['My-Gateway', '1gateway', 'my--gateway', 'my_gateway'])
    assert.match(errorsOf(draft({ routeId: bad })).routeId ?? '', /小写字母/u)
  assert.equal(
    errorsOf(draft({ routeId: 'openai' })).routeId,
    '这个路由 ID 已被使用',
  )
  assert.equal(
    errorsOf(draft({ routeId: 'deepseek-official' })).routeId,
    '这个路由 ID 已被使用',
  )
  assert.equal(errorsOf(draft({ routeId: '' }), 'update').routeId, undefined)
})

test('protocol, URL, name and model rows are validated', () => {
  assert.ok(errorsOf(draft({ protocol: 'grpc' })).protocol)
  for (const url of [
    'ftp://example.com',
    'example.com',
    'https://user:pw@example.com',
    '',
  ])
    assert.ok(errorsOf(draft({ baseURL: url })).baseURL, url)
  assert.ok(errorsOf(draft({ displayName: '   ' })).displayName)
  assert.ok(errorsOf(draft({ displayName: 'x'.repeat(201) })).displayName)
  assert.equal(
    errorsOf(draft({ models: [{ rowKey: 0, id: '', name: '' }] })).models,
    '至少添加一个模型',
  )
  assert.equal(
    errorsOf(draft({ models: [{ rowKey: 0, id: '', name: '名字' }] })).models,
    '模型 ID 不能为空',
  )
  assert.equal(
    errorsOf(
      draft({
        models: [
          { rowKey: 0, id: 'dup', name: '' },
          { rowKey: 1, id: ' dup ', name: '' },
        ],
      }),
    ).models,
    '模型 ID 不能重复：dup',
  )
  const many = Array.from({ length: 65 }, (_, index) => ({
    rowKey: index,
    id: `m${index}`,
    name: '',
  }))
  assert.match(errorsOf(draft({ models: many })).models ?? '', /64/u)
})

/* ── Page reducer ────────────────────────────────────────────────────── */

const run = (...actions: PageAction[]): ModelSettingsPageState =>
  actions.reduce(pageReducer, INITIAL_PAGE)

const ready = (): ModelSettingsPageState =>
  run(
    { type: 'load-start', token: 1 },
    { type: 'load-success', token: 1, snapshot },
  )

const setKey: Operation = { kind: 'set-key', providerId: 'deepseek-official' }
const changed: ModelSettingsSnapshot = { ...snapshot, defaultRevision: 9 }

test('a result from a replaced request is ignored', () => {
  const started = run(
    { type: 'load-start', token: 1 },
    { type: 'load-success', token: 1, snapshot },
    {
      type: 'open-editor',
      editor: { kind: 'key', providerId: 'deepseek-official' },
    },
    { type: 'op-start', token: 2, op: setKey },
  )
  const reloading = pageReducer(started, { type: 'load-start', token: 3 })
  const late = pageReducer(reloading, {
    type: 'op-success',
    token: 2,
    snapshot: changed,
  })
  assert.equal(late, reloading)
  const lateLoad = pageReducer(ready(), {
    type: 'load-success',
    token: 1,
    snapshot: changed,
  })
  assert.equal(lateLoad.snapshot, snapshot)
})

test('a second write while one is in flight is refused', () => {
  const busy = pageReducer(ready(), { type: 'op-start', token: 2, op: setKey })
  const again = pageReducer(busy, {
    type: 'op-start',
    token: 3,
    op: { kind: 'clear-key', providerId: 'local-compatible' },
  })
  assert.equal(again, busy)
  assert.equal(pageReducer(busy, { type: 'close-editor' }), busy)
})

test('a successful write replaces the snapshot, closes the editor and says saved ≠ verified', () => {
  const done = run(
    { type: 'load-start', token: 1 },
    { type: 'load-success', token: 1, snapshot },
    {
      type: 'open-editor',
      editor: { kind: 'key', providerId: 'deepseek-official' },
    },
    { type: 'op-start', token: 2, op: setKey },
    { type: 'op-success', token: 2, snapshot: changed },
  )
  assert.equal(done.snapshot, changed)
  assert.equal(done.editor, null)
  assert.equal(done.busy, null)
  assert.equal(done.notice?.tone, 'ok')
  assert.match(done.notice?.text ?? '', /密钥已保存.*尚未验证/u)
})

test('a partial create keeps the editor open as an update and holds no secret', () => {
  const failed = run(
    { type: 'load-start', token: 1 },
    { type: 'load-success', token: 1, snapshot },
    { type: 'open-editor', editor: { kind: 'custom', mode: 'create' } },
    {
      type: 'op-start',
      token: 2,
      op: { kind: 'save-custom', mode: 'create', providerId: 'my-gateway' },
    },
    {
      type: 'op-fail',
      token: 2,
      error: {
        code: 'partially_applied',
        failedStep: 'credential',
        cause: 'host_error',
      },
    },
  )
  assert.deepEqual(failed.editor, {
    kind: 'custom',
    mode: 'update',
    providerId: 'my-gateway',
  })
  assert.match(failed.editorError ?? '', /^提供方配置已保存，密钥未保存/u)
  assert.equal(failed.notice, null)
  assert.equal(failed.reloadRequested, true)
  assert.doesNotMatch(JSON.stringify(failed), /FAKE|sk-/u)
})

test('a failure snapshot replaces state; without one, uncertain outcomes reload', () => {
  const withSnapshot = run(
    { type: 'load-start', token: 1 },
    { type: 'load-success', token: 1, snapshot },
    {
      type: 'op-start',
      token: 2,
      op: { kind: 'clear-key', providerId: 'local-compatible' },
    },
    {
      type: 'op-fail',
      token: 2,
      error: { code: 'conflict', snapshot: changed },
    },
  )
  assert.equal(withSnapshot.snapshot, changed)
  assert.equal(withSnapshot.reloadRequested, false)
  assert.equal(withSnapshot.notice?.tone, 'error')
  for (const code of [
    'stale_generation',
    'conflict',
    'outcome_unknown',
  ] as const) {
    const state = run(
      { type: 'load-start', token: 1 },
      { type: 'load-success', token: 1, snapshot },
      {
        type: 'op-start',
        token: 2,
        op: { kind: 'remove-custom', providerId: 'local-compatible' },
      },
      { type: 'op-fail', token: 2, error: { code } },
    )
    assert.equal(state.reloadRequested, true, code)
    assert.equal(state.snapshot, snapshot)
    assert.equal(
      pageReducer(state, { type: 'load-start', token: 3 }).reloadRequested,
      false,
    )
  }
  const invalid = run(
    { type: 'load-start', token: 1 },
    { type: 'load-success', token: 1, snapshot },
    { type: 'op-start', token: 2, op: setKey },
    { type: 'op-fail', token: 2, error: { code: 'invalid_input' } },
  )
  assert.equal(invalid.reloadRequested, false)
})

test('a default-model result belongs to the row that started it', () => {
  const failed = run(
    { type: 'load-start', token: 1 },
    { type: 'load-success', token: 1, snapshot },
    {
      type: 'op-start',
      token: 2,
      op: {
        kind: 'set-default',
        selection: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
        field: 'effort',
      },
    },
    { type: 'op-fail', token: 2, error: { code: 'model_not_in_catalog' } },
  )
  assert.equal(failed.notice?.scope, 'effort')
  assert.equal(failed.notice?.text, '所选模型不在当前可用目录中')
})

test('a failed first read shows the error; a failed reload keeps the snapshot', () => {
  const first = run(
    { type: 'load-start', token: 1 },
    { type: 'load-fail', token: 1, error: { code: 'runtime_unavailable' } },
  )
  assert.equal(first.load, 'error')
  assert.equal(first.error?.code, 'runtime_unavailable')
  const reload = pageReducer(
    pageReducer(ready(), { type: 'load-start', token: 2 }),
    {
      type: 'load-fail',
      token: 2,
      error: { code: 'host_error' },
    },
  )
  assert.equal(reload.load, 'ready')
  assert.equal(reload.snapshot, snapshot)
  assert.equal(reload.notice?.tone, 'error')
})

/* ── Fixture and live port ───────────────────────────────────────────── */

test('the fixture never stores a submitted key', async () => {
  const fixture = new ModelSettingsFixture()
  const before = await fixture.read()
  assert.ok(before.ok)
  const target = before.value.providers.find(
    (entry) => entry.id === 'deepseek-official',
  )
  assert.ok(target)
  const saved = await fixture.setProviderKey({
    generation: before.value.generation,
    providerId: target.id,
    revision: target.revision,
    key: FAKE_KEY,
  })
  assert.ok(saved.ok)
  assert.doesNotMatch(JSON.stringify(saved), /FAKE/u)
  const created = await fixture.saveCustomProvider({
    generation: 1,
    mode: 'create',
    providerId: 'my-gateway',
    revision: 0,
    fields: {
      displayName: '网关',
      protocol: 'openai-completions',
      baseURL: 'https://gateway.example.com/v1',
      models: [{ id: 'm' }],
    },
    key: FAKE_KEY,
  })
  assert.ok(created.ok)
  const catalog = await fixture.read()
  assert.ok(catalog.ok)
  const openai = catalog.value.providers.find((entry) => entry.id === 'openai')
  assert.ok(openai)
  await fixture.setProviderKey({
    generation: 1,
    providerId: 'openai',
    revision: openai.revision,
    key: FAKE_KEY,
  })
  const after = await fixture.read()
  assert.ok(after.ok)
  const serialized = JSON.stringify([after, await fixture.status()])
  assert.doesNotMatch(serialized, /FAKE|sk-corn/u)
  const deepseek = after.value.providers.find(
    (entry) => entry.id === 'deepseek-official',
  )
  assert.deepEqual(deepseek?.credential, {
    kind: 'configured',
    source: 'stored',
    writable: true,
  })
  assert.equal(after.value.status.status, 'available')
  assert.ok(
    visibleProviders(after.value).some((entry) => entry.id === 'openai'),
  )
  assert.ok(after.value.catalog.some((group) => group.providerId === 'openai'))
})

test('the fixture checks generation, revision and key format like Main', async () => {
  const fixture = new ModelSettingsFixture()
  const command = {
    generation: 1,
    providerId: 'deepseek-official',
    revision: 1,
    key: FAKE_KEY,
  }
  const stale = await fixture.setProviderKey({ ...command, generation: 2 })
  assert.equal(stale.ok ? null : stale.error.code, 'stale_generation')
  const conflict = await fixture.setProviderKey({ ...command, revision: 7 })
  assert.equal(conflict.ok ? null : conflict.error.code, 'conflict')
  const pasted = await fixture.setProviderKey({
    ...command,
    key: `DEEPSEEK_API_KEY=${FAKE_KEY}`,
  })
  assert.equal(pasted.ok ? null : pasted.error.code, 'invalid_input')
  const missing = await fixture.setDefaultModel({
    generation: 1,
    revision: 1,
    selection: { provider: 'openai', model: 'gpt-5.1' },
  })
  assert.equal(missing.ok ? null : missing.error.code, 'model_not_in_catalog')
  const cleared = await fixture.clearProviderKey({
    generation: 1,
    providerId: 'local-compatible',
  })
  assert.ok(cleared.ok)
  assert.equal(
    cleared.value.providers.find((entry) => entry.id === 'local-compatible')
      ?.credential.kind,
    'missing',
  )
})

test('the live port turns a rejected bridge call into a closed host error', async () => {
  const boom = () => Promise.reject(new Error(`leaked ${FAKE_KEY} /tmp/x`))
  const bridge: ModelSettingsBridge = {
    status: boom,
    read: boom,
    setProviderKey: boom,
    clearProviderKey: boom,
    saveCustomProvider: boom,
    removeCustomProvider: boom,
    setDefaultModel: boom,
  }
  const port = livePort(bridge)
  assert.equal(port.label, 'live')
  const read = await port.read()
  assert.deepEqual(read, { ok: false, error: { code: 'host_error' } })
  const set = await port.setProviderKey({
    generation: 1,
    providerId: 'x',
    revision: 1,
    key: FAKE_KEY,
  })
  assert.doesNotMatch(JSON.stringify(set), /FAKE|tmp|leaked/u)
  assert.deepEqual(await port.status(), {
    status: 'unavailable',
    reason: 'host_error',
    devOverride: false,
  })
})
