# DSH headless gates with a fake model

## Status and evidence scope

**Headless gates run 2026-10-12, all recorded at commit `26fac9b` (branch `test/dsh-headless-gates`, base `origin/main` `8b6989c`).** Every listed scenario passed its stated check. Several observations change what the [ADR-0007](../adr/ADR-0007-execution-runtime.md) acceptance gates and revisit triggers can rely on (§4). The most important is that **`session.cancel` ends only the Turn; it does not stop the Session's background shell jobs or background subagents.**

- Runtime: real DSH `0.2.0-rc.2` Host (`dsh/lib/bin.js`) with Claw `0.3.0-rc.2`, started through Corn's `createGovernedHost` (ADR-0006 admission before spawn and after auth). The profile is materialized from a template built by `buildProfileTemplate` (locked DSH, Claw release asset sha256 `99ea3c20…08cb` from the repo cache, pnpm offline). `setup:runtime` was not needed and no network was used for setup.
- Model: **fake only.** `scripts/lib/fake-model-server.mjs` is a loopback OpenAI-compatible SSE stub. Each run home adds it as a pi-ai `openai-completions` provider (`corn-gate-fake/corn-gate-model`, `maxRetries: 0`) through `$DSH_HOME/cordis.patch.yml`, plus an `agent-default-model` row. The only key is the literal `sk-corn-gate-FAKE-0000` in the home `.env`, and report writers refuse to persist it. Responses are scripted per `⟦gate:<id>⟧` marker and step: chunks, delays, tool calls and hangs. Session-title requests (no tools) always get a fixed reply.
- Not run, by instruction: GUI or Electron smokes (`smoke:packaged`, `smoke:review-desktop`, layout probes) and real-model smokes (`smoke:model`, anything using `CORN_MODEL_*`). Nothing in this document came from a real provider, a window, `~/.dsh`, `/Applications/DeepSeek Harness.app` or `~/.corn-bot-dev/model.env`.
- Isolation:
  - Every run used a fresh home under `~/.corn-bot-dev/wt-dsh-gates/<run>-<ts>/` with the Corn home marker (purpose `dsh-headless-gate`), or the scripts' own disposable tmp homes. Homes are removed on pass and kept on failure.
  - Each run was preceded by a preflight (load limit, no live DSH Host) and followed by a cleanup assertion: no process references the home, `corn-host.lock` is absent, and no Host survives.
  - Scenarios ran one at a time through `scripts/gates/run.mjs`, which bounds each script and kills its process group on overrun. No run hung; load1 stayed between 3.6 and 6 on 15 CPUs.
- Network:
  - The Host, and whole scripts where noted, run under `sandbox-exec -f scripts/gates/no-network.sb`, which denies outbound network except loopback and unix sockets. Each gate first asserts that a sandboxed connect to `1.1.1.1:443` fails with `EPERM`.
  - **Exception:** DSH's bash executor applies its own Seatbelt profile, and macOS refuses nested `sandbox-exec`. Under the gate sandbox every bash command therefore fails with `exit code 71` ("the sandbox runner itself failed").
  - Scenarios that need a real shell process (B2 `--host-unsandboxed`, B3, B4) run the Host outside the gate sandbox. There, isolation is the loopback-only provider config plus a scrubbed environment, and `lsof` polls the Host tree's sockets every 250 ms. **No non-loopback endpoint was observed** (B2: 18 samples, B3: 9, B4: 40).
- Environment hygiene: the operator shell exports two provider API-key variables. Corn's Host environment is an allowlist (`cornHostEnvironment`), and `model: null` skips the `model.env` lookup, so no Host ever received them. Since `26fac9b`, every gate child process also gets `scrubbedEnv()`, which drops `KEY|TOKEN|SECRET|PASSW|CREDENTIAL|AUTH|COOKIE|PROXY`.
- Reports: `.artifacts/gates/*.json`, `.artifacts/m0-host-smoke.json` and `.artifacts/m0-governance-smoke.json` are redacted, mode 600 and not committed. Prompt text is never stored, only markers and counts.

## 1. Results

