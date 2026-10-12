import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { basename } from 'node:path'

const DEFAULT_TIMING = Object.freeze({
  graceMs: 8_000,
  killMs: 5_000,
  stopMs: 20_000,
})

/** Resolves with `{ settled, value }`; never waits longer than `ms`. */
export async function settleWithin(promise, ms) {
  let timer
  const timeout = new Promise((resolve) => {
    timer = setTimeout(resolve, ms, { settled: false })
  })
  try {
    return await Promise.race([
      promise.then((value) => ({ settled: true, value })),
      timeout,
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** Rejects with the abort reason as soon as `signal` aborts, whether or not `work` honours it. */
export async function untilAborted(signal, work) {
  signal?.throwIfAborted()
  if (!signal) return work()
  let onAbort
  try {
    return await Promise.race([
      work(),
      new Promise((_, reject) => {
        onAbort = () => reject(signal.reason)
        signal.addEventListener('abort', onAbort, { once: true })
      }),
    ])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

export class OwnedCleanupError extends AggregateError {
  name = 'OwnedCleanupError'

  constructor(errors, summary) {
    super(errors, `Owned resources not released: ${summary.failed.join(', ')}`)
    this.summary = summary
  }
}

/**
 * The processes and directories one run creates, registered the moment they
 * exist. Each is released at most once and within `stopMs`; close releases
 * them in reverse order. Processes are stopped as soon as `signal` aborts. A
 * directory is kept when a process registered after it was not confirmed
 * stopped, so a leak stays visible instead of losing its working directory.
 */
export class OwnedResources {
  #entries = []
  #closeFlight

  constructor({ signal, timing } = {}) {
    this.signal = signal
    this.timing = { ...DEFAULT_TIMING, ...timing }
    signal?.addEventListener(
      'abort',
      () => {
        for (const entry of this.#entries)
          if (entry.kind === 'process') this.#release(entry).catch(() => {})
      },
      { once: true },
    )
  }

  /** `stop` must end the process (or Host) and resolve only once it is gone. */
  process(label, stop) {
    const entry = this.#add(label, 'process', stop)
    if (this.signal?.aborted) this.#release(entry).catch(() => {})
    return entry
  }

  directory(label, path) {
    return this.#add(label, 'directory', () =>
      rm(path, { recursive: true, force: true, maxRetries: 2 }),
    )
  }

  /** Releases one entry early; close later reuses the same outcome. */
  release(entry) {
    return this.#release(entry)
  }

  close() {
    this.#closeFlight ??= this.#close()
    return this.#closeFlight
  }

  #add(label, kind, release) {
    if (this.#closeFlight)
      throw new Error(`Cannot own ${label}: resources already closed`)
    const entry = { label, kind, release, flight: undefined }
    this.#entries.push(entry)
    return entry
  }

  #release(entry) {
    entry.flight ??= settleWithin(
      Promise.resolve().then(entry.release),
      this.timing.stopMs,
    ).then(({ settled }) => {
      if (!settled)
        throw new Error(
          `${entry.label} was not released within ${this.timing.stopMs} ms`,
        )
    })
    return entry.flight
  }

  async #close() {
    const summary = {
      owned: this.#entries.length,
      released: [],
      failed: [],
      retained: [],
    }
    const errors = []
    for (const entry of this.#entries.toReversed()) {
      if (entry.kind === 'directory' && errors.length > 0) {
        summary.retained.push(entry.label)
        continue
      }
      try {
        await this.#release(entry)
        summary.released.push(entry.label)
      } catch (error) {
        errors.push(error)
        summary.failed.push(entry.label)
      }
    }
    if (errors.length > 0)
      throw new OwnedCleanupError(errors, { ok: false, ...summary })
    return { ok: true, ...summary }
  }
}

function groupAlive(pid) {
  try {
    process.kill(-pid, 0)
    return true
  } catch {
    return false
  }
}

/** SIGTERM, bounded grace, SIGKILL, bounded wait, then reaps whatever is left of its process group. */
async function stopChild(child, exited, { graceMs, killMs }, group) {
  if (child.pid === undefined) return
  const send = (signal) => {
    try {
      if (group) process.kill(-child.pid, signal)
      else child.kill(signal)
    } catch {}
  }
  if (child.exitCode === null && child.signalCode === null) {
    send('SIGTERM')
    if (!(await settleWithin(exited, graceMs)).settled) {
      send('SIGKILL')
      if (!(await settleWithin(exited, killMs)).settled)
        throw new Error(`process ${child.pid} survived SIGKILL`)
    }
  }
  if (!group || !groupAlive(child.pid)) return
  send('SIGKILL')
  const until = Date.now() + killMs
  while (groupAlive(child.pid) && Date.now() < until)
    await new Promise((resolve) => setTimeout(resolve, 50))
  if (groupAlive(child.pid))
    throw new Error(`process group ${child.pid} survived SIGKILL`)
}

/**
 * Runs a command owned by `owned`; it resolves on exit code 0. When the run
 * can be cancelled the child leads its own process group so cancellation
 * reaches its descendants; otherwise it stays in the caller's group so a
 * terminal Ctrl-C still reaches it.
 */
export function runOwned(owned, command, args, options = {}) {
  owned.signal?.throwIfAborted()
  const group = owned.signal !== undefined
  const child = spawn(command, args, { ...options, detached: group })
  const exited = new Promise((resolve) => {
    child.once('exit', () => resolve())
    child.once('error', () => {
      if (child.pid === undefined) resolve()
    })
  })
  const entry = owned.process(`${basename(command)} ${child.pid}`, () =>
    stopChild(child, exited, owned.timing, group),
  )
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (owned.signal?.aborted) reject(owned.signal.reason)
      else if (code !== 0)
        reject(new Error(`${command} failed (${code ?? signal})`))
      else owned.release(entry).then(resolve, reject)
    })
  })
}
