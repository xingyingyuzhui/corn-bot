import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isLocalDbError, LocalDbError } from '../src/errors.ts'
import {
  ADMISSION_STATES,
  admissionTransitions,
  bodyChecksum,
  findMessageAdmissionByClientId,
  insertMessageAdmission,
  listOpenMessageAdmissions,
  listUnsettledMessageAdmissions,
  parseMessageAdmissionRow,
  transitionMessageAdmission,
} from '../src/stores/admissions.ts'
import {
  getClawAgent,
  insertClawAgent,
  parseClawAgentRow,
} from '../src/stores/agents.ts'
import {
  getLiveSessionBinding,
  insertSessionBinding,
  setSessionBindingAppliedModel,
  setSessionBindingStage,
} from '../src/stores/bindings.ts'
import {
  getBot,
  insertBot,
  listBots,
  parseBotRow,
  setBotHidden,
  setBotModelOverride,
  setBotPinned,
  updateBotProfile,
} from '../src/stores/bots.ts'
import {
  getMainConversation,
  insertMainConversation,
} from '../src/stores/conversations.ts'
import { getMeta, setMeta } from '../src/stores/meta.ts'
import {
  createTag,
  listBotTagIds,
  listTags,
  setBotTags,
} from '../src/stores/tags.ts'
import { clearUiPref, getUiPrefs, setUiPref } from '../src/stores/ui-prefs.ts'
import { openReady, seedChat, T0 } from './helpers.ts'

function constraint(kind: LocalDbError['constraint']) {
  return (error: unknown) =>
    error instanceof LocalDbError &&
    error.code === 'constraint' &&
    error.constraint === kind
}

function isCode(code: LocalDbError['code']) {
  return (error: unknown) => isLocalDbError(error, code)
}

test('UNIQUE(conversation_id, client_id) dedupes admissions per conversation', async (t) => {
  const db = await openReady(t, { path: ':memory:' })
  const chat = seedChat(db, '1')
  const other = seedChat(db, '2')
  const admit = (requestId: string, target = chat) =>
    db.write((tx) =>
      insertMessageAdmission(tx, {
        requestId,
        conversationId: target.conversationId,
        bindingId: target.bindingId,
        clientId: 'client_1',
        bodyText: 'hello',
        now: T0,
      }),
    )
  admit('req_1')
  assert.throws(() => admit('req_2'), constraint('unique'))
  admit('req_3', other)
  assert.equal(
    db.read((tx) =>
      findMessageAdmissionByClientId(tx, chat.conversationId, 'client_1'),
    )?.requestId,
    'req_1',
  )
})

test('an admission cannot reference another conversation’s binding', async (t) => {
  const db = await openReady(t, { path: ':memory:' })
  const chat = seedChat(db, '1')
  const other = seedChat(db, '2')
  assert.throws(
    () =>
      db.write((tx) =>
        insertMessageAdmission(tx, {
          requestId: 'req_x',
          conversationId: chat.conversationId,
          bindingId: other.bindingId,
          clientId: 'client_x',
          bodyText: 'hi',
          now: T0,
        }),
      ),
    constraint('foreign_key'),
  )
})

test('one live binding per conversation; retiring frees the slot and is terminal', async (t) => {
  const db = await openReady(t, { path: ':memory:' })
  const chat = seedChat(db)
  const second = (bindingId: string, dshSessionId: string) =>
    db.write((tx) =>
      insertSessionBinding(tx, {
        bindingId,
        conversationId: chat.conversationId,
        dshSessionId,
        homeId: 'home_test',
        now: T0,
      }),
    )
  assert.throws(() => second('bind_2', 'corn-2'), constraint('unique'))
  db.write((tx) =>
    setSessionBindingStage(tx, chat.bindingId, 'retired', {
      now: T0 + 1,
      lastError: 'session_missing',
    }),
  )
  assert.equal(
    db.read((tx) => getLiveSessionBinding(tx, chat.conversationId)),
    null,
  )
  assert.throws(() => second('bind_3', 'corn-1'), constraint('unique'))
  second('bind_2', 'corn-2')
  assert.equal(
    db.read((tx) => getLiveSessionBinding(tx, chat.conversationId))?.bindingId,
    'bind_2',
  )
  assert.throws(
    () =>
      db.write((tx) =>
        setSessionBindingStage(tx, chat.bindingId, 'ready', {
          now: T0 + 2,
          lastError: null,
        }),
      ),
    isCode('invalid_transition'),
  )
})

