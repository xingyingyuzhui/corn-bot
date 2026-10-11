import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  writeFile,
} from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { redactHostDiagnostic } from '../../apps/desktop/src/runtime/host-readiness.ts'
import { createAuditLab, FAKE } from './model-audit-fixtures.mjs'

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
 * fact, no failed capability, no error and a complete cleanup.
 */
export function settleReport({
  required,
  capabilities,
  error,
  cleanup,
  ...rest
}) {
  const problems = []
  if (error) problems.push(safeMessage(error))
  for (const name of required)
    if (!capabilities[name]) problems.push(`${name}: not verified`)
  for (const [name, record] of Object.entries(capabilities))
    if (record.status !== 'pass')
      problems.push(`${name}: ${record.reason ?? record.status}`)
    else if (Object.values(record).includes(false))
      problems.push(`${name}: a passing record holds false`)
  if (!cleanup?.ok) problems.push('cleanup failed')
  const status = problems.length === 0 ? 'passed' : 'failed'
  return {
    status,
    exitCode: status === 'passed' ? 0 : 1,
    problems,
    capabilities,
    cleanup,
    ...rest,
  }
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
  const audit = {
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
  const interrupt = (signal) => {
    log(`AUDIT interrupted by ${signal}; destroying the lab`)
    ;(lab?.destroy() ?? Promise.resolve())
      .catch(() => {})
      .finally(() => process.exit(130))
  }
  if (handleSignals)
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, interrupt)
  try {
    lab = await createAuditLab({ label, parent: labParent, timing })
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
  if (handleSignals)
    for (const signal of ['SIGINT', 'SIGTERM']) process.off(signal, interrupt)
  let report = settleReport({
    required,
    capabilities,
    error: failure,
    cleanup,
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
      startedAt: report.startedAt,
      durationMs: report.durationMs,
      failure: 'A fake key reached the report; evidence withheld',
    })
  const { exitCode, ...stored } = report
  await writeReport(reportPath, stored)
  return report
}
