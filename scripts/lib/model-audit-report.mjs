import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  writeFile,
} from 'node:fs/promises'
import { constants } from 'node:os'
import { dirname, join } from 'node:path'
import { redactHostDiagnostic } from '../../apps/desktop/src/runtime/host-readiness.ts'
import { createAuditLab, FAKE } from './model-audit-fixtures.mjs'
import { OwnedCleanupError } from './owned-resources.mjs'

const SIGNALS = ['SIGINT', 'SIGTERM']

/** A capability check that ran and failed; its record is safe to persist. */
export class CapabilityFailure extends Error {
  constructor(capability, reason, facts = {}) {
    super(`${capability} failed: ${reason}`)
    this.record = { capability, status: 'fail', reason, ...facts }
  }
}

const safeMessage = (error) =>
  redactHostDiagnostic(String(error?.message ?? error)).slice(0, 500)

const holdsFake = (text) =>
  Object.values(FAKE).some((fake) => text.includes(fake))

/** Names every text and every regular file under `tree` that holds a fake key. */
export async function scanForFakeKeys({ texts = {}, tree }) {
  const leaks = Object.entries(texts)
    .filter(([, text]) => holdsFake(text))
    .map(([name]) => name)
  async function walk(directory) {
    for (const name of (await readdir(directory)).sort()) {
      if (name === 'node_modules') continue
      const path = join(directory, name)
      const info = await lstat(path)
      if (info.isDirectory()) await walk(path)
      else if (info.isFile() && holdsFake(await readFile(path, 'utf8')))
        leaks.push(path.slice(tree.length))
    }
  }
  if (tree) await walk(tree)
  return leaks
}

/**
 * Passing needs every required capability recorded as `pass` with no `false`
 * fact, no failed capability, no error and a complete cleanup. An interrupted
 * run never passes and exits with the shell's 128 + signal number.
 */
export function settleReport({
  required,
  capabilities,
  error,
  cleanup,
  interrupted,
  ...rest
}) {
  const problems = []
  if (interrupted) problems.push(`interrupted by ${interrupted}`)
  else if (error) problems.push(safeMessage(error))
  for (const name of required)
    if (!capabilities[name]) problems.push(`${name}: not verified`)
  for (const [name, record] of Object.entries(capabilities))
    if (record.status !== 'pass')
      problems.push(`${name}: ${record.reason ?? record.status}`)
    else if (Object.values(record).includes(false))
      problems.push(`${name}: a passing record holds false`)
  if (!cleanup?.ok) problems.push('cleanup failed')
  const status = interrupted
    ? 'interrupted'
    : problems.length === 0
      ? 'passed'
      : 'failed'
  return {
    status,
    exitCode: exitCodeOf(status, interrupted),
    problems,
    capabilities,
    cleanup,
    ...(interrupted ? { interrupted } : {}),
    ...rest,
  }
}

function exitCodeOf(status, interrupted) {
  switch (status) {
    case 'passed':
      return 0
    case 'failed':
      return 1
    case 'interrupted':
      return 128 + constants.signals[interrupted]
    default:
      throw new Error(`Unknown audit status ${status}`)
  }
}

export class AuditInterrupted extends Error {
  name = 'AuditInterrupted'

  constructor(signal) {
    super(`Audit interrupted by ${signal}`)
    this.signal = signal
  }
}

/**
 * Sets the exit code and exits once stdout is flushed: a child that survived
 * a failed cleanup must not keep a finished run alive.
 */
export function finishAudit(report) {
  process.exitCode = report.exitCode
  process.stdout.write('', () => process.exit(report.exitCode))
}

async function writeReport(path, report) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const staging = `${path}.${process.pid}.tmp`
  await writeFile(staging, `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
  })
  await rename(staging, path)
}

/**
 * Runs `body(lab, audit)` in a fresh lab and always destroys it. The report at
 * `reportPath` is replaced by a non-passing record before anything else, so a
 * crashed or failed run can never leave an older `passed` report as evidence.
 *
 * With `handleSignals`, SIGINT/SIGTERM only abort `audit.signal`: the body and
 * everything it owns settle, the lab is destroyed and an `interrupted` report
 * is written before the caller exits.
 */
export async function runAudit({
  label,
  reportPath,
  required,
  body,
  labParent,
  timing,
  handleSignals = false,
  log = console.log,
}) {
  const startedAt = new Date()
  await writeReport(reportPath, {
    status: 'running',
    startedAt: startedAt.toISOString(),
  })
  const evidence = []
  const capabilities = {}
  const controller = new AbortController()
  const audit = {
    signal: controller.signal,
    facts: {},
    record(step, facts) {
      evidence.push({ step, ...facts })
      log(`AUDIT ${step}`)
    },
    pass(name, facts) {
      capabilities[name] = { status: 'pass', ...facts }
      log(`AUDIT capability ${name}: pass`)
    },
  }
  let lab
  let failure
  let interrupted
  const interrupt = (signal) => {
    if (interrupted) {
      log(`AUDIT ${signal} received; cleanup already in progress`)
      return
    }
    interrupted = signal
    log(`AUDIT interrupted by ${signal}; cancelling and cleaning up`)
    controller.abort(new AuditInterrupted(signal))
  }
  if (handleSignals) for (const signal of SIGNALS) process.on(signal, interrupt)
  try {
    lab = await createAuditLab({
      label,
      parent: labParent,
      timing,
      signal: controller.signal,
    })
    controller.signal.throwIfAborted()
    await body(lab, audit)
  } catch (error) {
    failure = error
    if (error instanceof CapabilityFailure)
      capabilities[error.record.capability] = error.record
  }
  let cleanup
  if (lab)
    try {
      cleanup = { ok: true, ...(await lab.destroy()) }
    } catch (error) {
      cleanup = {
        ok: false,
        ...error.summary,
        errors: (error.errors ?? [error]).map(safeMessage),
      }
    }
  else cleanup = { ok: !failure?.cleanupFailed, removed: false }
  if (failure instanceof OwnedCleanupError)
    cleanup = {
      ...cleanup,
      ok: false,
      owned: failure.summary,
      errors: [...(cleanup.errors ?? []), ...failure.errors.map(safeMessage)],
    }
  if (handleSignals)
    for (const signal of SIGNALS) process.off(signal, interrupt)
  let report = settleReport({
    required,
    capabilities,
    error: failure,
    cleanup,
    interrupted,
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    facts: audit.facts,
    failure: failure ? safeMessage(failure) : undefined,
    evidence,
  })
  if (holdsFake(JSON.stringify(report)))
    report = settleReport({
      required,
      capabilities: {
        'fake-key-leak-scan': { status: 'fail', reason: 'fake key in report' },
      },
      cleanup,
      interrupted,
      startedAt: report.startedAt,
      durationMs: report.durationMs,
      failure: 'A fake key reached the report; evidence withheld',
    })
  const { exitCode, ...stored } = report
  await writeReport(reportPath, stored)
  return report
}
