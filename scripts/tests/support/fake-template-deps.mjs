import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CORN_PROFILE } from '../../../apps/desktop/src/runtime/profile-bootstrap.ts'
import { runOwned } from '../../lib/owned-resources.mjs'

const IDLE = 'setInterval(() => {}, 1000)'

export const announce = (phase, facts = {}) =>
  console.log(JSON.stringify({ event: 'phase', phase, ...facts }))

/**
 * Stand-ins for the template builder's Hosts, Claw install and verification.
 * `hold` names the phase that waits until cancelled; `hung-<phase>` also makes
 * that Host's stop never settle, like a supervisor whose child survives SIGKILL.
 */
export function fakeTemplateDeps(hold, { report = announce } = {}) {
  const homes = []
  function host(phase, home) {
    let child
    let abandon
    return {
      async start() {
        if (phase === 'bootstrap') {
          homes.push(home)
          const profile = join(home, 'profiles', CORN_PROFILE)
          await mkdir(profile, { recursive: true })
          await writeFile(join(profile, 'package.json'), '{}\n')
        }
        child = spawn(process.execPath, ['-e', IDLE], { stdio: 'ignore' })
        report(phase, { pid: child.pid, home })
        if (hold === phase || hold === `hung-${phase}`)
          await new Promise((_, reject) => {
            abandon = reject
          })
      },
      async stop() {
        abandon?.(new Error(`${phase} Host stopped before readiness`))
        if (hold === `hung-${phase}`) return new Promise(() => {})
        if (child && child.exitCode === null && child.signalCode === null) {
          const exited = once(child, 'exit')
          child.kill('SIGKILL')
          await exited
        }
      },
    }
  }
  return {
    homes,
    hosts: {
      bootstrap: (home) => host('bootstrap', home),
      governed: (home) => host('governed', home),
    },
    install: (home, owned) =>
      runOwned(
        owned,
        process.execPath,
        [
          '-e',
          hold === 'install'
            ? `process.on('SIGTERM', () => {});console.log(JSON.stringify({ event: 'phase', phase: 'install', pid: process.pid }));${IDLE}`
            : '',
        ],
        { cwd: home, stdio: ['ignore', 'inherit', 'inherit'] },
      ),
    verify: async () => {
      report('verify')
      if (hold === 'verify')
        await new Promise((resolve) => setTimeout(resolve, 30_000))
    },
  }
}
