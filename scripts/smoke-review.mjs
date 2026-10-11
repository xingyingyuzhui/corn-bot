import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Runtime review regressions, keyless and without paid model calls. Fails when
// any required scenario is missing, stale or failed, not only on exit codes.
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const review = join(root, '.artifacts', 'review')
const SUITES = [
  {
    script: 'scripts/smoke-review-claw.mjs',
    report: 'claw-smoke.json',
    required: [
      'governed-legit-profile-ready',
      'no-claw-web-profile',
      'suite-not-in-bundles',
      'suite-version-mismatch',
      'gate-missing',
      'gate-disabled-by-profile-patch',
      'registry-replaced-by-noop-plugin',
      'recovery-revalidates-after-gate-removed',
    ],
  },
  {
    script: 'scripts/smoke-review-desktop.mjs',
    report: 'desktop-smoke.json',
    required: [
      'config-missing-key',
      'config-unknown-route',
      'config-group-readable',
      'config-unreadable-directory',
      'no-claw-profile',
      'governed-ready',
      'crash-recovery-revalidated',
    ],
  },
]

const startedAt = Date.now()
const problems = []
const build = spawnSync('pnpm', ['build'], { cwd: root, stdio: 'inherit' })
if (build.status !== 0) problems.push(`pnpm build exited ${build.status}`)
const summary = []
for (const suite of SUITES) {
  if (build.status !== 0) break
  const run = spawnSync(process.execPath, [suite.script], {
    cwd: root,
    stdio: 'inherit',
  })
  if (run.status !== 0) problems.push(`${suite.script} exited ${run.status}`)
  let scenarios = []
  try {
    const report = JSON.parse(
      await readFile(join(review, suite.report), 'utf8'),
    )
    if (Date.parse(report.recordedAt) < startedAt)
      problems.push(`${suite.report} is stale`)
    else scenarios = report.scenarios
  } catch {
    problems.push(`${suite.report} is missing or unreadable`)
  }
  for (const name of suite.required) {
    const row = scenarios.find((scenario) => scenario.name === name)
    if (!row) problems.push(`missing scenario ${name}`)
    else if (row.passed !== true) problems.push(`failed scenario ${name}`)
    summary.push({ name, passed: row?.passed === true })
  }
}
await mkdir(review, { recursive: true, mode: 0o700 })
await writeFile(
  join(review, 'smoke-review.json'),
  `${JSON.stringify({ recordedAt: new Date().toISOString(), passed: problems.length === 0, problems, scenarios: summary }, null, 2)}\n`,
  { mode: 0o600 },
)
for (const problem of problems) console.error(`FAIL ${problem}`)
const required = SUITES.reduce(
  (total, suite) => total + suite.required.length,
  0,
)
console.log(
  problems.length === 0
    ? `PASS smoke:review ${required}/${required} required scenarios`
    : `smoke:review failed with ${problems.length} problem(s)`,
)
process.exitCode = problems.length === 0 ? 0 : 1
