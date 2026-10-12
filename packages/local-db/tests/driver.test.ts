import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isLocalDbError, LocalDbError } from '../src/errors.ts'
import { getBot, insertBot, listBots } from '../src/stores/bots.ts'
import { insertMainConversation } from '../src/stores/conversations.ts'
import { openReady, T0 } from './helpers.ts'

function newBot(botId: string) {
  return {
    botId,
    displayName: botId,
    avatarVariant: null,
    sortKey: botId,
    modelOverride: null,
    now: T0,
  } as const
}

function isCode(code: LocalDbError['code']) {
  return (error: unknown) => isLocalDbError(error, code)
}

test('write() commits a synchronous callback and returns its value', async (t) => {
  const db = await openReady(t, { path: ':memory:' })
  const bot = db.write((tx) => insertBot(tx, newBot('bot_a')))
  assert.equal(bot.revision, 1)
  assert.equal(db.read((tx) => getBot(tx, 'bot_a'))?.displayName, 'bot_a')
})

test('write() rolls back and rethrows when the callback throws', async (t) => {
  const db = await openReady(t, { path: ':memory:' })
  const boom = new Error('boom')
  assert.throws(
    () =>
      db.write((tx) => {
        insertBot(tx, newBot('bot_a'))
        throw boom
      }),
    (error) => error === boom,
  )
  assert.equal(
    db.read((tx) => getBot(tx, 'bot_a')),
    null,
  )
})

test('an async write callback throws, rolls back, and cannot write after the await', async (t) => {
  const db = await openReady(t, { path: ':memory:' })
  let late: Promise<void> | undefined
  assert.throws(
    () =>
      db.write((tx) => {
        insertBot(tx, newBot('bot_a'))
        late = (async () => {
          await null
          insertBot(tx, newBot('bot_b'))
        })()
        return late
      }),
    isCode('async_transaction'),
  )
  await assert.rejects(late as Promise<void>, isCode('transaction_closed'))
  assert.deepEqual(
    db.read((tx) => listBots(tx, { includeHidden: true })),
    [],
  )

  assert.throws(
    () =>
      db.write(async (tx) => {
        insertBot(tx, newBot('bot_c'))
      }),
    isCode('async_transaction'),
  )
  assert.equal(
    db.read((tx) => getBot(tx, 'bot_c')),
    null,
  )
  db.write((tx) => insertBot(tx, newBot('bot_d')))
  assert.notEqual(
    db.read((tx) => getBot(tx, 'bot_d')),
    null,
  )
})

test('read() rejects async callbacks and writes', async (t) => {
  const db = await openReady(t, { path: ':memory:' })
  assert.throws(
    () => db.read(async (tx) => getBot(tx, 'x')),
    isCode('async_transaction'),
  )
  assert.throws(() => db.read((tx) => insertBot(tx, newBot('bot_a'))))
  db.write((tx) => insertBot(tx, newBot('bot_b')))
  assert.equal(db.read((tx) => listBots(tx, { includeHidden: true })).length, 1)
})

test('transactions cannot nest', async (t) => {
  const db = await openReady(t, { path: ':memory:' })
  assert.throws(
    () => db.write(() => db.write(() => 1)),
    isCode('nested_transaction'),
  )
  assert.throws(
    () => db.write(() => db.read(() => 1)),
    isCode('nested_transaction'),
  )
  assert.equal(
    db.write(() => 2),
    2,
  )
})

test('a foreign key violation is rejected as a typed constraint error', async (t) => {
  const db = await openReady(t, { path: ':memory:' })
  assert.throws(
    () =>
      db.write((tx) =>
        insertMainConversation(tx, {
          conversationId: 'conv_a',
          botId: 'bot_missing',
          now: T0,
        }),
      ),
    (error) =>
      error instanceof LocalDbError &&
      error.code === 'constraint' &&
      error.constraint === 'foreign_key',
  )
})

test('a closed database refuses transactions', async (t) => {
  const db = await openReady(t, { path: ':memory:' })
  db.close()
  db.close()
  assert.throws(() => db.read(() => 1), isCode('closed'))
})
