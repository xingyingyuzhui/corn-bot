import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  formatReclaim,
  HostDescendants,
  type ProcessRow,
  parsePsLine,
  systemProcessTable,
} from '../src/runtime/host-descendants.ts'
import { FakeProcessTable, OWN_GROUP } from './helpers/runtime-harness.ts'

const HOST = 41_000

function withHost(): FakeProcessTable {
  const processes = new FakeProcessTable()
  processes.rows.set(HOST, {
    pid: HOST,
    ppid: process.pid,
    pgid: OWN_GROUP,
    started: 'host',
    name: 'node',
  })
  return processes
}

test('ps rows parse with a five-field start time and an executable basename', () => {
  assert.deepEqual(
    parsePsLine(
      '  4242   4100  4242 Mon Oct  5 09:03:07 2026     /Applications/Some App.app/Contents/MacOS/Some App',
    ),
    {
      pid: 4242,
      ppid: 4100,
      pgid: 4242,
      started: 'Mon Oct 5 09:03:07 2026',
      name: 'Some App',
    },
  )
  assert.equal(parsePsLine(''), undefined)
  assert.equal(parsePsLine('x 1 1 Mon Oct 5 09:03:07 2026 sh'), undefined)
  assert.equal(parsePsLine('1 1 1 Mon Oct 5 sh'), undefined)
})

test('the system table lists this process without signalling anything', async () => {
  const rows = await systemProcessTable.snapshot()
  const self = rows.find((row) => row.pid === process.pid)
  assert.ok(self, 'own row present')
  assert.equal(self.ppid, process.ppid)
  assert.match(self.started, /^\w{3} \w{3} +\d+ \d\d:\d\d:\d\d \d{4}$/u)
})

test('a process forked into a recorded group after the last record is still reclaimed', async () => {
  const processes = withHost()
  const tree = new HostDescendants(processes, HOST)
  const bash = processes.spawn(HOST, 'bash')
  await tree.refresh()
  const late = processes.spawn(bash.pid, 'sleep', { ownGroup: false })
  processes.exit(bash.pid)
  processes.exit(HOST)
  assert.equal(processes.rows.get(late.pid)?.ppid, 1)
  const report = await tree.reclaim('crash', 50)
  assert.equal(processes.alive(late.pid), false)
  assert.deepEqual(processes.signals, [
    [-bash.pid, 'SIGKILL'],
    [late.pid, 'SIGKILL'],
  ])
  assert.equal(report.signalled, 1)
  assert.equal(report.groups, 1)
})

test('a recorded pid reused by an unrelated process is never signalled', async () => {
  const processes = withHost()
  const tree = new HostDescendants(processes, HOST)
  const tool = processes.spawn(HOST, 'bash')
  await tree.refresh()
  processes.exit(HOST)
  const stranger = processes.reuse(tool.pid, 'stranger')
  const report = await tree.reclaim('crash', 50)
  assert.equal(processes.rows.get(stranger.pid), stranger)
  assert.deepEqual(processes.signals, [])
  assert.equal(report.tracked, 1)
  assert.equal(report.signalled, 0)
  assert.equal(formatReclaim(report), undefined)
})

test('records keep reparented descendants and drop dead ones', async () => {
  const processes = withHost()
  const tree = new HostDescendants(processes, HOST)
  const bash = processes.spawn(HOST, 'bash')
  const daemon = processes.spawn(bash.pid, 'daemon')
  const brief = processes.spawn(HOST, 'brief')
  await tree.refresh()
  processes.exit(bash.pid)
  processes.exit(brief.pid)
  await tree.refresh()
  assert.equal(tree.tracked, 1)
  processes.exit(HOST)
  const report = await tree.reclaim('crash', 50)
  assert.equal(processes.alive(daemon.pid), false)
  assert.deepEqual(report.names, ['daemon'])
})

test('an unreadable process table at reclaim signals nothing and reports counts only', async () => {
  const processes = withHost()
  let readable = true
  const table = {
    snapshot: (): Promise<readonly ProcessRow[]> =>
      readable ? processes.snapshot() : Promise.reject(new Error('ps failed')),
    kill: processes.kill.bind(processes),
  }
  const tree = new HostDescendants(table, HOST)
  const bash = processes.spawn(HOST, 'bash')
  await tree.refresh()
  readable = false
  const report = await tree.reclaim('crash', 50)
  assert.equal(report.snapshotFailed, true)
  assert.equal(processes.alive(bash.pid), true)
  assert.deepEqual(processes.signals, [])
  assert.equal(
    formatReclaim(report),
    '[corn-host] crash: process table unavailable; 1 recorded descendant(s) not reclaimed',
  )
})

test('a reclaim line names executables and counts, nothing else', async () => {
  const processes = withHost()
  const tree = new HostDescendants(processes, HOST)
  const bash = processes.spawn(HOST, 'bash')
  processes.spawn(bash.pid, 'sleep', { ownGroup: false })
  await tree.refresh()
  processes.exit(HOST)
  assert.equal(
    formatReclaim(await tree.reclaim('stop', 50)),
    '[corn-host] stop: reclaimed 2 descendant process(es) in 1 group(s) [bash, sleep]; survivors 0',
  )
})
