import assert from 'node:assert/strict'
import type { ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  DshHostSupervisor,
  type HostAdmission,
} from '../src/runtime/dsh-host-supervisor.ts'
import { HostAuth } from '../src/runtime/host-auth.ts'
import type { ReclaimReport } from '../src/runtime/host-descendants.ts'
import { RuntimeFailure } from '../src/runtime/runtime-failure.ts'
import {
  FakeChild,
  FakeHost,
  FakeProcessTable,
  OWN_GROUP,
  RuntimeHarness,
  within,
} from './helpers/runtime-harness.ts'

const TIMEOUT = { timeout: 10_000 }
const BOUNDS = { graceMs: 50, killMs: 100 }
const BASIC: HostAdmission = {
  beforeSpawn: async () => {},
  afterAuth: async () => {},
}

type Behaviour =
  | 'exits-on-term'
  | 'exits-on-kill'
  | 'exit-without-close'
  | 'wedged'

/** How a fake child answers the supervisor's signals. */
function behave(child: FakeChild, behaviour: Behaviour): void {
  switch (behaviour) {
    case 'exits-on-term':
      return
    case 'wedged':
      child.ignoreSignals = true
      return
    case 'exits-on-kill':
    case 'exit-without-close':
      child.kill = (signal: NodeJS.Signals = 'SIGTERM') => {
        child.kills.push(signal)
        if (signal === 'SIGKILL')
          queueMicrotask(() =>
            behaviour === 'exits-on-kill'
              ? child.exit(null, signal)
              : child.exitOnly(null, signal),
          )
        return true
      }
      return
    default: {
      const unreachable: never = behaviour
      throw new Error(`Unknown behaviour ${String(unreachable)}`)
    }
  }
}

interface Fixture {
  readonly supervisor: DshHostSupervisor
  readonly children: FakeChild[]
  readonly processes: FakeProcessTable
  readonly reclaims: ReclaimReport[]
  lockHeld(): boolean
}

async function withSupervisor(
  behaviour: Behaviour,
  run: (fixture: Fixture) => Promise<void>,
  admission: HostAdmission = BASIC,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'corn-supervisor-stop-'))
  const home = join(root, 'dsh')
  await mkdir(join(home, 'profiles', 'corn-dev'), {
    recursive: true,
    mode: 0o700,
  })
  await writeFile(
    join(home, '.corn-bot-home.json'),
    `${JSON.stringify({ owner: 'corn-bot', schemaVersion: 1 })}\n`,
  )
  await writeFile(join(home, 'profiles', 'corn-dev', 'package.json'), '{}\n')
  const host = await FakeHost.start()
  const children: FakeChild[] = []
  const processes = new FakeProcessTable()
  const reclaims: ReclaimReport[] = []
  const supervisor = new DshHostSupervisor(home, {
    admission,
    model: null,
    stopTimeouts: BOUNDS,
    processTable: processes,
    descendantPollMs: 10,
    onReclaim: (report) => {
      reclaims.push(report)
    },
    spawnHost: (_command, args, options) => {
      const child = new FakeChild(
        50_000 + children.length,
        args,
        options.env ?? {},
        host.port,
      )
      behave(child, behaviour)
      processes.host(child)
      children.push(child)
      queueMicrotask(() => child.ready())
      return child as unknown as ChildProcess
    },
    exchangeAuth: (launch, signal) => HostAuth.exchange(launch, signal),
  })
  try {
    await run({
      supervisor,
      children,
      processes,
      reclaims,
      lockHeld: () => existsSync(join(home, 'corn-host.lock')),
    })
  } finally {
    for (const child of children) child.exit(0)
    await supervisor.stop().catch(() => {})
    await host.close()
    await rm(root, { recursive: true, force: true })
  }
}

/** Matched by name so this file also loads, and fails, against the unbounded baseline. */
function assertStopTimeout(error: unknown): asserts error is Error & {
  pid: number | undefined
} {
  assert.ok(error instanceof Error, String(error))
  assert.equal(error.name, 'HostStopTimeoutError', error.message)
}

async function rejection(promise: Promise<unknown>, label: string) {
  return within(
    promise.then(
      () => assert.fail(`${label} must fail`),
      (error: unknown) => error,
    ),
    label,
  )
}

test(
  'a SIGTERM exit stops normally and releases the home',
  TIMEOUT,
  async () => {
    await withSupervisor(
      'exits-on-term',
      async ({ supervisor, children, lockHeld }) => {
        await within(supervisor.start(), 'start')
        await within(supervisor.stop(), 'stop')
        assert.deepEqual(children[0]?.kills, ['SIGTERM'])
        assert.equal(lockHeld(), false)
      },
    )
  },
)

