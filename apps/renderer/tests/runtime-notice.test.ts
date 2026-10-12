import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  RUNTIME_ERROR_CODES,
  type RuntimeErrorCode,
  type RuntimeStatus,
} from '@corn-bot/contracts'
import type { ModelStatusView } from '@corn-bot/contracts/model-settings'
import {
  type Announcement,
  type DataSource,
  errorCodeText,
  modelNotice,
  nextAnnouncement,
  PENDING_READING,
  type RuntimeReading,
  runtimeNotice,
  SAMPLE_NOTICE,
  SILENT,
  sampleNotice,
  UNAVAILABLE_READING,
} from '../src/app/runtime-notice.ts'
import { modelStatusText } from '../src/features/settings/model-settings-controller.ts'
import {
  parseRuntimeFixture,
  RUNTIME_FIXTURES,
  runtimeFixtureReading,
} from '../src/fixtures/runtime-states.ts'

const STATUSES: readonly RuntimeStatus[] = [
  'stopped',
  'starting',
  'ready',
  'recovering',
  'failed',
]

const host = (
  status: RuntimeStatus,
  message = `Main message for ${status}`,
): RuntimeReading => ({
  kind: 'host',
  view: { status, dshVersion: '0.2.0-rc.2', message },
})

type Tick = RuntimeReading | readonly [RuntimeReading, ModelStatusView | null]

/**
 * Feeds readings (optionally paired with a model status) in order and returns
 * the text of every announcement made.
 */
const spoken = (
  ticks: readonly Tick[],
  source: DataSource = 'fixture',
  start: Announcement = SILENT,
) => {
  const said: string[] = []
  ticks.reduce((previous, tick) => {
    const [reading, model] = 'kind' in tick ? [tick, null] : tick
    const next = nextAnnouncement(previous, source, reading, model)
    if (next.count !== previous.count) said.push(next.text)
    return next
  }, start)
  return said
}

const modelView = (
  status: ModelStatusView['status'],
  reason: ModelStatusView['reason'],
  devOverride = false,
): ModelStatusView => ({ status, reason, devOverride })

const NEEDS_KEY = modelView('needs_configuration', 'credential_missing')
const AVAILABLE = modelView('available', 'configured')
const CHECKING = modelView('checking', 'reading')

const text = (reading: RuntimeReading) => runtimeNotice(reading).text

test('every Host status and the bridge state have a distinct key and wording', () => {
  const notices = [
    PENDING_READING,
    UNAVAILABLE_READING,
    ...STATUSES.map((status) => host(status)),
  ].map(runtimeNotice)
  assert.equal(new Set(notices.map((notice) => notice.key)).size, 7)
  assert.equal(new Set(notices.map((notice) => notice.text)).size, 7)
  assert.equal(runtimeNotice(UNAVAILABLE_READING).key, 'bridge-unavailable')
  assert.equal(runtimeNotice(UNAVAILABLE_READING).status, 'unavailable')
})

test('runtime wording never repeats raw Main messages or claims a Bot is connected', () => {
  for (const status of STATUSES) {
    const notice = runtimeNotice(host(status, 'Error: spawn ENOENT /tmp/x'))
    assert.equal(notice.status, status)
    assert.doesNotMatch(notice.text, /Bot|ENOENT|\/tmp|已连接/u)
  }
  assert.equal(runtimeNotice(host('ready')).tone, 'ok')
  assert.equal(runtimeNotice(host('failed')).tone, 'error')
  assert.equal(runtimeNotice(UNAVAILABLE_READING).tone, 'error')
})

const failedWith = (errorCode: RuntimeErrorCode): RuntimeReading => ({
  kind: 'host',
  view: {
    status: 'failed',
    dshVersion: '0.2.0-rc.2',
    message: 'Error: raw /tmp/x',
    errorCode,
  },
})