test('binding stage and applied model updates validate closed error codes', async (t) => {
  const db = await openReady(t, { path: ':memory:' })
  const chat = seedChat(db)
  const ready = db.write((tx) => {
    setSessionBindingStage(tx, chat.bindingId, 'ready', {
      now: T0 + 1,
      lastError: null,
    })
    return setSessionBindingAppliedModel(
      tx,
      chat.bindingId,
      { provider: 'deepseek', model: 'deepseek-chat', effort: null },
      { now: T0 + 2 },
    )
  })
  assert.equal(ready.stage, 'ready')
  assert.deepEqual(ready.appliedModel, {
    provider: 'deepseek',
    model: 'deepseek-chat',
    effort: null,
  })
  assert.equal(ready.updatedAt, T0 + 2)
  assert.throws(
    () =>
      db.write((tx) =>
        setSessionBindingStage(tx, chat.bindingId, 'needs_model', {
          now: T0 + 3,
          lastError: 'Host said: model gpt-x missing',
        }),
      ),
    isCode('invalid_input'),
  )
})

test('one main conversation per Bot', async (t) => {
  const db = await openReady(t, { path: ':memory:' })
  const chat = seedChat(db)
  assert.throws(
    () =>
      db.write((tx) =>
        insertMainConversation(tx, {
          conversationId: 'conv_other',
          botId: chat.botId,
          now: T0,
        }),
      ),
    constraint('unique'),
  )
  assert.equal(
    db.read((tx) => getMainConversation(tx, chat.botId))?.conversationId,
    chat.conversationId,
  )
})

test('body_text is cleared once the admission is observed and cannot come back', async (t) => {
  const db = await openReady(t, { path: ':memory:' })
  const chat = seedChat(db)
  db.write((tx) =>
    insertMessageAdmission(tx, {
      requestId: 'req_1',
      conversationId: chat.conversationId,
      bindingId: chat.bindingId,
      clientId: 'client_1',
      bodyText: 'secret plan',
      now: T0,
    }),
  )
  const sending = db.write((tx) =>
    transitionMessageAdmission(tx, 'req_1', 'sending', {
      now: T0 + 1,
      countAttempt: true,
    }),
  )
  assert.equal(sending.attempts, 1)
  assert.equal(sending.bodyText, 'secret plan')
  db.write((tx) =>
    transitionMessageAdmission(tx, 'req_1', 'accepted', { now: T0 + 2 }),
  )
  const observed = db.write((tx) =>
    transitionMessageAdmission(tx, 'req_1', 'observed', {
      now: T0 + 3,
      observedSeq: 42,
    }),
  )
  assert.equal(observed.bodyText, null)
  assert.equal(observed.bodySha256, bodyChecksum('secret plan'))
  assert.equal(observed.observedSeq, 42)
  assert.equal(
    db.read((tx) =>
      tx.get(
        "SELECT body_text FROM message_admissions WHERE request_id = 'req_1'",
      ),
    )?.body_text,
    null,
  )
  assert.throws(
    () =>
      db.write((tx) =>
        tx.run(
          "UPDATE message_admissions SET body_text = 'x' WHERE request_id = 'req_1'",
        ),
      ),
    constraint('check'),
  )
  assert.throws(
    () =>
      db.write((tx) =>
        transitionMessageAdmission(tx, 'req_1', 'sending', { now: T0 + 4 }),
      ),
    isCode('invalid_transition'),
  )
})