test(
  'a child ignoring SIGTERM is killed and stops normally',
  TIMEOUT,
  async () => {
    await withSupervisor(
      'exits-on-kill',
      async ({ supervisor, children, lockHeld }) => {
        await within(supervisor.start(), 'start')
        await within(supervisor.stop(), 'stop')
        assert.deepEqual(children[0]?.kills, ['SIGTERM', 'SIGKILL'])
        assert.equal(lockHeld(), false)
      },
    )
  },
)

test(
  'a confirmed exit whose pipes never close still stops within the bound',
  TIMEOUT,
  async () => {
    await withSupervisor(
      'exit-without-close',
      async ({ supervisor, children, lockHeld }) => {
        await within(supervisor.start(), 'start')
        await within(supervisor.stop(), 'stop')
        const child = children[0] as FakeChild
        assert.deepEqual(child.kills, ['SIGTERM', 'SIGKILL'])
        assert.equal(child.stdout.destroyed, true)
        assert.equal(lockHeld(), false)
      },
    )
  },
)

test(
  'a child that never exits after SIGKILL ends stop with a typed cleanup failure',
  TIMEOUT,
  async () => {
    await withSupervisor(
      'wedged',
      async ({ supervisor, children, lockHeld }) => {
        await within(supervisor.start(), 'start')
        const error = await rejection(supervisor.stop(), 'stop')
        assertStopTimeout(error)
        assert.equal(error.pid, 50_000)
        assert.deepEqual(children[0]?.kills, ['SIGTERM', 'SIGKILL'])
        assert.equal(lockHeld(), true, 'an unconfirmed child keeps its home')
        assert.equal(supervisor.running, false)
      },
    )
  },
)

test(
  'no replacement Host starts until the old child is confirmed dead',
  TIMEOUT,
  async () => {
    await withSupervisor(
      'wedged',
      async ({ supervisor, children, lockHeld }) => {
        await within(supervisor.start(), 'start')
        await rejection(supervisor.stop(), 'first stop')
        const blocked = await rejection(supervisor.start(), 'replacement start')
        assertStopTimeout(blocked)
        assert.equal(children.length, 1)
        const again = await rejection(supervisor.stop(), 'second stop')
        assertStopTimeout(again)
        assert.equal(children.length, 1)
        assert.equal(lockHeld(), true)
        children[0]?.exit(null, 'SIGKILL')
        await within(supervisor.stop(), 'stop after exit')
        assert.equal(lockHeld(), false)
        await within(supervisor.start(), 'start after confirmed exit')
        assert.equal(children.length, 2)
      },
    )
  },
)

test(
  'a wedged child after a failed start surfaces the cleanup failure, not the start error',
  TIMEOUT,
  async () => {
    await withSupervisor(
      'wedged',
      async ({ supervisor, children, lockHeld }) => {
        const error = await rejection(supervisor.start(), 'start')
        assertStopTimeout(error)
        const stop = await rejection(supervisor.stop(), 'stop')
        assertStopTimeout(stop)
        assert.equal(children.length, 1)
        assert.equal(lockHeld(), true)
      },
      {
        beforeSpawn: async () => {},
        afterAuth: async () => {
          throw new RuntimeFailure('claw_check_failed', 'fixture')
        },
      },
    )
  },
)

test(
  'startup control never spawns a replacement while a wedged child is unconfirmed',
  TIMEOUT,
  async () => {
    const harness = await RuntimeHarness.create({
      wedgedChildren: true,
      stopTimeouts: BOUNDS,
    })
    try {
      harness.host.registry = 'missing'
      await within(harness.control.start(), 'start')
      assert.equal(harness.children.length, 1)
      assert.equal(harness.control.view.status, 'recovering')
      harness.runRecovery()
      await within(
        (async () => {
          while (harness.schedules.filter((row) => !row.cancelled).length < 1)
            await new Promise((resolve) => setImmediate(resolve))
        })(),
        'next recovery',
      )
      assert.equal(harness.children.length, 1)
      assert.ok(existsSync(join(harness.home, 'corn-host.lock')))
      const quit = await rejection(harness.control.shutdown(), 'quit')
      assertStopTimeout(quit)
      assert.equal(harness.children.length, 1)
    } finally {
      for (const child of harness.children) child.exit(0)
      await harness.dispose()
    }
  },
)

/** A DSH tool shape: `bash` leads its own group (detached spawn or node-pty), `sleep` runs inside it. */
function spawnTool(processes: FakeProcessTable, host: FakeChild) {
  const bash = processes.spawn(host.pid, 'bash')
  const sleep = processes.spawn(bash.pid, 'sleep', { ownGroup: false })
  return { bash, sleep }
}

/** Two snapshots: the first refresh that saw the tree has completed. */
async function recorded(processes: FakeProcessTable): Promise<void> {
  await processes.nextSnapshot()
  await processes.nextSnapshot()
}

async function until(check: () => boolean, label: string): Promise<void> {
  await within(
    (async () => {
      while (!check()) await new Promise((resolve) => setTimeout(resolve, 5))
    })(),
    label,
  )
}

