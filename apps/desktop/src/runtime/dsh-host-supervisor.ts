import { type ChildProcess, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { DSH_VERSION } from '../../../../packages/contracts/src/runtime.ts'
import { HostAuth } from './host-auth.ts'
import { parseReadinessLine, redactHostDiagnostic } from './host-readiness.ts'
import { acquireProcessLock } from './process-lock.ts'
import {
  CORN_PROFILE,
  claimCornHome,
  cornHostEnvironment,
  writeIsolationPatch,
} from './profile-bootstrap.ts'

const require = createRequire(import.meta.url)
const cliManifest = require.resolve('@deepseek-ai/dsh/package.json')
const cliEntry = join(dirname(cliManifest), 'lib', 'bin.js')

export class DshHostSupervisor {
  #child: ChildProcess | undefined
  #exit: Promise<void> | undefined
  #release: (() => Promise<void>) | undefined
  #stopping = false
  #startFlight: Promise<HostAuth> | undefined
  #stopFlight: Promise<void> | undefined
  #diagnostic = ''

  readonly home: string
  readonly onFailure: (message: string) => void

  constructor(home: string, onFailure: (message: string) => void = () => {}) {
    this.home = home
    this.onFailure = onFailure
  }

  /** Main-only process ownership diagnostics; never exposed over Renderer IPC. */
  get processId(): number | undefined {
    return this.#child?.pid
  }

  start(): Promise<HostAuth> {
    if (this.#startFlight || this.#child || this.#stopFlight)
      return Promise.reject(new Error('Host is already started or stopping'))
    this.#startFlight = this.#start().finally(() => {
      this.#startFlight = undefined
    })
    return this.#startFlight
  }

  async #start(): Promise<HostAuth> {
    const manifest = require(cliManifest) as { version: string }
    if (manifest.version !== DSH_VERSION)
      throw new Error('Installed DSH runtime differs from the locked version')
    await claimCornHome(this.home)
    this.#release = await acquireProcessLock(this.home)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const patch = await writeIsolationPatch(this.home)
      const args = [cliEntry, CORN_PROFILE]
      // DSH creates this named profile from its own shipped template, never the user's profile.
      const { existsSync } = await import('node:fs')
      if (
        !existsSync(join(this.home, 'profiles', CORN_PROFILE, 'package.json'))
      ) {
        args.push('--from-default-profile', 'web')
      }
      args.push('--patch', patch, '--no-open', '--port', '0')
      const child = spawn(process.execPath, args, {
        cwd: this.home,
        env: cornHostEnvironment(this.home),
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      this.#child = child
      this.#exit = new Promise((resolve) =>
        child.once('close', () => resolve()),
      )
      const launch = await new Promise<URL>((resolve, reject) => {
        let pending = ''
        timer = setTimeout(
          () => reject(new Error('DSH readiness deadline exceeded')),
          45_000,
        )
        child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
          pending += chunk
          const lines = pending.split(/\r?\n/u)
          pending = lines.pop() ?? ''
          if (pending.length > 128 * 1024) {
            reject(new Error('DSH startup line exceeded its limit'))
            return
          }
          for (const line of lines) {
            try {
              const ready = parseReadinessLine(line)
              if (ready) resolve(ready)
            } catch (error) {
              reject(error)
            }
          }
        })
        child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
          this.#diagnostic = redactHostDiagnostic(
            (this.#diagnostic + chunk).slice(-16_384),
          )
        })
        child.once('error', reject)
        child.once('close', (code, signal) => {
          const message = `DSH exited (${String(code ?? signal)}): ${this.#diagnostic}`
          reject(new Error(message))
          if (!this.#stopping) this.onFailure(message)
        })
      })
      return await HostAuth.exchange(launch)
    } catch (error) {
      await this.#stop()
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  stop(): Promise<void> {
    this.#stopFlight ??= (async () => {
      await this.#startFlight?.catch(() => {})
      await this.#stop()
    })().finally(() => {
      this.#stopFlight = undefined
    })
    return this.#stopFlight
  }

  async #stop(): Promise<void> {
    this.#stopping = true
    const child = this.#child
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM')
      let timer: ReturnType<typeof setTimeout> | undefined
      const exited = await Promise.race([
        this.#exit?.then(() => true),
        new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), 8_000)
        }),
      ])
      clearTimeout(timer)
      if (!exited) {
        child.kill('SIGKILL')
        await this.#exit
      }
    }
    await this.#release?.()
    this.#release = undefined
    this.#child = undefined
    this.#stopping = false
  }
}
