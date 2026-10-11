import { join } from 'node:path'
import { finishAudit, runAudit } from '../../lib/model-audit-report.mjs'
import { buildProfileTemplate } from '../../lib/profile-template-build.mjs'
import { fakeTemplateDeps } from './fake-template-deps.mjs'

const [hold, reportPath, labParent] = process.argv.slice(2)
const deps = fakeTemplateDeps(hold)

const report = await runAudit({
  label: 'unit',
  reportPath,
  labParent,
  required: ['template'],
  handleSignals: true,
  timing: { readinessMs: 5_000, graceMs: 300, killMs: 1_000, closeMs: 1_000 },
  body: async (lab, audit) => {
    await buildProfileTemplate(join(lab.root, 'template'), {
      signal: audit.signal,
      timing: { graceMs: 300, killMs: 1_000, stopMs: 1_500 },
      hosts: deps.hosts,
      install: deps.install,
      verify: deps.verify,
    })
    audit.pass('template', {})
  },
})
console.log(
  JSON.stringify({
    event: 'report',
    status: report.status,
    exitCode: report.exitCode,
  }),
)
finishAudit(report)