test('admission transitions follow the closed table and unknown keeps the body', async (t) => {
  const db = await openReady(t, { path: ':memory:' })
  const chat = seedChat(db)
  db.write((tx) =>
    insertMessageAdmission(tx, {
      requestId: 'req_1',
      conversationId: chat.conversationId,
      bindingId: chat.bindingId,
      clientId: 'client_1',
      bodyText: 'retry me',
      now: T0,
    }),
  )
  assert.throws(
    () =>
      db.write((tx) =>
        transitionMessageAdmission(tx, 'req_1', 'accepted', { now: T0 }),
      ),
    isCode('invalid_transition'),
  )
  assert.throws(
    () =>
      db.write((tx) =>
        transitionMessageAdmission(tx, 'req_1', 'sending', {
          now: T0,
          observedSeq: 3,
        }),
      ),
    isCode('invalid_input'),
  )
  const unknown = db.write((tx) => {
    transitionMessageAdmission(tx, 'req_1', 'sending', {
      now: T0 + 1,
      countAttempt: true,
    })
    return transitionMessageAdmission(tx, 'req_1', 'unknown', {
      now: T0 + 2,
      lastError: 'host_timeout',
    })
  })
  assert.equal(unknown.bodyText, 'retry me')
  assert.equal(unknown.lastError, 'host_timeout')
  assert.deepEqual(
    db.read((tx) => listOpenMessageAdmissions(tx)).map((row) => row.requestId),
    ['req_1'],
  )
  const withdrawn = db.write((tx) =>
    transitionMessageAdmission(tx, 'req_1', 'withdrawn', { now: T0 + 3 }),
  )
  assert.equal(withdrawn.bodyText, null)
  assert.deepEqual(
    db.read((tx) => listOpenMessageAdmissions(tx)),
    [],
  )
  for (const state of ADMISSION_STATES) {
    for (const next of admissionTransitions(state)) {
      assert.notEqual(next, state)
    }
  }
})

test('a rejected admission keeps its body, can be resent and is listed as unsettled', async (t) => {
  const db = await openReady(t, { path: ':memory:' })
  const chat = seedChat(db)
  const other = seedChat(db, '2')
  const admit = (requestId: string, target = chat, now = T0) =>
    db.write((tx) =>
      insertMessageAdmission(tx, {
        requestId,
        conversationId: target.conversationId,
        bindingId: target.bindingId,
        clientId: `client_${requestId}`,
        bodyText: 'refused',
        now,
      }),
    )
  admit('req_2', chat, T0 + 1)
  admit('req_1')
  admit('req_3', chat, T0 + 2)
  admit('req_9', other)

  const refused = db.write((tx) =>
    transitionMessageAdmission(tx, 'req_1', 'rejected', {
      now: T0 + 3,
      lastError: 'not_sent',
    }),
  )
  assert.equal(refused.bodyText, 'refused')
  assert.equal(refused.attempts, 0)
  db.write((tx) => {
    transitionMessageAdmission(tx, 'req_3', 'sending', { now: T0 + 3 })
    transitionMessageAdmission(tx, 'req_3', 'accepted', { now: T0 + 4 })
    transitionMessageAdmission(tx, 'req_3', 'observed', {
      now: T0 + 5,
      observedSeq: 7,
    })
  })
  assert.deepEqual(
    db
      .read((tx) => listUnsettledMessageAdmissions(tx, chat.conversationId))
      .map((row) => [row.requestId, row.state]),
    [
      ['req_1', 'rejected'],
      ['req_2', 'pending'],
    ],
  )

  const resent = db.write((tx) =>
    transitionMessageAdmission(tx, 'req_1', 'sending', {
      now: T0 + 6,
      countAttempt: true,
    }),
  )
  assert.equal(resent.attempts, 1)
  assert.equal(resent.lastError, null)
  const rejected = db.write((tx) =>
    transitionMessageAdmission(tx, 'req_1', 'rejected', {
      now: T0 + 7,
      lastError: 'session_busy',
    }),
  )
  assert.equal(rejected.bodyText, 'refused')
  const observed = db.write((tx) =>
    transitionMessageAdmission(tx, 'req_1', 'observed', {
      now: T0 + 8,
      observedSeq: 9,
    }),
  )
  assert.equal(observed.bodyText, null)
  const withdrawn = db.write((tx) =>
    transitionMessageAdmission(tx, 'req_2', 'withdrawn', { now: T0 + 9 }),
  )
  assert.equal(withdrawn.bodyText, null)
  assert.deepEqual(
    db.read((tx) => listUnsettledMessageAdmissions(tx, chat.conversationId)),
    [],
  )
})