test(
  'the SIGKILL fallback reclaims tool processes outside the Host process group',
  TIMEOUT,
  async () => {
    await withSupervisor(
      'exits-on-kill',
      async ({ supervisor, children, processes, reclaims, lockHeld }) => {
        await within(supervisor.start(), 'start')
        const host = children[0] as FakeChild
        const { bash, sleep } = spawnTool(processes, host)
        const helper = processes.spawn(host.pid, 'helper', { ownGroup: false })
        await within(supervisor.stop(), 'stop')
        assert.deepEqual(host.kills, ['SIGTERM', 'SIGKILL'])
        assert.equal(processes.alive(bash.pid), false, 'bash orphaned')
        assert.equal(processes.alive(sleep.pid), false, 'sleep orphaned')
        assert.equal(processes.alive(helper.pid), false, 'helper orphaned')
        assert.equal(processes.alive(process.pid), true)
        assert.ok(
          !processes.signals.some(([pid]) => pid === -OWN_GROUP),
          'never signals the caller’s own process group',
        )
        assert.deepEqual(
          reclaims.map(({ reason, signalled, groups, survivors, names }) => ({
            reason,
            signalled,
            groups,
            survivors,
            names,
          })),
          [
            {
              reason: 'stop',
              signalled: 3,
              groups: 1,
              survivors: 0,
              names: ['bash', 'helper', 'sleep'],
            },
          ],
        )
        assert.equal(lockHeld(), false)
      },
    )
  },
)

test(
  'a Host crash reclaims the descendants recorded before it died',
  TIMEOUT,
  async () => {
    await withSupervisor(
      'exits-on-term',
      async ({ supervisor, children, processes, reclaims }) => {
        await within(supervisor.start(), 'start')
        const host = children[0] as FakeChild
        const { bash, sleep } = spawnTool(processes, host)
        await recorded(processes)
        host.exit(null, 'SIGKILL')
        assert.equal(processes.rows.get(bash.pid)?.ppid, 1, 'reparented')
        await until(
          () => !processes.alive(bash.pid) && !processes.alive(sleep.pid),
          'crash reclaim',
        )
        await within(supervisor.stop(), 'stop after crash')
        assert.deepEqual(host.kills, [])
        assert.deepEqual(
          reclaims.map(({ reason, signalled }) => ({ reason, signalled })),
          [{ reason: 'crash', signalled: 2 }],
        )
      },
    )
  },
)

test(
  'a graceful stop reclaims a descendant that outlived the Host’s own teardown',
  TIMEOUT,
  async () => {
    await withSupervisor(
      'exits-on-term',
      async ({ supervisor, children, processes, reclaims }) => {
        await within(supervisor.start(), 'start')
        const host = children[0] as FakeChild
        const daemon = processes.spawn(host.pid, 'daemon')
        await within(supervisor.stop(), 'stop')
        assert.deepEqual(host.kills, ['SIGTERM'])
        assert.equal(processes.alive(daemon.pid), false)
        assert.equal(reclaims[0]?.signalled, 1)
      },
    )
  },
)

test(
  'a Host without descendants stops with no extra signals',
  TIMEOUT,
  async () => {
    await withSupervisor(
      'exits-on-term',
      async ({ supervisor, processes, reclaims }) => {
        await within(supervisor.start(), 'start')
        await within(supervisor.stop(), 'stop')
        assert.deepEqual(processes.signals, [])
        assert.deepEqual(
          reclaims.map(({ signalled, tracked }) => ({ signalled, tracked })),
          [{ signalled: 0, tracked: 0 }],
        )
      },
    )
  },
)

test(
  'an unconfirmed Host keeps its descendants until a later stop confirms its exit',
  TIMEOUT,
  async () => {
    await withSupervisor(
      'wedged',
      async ({ supervisor, children, processes }) => {
        await within(supervisor.start(), 'start')
        const host = children[0] as FakeChild
        const { bash } = spawnTool(processes, host)
        assertStopTimeout(await rejection(supervisor.stop(), 'first stop'))
        assert.equal(processes.alive(bash.pid), true)
        host.exit(null, 'SIGKILL')
        await within(supervisor.stop(), 'stop after exit')
        assert.equal(processes.alive(bash.pid), false)
      },
    )
  },
)

test('App shutdown reclaims the Host’s tool processes', TIMEOUT, async () => {
  const harness = await RuntimeHarness.create()
  try {
    await within(harness.control.start(), 'start')
    const host = harness.children[0] as FakeChild
    const { bash, sleep } = spawnTool(harness.processes, host)
    await within(harness.control.shutdown(), 'quit')
    assert.equal(harness.processes.alive(bash.pid), false)
    assert.equal(harness.processes.alive(sleep.pid), false)
    assert.equal(harness.reclaims[0]?.reason, 'stop')
  } finally {
    await harness.dispose()
  }
})
