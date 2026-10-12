import type {
  MessageCommand,
  SendMessageCommand,
  WorkspaceResult,
} from '../../../../packages/contracts/src/workspace.ts'
import {
  type AdmissionState,
  type AdmissionTransition,
  bodyChecksum,
  findMessageAdmissionByClientId,
  findSessionBindingBySessionId,
  getBot,
  getConversation,
  getLiveSessionBinding,
  getMainConversation,
  getMessageAdmission,
  getSessionBinding,
  insertMessageAdmission,
  isLocalDbError,
  type LocalDb,
  listOpenMessageAdmissions,
  listUnsettledMessageAdmissions,
  type MessageAdmissionRow,
  type SessionBindingRow,
  transitionMessageAdmission,
} from '../../../../packages/local-db/src/index.ts'
import type { CornData } from '../data/open.ts'
import {
  admissionView,
  messageIdFor,
  requestIdFor,
  type SendFailure,
} from './chat-admissions.ts'
import { fail, type Located, OK } from './chat-runtime.ts'
import type {
  AdmissionObservation,
  AdmissionView,
} from './conversation-projector.ts'

/**
 * The `message_admissions` side of the chat: which Session a Bot sends to and
 * every guarded admission write. Never talks to the Host.
 */

/** A Bot's main conversation with its usable live binding. */
export interface ChatTarget {
  readonly db: LocalDb
  readonly botId: string
  readonly conversationId: string
  readonly binding: SessionBindingRow
  readonly sessionId: string
}

export interface ChatLedgerOptions {
  readonly data: Pick<CornData, 'available' | 'isBindingUsable'>
  readonly now: () => number
  readonly log: (line: string) => void
  /** An admission of this conversation changed through a guarded move or insert. */
  readonly onChanged: (conversationId: string) => void
}

export interface MoveOptions extends Omit<AdmissionTransition, 'now'> {
  readonly from: readonly AdmissionState[]
}

/** States the follow may settle as `observed` (the journal is the fact). */
const OBSERVABLE: readonly AdmissionState[] = [
  'sending',
  'unknown',
  'accepted',
  'rejected',
]

const isProvisioned = (binding: SessionBindingRow): boolean =>
  binding.stage === 'ready' ||
  binding.stage === 'needs_model' ||
  binding.stage === 'model_applied'

export class ChatLedger {
  readonly #data: ChatLedgerOptions['data']
  readonly #now: () => number
  readonly #log: (line: string) => void
  readonly #onChanged: (conversationId: string) => void

  constructor(options: ChatLedgerOptions) {
    this.#data = options.data
    this.#now = options.now
    this.#log = options.log
    this.#onChanged = options.onChanged
  }

  db(): LocalDb | undefined {
    const available = this.#data.available()
    return available.ok ? available.value : undefined
  }

