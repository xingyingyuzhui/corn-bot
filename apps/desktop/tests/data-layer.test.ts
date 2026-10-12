import assert from 'node:assert/strict'
import { existsSync, realpathSync, statSync } from 'node:fs'
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { type TestContext, test } from 'node:test'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { DATA_CHANNELS } from '../../../packages/contracts/src/workspace.ts'
import {
  getMeta,
  getSessionBinding,
  insertBot,
  insertMainConversation,
  insertSessionBinding,
  type LocalDbFailure,
  setUiPref,
} from '../../../packages/local-db/src/index.ts'
import { CornData, HOME_MISMATCH } from '../src/data/open.ts'
import {
  assertIsolatedDataDir,
  claimDataDir,
  DATA_LOCK_FILE,
  dataPaths,
} from '../src/data/paths.ts'
import {
  DEFAULT_UI_PREFS,
  readUiPrefs,
  writeUiPref,
} from '../src/data/ui-prefs.ts'
import { registerDataIpc } from '../src/ipc/data.ts'
import { acquireProcessLock } from '../src/runtime/process-lock.ts'
import {
  claimCornHome,
  readCornHomeId,
} from '../src/runtime/profile-bootstrap.ts'

const T0 = 1_760_000_000_000

async function scratch(t: TestContext): Promise<string> {
  const dir = realpathSync(await mkdtemp(join(tmpdir(), 'corn-data-test-')))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

function quiet(options: ConstructorParameters<typeof CornData>[0]): {
  data: CornData
  logs: string[]
} {
  const logs: string[] = []
  return {
    data: new CornData({ now: () => T0, log: (l) => logs.push(l), ...options }),
    logs,
  }
}

function seedBinding(data: CornData, homeId: string, suffix = '1'): string {
  const db = data.db
  assert.ok(db)
  const bindingId = `bind_${suffix}`
  db.write((tx) => {
    insertBot(tx, {
      botId: `bot_${suffix}`,
      displayName: `Bot ${suffix}`,
      avatarVariant: null,
      sortKey: suffix,
      modelOverride: null,
      now: T0,
    })
    insertMainConversation(tx, {
      conversationId: `conv_${suffix}`,
      botId: `bot_${suffix}`,
      now: T0,
    })
    insertSessionBinding(tx, {
      bindingId,
      conversationId: `conv_${suffix}`,
      dshSessionId: `corn-${suffix}`,
      homeId,
      now: T0,
    })
  })
  return bindingId
}

test('the data directory never overlaps ~/.dsh or the Corn DSH home', async (t) => {
  const root = await scratch(t)
  const home = join(root, 'dsh')
  await mkdir(home)
  for (const dir of [
    homedir(),
    join(homedir(), '.dsh'),
    join(homedir(), '.dsh', 'corn-data'),
    home,
    join(home, 'corn-data'),
    join(home, 'profiles', 'corn-dev', 'data'),
    root,
  ])
    assert.throws(() => assertIsolatedDataDir(dir, home), /Refusing/u, dir)
  await symlink(home, join(root, 'alias'))
  assert.throws(
    () => assertIsolatedDataDir(join(root, 'alias', 'data'), home),
    /Refusing/u,
    'a symlink alias into the home is resolved',
  )
  assert.throws(() => assertIsolatedDataDir('data', home), /absolute/u)
  assert.throws(
    () => assertIsolatedDataDir(join(root, 'dsh-data'), 'dsh'),
    /absolute/u,
  )
  assert.equal(
    assertIsolatedDataDir(join(root, 'dsh-data'), home),
    join(root, 'dsh-data'),
  )
})

test('the data directory is created 0700 with an owner marker and a foreign one is refused', async (t) => {
  const root = await scratch(t)
  const own = dataPaths(join(root, 'own'))
  await claimDataDir(own)
  assert.equal(statSync(own.dir).mode & 0o777, 0o700)
  assert.equal(statSync(own.marker).mode & 0o777, 0o600)
  await claimDataDir(own)
  const foreign = dataPaths(join(root, 'foreign'))
  await mkdir(foreign.dir)
  await writeFile(join(foreign.dir, 'notes.txt'), 'x')
  await assert.rejects(claimDataDir(foreign), /not owned/u)
  assert.deepEqual(await readdir(foreign.dir), ['notes.txt'])
})

test('a fresh start opens the database outside the home and pairs with the home marker', async (t) => {
  const root = await scratch(t)
  const home = join(root, 'dsh')
  const dir = join(root, 'dsh-data')
  const { data } = quiet({ dir, home })
  assert.equal(data.status, 'opening')
  assert.deepEqual(data.available(), {
    ok: false,
    error: { code: 'data_unavailable' },
  })

  assert.equal(await data.open(), 'ready')
  assert.equal(data.open(), data.open(), 'single flight')
  assert.equal(data.homeCheck, 'unverified', 'the Host has not claimed yet')
  assert.equal(existsSync(home), false, 'opening data never creates the home')
  assert.equal(data.isBindingUsable({ homeId: 'home_x' }), false)
  const paths = dataPaths(dir)
  assert.ok(existsSync(paths.database))
  assert.ok(existsSync(join(dir, DATA_LOCK_FILE)))
  assert.equal(statSync(paths.database).mode & 0o777, 0o600)
  assert.ok(data.available().ok)

  await claimCornHome(home)
  const homeId = await readCornHomeId(home)
  assert.ok(homeId)
  assert.deepEqual(
    (await readdir(home)).toSorted(),
    ['.corn-bot-home.json'],
    'no Corn data file inside the DSH home',
  )
  assert.equal(await data.verifyHome(), 'matched')
  assert.equal(data.homeId, homeId)
  assert.equal(
    data.db?.read((tx) => getMeta(tx, 'home_id')),
    homeId,
  )
  assert.equal(data.isBindingUsable({ homeId }), true)
  assert.equal(data.isBindingUsable({ homeId: 'home_other' }), false)
  await data.close()
})

test('a second owner of the data directory gets locked without touching the database', async (t) => {
  const root = await scratch(t)
  const options = { dir: join(root, 'data'), home: join(root, 'dsh') }
  const first = quiet(options).data
  assert.equal(await first.open(), 'ready')
  const second = quiet(options)
  assert.equal(await second.data.open(), 'locked')
  assert.equal(second.data.db, undefined)
  assert.deepEqual(second.logs, ['Corn data locked: data_locked'])
  await second.data.close()
  assert.ok(
    existsSync(join(options.dir, DATA_LOCK_FILE)),
    'the loser never releases the owner lock',
  )
  await first.close()
  assert.equal(existsSync(join(options.dir, DATA_LOCK_FILE)), false)
  const third = quiet(options).data
  assert.equal(await third.open(), 'ready')
  await third.close()
})

test('a corrupt file disables data, releases the lock and is left in place', async (t) => {
  const root = await scratch(t)
  const dir = join(root, 'data')
  const paths = dataPaths(dir)
  await claimDataDir(paths)
  const garbage = Buffer.alloc(8192, 0x5a)
  await writeFile(paths.database, garbage)
  const { data, logs } = quiet({ dir, home: join(root, 'dsh') })
  assert.equal(await data.open(), 'corrupt')
  assert.equal(data.db, undefined)
  assert.deepEqual(data.view(), { status: 'corrupt' })
  assert.deepEqual(logs, ['Corn data corrupt: not_a_database'])
  assert.equal(existsSync(join(dir, DATA_LOCK_FILE)), false)
  assert.deepEqual(await readFile(paths.database), garbage)
  await data.close()
})

test('every database refusal maps to its DataStatus; a throw is unavailable', async (t) => {
  const root = await scratch(t)
  const cases: Array<[LocalDbFailure | 'throw', string, string]> = [
    [
      { status: 'from_future', userVersion: 9 },
      'from_future',
      'user_version_9',
    ],
    [
      { status: 'schema_tampered', reason: 'checksum_mismatch' },
      'schema_tampered',
      'checksum_mismatch',
    ],
    [
      {
        status: 'migration_failed',
        reason: 'migration_threw',
        backupPath: '/secret/path',
        cause: new Error('driver text'),
      },
      'migration_failed',
      'migration_threw',
    ],
    [
      { status: 'unavailable', reason: 'foreign_database' },
      'unavailable',
      'foreign_database',
    ],
    ['throw', 'unavailable', 'open_failed'],
  ]
  for (const [index, [failure, status, reason]] of cases.entries()) {
    const dir = join(root, `data-${index}`)
    const { data, logs } = quiet({
      dir,
      home: join(root, 'dsh'),
      openDb: async () => {
        if (failure === 'throw') throw new Error('/secret/path exploded')
        return failure
      },
    })
    assert.equal(await data.open(), status)
    assert.deepEqual(logs, [`Corn data ${status}: ${reason}`])
    assert.ok(!logs.join().includes('secret'), 'no path or driver text')
    assert.equal(existsSync(join(dir, DATA_LOCK_FILE)), false)
  }
})

test('a directory overlapping the home is unavailable and nothing is created', async (t) => {
  const root = await scratch(t)
  const home = join(root, 'dsh')
  const { data } = quiet({ dir: join(home, 'corn-data'), home })
  assert.equal(await data.open(), 'unavailable')
  assert.equal(existsSync(home), false)
})

test('bindings from another DSH home are marked home_mismatch and unusable until it returns', async (t) => {
  const root = await scratch(t)
  const dir = join(root, 'data')
  const homeA = join(root, 'dsh-a')
  const homeB = join(root, 'dsh-b')
  await claimCornHome(homeA)
  await claimCornHome(homeB)
  const idA = await readCornHomeId(homeA)
  const idB = await readCornHomeId(homeB)
  assert.ok(idA && idB && idA !== idB)

  const first = quiet({ dir, home: homeA }).data
  assert.equal(await first.open(), 'ready')
  assert.equal(first.homeCheck, 'matched')
  const bindingId = seedBinding(first, idA)
  await first.close()

  const elsewhere = quiet({ dir, home: homeB })
  assert.equal(await elsewhere.data.open(), 'ready')
  assert.equal(elsewhere.data.homeCheck, 'mismatch')
  assert.deepEqual(elsewhere.logs, ['Corn data home check: mismatch'])
  const marked = elsewhere.data.db?.read((tx) =>
    getSessionBinding(tx, bindingId),
  )
  assert.equal(marked?.lastError, HOME_MISMATCH)
  assert.equal(marked?.stage, 'planned', 'the checkpoint is kept')
  assert.equal(elsewhere.data.isBindingUsable({ homeId: idA }), false)
  assert.equal(
    elsewhere.data.db?.read((tx) => getMeta(tx, 'home_id')),
    idA,
    'the database keeps its first pairing',
  )
  await elsewhere.data.close()

  const back = quiet({ dir, home: homeA }).data
  assert.equal(await back.open(), 'ready')
  assert.equal(back.homeCheck, 'matched')
  const cleared = back.db?.read((tx) => getSessionBinding(tx, bindingId))
  assert.equal(cleared?.lastError, null)
  assert.equal(back.isBindingUsable({ homeId: idA }), true)
  await back.close()
})

test('close checkpoints the WAL, releases the lock and disables data; quit before open is clean', async (t) => {
  const root = await scratch(t)
  const dir = join(root, 'data')
  const { data } = quiet({ dir, home: join(root, 'dsh') })
  assert.equal(await data.open(), 'ready')
  data.db?.write((tx) => setUiPref(tx, 'layout.detailsOpen', true, { now: T0 }))
  const db = data.db
  await Promise.all([data.close(), data.close()])
  assert.equal(db?.isOpen, false)
  const wal = `${dataPaths(dir).database}-wal`
  assert.ok(!existsSync(wal) || statSync(wal).size === 0)
  assert.equal(existsSync(join(dir, DATA_LOCK_FILE)), false)
  assert.equal(data.status, 'unavailable')
  assert.equal(data.db, undefined)

  const early = quiet({ dir: join(root, 'early'), home: join(root, 'dsh') })
  await early.data.close()
  assert.equal(await early.data.open(), 'opening')
  assert.equal(existsSync(join(root, 'early')), false)
})

test('a quit during open closes the database it just opened', async (t) => {
  const root = await scratch(t)
  const dir = join(root, 'data')
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const { data } = quiet({
    dir,
    home: join(root, 'dsh'),
    lock: async (lockDir, file) => {
      await gate
      return acquireProcessLock(lockDir, file)
    },
  })
  const opening = data.open()
  const closing = data.close()
  release()
  await closing
  assert.equal(await opening, 'opening')
  assert.equal(existsSync(join(dir, DATA_LOCK_FILE)), false)
  assert.equal(data.db, undefined)
})

test('legacy home markers gain a homeId and keep their fields; reading never writes', async (t) => {
  const root = await scratch(t)
  const legacy = join(root, 'legacy')
  await mkdir(legacy)
  await writeFile(
    join(legacy, '.corn-bot-home.json'),
    `${JSON.stringify({ owner: 'corn-bot', purpose: 'review-regression', schemaVersion: 1 })}\n`,
  )
  assert.equal(await readCornHomeId(legacy), undefined)
  await claimCornHome(legacy)
  const marker = JSON.parse(
    await readFile(join(legacy, '.corn-bot-home.json'), 'utf8'),
  )
  assert.equal(marker.purpose, 'review-regression')
  assert.match(marker.homeId, /^home_/u)
  await claimCornHome(legacy)
  assert.equal(await readCornHomeId(legacy), marker.homeId, 'stable')
  assert.deepEqual(await readdir(legacy), ['.corn-bot-home.json'])

  const tampered = join(root, 'tampered')
  await mkdir(tampered)
  await writeFile(
    join(tampered, '.corn-bot-home.json'),
    JSON.stringify({ owner: 'corn-bot', homeId: '../../etc' }),
  )
  await claimCornHome(tampered)
  assert.equal(await readCornHomeId(tampered), undefined)
  assert.equal(await readCornHomeId(join(root, 'missing')), undefined)
  assert.equal(existsSync(join(root, 'missing')), false)
  await assert.rejects(readCornHomeId(join(homedir(), '.dsh')), /Refusing/u)
})

test('UI preferences map the contract keys onto the stored keys', async (t) => {
  const root = await scratch(t)
  const { data } = quiet({ dir: join(root, 'data'), home: join(root, 'dsh') })
  assert.equal(await data.open(), 'ready')
  const db = data.db
  assert.ok(db)
  assert.deepEqual(readUiPrefs(db), DEFAULT_UI_PREFS)
  db.write((tx) => setUiPref(tx, 'layout.sidebarWidth', 280, { now: T0 }))
  writeUiPref(db, { key: 'selectedBotId', value: 'bot_1' }, T0)
  writeUiPref(db, { key: 'detailsOpen', value: true }, T0)
  writeUiPref(db, { key: 'sidebarCollapsed', value: true }, T0)
  assert.deepEqual(readUiPrefs(db), {
    selectedBotId: 'bot_1',
    detailsOpen: true,
    sidebarCollapsed: true,
  })
  writeUiPref(db, { key: 'selectedBotId', value: null }, T0)
  assert.equal(readUiPrefs(db).selectedBotId, null)
  assert.equal(
    db.read(
      (tx) =>
        tx.get(
          "SELECT value_json FROM ui_prefs WHERE key = 'layout.sidebarWidth'",
        )?.value_json,
    ),
    '280',
    'the width the IPC does not offer is left alone',
  )
  await data.close()
})

test('the data status channel answers only the owned main frame with the status alone', async () => {
  const handlers = new Map<string, (event: IpcMainInvokeEvent) => unknown>()
  const mainFrame = {}
  const webContents = { mainFrame }
  const window = { webContents } as BrowserWindow
  registerDataIpc(
    {
      handle: (channel: string, handler: never) => {
        handlers.set(channel, handler)
      },
    } as never,
    window,
    { view: () => ({ status: 'locked' }) },
  )
  assert.deepEqual([...handlers.keys()], [DATA_CHANNELS.status])
  const handler = handlers.get(DATA_CHANNELS.status)
  assert.ok(handler)
  assert.deepEqual(
    handler({ sender: webContents, senderFrame: mainFrame } as never),
    { status: 'locked' },
  )
  for (const event of [
    { sender: { mainFrame }, senderFrame: mainFrame },
    { sender: webContents, senderFrame: {} },
  ])
    assert.throws(() => handler(event as never), /Untrusted/u)
})