test('every safe error code has its own wording and dedupe key', () => {
  const notices = RUNTIME_ERROR_CODES.map((code) =>
    runtimeNotice(failedWith(code)),
  )
  assert.equal(new Set(notices.map((notice) => notice.text)).size, 12)
  for (const [index, notice] of notices.entries()) {
    assert.equal(notice.key, `failed:${RUNTIME_ERROR_CODES[index]}`)
    assert.equal(notice.tone, 'error')
    assert.ok(notice.text.startsWith(text(host('failed'))))
    assert.doesNotMatch(notice.text, /\/tmp|Error|_/u)
  }
})

test('an error code is read only while failed', () => {
  const recovering: RuntimeReading = {
    kind: 'host',
    view: {
      status: 'recovering',
      dshVersion: '0.2.0-rc.2',
      message: '',
      errorCode: 'host_unavailable',
    },
  }
  assert.equal(runtimeNotice(recovering).key, 'recovering')
})

test('a different failure code is announced again; the same one is not', () => {
  const said = spoken([
    failedWith('claw_missing'),
    failedWith('claw_missing'),
    failedWith('claw_disabled'),
  ])
  assert.equal(said.length, 2)
  assert.equal(said[1], text(failedWith('claw_disabled')))
})

test('the sample marker belongs to the fixture source only', () => {
  assert.equal(sampleNotice('fixture'), SAMPLE_NOTICE)
  assert.equal(sampleNotice('live'), null)
})

test('the first reading speaks the sample source and the runtime once', () => {
  assert.deepEqual(spoken([UNAVAILABLE_READING]), [
    `${SAMPLE_NOTICE}。${text(UNAVAILABLE_READING)}`,
  ])
})

test('a pending reading is never spoken', () => {
  assert.deepEqual(spoken([PENDING_READING, PENDING_READING, host('ready')]), [
    SAMPLE_NOTICE,
    text(host('ready')),
  ])
})

test('polling the same status stays silent even when unrelated fields change', () => {
  const first = nextAnnouncement(SILENT, 'fixture', host('ready'), null)
  const again = nextAnnouncement(
    first,
    'fixture',
    {
      kind: 'host',
      view: { status: 'ready', dshVersion: '9.9.9', message: 'polled again' },
    },
    null,
  )
  assert.equal(again, first)
  assert.deepEqual(
    spoken([host('starting'), host('starting'), host('ready'), host('ready')]),
    [`${SAMPLE_NOTICE}。${text(host('starting'))}`, text(host('ready'))],
  )
})

test('only the previous key counts: failed, recovering, failed speaks failure again', () => {
  const said = spoken([host('failed'), host('recovering'), host('failed')])
  assert.equal(said.length, 3)
  assert.equal(said[2], text(host('failed')))
})

test('bridge unavailable is its own key between Host states', () => {
  assert.deepEqual(
    spoken([
      host('ready'),
      UNAVAILABLE_READING,
      UNAVAILABLE_READING,
      host('ready'),
    ]).slice(1),
    [text(UNAVAILABLE_READING), text(host('ready'))],
  )
})

test('the sample source is spoken again only when the source changes', () => {
  const fixture = nextAnnouncement(SILENT, 'fixture', host('ready'), null)
  const live = nextAnnouncement(fixture, 'live', host('ready'), null)
  assert.equal(live.count, fixture.count)
  assert.equal(live.source, 'live')
  const back = nextAnnouncement(live, 'fixture', host('ready'), null)
  assert.equal(back.text, SAMPLE_NOTICE)
  assert.equal(back.count, fixture.count + 1)
})

test('repeated text still counts as a new announcement', () => {
  const failed = nextAnnouncement(SILENT, 'fixture', host('failed'), null)
  const recovering = nextAnnouncement(
    failed,
    'fixture',
    host('recovering'),
    null,
  )
  const again = nextAnnouncement(recovering, 'fixture', host('failed'), null)
  assert.equal(again.text, text(host('failed')))
  assert.equal(again.count, failed.count + 2)
})

test('model config codes name the development override, not production setup', () => {
  for (const code of [
    'model_config_invalid',
    'model_config_permissions',
    'model_config_unreadable',
  ] as const)
    assert.match(errorCodeText(code), /开发测试/u)
})

