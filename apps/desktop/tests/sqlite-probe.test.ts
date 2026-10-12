import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { probeSqlite, sqliteProbePassed } from '../src/smoke/sqlite-probe.ts'

test('the probe proves WAL, FULL sync, foreign keys and backup, then cleans up', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'corn-sqlite-probe-test-'))
  try {
    const facts = await probeSqlite(parent)
    assert.equal(facts.failure, null)
    assert.match(facts.sqliteVersion ?? '', /^3\.\d+\.\d+$/u)
    assert.equal(facts.wal, true)
    assert.equal(facts.synchronousFull, true)
    assert.equal(facts.foreignKeys, true)
    assert.equal(facts.backupOk, true)
    assert.deepEqual(await readdir(parent), [])
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

test('plain Node is not Electron Main, so the smoke check stays failed', async () => {
  const facts = await probeSqlite()
  assert.equal(facts.mainProcess, false)
  assert.equal(sqliteProbePassed(facts), false)
  assert.equal(sqliteProbePassed({ ...facts, mainProcess: true }), true)
})

test('an unusable scratch parent reports a code, never a path', async () => {
  const missing = join(tmpdir(), 'corn-sqlite-probe-missing', 'nested')
  const facts = await probeSqlite(missing)
  assert.equal(facts.failure, 'ENOENT')
  assert.equal(facts.sqliteVersion, null)
  assert.equal(sqliteProbePassed({ ...facts, mainProcess: true }), false)
  assert.doesNotMatch(JSON.stringify(facts), /corn-sqlite-probe-missing/u)
})

for (const fact of [
  'wal',
  'synchronousFull',
  'foreignKeys',
  'backupOk',
] as const) {
  test(`a false ${fact} fails the smoke check`, () => {
    const passing = {
      sqliteVersion: '3.53.4',
      wal: true,
      synchronousFull: true,
      foreignKeys: true,
      backupOk: true,
      mainProcess: true,
      failure: null,
    }
    assert.equal(sqliteProbePassed(passing), true)
    assert.equal(sqliteProbePassed({ ...passing, [fact]: false }), false)
  })
}