test('row parsers reject values outside their closed enums', () => {
  const admission = {
    request_id: 'r',
    conversation_id: 'c',
    binding_id: 'b',
    client_id: 'x',
    mode: 'queue',
    state: 'teleported',
    body_text: null,
    body_sha256: 'a'.repeat(64),
    attempts: 0,
    observed_seq: null,
    last_error: null,
    created_at: T0,
    updated_at: T0,
  }
  assert.throws(
    () => parseMessageAdmissionRow(admission),
    isCode('invalid_row'),
  )
  assert.throws(
    () =>
      parseMessageAdmissionRow({
        ...admission,
        state: 'pending',
        mode: 'steer',
      }),
    isCode('invalid_row'),
  )
  assert.throws(
    () =>
      parseMessageAdmissionRow({
        ...admission,
        state: 'pending',
        attempts: 2 ** 60,
      }),
    isCode('invalid_row'),
  )
  assert.throws(
    () =>
      parseBotRow({
        bot_id: 'bot_1',
        display_name: 'B',
        avatar_variant: null,
        pinned: 2,
        hidden: 0,
        sort_key: 'a',
        model_override_provider: null,
        model_override_model: null,
        model_override_effort: null,
        provisioning: 'ready',
        revision: 1,
        created_at: T0,
        updated_at: T0,
      }),
    isCode('invalid_row'),
  )
  assert.throws(
    () =>
      parseClawAgentRow({
        bot_id: 'bot_1',
        agent_id: 'agent_1',
        workspace_id: 'w',
        canonical_root: '/tmp/w',
        dsh_preset: 'wa-1',
        policy_preset: 'research',
        created_at: T0,
      }),
    isCode('invalid_row'),
  )
})

test('bots: revisions, optimistic conflicts, hidden filter and model override', async (t) => {
  const db = await openReady(t, { path: ':memory:' })
  db.write((tx) => {
    insertBot(tx, {
      botId: 'bot_b',
      displayName: 'B',
      avatarVariant: 'sprout',
      sortKey: 'b',
      modelOverride: null,
      now: T0,
    })
    insertBot(tx, {
      botId: 'bot_a',
      displayName: 'A',
      avatarVariant: null,
      sortKey: 'a',
      modelOverride: {
        provider: 'deepseek',
        model: 'deepseek-chat',
        effort: 'high',
      },
      now: T0,
    })
  })
  const renamed = db.write((tx) =>
    updateBotProfile(
      tx,
      'bot_b',
      { displayName: 'Bee', avatarVariant: null },
      { now: T0 + 1, expectedRevision: 1 },
    ),
  )
  assert.equal(renamed.revision, 2)
  assert.equal(renamed.updatedAt, T0 + 1)
  assert.throws(
    () =>
      db.write((tx) =>
        setBotPinned(tx, 'bot_b', true, { now: T0 + 2, expectedRevision: 1 }),
      ),
    isCode('revision_conflict'),
  )
  assert.throws(
    () => db.write((tx) => setBotPinned(tx, 'bot_zz', true, { now: T0 + 2 })),
    isCode('not_found'),
  )
  db.write((tx) => setBotPinned(tx, 'bot_b', true, { now: T0 + 2 }))
  assert.deepEqual(
    db.read((tx) => listBots(tx, { includeHidden: false })).map((b) => b.botId),
    ['bot_b', 'bot_a'],
  )
  db.write((tx) => setBotHidden(tx, 'bot_b', true, { now: T0 + 3 }))
  assert.deepEqual(
    db.read((tx) => listBots(tx, { includeHidden: false })).map((b) => b.botId),
    ['bot_a'],
  )
  assert.equal(db.read((tx) => listBots(tx, { includeHidden: true })).length, 2)
  const followed = db.write((tx) =>
    setBotModelOverride(tx, 'bot_a', null, { now: T0 + 4 }),
  )
  assert.equal(followed.modelOverride, null)
  assert.deepEqual(
    db.read((tx) => getBot(tx, 'bot_a'))?.provisioning,
    'creating',
  )
  assert.throws(
    () =>
      db.write((tx) =>
        tx.run(
          "UPDATE bots SET model_override_effort = 'high' WHERE bot_id = 'bot_a'",
        ),
      ),
    constraint('check'),
  )
})

test('claw agents validate wa_/wa- prefixes and the policy preset', async (t) => {
  const db = await openReady(t, { path: ':memory:' })
  const chat = seedChat(db)
  const agent = {
    botId: chat.botId,
    agentId: 'wa_corn',
    workspaceId: 'ws_1',
    canonicalRoot: '/tmp/corn/ws_1',
    dshPreset: 'wa-corn',
    policyPreset: 'research',
    now: T0,
  } as const
  assert.throws(
    () => db.write((tx) => insertClawAgent(tx, { ...agent, agentId: 'corn' })),
    isCode('invalid_input'),
  )
  assert.throws(
    () =>
      db.write((tx) => insertClawAgent(tx, { ...agent, dshPreset: 'corn' })),
    isCode('invalid_input'),
  )
  db.write((tx) => insertClawAgent(tx, agent))
  assert.equal(
    db.read((tx) => getClawAgent(tx, chat.botId))?.policyPreset,
    'research',
  )
  assert.throws(
    () =>
      db.write((tx) => insertClawAgent(tx, { ...agent, botId: 'bot_missing' })),
    (error) => error instanceof LocalDbError && error.code === 'constraint',
  )
})

