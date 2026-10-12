import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { dshHosts, preflight, SANDBOX_PROFILE } from './lib/gate-env.mjs'

// Run: node scripts/gates/run.mjs <script.mjs> [--bound-s <seconds>] [--whole-sandbox] [-- <args>]
// One gate at a time, headless: refuses to start while any DSH Host runs or the
// machine is loaded, runs the script in its own process group, kills the group
// past its bound and reports any Host left afterwards. No retries.
// --whole-sandbox runs the whole script under the no-network sandbox (for
// existing smokes); gate drivers instead sandbox the Host / audit they spawn,
// because the sandbox refuses the setuid `ps` they sample with.
const argv = process.argv.slice(2)
const separator = argv.indexOf('--')
const own = separator < 0 ? argv : argv.slice(0, separator)
const passed = separator < 0 ? [] : argv.slice(separator + 1)
const script = own[0]
if (!script) {
  console.error(
    'usage: node scripts/gates/run.mjs <script.mjs> [--bound-s N] [--whole-sandbox] [-- args]',
  )
  process.exit(2)
}
const boundIndex = own.indexOf('--bound-s')
const boundMs = (boundIndex > 0 ? Number(own[boundIndex + 1]) : 240) * 1000
const whole = own.includes('--whole-sandbox')

const before = await preflight()
console.log(`[gate-run] preflight ${JSON.stringify({ ...before, whole })}`)
const started = Date.now()
const command = [process.execPath, resolve(script), ...passed]
const child = whole
  ? spawn('sandbox-exec', ['-f', SANDBOX_PROFILE, ...command], {
      stdio: 'inherit',
      detached: true,
    })
  : spawn(command[0], command.slice(1), { stdio: 'inherit', detached: true })
let hung = false
const timer = setTimeout(async () => {
  hung = true
  console.error(
    `[gate-run] HANG: bound ${boundMs / 1000}s exceeded; stopping the group`,
  )
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {}
  await delay(10_000)
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {}
}, boundMs)
const [code, signal] = await new Promise((done) =>
  child.once('close', (exitCode, exitSignal) => done([exitCode, exitSignal])),
)
clearTimeout(timer)
await delay(1_000)
const leftover = await dshHosts()
console.log(
  `[gate-run] ${JSON.stringify({
    script,
    exit: code ?? signal,
    hung,
    wallMs: Date.now() - started,
    hostsAliveAfter: leftover.map((row) => row.pid),
  })}`,
)
process.exit(hung ? 124 : leftover.length > 0 && code === 0 ? 3 : (code ?? 1))
