import { cpus, loadavg } from 'node:os'
import {
  FAKE_MODEL,
  FAKE_PROVIDER,
  startFakeModel,
} from '../../lib/fake-model-server.mjs'
import { ModelHarness } from '../../lib/model-session.mjs'
import {
  assertHomeReleased,
  assertSandboxDeniesNetwork,
  createRunHome,
  gitCommit,
  governedHost,
  NetworkWatch,
  ResourceSampler,
  removeRunHome,
  repo,
  sandboxedSpawn,
  unsandboxedSpawn,
  writeReport,
} from './gate-env.mjs'

/** Redacted per-request facts from the fake model; prompt text is never kept. */
export function requestFacts(stub, since = 0) {
  return stub.requests.map((row) => ({
    index: row.index,
    kind: row.kind,
    scriptId: row.scriptId ?? null,
    step: row.step,
    markers: row.markers,
    toolResults: row.toolResults,
    authOk: row.authOk,
    model: row.model,
    receivedMs: row.receivedAt - since,
    firstByteMs: row.firstByteAt === undefined ? null : row.firstByteAt - since,
    endedMs: row.endedAt === undefined ? null : row.endedAt - since,
    chunksSent: row.chunksSent,
    toolCall: row.stepPlan?.toolCall ?? null,
    completed: row.completed,
    closedByClient: row.closedByClient,
  }))
}

/**
 * One headless gate: fake model on loopback, fresh Corn-owned home seeded from
 * the verified template, governed Host under the no-network sandbox, the
 * existing script ModelHarness, bounded cleanup and a redacted report. `body`
 * returns `{ passed, ...facts }`; failures are reported, never retried.
 */
export async function runGate(
  name,
  { scripts, title, hostSandbox = true },
  body,
) {
  await assertSandboxDeniesNetwork()
  const t0 = Date.now()
  const stub = await startFakeModel({ scripts })
  const home = await createRunHome(name, { baseURL: stub.baseURL })
  const hostExits = []
  // The supervisor reports on `close`, which waits for every stdio holder;
  // `exit` and a stderr tail record what the Host process itself did.
  const hostProcess = { exits: [], stderrTail: '' }
  const spawn = hostSandbox ? sandboxedSpawn : unsandboxedSpawn
  const host = governedHost(home, {
    onFailure: (message) =>
      hostExits.push({ at: Date.now() - t0, message: message.slice(0, 160) }),
    spawnHost: (command, args, options) => {
      const child = spawn(command, args, options)
      child.once('exit', (code, signal) =>
        hostProcess.exits.push({
          at: Date.now() - t0,
          pid: child.pid,
          code,
          signal,
        }),
      )
      child.stderr?.on('data', (chunk) => {
        hostProcess.stderrTail = (hostProcess.stderrTail + chunk).slice(-4_000)
      })
      return child
    },
  })
  const network = hostSandbox ? null : new NetworkWatch(() => host.processId)
  const ctx = {
    t0,
    stub,
    home,
    host,
    hostExits,
    samplers: [],
    harness: undefined,
    auth: undefined,
    /** (Re)starts the Host, a fresh sampler and a fresh harness. */
    async startHost() {
      ctx.harness?.close()
      ctx.auth = await host.start()
      const sampler = new ResourceSampler(host.processId).start()
      ctx.samplers.push(sampler)
      ctx.sampler = sampler
      ctx.harness = await new ModelHarness(ctx.auth, {
        route: FAKE_PROVIDER,
        model: FAKE_MODEL,
      }).connect()
      return ctx.harness
    },
  }
  let result
  let error
  const cleanupErrors = []
  try {
    await ctx.startHost()
    network?.start()
    await ctx.harness.assertModelInCatalog()
    result = await body(ctx)
  } catch (caught) {
    error = caught
  } finally {
    ctx.harness?.close()
    for (const sampler of ctx.samplers) await sampler.stop()
    await network?.stop()
    await host.stop().catch((caught) => cleanupErrors.push(caught.name))
    await stub.close()
  }
  const released = await assertHomeReleased(home)
  const offLoopback = network?.offLoopback ?? []
  const passed =
    !error &&
    result?.passed === true &&
    released.ok &&
    cleanupErrors.length === 0 &&
    offLoopback.length === 0
  const report = {
    scenario: name,
    title,
    commit: await gitCommit(),
    recordedAt: new Date().toISOString(),
    environment: {
      dsh: '0.2.0-rc.2',
      claw: '0.3.0-rc.2',
      node: process.version,
      cpus: cpus().length,
      load1AtEnd: Number(loadavg()[0].toFixed(2)),
      host: hostSandbox
        ? 'real governed DSH Host (createGovernedHost, Claw admission) under the no-network sandbox, fresh home seeded from the verified template'
        : 'real governed DSH Host (createGovernedHost, Claw admission) WITHOUT the no-network sandbox (DSH bash Seatbelt cannot nest), scrubbed env, loopback-only provider config, lsof-watched sockets; fresh home seeded from the verified template',
      ...(network
        ? { network: { samples: network.samples, offLoopback } }
        : {}),
      model: `fake loopback OpenAI-compatible stub (${FAKE_PROVIDER}/${FAKE_MODEL}, pi-ai openai-completions route, retries 0, fake key literal)`,
    },
    durationMs: Date.now() - t0,
    passed,
    result,
    error: error ? `${error.name}: ${error.message}`.slice(0, 600) : null,
    errorAt:
      error?.stack
        ?.split('\n')
        .slice(1, 4)
        .map((line) => line.trim().replace(repo, '.')) ?? null,
    errorCause: error?.cause
      ? `${error.cause.code ?? error.cause.name}: ${error.cause.message}`.slice(
          0,
          300,
        )
      : null,
    errorContext: error?.context ?? null,
    hostExits,
    hostProcess: {
      exits: hostProcess.exits,
      stderrTail: error
        ? hostProcess.stderrTail.replaceAll(home, '<home>')
        : null,
    },
    fakeModel: {
      requests: requestFacts(stub, t0),
      tools: stub.requests.find((row) => row.kind === 'agent')?.tools ?? [],
    },
    cleanup: { ...released, errors: cleanupErrors, homeRemoved: passed },
  }
  const path = await writeReport(name, report)
  if (passed) await removeRunHome(home)
  console.log(
    JSON.stringify(
      {
        scenario: name,
        passed,
        error: report.error,
        report: path,
        retainedHome: passed ? null : home,
      },
      null,
      2,
    ),
  )
  return report
}