| # | Scenario | Command | Real / fake | Result | Key evidence |
| --- | --- | --- | --- | --- | --- |
| A1a | smoke:host | `H=$(node scripts/gates/seed-home.mjs create a1-smoke-host); CORN_DSH_HOME=$H node scripts/gates/run.mjs scripts/smoke-host.mjs --whole-sandbox; node scripts/gates/seed-home.mjs release $H` | real Host, no model | **passed** | 16/16 live checks, 4.4 s, home released |
| A1b | smoke:cold | `node scripts/gates/run.mjs scripts/smoke-cold-start.mjs --whole-sandbox` | real bootstrap Host, no Claw | **passed** | 4/4, 3.7 s, no tmp residue |
| A2 | Governance (deny / ask-reject / cancel) | as A1a with `a2-governance` and `scripts/smoke-governance.mjs` | real Host + Claw, fixture tool (no model needed) | **passed** | gate-deny `turn/end blocked`; remote-reject outcome `rejected`; remote-cancel `aborted` with queue preserved; `bashExecutions: 0` in all three |
| A3 | N4 interrupt (6 cases) | `node scripts/gates/run.mjs scripts/gates/n4-audit-interrupt.mjs -- <template-host\|template-install\|audit-host> <SIGINT\|SIGTERM>` | real audit script, real template build, real Hosts | **passed** 6/6 | status `interrupted`, exit 130/143, lab removed, lock released, no new `corn-audit-api-*` / `corn-profile-template-*`, no Host (§2.1) |
| A4 | #19 bounded stop, SIGTERM-ignoring Host | `node scripts/gates/run.mjs scripts/gates/a4-bounded-stop.mjs` | real Host and production supervisor timeouts; only a `--import` preload that swallows SIGTERM | **passed** | stop 8019 / 8018 ms over two rounds, alive through the 8 s grace, SIGKILL then confirmed exit, restart after confirmed stop works |
| B1 | Foreground independent reply while background streams (ADR-0007 §5.2-1, -9) | `node scripts/gates/run.mjs scripts/gates/b1-foreground-independent.mjs` | real Host, fake model | **passed** | first chunk median 45 ms idle vs 52 ms under background load (+7 ms); seqs independent; background completed 40/40 chunks (§2.2) |
| B2 | Targeted `session.cancel` (§5.2-4) | `… b2-targeted-cancel.mjs` (sandboxed) and `… b2-targeted-cancel.mjs -- --host-unsandboxed` | real Host, fake model, real `sleep` job (unsandboxed variant) | **passed** (Turn scope) | `turn/end aborted/user` 6 ms after cancel, upstream closed in 3 ms, foreground 20/20 chunks and `completed`. **Background job and subagent survive** (§2.3) |
| B3 | Approval pending, then cancel, then late `allowed-once` (§5.2-4) | `… b3-approval-cancel.mjs -- --host-unsandboxed` | real Host, fake model, real bash composition | **passed** | `approval/decided cancelled` (same id) and `$events` cancel frame within 6 ms; tool result `aborted before dispatch`; late reply accepted **silently** with no effect: no sentinel file, 0 model requests, 0 events |
| B4 | SIGKILL mid-stream and mid-tool, restart, read-only reconcile (§5.2-6) | `… b4-restart-reconcile.mjs` | real Host (unsandboxed for a real tool process), fake model | **passed** | synthetic `turn/end interrupted` on both Sessions; in-flight bash marked error ("outcome unknown"); 0 replays; queued item **not** auto-started. **Foreground bash orphaned to PID 1** (§2.4) |
| B5 | steer / updateQueue (§5.2-2) | `… b5-steer-queue.mjs` | real Host, fake model | **passed** | two steers plus queued item edited then promoted, all claimed at the next step in order `rev:1, rev:2, rev:3e`; original text never sent; single Turn `completed` (§2.5) |
| B6 | Run-level stop via DSH APIs only (ADR-0007 trigger "targeted stop") | `… b6-run-level-stop.mjs [-- --jobs-first \| --leaf-first] [--recancel]` | real Host (unsandboxed), fake model, real `sleep` job trees | **conditional** (leaf-first clean; parent-first reactivates the parent) | see §6 |
| — | Model isolation (§5.2-7) | — | — | **pending** (gate not re-run) | U1 is now implemented in [PR #27](https://github.com/xingyingyuzhui/corn-bot/pull/27) and its session-model real-Host smoke passed; "needs U1" no longer applies |
| — | C1 fencing (`corn-run-control` denies further dispatch), Outbox exactly-once (§5.2-5), governance negatives beyond A2 (§5.2-8) | — | — | **pending** | C1 and the Outbox do not exist yet; not in this brief |

## 2. Measurements and observations

### 2.1 N4 interrupt (A3)

| Phase | Signal | Signal sent after | Exit | Exit after signal | Hosts spawned / stopped by the body |
| --- | --- | --- | --- | --- | --- |
| template-host | SIGINT | 172 ms | 130 | 97 ms | 0 / 0 |
| template-host | SIGTERM | 172 ms | 143 | 94 ms | 0 / 0 |
| template-install | SIGINT | 1025 ms | 130 | 96 ms | 0 / 0 |
| template-install | SIGTERM | 942 ms | 143 | 89 ms | 0 / 0 |
| audit-host | SIGINT | 3940 ms | 130 | 5325 ms | 2 / 0 |
| audit-host | SIGTERM | 3897 ms | 143 | 5331 ms | 2 / 0 |

`audit-host` exits are slower because cleanup stops the live Host and closes the discovery stub. "Hosts stopped 0" means the body had already stopped its earlier Host before the signal. The tracked tree was confirmed dead in every case. An earlier pre-commit run of template-install SIGTERM took 62.6 s for the driver to return, with no survivors; it did not reproduce in the re-run, and the cause is not established.

### 2.2 Foreground under background load (B1)

The background Session streams 40 chunks at 250 ms. The foreground Session runs three turns idle and three while the background streams. Both use the research preset.

| Window | First chunk (ms, median) | Upstream received (ms) | Turn end (ms) | Host CPU avg | Host RSS max | Processes |
| --- | --- | --- | --- | --- | --- | --- |
| Idle | 45 (44/45/52) | 23 | 89 | 2.4 % | 329 MB | 1 |
| Background streaming only | — | — | — | 1.9 % | 330 MB | 1 |
| Foreground under load | 52 (48/52/54) | 25 | 92 | 12.4 % (sample max 29 %) | 334 MB | 1 |
| Whole run | — | — | — | sample max 86 % (startup) | 342 MB | 1 |

The background was still streaming when the last foreground turn ended, then completed with 40/40 chunks and was not closed by the client. Durable seqs are per Session and contiguous, and no background text appeared in the foreground. **Limit:** this is one slow fake stream with no tools. It does not show behaviour under several Workers, heavy tool output or a real provider's rate limits.

### 2.3 Targeted cancel (B2)

Setup:
- The background Session uses the developer preset, with a disposable git workspace (see below).
- Its fake model calls `bash {command: "sleep 47.913", run_in_background: true}` (approved `allowed-once` through `$events`), then `subagent {prompt: "⟦gate:b2-child⟧…", run_in_background: true}`, then streams and hangs.
- The child's own model request also hangs.
- The foreground Session (research) streams 20 chunks at 200 ms.

| Fact | Sandboxed Host | Unsandboxed Host |
| --- | --- | --- |
| Cancel receipt / `turn/end aborted {user}` | 7 ms / 7 ms | 6 ms / 6 ms |
| Background upstream stream closed by DSH | 4 ms | 3 ms |
| Foreground | `completed`, 20/20 chunks, not closed | same |
| Events after background `turn/end` | none | none |
| Background shell job | never ran: `exit code 71`, nested Seatbelt | **alive 2 s after cancel**; ended only by Host stop |
| Background subagent | **child Session still `running`, its model stream still open 2 s after cancel**; closed by Host stop | same |

Answers ADR-0007 "Whether `agent.cancel` also ends subagents and background shell jobs is unknown": **with `session.cancel` on the parent, neither ends.** Both are reclaimed by Host disposal. Whether `session.cancel(childSessionId)` and the DSH job kill path (`job.*` Remote, not in the whitelist) stop them was not tested here; B6 (§6) tests it.

Claw finding: under the developer preset, Claw's delegate layer denies background bash and write-capable subagents unless the Session cwd is a git workspace. It returns `Denied: write child requires a git workspace to allocate a task worktree.`, because it allocates a per-child worktree. The gate makes the disposable `canonicalRoot` a one-commit repo (`gitWorkspace()`).

### 2.4 Restart and read-only reconcile (B4)

Before the kill:
- S1 (research) has a hanging stream and one `queue` prompt in its `next-turn` inbox.
- S2 (developer, approved) runs foreground `bash sleep 39.517`.

The gate then SIGKILLs the Host, restarts it on the same home, reads projections then page with no follow, waits 5 s, and only then opens a cold follow and waits another 5 s.

| Fact | Value |
| --- | --- |
| Supervisor observed exit | 9 ms after SIGKILL (`DSH exited (SIGKILL)`) |
| Restart on same home (stale lock) | 736 ms, new pid |
| S1 tail after restart | `step/end`, `turn/end {kind: interrupted}` |
| S2 tail after restart | `tool/result isError: true` ("interrupted after it was recorded … outcome is unknown … retry only if read-only or idempotent"), `step/end`, `turn/end interrupted` |
| Model requests during read-only reconcile + 5 s | 0 |
| Bash commands re-run | 0 |
| Queued inbox item | still in `inbox.next-turn` after reconcile **and** after a cold follow; no `turn/start`, 0 model requests |
| **Foreground bash child of the killed Host** | **survived, reparented to PID 1** (killed by gate cleanup) |

The synthetic end reason is `interrupted`, not `aborted`. How the pending item is meant to be drained after recovery (resubmit, `updateQueue steer`, or a new prompt) is open.

### 2.5 Steer and updateQueue (B5)

Turn step 0 streams 20 chunks at 150 ms and ends with a read-only `read` call. During step 0 the gate sends:
- `prompt steer ⟦rev:1⟧`
- `prompt steer ⟦rev:2⟧`
- `prompt queue ⟦rev:3⟧`
- `updateQueue edit` (to `⟦rev:3e⟧`)
- `updateQueue steer`

Every receipt and op returned `{accepted: true}` within 4–7 ms.

The splice log, in seq order:
- `next-step` inserts at 0 and 1 (the steers).
- `next-turn` insert (the queue item).
- `next-turn` remove-1 / insert-1 (the edit, same item id).
- `next-turn` remove-1 with `outcome` (the steer action).
- `next-step` insert at 2.
- One `next-step` removedCount 3 (the claim), followed by `user/message` seqs 32–34 carrying `rev:1`, `rev:2`, `rev:3e`.

The model's step-1 request contained exactly those three in that order. `rev:3` never reached the model. One `turn/start` and one `turn/end completed`.

## 3. Cleanup

Every run ended with no DSH Host alive, `corn-host.lock` absent and no process referencing the home. Homes were removed on pass. Two homes kept by failed B3 harness runs (a bug in `eventSummary` for `tool/result`, fixed before `26fac9b`) were released with `seed-home.mjs release`. Leftover shell processes were found and killed by the gates only in the two cases reported as findings: the B2 background job before Host stop, and the B4 orphan. The template at `~/.corn-bot-dev/wt-dsh-gates/template` is intentionally retained for re-runs.

## 4. Impact on ADR-0007

**Revisit trigger "a targeted stop cannot be confirmed (dispatch fencing plus cancellation of jobs and subagents owned by that Run)"**: at risk.
- DSH's per-Session cancel stops the Turn and its stream precisely and leaves other Sessions alone.
- It does **not** stop owned background jobs or subagents.
- A Run-level stop therefore needs Corn to enumerate and stop children explicitly: child Sessions via `parentSessionId`/`origin: subagent` in `session/list`, plus jobs through the job Remote.
- Alternatively, Corn could forbid background jobs and subagents for Worker Sessions.
- Neither path is verified yet. A follow-up probe (cancel child Session; job kill RPC behind the whitelist) should run before C1 is designed. **Done in B6 (§6): verdict conditional.**

**Revisit trigger "foreground latency under background load"**: not triggered at the tested load (+7 ms median first chunk, one slow fake stream). Heavier load is unproven.

**Model isolation**: the gate is still pending, but its precondition is met. U1 is implemented in [PR #27](https://github.com/xingyingyuzhui/corn-bot/pull/27), and that PR's session-model real-Host smoke passed.

**Known gaps now answered:**
- Subagents and background jobs are **not** ended by Session cancel.
- Pending inbox items **do not** start a new Turn after recovery, not even on a cold follow.

**New facts for the required work:**
- **C3 (reconcile):** the restarted Host writes the synthetic `turn/end interrupted` and marks the in-flight tool as an "outcome unknown" error. Read-only reconcile (projections, then page) caused no activation. Corn must map `interrupted` explicitly and surface the stranded `next-turn` item.
- **#19 / supervisor:** a Host SIGKILL (and therefore the bounded-stop SIGKILL fallback) **orphans running tool processes**. Corn's supervisor needs a process-group kill or a post-crash orphan sweep. The A4 bounded stop was measured with no tool running.
- **C4 (approvals):** a late `$events/result` for a withdrawn request returns success and is ignored. Corn cannot detect staleness from the RPC result; it must use `approval/decided` and the `$events` cancel frame.
- **C2:** `session/projections` and `session/updateQueue` are now in the strict RPC whitelist, with adapter methods `projections()` and `updateQueue()` and an endpoint-shape test.
- **Product:** with Claw developer policy, background shell jobs and write subagents need a git workspace.

## 5. Harness notes

- `scripts/gates/lib/gate-env.mjs`: isolation, preflight, the sandbox spawn and the scrubbed unsandboxed spawn, `NetworkWatch`, `ResourceSampler` (200 ms `ps` samples plus exact snapshots at marks; CPU from cumulative CPU-time deltas), read-only reconcile, `$events` approvals and report writing.
- `scripts/gates/lib/gate-session.mjs`: `runGate` sequences sandbox check, stub, home, governed Host, harness, body, cleanup, release and report.
- Drivers are not sandboxed as a whole, because setuid `ps` cannot be exec'd under `sandbox-exec`. Only the Host or audit child is, except where `--whole-sandbox` is passed for scripts that need no `ps`.
- A4's preload (`scripts/gates/support/ignore-sigterm.mjs`) is the only modification to the real Host. The `HostStopTimeoutError` path (a child that survives SIGKILL) cannot be produced with a real process and remains unit-test-only.
- All numbers come from one machine (15 CPUs, Node 24.18.0) and one run per scenario at `26fac9b`. Earlier pre-commit runs agreed within a few ms.
- B6 additions:
  - The fake model's `awaitRelease` holds a stream before its tool call until the gate releases it. B6 uses it to spawn a job in the middle of the stop sequence.
  - `runGate` reports the Host's own `exit` (code and signal) and, on failure, a stderr tail, `errorCause` and the body's `errorContext`. The supervisor reports only on `close`, which waits for every stdio holder.

## 6. Run-level stop via DSH APIs only (B6)

**Run 2026-10-12 on `test/dsh-targeted-stop-probe`, on top of `a407e08`, with the probe uncommitted at the time.** The committed probe is the same code after `biome` formatting. Same constraints as above: headless, fake loopback model only, one real Host at a time. The Host runs unsandboxed (scrubbed env, loopback-only provider; `lsof` saw 39–40 samples per run and no non-loopback endpoint). Each order was run once, and every number below comes from that run's report (`.artifacts/gates/b6-run-level-stop-<order>.json`, not committed).

### 6.1 Setup

This reproduces B2 with more moving parts:
- The parent Session (`developer`, git workspace) starts a background bash job, `bash-1`, then a background continuable subagent, then hangs mid-stream.
- The child Session starts its own background job, `bash-2`. Its next model stream is then held at the release gate, right before a tool call that starts `bash-3`.
- Every job runs `sleep A & sleep B & wait`, so each job is a process tree of 3 PIDs (bash plus two sleeps). Every PID carries the job's marker in its argv:
  - `53.11`: parent's `bash-1`
  - `53.21`: child's `bash-2`
  - `53.31`: child's late `bash-3`
- A `ps` watcher polls every 25 ms plus the duration of `ps`, and records when each marker has no process left.
- A foreground Session (`research`) streams 40 chunks at 200 ms throughout.

The stop uses only these DSH APIs:
- `session.cancel(parent)`.
- `session.list` to enumerate children through `parentSessionId`.
- `subagents.interruptByParent({childSessionId, parentSessionId, mode: 'continuable'})` per child.
- `job.list` per Session, then `job.kill` per running row.

`session.cancel(child)` was attempted first every time. It is **refused** with `session/agent-busy` ("owned by subagent routing"); the owner-scoped interrupt is the official path.

Orders (T0 = start of the stop sequence; all times in ms after T0):
- **sessions-first:** cancel the parent; release the late spawn; stop the children; one job pass.
- **jobs-first:** cancel the parent; job pass; release the late spawn; stop the children. This is the race: a job is started after the job pass.
- **leaf-first:** release the late spawn; stop the children; job pass; wait until no marker process is left; cancel the parent last.
- **`--recancel`** (on sessions-first): if the parent wakes up again, cancel it again.

### 6.2 Measurements

| Measurement | sessions-first | jobs-first | leaf-first | sessions-first + re-cancel |
| --- | --- | --- | --- | --- |
| Parent cancel receipt / `turn/end aborted {user}` | 8 / 8 | 6 / 6 | 245 / 245 (sent last) | 7 / 7 |
| Late job (`bash-3`) process seen | 148 (during the stop) | 166 (**after** the job pass at 12–19) | 137 | 147 |
| `interruptByParent` receipt and child `turn/end aborted {user}` | 160 | 177 | 151 | 161 |
| Child no longer `running` in `session.list` | 202 | 182 | 251 (checked after the parent cancel) | 209 |
| Jobs listed by the job pass | `bash-1` only (the child's jobs had already left its roster) | `bash-1` (parent) and `bash-2` (child) | `bash-1` only | `bash-1` only |
| `job.kill` RPC | `requested`, 3–4 ms | `requested`, 3–4 ms each | `requested`, 2 ms | `requested`, 3 ms |
| All PIDs gone, descendants included (3 per tree) | 200 for all three trees | `bash-1` and `bash-2`: 55; `bash-3`: 221 | 215 for all three | 217 for all three |
| +2 s: marker processes / running jobs | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| +2 s and +10 s: running Sessions | **parent** | **parent** | none | none |
| Parent model requests after its own cancel | **1** (at 208) | **1** (at 37) | 0 | 0 |
| New parent Turns after the stop | **1** | **1** | 0 | 1 (aborted at 203, before its first step) |
| Foreground | `completed`, 40/40, not closed | same | same | same |
| Leftover processes at Host stop / cleanup | 0 / none | 0 / none | 0 / none | 0 / none |

Process-kill evidence:
- `job.kill` takes the whole process tree down: every PID of a tree, descendants included, was gone within 7–43 ms of the kill request. These are upper bounds set by the `ps` poll.
- Interrupting the child also takes down **the child's own jobs**, including one started during the stop. In jobs-first, `bash-3` was never in any job pass; it disappeared about 44 ms after the interrupt.
- After the interrupt, the child's job roster was empty. In one development run, `job.kill` on a `bash-3` row read just before the interrupt failed with `unknown job bash-3`, which is not the documented `job/not-found`. A caller must treat a kill error after an interrupt as "already gone".

Race: a job spawned after the job pass survives the pass, and nothing in the job API prevents a new spawn. In these runs it was reclaimed because the child was interrupted after the pass. That covers jobs owned by an interrupted child, but not a job the **parent** starts again after it is woken (§6.3).

### 6.3 Parent reactivation (the finding)

Ending a child or a job delivers a **notice into the parent's inbox**. If the parent's Turn has already ended, DSH starts a new Turn, which makes a new model request. Parent journal, sessions-first:
- `turn/end aborted {user}`
- `agent/inbox/spliced next-turn` with source `subagent-settled`, `senderSessionId` = child id, "Background subagent … was stopped before it finished", followed by the child's closing message
- `turn/start {turn: 2}`
- `agent/inbox/spliced next-step` with source `tool-jobs`, "background job bash-1 (…) finished [status: killed, signal: SIGTERM; cancelled by the user]"
- `step/start`
- `user/message` (the settled notice)
- a model request at 208 ms

In jobs-first, the `tool-jobs` notice for `bash-1` woke the parent first, with a model request at 37 ms.

In leaf-first, both notices arrived while the parent's original Turn was still running. They were spliced as `next-step` and never claimed. The parent cancel then ended that Turn, and through +10 s there was no new Turn and no model request. They stay in the inbox, because `cancel` keeps it. Whether they surface with the next user prompt was not tested.

With `--recancel`, the second cancel (at 195 ms) ended the woken Turn at 203 ms, before its first step, so no model request was made. This is a race, not a guarantee: in the two parent-first runs the woken Turn's request came at 37 and 208 ms.

### 6.4 Events and correlation

| Signal | Carries | Correlatable by Corn? |
| --- | --- | --- |
| `turn/end` (parent and child) | `reason {kind: aborted, reason: {kind: user}}`, turn number | by Session id only; no Corn run id or request id |
| `subagent-settled` notice | `source.senderSessionId` = child Session id, summary, closing message | **yes** (structured) |
| `tool-jobs` notice | the job id (`bash-1`), status and reason **only in text/summary** | only by parsing text; no structured job id |
| `job.list` rows | `id`, `owner` (Session id), `status` (`killed`), `detail` ("signal: SIGTERM; cancelled by the user"), `startedAt`/`finishedAt` | yes |
| `session.list` / parent `subagentCatalog` | `parentSessionId`, `origin: subagent`; catalog `{id, mode: continuable, label}` | yes |
| Claw files (one retained development-run home, inspected) | `agent-delegate/audit.jsonl`: child `create`/`end` with handoff patch; per-job worktrees keyed `job-<uuid>` (not the DSH job id). `agent-observe/diag.jsonl`: no entry for the interrupt or the kills | partially |

### 6.5 Verdict on the ADR-0007 trigger

**Trigger "a targeted stop cannot be confirmed": CONDITIONAL. It does not fire if Corn adopts the conditions below; it stays open for the idle-parent case.**

What is confirmable with DSH APIs only:
- Children stop on `subagents.interruptByParent`, and child jobs go with them.
- Jobs stop on `job.kill`, and the whole process tree goes.
- Both are verified by PID, with nothing left at +2 s or +10 s.
- The foreground Session is unaffected.
- `job.list` and `session.list` give Corn the ids it needs to enumerate and verify.

Conditions:
1. **Order leaf-first:** interrupt every child, kill every listed job, wait until the roster and processes are clear, and cancel the parent last. Parent-first lets the settlement notices wake the parent: one extra Turn and one model request in both parent-first runs.
2. **The parent must still have a running Turn when the notices land.** A background Run whose parent Turn has already ended (common: "started the work, will report back") is woken by the notices whatever the order. A re-cancel can usually beat the woken Turn's first model request, but that is not guaranteed (requests seen at 37–208 ms). C1 fencing as specified blocks tool dispatch, not model requests.
3. **Treat jobs started during the stop as normal.** Re-enumerate after the children stop, and treat kill errors after an interrupt as "already gone".

Open items:
- A DSH-side way to cancel without keeping or delivering settlement notices (or a "stopping" state that suppresses wakeups) would close condition 2. That is an upstream question, not tested here.
- Whether the retained notices surface on the next user prompt is not tested.

### 6.6 Whitelist and adapter changes

The narrowest set the stop needs:
- **RPC:** `job/kill` and `subagents/interruptByParent`.
- **Stream:** `job/list`.

Adapter:
- `JobClient.kill(sessionId, jobId)`: validates the `requested` / `already-finished` outcome.
- `JobClient.rows(mux, sessionId)`: takes the first `rows` frame, closes the stream and validates rows.
- `SessionClient.interruptChild({parentSessionId, childSessionId})`: always `mode: 'continuable'`; rejects unless `accepted: true`.

The tests also pin that these stay denied:
- `job/follow` (as stream and as RPC);
- `job/kill` as a stream and `job/list` as an RPC;
- `job/start`, `subagents/prompt` and `workspace/archiveSession`.

`workspace/archiveSession` also cancels descendants and jobs, but it archives the Session, so it was not used.

### 6.7 Cleanup

- Every B6 run ended with no DSH Host alive, no `sleep 53.*` process and `corn-host.lock` absent.
- Homes from failed runs were released with `seed-home.mjs release`; failing expectations retain a home by design. The leaf-first home was removed on pass.
- Development runs exposed a probe bug: the probe stopped the Host, then queried it. That bug was fixed before these runs, and no DSH Host failure was involved.