test('tags: unique labels and replaceable Bot tag sets', async (t) => {
  const db = await openReady(t, { path: ':memory:' })
  const chat = seedChat(db)
  db.write((tx) => {
    createTag(tx, { tagId: 'tag_1', label: '工作', now: T0 })
    createTag(tx, { tagId: 'tag_2', label: '学习', now: T0 + 1 })
  })
  assert.throws(
    () =>
      db.write((tx) =>
        createTag(tx, { tagId: 'tag_3', label: '工作', now: T0 }),
      ),
    constraint('unique'),
  )
  db.write((tx) => setBotTags(tx, chat.botId, ['tag_2', 'tag_1']))
  assert.deepEqual(
    db.read((tx) => listBotTagIds(tx, chat.botId)),
    ['tag_1', 'tag_2'],
  )
  db.write((tx) => setBotTags(tx, chat.botId, ['tag_2']))
  assert.deepEqual(
    db.read((tx) => listBotTagIds(tx, chat.botId)),
    ['tag_2'],
  )
  assert.throws(
    () => db.write((tx) => setBotTags(tx, chat.botId, ['tag_missing'])),
    constraint('foreign_key'),
  )
  assert.deepEqual(
    db.read((tx) => listBotTagIds(tx, chat.botId)),
    ['tag_2'],
  )
  assert.equal(db.read((tx) => listTags(tx)).length, 2)
})

test('ui prefs: whitelisted keys, typed values, invalid stored rows skipped', async (t) => {
  const db = await openReady(t, { path: ':memory:' })
  db.write((tx) => {
    setUiPref(tx, 'layout.sidebarWidth', 300, { now: T0 })
    setUiPref(tx, 'layout.sidebarCollapsed', true, { now: T0 })
    setUiPref(tx, 'layout.sidebarWidth', 320, { now: T0 + 1 })
  })
  assert.throws(
    () =>
      db.write((tx) => setUiPref(tx, 'layout.sidebarWidth', 1.5, { now: T0 })),
    isCode('invalid_input'),
  )
  assert.throws(
    () =>
      db.write((tx) =>
        setUiPref(tx, 'layout.theme' as 'layout.detailsOpen', true, {
          now: T0,
        }),
      ),
    isCode('invalid_input'),
  )
  db.write((tx) => {
    tx.run(
      "INSERT INTO ui_prefs (key, value_json, updated_at) VALUES ('layout.theme', '\"dark\"', 0)",
    )
    tx.run(
      "INSERT INTO ui_prefs (key, value_json, updated_at) VALUES ('layout.detailsOpen', 'not json', 0)",
    )
  })
  assert.deepEqual(
    db.read((tx) => getUiPrefs(tx)),
    {
      'layout.sidebarWidth': 320,
      'layout.sidebarCollapsed': true,
    },
  )
  db.write((tx) => {
    clearUiPref(tx, 'layout.sidebarWidth')
    clearUiPref(tx, 'workspace.selectedBotId')
  })
  assert.deepEqual(
    db.read((tx) => getUiPrefs(tx)),
    {
      'layout.sidebarCollapsed': true,
    },
  )
  assert.throws(
    () =>
      db.write((tx) => clearUiPref(tx, 'layout.theme' as 'layout.detailsOpen')),
    isCode('invalid_input'),
  )
})

test('meta stores home_id alongside the minted data_id', async (t) => {
  const db = await openReady(t, { path: ':memory:' })
  const dataId = db.read((tx) => getMeta(tx, 'data_id'))
  db.write((tx) => setMeta(tx, 'home_id', 'home_abc'))
  db.write((tx) => setMeta(tx, 'home_id', 'home_def'))
  assert.equal(
    db.read((tx) => getMeta(tx, 'home_id')),
    'home_def',
  )
  assert.equal(
    db.read((tx) => getMeta(tx, 'data_id')),
    dataId,
  )
})
