import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TestContext } from 'node:test'
import { SqliteConnection } from '../src/driver.ts'
import {
  type LocalDb,
  type LocalDbOpenResult,
  type OpenLocalDbOptions,
  openLocalDb,
} from '../src/open.ts'
import { insertSessionBinding } from '../src/stores/bindings.ts'
import { insertBot } from '../src/stores/bots.ts'
import { insertMainConversation } from '../src/stores/conversations.ts'

export const T0 = 1_760_000_000_000

export function tempDir(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'corn-local-db-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

export function dbPath(dir: string): string {
  return join(dir, 'corn.sqlite')
}

export function expectReady(result: LocalDbOpenResult): LocalDb {
  if (result.status !== 'ready') {
    assert.fail(`expected ready, got ${JSON.stringify(result)}`)
  }
  return result.db
}

export async function openReady(
  t: TestContext,
  options: OpenLocalDbOptions,
): Promise<LocalDb> {
  const db = expectReady(await openLocalDb(options))
  t.after(() => db.close())
  return db
}

/** Raw connection for tampering, still through the driver. */
export function withRaw<T>(
  path: string,
  fn: (connection: SqliteConnection) => T,
  options: { readonly readOnly?: boolean } = {},
): T {
  const connection = SqliteConnection.open(path, options)
  try {
    return fn(connection)
  } finally {
    connection.close()
  }
}

export function fileSha(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export interface SeededChat {
  readonly botId: string
  readonly conversationId: string
  readonly bindingId: string
}

export function seedChat(db: LocalDb, suffix = '1'): SeededChat {
  const ids = {
    botId: `bot_${suffix}`,
    conversationId: `conv_${suffix}`,
    bindingId: `bind_${suffix}`,
  }
  db.write((tx) => {
    insertBot(tx, {
      botId: ids.botId,
      displayName: `Bot ${suffix}`,
      avatarVariant: null,
      sortKey: suffix,
      modelOverride: null,
      now: T0,
    })
    insertMainConversation(tx, {
      conversationId: ids.conversationId,
      botId: ids.botId,
      now: T0,
    })
    insertSessionBinding(tx, {
      bindingId: ids.bindingId,
      conversationId: ids.conversationId,
      dshSessionId: `corn-${suffix}`,
      homeId: 'home_test',
      now: T0,
    })
  })
  return ids
}