  /** The Bot's one main conversation and its usable live binding. */
  target(botId: string): WorkspaceResult<ChatTarget> {
    const available = this.#data.available()
    if (!available.ok) return available
    const db = available.value
    let result: WorkspaceResult<ChatTarget>
    try {
      result = db.read((tx): WorkspaceResult<ChatTarget> => {
        const bot = getBot(tx, botId)
        if (bot === null) return fail('not_found')
        const conversation = getMainConversation(tx, botId)
        const binding =
          conversation === null
            ? null
            : getLiveSessionBinding(tx, conversation.conversationId)
        if (conversation === null || binding === null)
          return fail('binding_broken')
        if (!isProvisioned(binding))
          return fail(
            bot.provisioning === 'creating' ? 'unavailable' : 'binding_broken',
          )
        if (!this.#data.isBindingUsable(binding)) return fail('binding_broken')
        return {
          ok: true,
          value: {
            db,
            botId,
            conversationId: conversation.conversationId,
            binding,
            sessionId: binding.dshSessionId,
          },
        }
      })
    } catch {
      return fail('data_unavailable')
    }
    return result
  }

  /** The send target of an admission's binding, when it is still live and usable. */
  bindingTarget(db: LocalDb, row: MessageAdmissionRow): ChatTarget | undefined {
    try {
      return db.read((tx) => {
        const binding = getSessionBinding(tx, row.bindingId)
        if (
          binding === null ||
          !isProvisioned(binding) ||
          !this.#data.isBindingUsable(binding)
        )
          return undefined
        const conversation = getConversation(tx, binding.conversationId)
        if (conversation === null) return undefined
        return {
          db,
          botId: conversation.botId,
          conversationId: conversation.conversationId,
          binding,
          sessionId: binding.dshSessionId,
        }
      })
    } catch {
      return undefined
    }
  }

  /**
   * The broker's `botForSession`: the Bot of a provisioned foreground binding
   * of the current home, else `undefined` (the request fails closed).
   */
  botForSession(sessionId: string): string | undefined {
    const db = this.db()
    if (db === undefined) return undefined
    try {
      return db.read((tx) => {
        const binding = findSessionBindingBySessionId(tx, sessionId)
        if (
          binding === null ||
          !isProvisioned(binding) ||
          !this.#data.isBindingUsable(binding)
        )
          return undefined
        return getConversation(tx, binding.conversationId)?.botId
      })
    } catch {
      return undefined
    }
  }

  /**
   * Persists a new admission before any RPC; resolves to its message id. A
   * `clientId` admitted concurrently resolves like `repeat`.
   */
  admit(
    target: ChatTarget,
    command: SendMessageCommand,
    requestId: string,
  ): WorkspaceResult<string> {
    try {
      target.db.write((tx) =>
        insertMessageAdmission(tx, {
          requestId,
          conversationId: target.conversationId,
          bindingId: target.binding.bindingId,
          clientId: command.clientId,
          bodyText: command.text,
          now: this.#now(),
        }),
      )
    } catch (error) {
      if (isLocalDbError(error, 'constraint'))
        return this.repeat(target, command) ?? fail('conflict')
      return fail('data_unavailable')
    }
    this.#onChanged(target.conversationId)
    return { ok: true, value: messageIdFor(requestId) as string }
  }

  /** A repeated `clientId`: the original message id, or `conflict` for other text. */
  repeat(
    target: ChatTarget,
    command: SendMessageCommand,
  ): WorkspaceResult<string> | undefined {
    const existing = target.db.read((tx) =>
      findMessageAdmissionByClientId(
        tx,
        target.conversationId,
        command.clientId,
      ),
    )
    if (existing === null) return undefined
    const messageId = messageIdFor(existing.requestId)
    if (
      messageId === undefined ||
      existing.bodySha256 !== bodyChecksum(command.text)
    )
      return fail('conflict')
    return { ok: true, value: messageId }
  }

  admission(
    command: MessageCommand,
  ): WorkspaceResult<{ target: ChatTarget; row: MessageAdmissionRow }> {
    const resolved = this.target(command.botId)
    if (!resolved.ok) return resolved
    const requestId = requestIdFor(command.messageId)
    if (requestId === undefined) return fail('not_found')
    const row = this.read(resolved.value, requestId)
    if (row === null) return fail('not_found')
    return { ok: true, value: { target: resolved.value, row } }
  }

  /** The admission when it belongs to the target's conversation. */
  read(target: ChatTarget, requestId: string): MessageAdmissionRow | null {
    try {
      const row = target.db.read((tx) => getMessageAdmission(tx, requestId))
      return row?.conversationId === target.conversationId ? row : null
    } catch {
      return null
    }
  }

  /**
   * Withdraws a still-`pending` admission in one conditional write, without
   * waiting for the Session lane. Already `withdrawn` is success. A lost
   * race (no longer pending) is `stale`. A failed write is `data_unavailable`
   * and does not claim the withdraw succeeded.
   */
  withdrawPending(
    target: ChatTarget,
    requestId: string,
  ): WorkspaceResult<null> {
    try {
      const moved = target.db.write((tx) => {
        const row = getMessageAdmission(tx, requestId)
        if (row === null || row.conversationId !== target.conversationId)
          return 'missing' as const
        if (row.state === 'withdrawn') return 'done' as const
        if (row.state !== 'pending') return 'stale' as const
        transitionMessageAdmission(tx, requestId, 'withdrawn', {
          now: this.#now(),
        })
        return 'wrote' as const
      })
      if (moved === 'stale' || moved === 'missing') return fail('stale')
      if (moved === 'wrote') this.#onChanged(target.conversationId)
    } catch {
      this.#log('Corn chat: admission write failed (withdrawn)')
      return fail('data_unavailable')
    }
    return OK
  }

  /**
   * One guarded transition: applied only from the listed states, so racing
   * paths (follow, prompt reply, detach) never fight. `null` when skipped or
   * when the write failed (the caller then sends nothing).
   */
  move(
    target: ChatTarget,
    requestId: string,
    to: AdmissionState,
    options: MoveOptions,
  ): MessageAdmissionRow | null {
    const { from, ...transition } = options
    let moved: MessageAdmissionRow | null
    try {
      moved = target.db.write((tx) => {
        const row = getMessageAdmission(tx, requestId)
        if (
          row === null ||
          row.conversationId !== target.conversationId ||
          !from.includes(row.state)
        )
          return null
        return transitionMessageAdmission(tx, requestId, to, {
          ...transition,
          now: this.#now(),
        })
      })
    } catch {
      this.#log(`Corn chat: admission write failed (${to})`)
      return null
    }
    if (moved !== null) this.#onChanged(target.conversationId)
    return moved
  }

  /** Only a never-sent (`pending`) admission is refused locally; others keep their state. */
  settleUnsent(target: ChatTarget, requestId: string, code: SendFailure): void {
    this.move(target, requestId, 'rejected', {
      from: ['pending'],
      lastError: code,
    })
  }

  /** Records what was found; `true` when DSH has no trace (a resend may go out). */
  applyLocated(
    target: ChatTarget,
    requestId: string,
    located: Located,
  ): boolean {
    switch (located.kind) {
      case 'journal':
        this.move(target, requestId, 'observed', {
          from: ['sending', 'unknown', 'accepted', 'rejected'],
          observedSeq: located.seq,
        })
        return false
      case 'inbox':
        this.move(target, requestId, 'accepted', {
          from: ['sending', 'unknown'],
        })
        return false
      case 'absent':
        return true
      case 'missing':
      case 'unreadable':
        return false
      default: {
        const unreachable: never = located
        throw new Error(`Unhandled location ${String(unreachable)}`)
      }
    }
  }

  /** Every admission not yet settled by DSH, across conversations. */
  listOpen(db: LocalDb): readonly MessageAdmissionRow[] | undefined {
    try {
      return db.read((tx) => listOpenMessageAdmissions(tx))
    } catch {
      return undefined
    }
  }

  /**
   * A stop has begun. Still-local `pending` rows become `rejected` /
   * `not_sent` and keep their body and request id. They are not auto-retried.
   * Rows the Host may already hold are left for reconciliation.
   */
  rejectPending(sessionId: string): void {
    const db = this.db()
    if (db === undefined) return
    let changed: string | undefined
    try {
      changed = db.write((tx) => {
        const binding = findSessionBindingBySessionId(tx, sessionId)
        if (binding === null) return undefined
        let conversationId: string | undefined
        for (const row of listUnsettledMessageAdmissions(
          tx,
          binding.conversationId,
        )) {
          if (row.state !== 'pending') continue
          transitionMessageAdmission(tx, row.requestId, 'rejected', {
            now: this.#now(),
            lastError: 'not_sent',
          })
          conversationId = binding.conversationId
        }
        return conversationId
      })
    } catch {
      this.#log('Corn chat: could not reject pending sends')
      return
    }
    if (changed !== undefined) this.#onChanged(changed)
  }

  /** The Host generation ended: an in-flight send's outcome is now unknown. */
  markInFlightUnknown(): void {
    const db = this.db()
    if (db === undefined) return
    try {
      db.write((tx) => {
        for (const row of listOpenMessageAdmissions(tx))
          if (row.state === 'sending')
            transitionMessageAdmission(tx, row.requestId, 'unknown', {
              now: this.#now(),
              lastError: 'host_lost',
            })
      })
    } catch {
      this.#log('Corn chat: could not mark in-flight sends unknown')
    }
  }

  /**
   * `onAdmissionObserved`: settles the send as `observed`. Silent (no
   * `onChanged`), since it runs inside the projector; `true` when it moved.
   */
  observe(conversationId: string, observation: AdmissionObservation): boolean {
    const db = this.db()
    if (db === undefined) return false
    try {
      return db.write((tx) => {
        const row = getMessageAdmission(tx, observation.requestId)
        if (
          row === null ||
          row.conversationId !== conversationId ||
          !OBSERVABLE.includes(row.state)
        )
          return false
        transitionMessageAdmission(tx, row.requestId, 'observed', {
          now: this.#now(),
          observedSeq: observation.seq,
        })
        return true
      })
    } catch {
      this.#log('Corn chat: could not record an observed send')
      return false
    }
  }

  /** The conversation's unsettled sends as projector bubbles. */
  views(conversationId: string): readonly AdmissionView[] {
    const db = this.db()
    if (db === undefined) return []
    let rows: readonly MessageAdmissionRow[]
    try {
      rows = db.read((tx) => listUnsettledMessageAdmissions(tx, conversationId))
    } catch {
      return []
    }
    return rows.flatMap((row) => {
      const view = admissionView(row)
      return view === undefined ? [] : [view]
    })
  }
}