const modelText = (view: ModelStatusView) => modelStatusText(view)

test('the model line exists only while the runtime is ready', () => {
  assert.equal(modelNotice(host('ready'), null), null)
  for (const status of STATUSES.filter((entry) => entry !== 'ready'))
    assert.equal(modelNotice(host(status), NEEDS_KEY), null)
  assert.equal(modelNotice(UNAVAILABLE_READING, NEEDS_KEY), null)
  assert.equal(modelNotice(PENDING_READING, NEEDS_KEY), null)
  const line = modelNotice(host('ready'), NEEDS_KEY)
  assert.equal(line?.text, modelText(NEEDS_KEY))
  assert.equal(line?.status, 'needs_configuration')
  assert.notEqual(line?.text, text(host('ready')))
})

test('a model needing configuration is announced once after ready, joined with it', () => {
  assert.deepEqual(
    spoken([
      [host('starting'), NEEDS_KEY],
      [host('ready'), NEEDS_KEY],
      [host('ready'), NEEDS_KEY],
      [host('ready'), NEEDS_KEY],
    ]),
    [
      `${SAMPLE_NOTICE}。${text(host('starting'))}`,
      `${text(host('ready'))}。${modelText(NEEDS_KEY)}`,
    ],
  )
})

test('repeated model polls are silent and return the same announcement', () => {
  const first = nextAnnouncement(SILENT, 'live', host('ready'), NEEDS_KEY)
  const again = nextAnnouncement(first, 'live', host('ready'), {
    ...NEEDS_KEY,
  })
  assert.equal(again, first)
})

test('checking is never spoken and does not re-arm the same status', () => {
  assert.deepEqual(
    spoken(
      [
        [host('ready'), CHECKING],
        [host('ready'), NEEDS_KEY],
        [host('ready'), CHECKING],
        [host('ready'), NEEDS_KEY],
      ],
      'live',
    ),
    [text(host('ready')), modelText(NEEDS_KEY)],
  )
})

test('a model that becomes available is announced once', () => {
  assert.deepEqual(
    spoken(
      [
        [host('ready'), NEEDS_KEY],
        [host('ready'), AVAILABLE],
        [host('ready'), AVAILABLE],
      ],
      'live',
    ),
    [`${text(host('ready'))}。${modelText(NEEDS_KEY)}`, modelText(AVAILABLE)],
  )
})

test('a failed runtime suppresses the model line; the next ready speaks it again', () => {
  const said = spoken(
    [
      [host('ready'), NEEDS_KEY],
      [host('failed'), NEEDS_KEY],
      [host('recovering'), NEEDS_KEY],
      [host('ready'), NEEDS_KEY],
    ],
    'live',
  )
  assert.deepEqual(said, [
    `${text(host('ready'))}。${modelText(NEEDS_KEY)}`,
    text(host('failed')),
    text(host('recovering')),
    `${text(host('ready'))}。${modelText(NEEDS_KEY)}`,
  ])
  for (const line of said.slice(1, 3)) assert.doesNotMatch(line, /模型/u)
})

test('the dev override is part of the model key and the wording', () => {
  const dev = modelView('available', 'configured', true)
  assert.match(modelText(dev), /开发测试覆盖/u)
  assert.deepEqual(
    spoken(
      [
        [host('ready'), AVAILABLE],
        [host('ready'), dev],
      ],
      'live',
    ).slice(1),
    [modelText(dev)],
  )
})

test('runtime fixtures exist only on the dev server', () => {
  assert.equal(parseRuntimeFixture('#runtime=failed', false), null)
  assert.equal(
    parseRuntimeFixture('#fixture=ui-states&runtime=failed', true),
    'failed',
  )
  assert.equal(parseRuntimeFixture('#runtime=bogus', true), null)
  assert.equal(parseRuntimeFixture('', true), null)
  for (const fixture of RUNTIME_FIXTURES) {
    const notice = runtimeNotice(runtimeFixtureReading(fixture))
    assert.equal(notice.status, fixture)
  }
})
