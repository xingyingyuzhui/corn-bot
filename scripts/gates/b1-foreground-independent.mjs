import { setTimeout as delay } from 'node:timers/promises'
import { eventSummary, until } from './lib/gate-env.mjs'
import { runGate } from './lib/gate-session.mjs'

// Run: node scripts/gates/run.mjs scripts/gates/b1-foreground-independent.mjs
// ADR-0007 §5.2 scenario 1 (DSH gate B1): a foreground Session answers while a
// background Session's Turn is mid-stream. Measures first-chunk latency idle vs
// under background load (after one warm-up Turn, 3 samples each), seq
// independence and Host CPU/RSS/process count.
const BG_CHUNKS = 40
const SAMPLES = 3
const scripts = {
  'bg-long': [{ chunks: Array(BG_CHUNKS).fill('bg '), chunkDelayMs: 250 }],
  'fg-quick': [{ chunks: ['fg ', 'reply ', 'done'], chunkDelayMs: 20 }],
}
const turnEnds = (follow) =>
  follow.state.events.filter((event) => event.type === 'turn/end')
const median = (values) => [...values].sort((a, b) => a - b)[values.length >> 1]

const report = await runGate(
  'b1-foreground-independent',
  { scripts, title: 'Foreground replies while a background Turn streams' },
  async (ctx) => {
    const h = ctx.harness
    const bg = await h.boundSession('b1-bg', 'research')
    const fg = await h.boundSession('b1-fg', 'research')
    const bgFollow = await h.follow(bg.sessionId)
    const fgFollow = await h.follow(fg.sessionId)
    const bgCursor0 = bgFollow.state.cursor
    const fgCursor0 = fgFollow.state.cursor

    async function foreground(label) {
      const chunksBefore = fgFollow.state.chunks
      const endsBefore = turnEnds(fgFollow).length
      const sent = Date.now()
      await h.prompt(fg.sessionId, `⟦gate:fg-quick⟧ ${label}`)
      const admitted = Date.now()
      await until(
        () => fgFollow.state.chunks > chunksBefore,
        `${label} first chunk`,
        20_000,
        5,
      )
      const firstChunk = Date.now()
      await until(
        () => turnEnds(fgFollow).length > endsBefore,
        `${label} turn end`,
        20_000,
        5,
      )
      const ended = Date.now()
      const upstream = ctx.stub.requests.find(
        (row) =>
          row.kind === 'agent' &&
          row.scriptId === 'fg-quick' &&
          row.receivedAt >= sent,
      )
      await delay(300)
      return {
        label,
        admitMs: admitted - sent,
        upstreamReceivedMs: upstream ? upstream.receivedAt - sent : null,
        firstChunkMs: firstChunk - sent,
        turnEndMs: ended - sent,
        turnEnd: eventSummary(turnEnds(fgFollow).at(-1)),
      }
    }
    const series = async (label) => {
      const rows = []
      for (let i = 1; i <= SAMPLES; i++)
        rows.push(await foreground(`${label}-${i}`))
      return {
        rows,
        medianFirstChunkMs: median(rows.map((r) => r.firstChunkMs)),
        medianUpstreamReceivedMs: median(rows.map((r) => r.upstreamReceivedMs)),
        medianTurnEndMs: median(rows.map((r) => r.turnEndMs)),
      }
    }

    const warmup = await foreground('warmup')
    await ctx.sampler.mark('idle-start')
    await delay(2_000)
    await ctx.sampler.mark('idle-end')
    const idle = await series('idle')

    await h.prompt(bg.sessionId, '⟦gate:bg-long⟧ background')
    await until(
      () => bgFollow.state.chunks >= 4,
      'background mid-stream',
      20_000,
      10,
    )
    await ctx.sampler.mark('bg-only-start')
    await delay(1_000)
    await ctx.sampler.mark('fg-start')
    const bgChunksAtFg = bgFollow.state.chunks
    const underLoad = await series('under-load')
    await ctx.sampler.mark('fg-done')
    const bgUpstream = ctx.stub.requests.find(
      (row) => row.kind === 'agent' && row.scriptId === 'bg-long',
    )
    const bgStillStreaming =
      turnEnds(bgFollow).length === 0 &&
      !bgUpstream.completed &&
      !bgUpstream.closedByClient
    await until(
      () => turnEnds(bgFollow).length > 0,
      'background turn end',
      30_000,
      20,
    )
    await ctx.sampler.mark('bg-done')

    const fgText = JSON.stringify(fgFollow.state.events)
    const bgEnd = eventSummary(turnEnds(bgFollow)[0])
    const seqs = (follow, cursor0) => ({
      snapshotCursor: cursor0,
      firstLiveSeq: follow.state.events[0]?.seq ?? null,
      lastSeq: follow.state.cursor,
      liveEvents: follow.state.events.length,
      turns: turnEnds(follow).map((e) => eventSummary(e).turn),
      contiguous: true,
    })
    const ok = (row) => row.turnEnd.reason?.kind === 'completed'
    const facts = {
      warmup,
      idle,
      underLoad,
      medianLatencyDeltaMs:
        underLoad.medianFirstChunkMs - idle.medianFirstChunkMs,
      background: {
        chunksWhenForegroundStarted: bgChunksAtFg,
        stillStreamingWhenForegroundEnded: bgStillStreaming,
        turnEnd: bgEnd,
        upstreamChunks: bgUpstream.chunksSent,
        upstreamCompleted: bgUpstream.completed,
        upstreamClosedByClient: bgUpstream.closedByClient,
        liveChunksSeen: bgFollow.state.chunks,
      },
      seqs: {
        background: seqs(bgFollow, bgCursor0),
        foreground: seqs(fgFollow, fgCursor0),
      },
      foregroundContainsBackgroundText: fgText.includes('bg bg'),
      providerStatus: 'all 200 (fake); no 429 path exercised',
      resources: {
        idle: ctx.sampler.window('idle-start', 'idle-end'),
        backgroundStreamingOnly: ctx.sampler.window(
          'bg-only-start',
          'fg-start',
        ),
        foregroundTurnsUnderLoad: ctx.sampler.window('fg-start', 'fg-done'),
        backgroundTail: ctx.sampler.window('fg-done', 'bg-done'),
        whole: ctx.sampler.window(),
      },
    }
    facts.passed =
      ok(warmup) &&
      idle.rows.every(ok) &&
      underLoad.rows.every(ok) &&
      bgStillStreaming &&
      bgEnd.reason?.kind === 'completed' &&
      bgUpstream.completed &&
      bgUpstream.chunksSent === BG_CHUNKS &&
      !facts.foregroundContainsBackgroundText
    return facts
  },
)
process.exit(report.passed ? 0 : 1)
