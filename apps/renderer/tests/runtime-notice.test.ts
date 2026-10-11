import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  RUNTIME_ERROR_CODES,
  type RuntimeErrorCode,
  type RuntimeStatus,
} from '@corn-bot/contracts'
import {
  type Announcement,
  type DataSource,
  nextAnnouncement,
  PENDING_READING,
  type RuntimeReading,
  runtimeNotice,
  SAMPLE_NOTICE,
  SILENT,
  sampleNotice,
  UNAVAILABLE_READING,
} from '../src/app/runtime-notice.ts'
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

/** Feeds readings in order and returns the text of every announcement made. */
const spoken = (
  readings: readonly RuntimeReading[],
  source: DataSource = 'fixture',
  start: Announcement = SILENT,
) => {
  const said: string[] = []
  readings.reduce((previous, reading) => {
    const next = nextAnnouncement(previous, source, reading)
    if (next.count !== previous.count) said.push(next.text)
    return next
  }, start)
  return said
}

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
  assert.equal(new Set(notices.map((notice) => notice.text)).size, 11)
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
  const first = nextAnnouncement(SILENT, 'fixture', host('ready'))
  const again = nextAnnouncement(first, 'fixture', {
    kind: 'host',
    view: { status: 'ready', dshVersion: '9.9.9', message: 'polled again' },
  })
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
  const fixture = nextAnnouncement(SILENT, 'fixture', host('ready'))
  const live = nextAnnouncement(fixture, 'live', host('ready'))
  assert.equal(live.count, fixture.count)
  assert.equal(live.source, 'live')
  const back = nextAnnouncement(live, 'fixture', host('ready'))
  assert.equal(back.text, SAMPLE_NOTICE)
  assert.equal(back.count, fixture.count + 1)
})

test('repeated text still counts as a new announcement', () => {
  const failed = nextAnnouncement(SILENT, 'fixture', host('failed'))
  const recovering = nextAnnouncement(failed, 'fixture', host('recovering'))
  const again = nextAnnouncement(recovering, 'fixture', host('failed'))
  assert.equal(again.text, text(host('failed')))
  assert.equal(again.count, failed.count + 2)
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
