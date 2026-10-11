import { runAudit } from '../../lib/model-audit-report.mjs'

const [reportPath, labParent] = process.argv.slice(2)
const HOST = [
  "console.log('dsh web: http://127.0.0.1:9/?token=corn-test')",
  'setInterval(() => {}, 1000)',
].join(';')

const report = await runAudit({
  label: 'unit',
  reportPath,
  labParent,
  required: ['body'],
  handleSignals: true,
  timing: { readinessMs: 5_000, graceMs: 300, killMs: 1_000, closeMs: 1_000 },
  body: async (lab) => {
    const host = await lab.startHost({
      command: process.execPath,
      args: ['-e', HOST],
    })
    console.log(
      JSON.stringify({ event: 'phase', phase: 'body', pid: host.pid }),
    )
    await host.exited
    throw new Error('Audit Host went away')
  },
})
console.log(
  JSON.stringify({
    event: 'report',
    status: report.status,
    exitCode: report.exitCode,
  }),
)
process.exitCode = report.exitCode
