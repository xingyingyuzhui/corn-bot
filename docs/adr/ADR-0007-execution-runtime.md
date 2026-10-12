# ADR-0007: DSH Host + Claw as the single execution runtime

- Status: **Accepted (2026-10-12)** by maintainer decision. The planned real head-to-head comparison with a challenger was skipped by the same decision.
- Milestone: P1 / RT-DECISION ([forward plan](../plans/CORN_BOT_FORWARD_PLAN.md) §5)
- DSH: `0.2.0-rc.2`, tag `dsh-v0.2.0-rc.2`, commit `639ed015397290b3745d163aafe02ffee4aa3f84` (source read at `/Users/qin/deepseek-harness`, same as `runtime.lock.json`)
- Claw Suite: `0.3.0-rc.2` (all nine components at tag `v0.3.0-rc.2`)

## Context

The forward plan §5 compared three execution runtimes: the existing DSH Host + Claw, OpenClaw (`v2026.10.2` / `b8952d47`) and Mastra (`@mastra/core@1.76.0` / `81299c92`). The [static capability matrix](../research/runtime-capability-matrix-2026-10-12.md) merged three read-only audits. It covers a 13-row capability table, a seven-item comparison against the per-dispatch governance hard gate, the build/patch list for each runtime, and a non-binding ranking: DSH > Mastra > OpenClaw.

The plan requires exactly one execution loop. Until now the choice was pending.

## Evidence and its limits

- The static matrix and its appendices (`path:line@pin` citations).
- Existing DSH measurements: [M0 evidence](../milestones/M0-EVIDENCE.md) shows native deny, ask/reject and cancel with zero tool executions, outer PTC rejection, and SIGKILL recovery with a continuous log. Startup admission is covered by [ADR-0006](ADR-0006-claw-admission.md) and [R1](../milestones/M0-EVIDENCE.md#r1-reopened-by-f1); the R1 joint sign-off is still pending as stated there.
- **No real comparison was run. Mastra and OpenClaw were not installed, started or executed.** No model was called for this decision. The DSH facts below come from source reading and earlier M0/R1 runs, not from new runs.

## Decision

1. **The single execution loop is DSH `0.2.0-rc.2` with Claw `0.3.0-rc.2`**, at the pins above. Corn must not add a second agent loop or run another runtime against the same execution session.
2. Rationale:
   - **Closest to the governance hard gate.** `tools.guard()` runs after every pre-execute step and after approval, and no listener can override it. Claw's guard re-reads the policy synchronously on every call, so a policy tightened while an approval is pending takes effect. Unknown tools are denied by default. These behaviours have been measured.
   - **No in-flight replay on restart.** An open Turn gets a synthetic end and its in-flight tools are marked as errors. This is verified at source level only.
   - **Smallest backend-specific work.** Corn needs U1 (S) and C1 (M); the other adapters are mostly S.
   - **Already wired.** Admission, authentication, recovery and model settings audits already exist.
3. Mastra's EE licence question stays open but no longer blocks anything. It only matters if this ADR is reopened.

## Required work

| ID | Work | Owner / gate |
| --- | --- | --- |
| U1 | Upstream DSH patch: session-only model selection. Either a `session.selectModel` option that does not write the global default, or a new session-scoped Remote. | **Needs separate authorisation (plan §5.3). This ADR does not grant it.** If upstream rejects it, a self-maintained patch also needs its own decision. |
| C1 | Corn-owned Host plugin `corn-run-control`, registered on the public global `tools.guard`. It checks attempt, stop epoch, revision and lease. Main pushes control snapshots over an authenticated JSON route. Unknown or stale control state is denied by default. Every denial is audited with runId, attemptId, callId and rootCallId. The plugin joins [ADR-0006](ADR-0006-claw-admission.md) admission, so a missing plugin blocks admission. Upstream DSH and Claw policy are not changed. | Part of RUN-01a |
| C2 | Transport allowlist adds `session/projections` and `session/updateQueue`; the follow merge gains a page backfill. | Adapter, S |
| C3 | Read-only reconcile: projections first, then page, never a cold follow. An open Turn is treated as unknown, and unknown side effects are never retried. | Adapter, S–M |
| C4 | Approval mapping (eventId ↔ callId ↔ Attempt), generation replacement, and a Corn-side timeout that rejects. | Adapter, S–M |
| C5 | Durable requestId, single flight, reconcile after a lost receipt. | Adapter, S |
| C6 | Product domain: Run / Attempt / Directive / ControlOp / Completion / Outbox and the database. This is needed with any runtime. | DATA-01 / RUN-01, L |
| C7 | Separate foreground and Worker sessions; optional Corn-side model request throttling. | Adapter, M |
| C8 | Bundle size reduction. | Packaging, M |

## Known gaps and risks

- The `memory` tool and identity changes pass Claw without a guard.
- Claw governs only Claw-classified sessions.
- The Gate audit has no callId, merges identical denials within 1.5 s and swallows write failures. Allowed calls are recorded only in the session log. C1 covers what Corn needs; the Claw patch (U2) stays optional.
- DSH approvals have no timeout (C4 adds one on the Corn side).
- Cancel is per session, not per Run, so foreground and background must use separate sessions.
- Whether `agent.cancel` also ends subagents and background shell jobs is unknown.
- Whether pending inbox items start a new Turn after recovery is unknown.
- The LLM layer has no global concurrency or priority control. Foreground latency under background load is unproven.
- The unsigned arm64 bundle is about 846 MB.
- Upstream drifts fast. `0.2.1-alpha.2` changed the `session.projections` result (`kind`, `migration-required`) and removed `tools.mode: both`, which the current PTC smoke config uses.
- PTC stays disabled. Opening it needs a separate governance work package that proves per-call checks on nested calls.

## Consequences

- The §5.2 scenarios become **DSH real acceptance gates** for P3/P4. All of them stay **pending** until runs are explicitly authorised. Run them with a fake provider and side-effect-free tasks first, one scenario at a time.
  1. A background Worker is still running and the foreground session answers independently.
  2. Three successive requirement changes are applied in order, and each adoption is reconciled.
  3. Progress queries come from projections or control state with zero model calls.
  4. Stopping one task: `turn/end aborted`, C1 denies further dispatch, the other session is unaffected, and a late approval of an old request does not execute.
  5. The completion is delivered exactly once through the Outbox, including after a reconnect or restart.
  6. A restart does not replay blindly: read-only reconcile happens before any activation.
  7. Model isolation (plan §7.3). Expected to fail without U1.
  8. Governance negatives: tighten the policy while an approval is pending, use stale control state, check that every denial is attributed, and check that `run_code` makes zero inner dispatches.
  9. Resources: process count, RSS and CPU, without stealing focus.
- #15 N2, rebase/integration and merge are unblocked by this decision. They remain review-gated, and checks with a real Key still need authorisation.
- MODEL-01b and DATA-01 now have their runtime dependency satisfied. Backend-specific work proceeds on DSH only.
- A future DSH or Claw upgrade must re-verify the matrix facts and ADR-0006 at the new tag before `runtime.lock.json` is bumped.

## Revisit triggers

Reopen this ADR if any of the following happens:

- DSH cannot keep foreground latency acceptable under background load.
- A targeted stop cannot be confirmed: dispatch fencing plus the cancellation of jobs and subagents owned by that Run.
- Model isolation cannot be met without an unacceptable patch burden (U1 rejected and a self-maintained patch declined).
- Upstream drift breaks the pinned contracts.

If reopened, the next candidate is Mastra (only after its EE licence question is cleared) or OpenClaw (its auto-resume after restart must be shown to be stoppable before Corn's read-only reconcile). Run the comparison in the matrix's serial format.

## Addendum 2026-10-12: targeted-stop verdict

- Status: **Accepted (2026-10-12)** by maintainer decision. This addendum adds to the ADR. It does not change the Decision, and the sections above stay as written.
- Naming: in this addendum **U2** is the stop-settlement upstream patch drafted in [U2-STOP-SETTLEMENT-DRAFT](../milestones/U2-STOP-SETTLEMENT-DRAFT.md). The optional Claw audit patch called "(U2)" in Known gaps and in the matrix is called the **Claw audit patch** from here on. It is still optional.

### Evidence

All runs used a real DSH `0.2.0-rc.2` Host with Claw `0.3.0-rc.2`, a fake loopback model and real `sleep` process trees. No real provider was called.

- [PR #28](https://github.com/xingyingyuzhui/corn-bot/pull/28) (`test/dsh-headless-gates`, `a407e08`), B1–B5. B2 shows that `session.cancel` ends only the Turn. Background jobs and subagents survive it ([§2.3](https://github.com/xingyingyuzhui/corn-bot/blob/a7a75dc318213fc4ef7f85cd9be7a876f07a408d/docs/milestones/DSH-HEADLESS-GATES.md#23-targeted-cancel-b2), [§4](https://github.com/xingyingyuzhui/corn-bot/blob/a7a75dc318213fc4ef7f85cd9be7a876f07a408d/docs/milestones/DSH-HEADLESS-GATES.md#4-impact-on-adr-0007)).
- [PR #30](https://github.com/xingyingyuzhui/corn-bot/pull/30) (`test/dsh-targeted-stop-probe`, `a7a75dc`), B6: a Run-level stop using DSH APIs only, measured in three orders ([§6](https://github.com/xingyingyuzhui/corn-bot/blob/a7a75dc318213fc4ef7f85cd9be7a876f07a408d/docs/milestones/DSH-HEADLESS-GATES.md#6-run-level-stop-via-dsh-apis-only-b6)). Measurements are in §6.2, parent reactivation in [§6.3](https://github.com/xingyingyuzhui/corn-bot/blob/a7a75dc318213fc4ef7f85cd9be7a876f07a408d/docs/milestones/DSH-HEADLESS-GATES.md#63-parent-reactivation-the-finding) and the verdict in [§6.5](https://github.com/xingyingyuzhui/corn-bot/blob/a7a75dc318213fc4ef7f85cd9be7a876f07a408d/docs/milestones/DSH-HEADLESS-GATES.md#65-verdict-on-the-adr-0007-trigger).
  - Leaf-first: all three process trees were gone about 215 ms after the stop started. Nothing was left at +2 s or +10 s, the parent made 0 model requests, and the foreground completed 40/40 chunks.
  - Parent-first (both orders): every tree was gone too, but the parent was woken once and made **1 model request** (at 37 ms and at 208 ms).
- [PR #29](https://github.com/xingyingyuzhui/corn-bot/pull/29) (`fix/host-process-group-kill`), related. It reclaims Host descendant processes when the Host stops or crashes, and it was verified on a real Host. A tool started less than about 2 s before a Host crash is not reclaimed. That PR covers Host death. It is not a substitute for the stop sequence below.
- DSH source at the pinned tag shows why the parent wakes: settlement notices from jobs and subagents open a new Turn on an idle owner. File and line citations are in [U2-STOP-SETTLEMENT-DRAFT §3](../milestones/U2-STOP-SETTLEMENT-DRAFT.md#3-where-dsh-delivers-the-notices-dsh-v020-rc2).

### Verdict

**Revisit trigger "a targeted stop cannot be confirmed": CONDITIONALLY triggered. This ADR is not reopened.**

- DSH-only APIs can confirm a targeted stop if Corn stops the Run leaf-first (below). Under that order the ADR keeps standing.
- The trigger stays open for one case: **a parent that is already idle**, or was cancelled before its children and jobs settled. Settlement notices are delivered to the parent inbox and open a new Turn. That costs **at most one leaked model request per wake**. C1's `tools.guard` fence stops tool dispatch, not model requests, so the leaked request cannot execute a tool but it still reaches the provider.
- The answers to two Known gaps:
  - `agent.cancel` / `session.cancel` does **not** end subagents or background shell jobs. Corn has to stop them explicitly.
  - Pending inbox items do not start a Turn after a Host restart (B4). They **do** start a Turn when a settlement notice reaches an idle owner during normal operation.

### Mandated stop order for C1 `corn-run-control` (normative)

This is part of C1 and RUN-01a. It replaces "request runtime cancel" in the plan §8.2 stop line for the DSH route. MUST and SHOULD carry their usual meaning.

The **Run set** is the Attempt's `workerSessionId` plus every Session whose `parentSessionId` lineage (with `origin: subagent`) leads to it, as read from `session.list`. DSH events carry no Corn run id, so membership comes only from Corn's own Attempt binding plus this lineage. The parent is the Worker Session.

0. **Fence first.** Main increments the Run's stop epoch and pushes the control snapshot to `corn-run-control`. The stop sequence starts only after the plugin acknowledges it. From then on C1 denies every dispatch from any Session in the Run set, including child Sessions and Sessions that join the set later, and audits each denial as specified in C1. The fence is never lowered for this Attempt. If the acknowledgement cannot be confirmed, the stop continues, but the Run cannot reach `cancelled` (plan §8.2 `stopping` / `stop_partial` / `unknown`).
1. **Children, deepest first.** For each child that is still running, call `subagents.interruptByParent({childSessionId, parentSessionId: <direct parent>, mode: 'continuable'})` and require `accepted: true`. The receipt only means the signal was admitted. Completion is confirmed when the child is no longer `running` in `session.list`. Corn MUST NOT call `session.cancel` on a child; DSH rejects it with `session/agent-busy`.
2. **Jobs.** For every Session in the Run set (children first, then the parent), read `job.list` and call `job.kill` on each `running` or `stopping` row. Job ids come only from the structured `job.list` rows. The `tool-jobs` notice carries the id only in text, so Corn MUST NOT parse it for control.
3. **Re-list until empty.** Repeat steps 1–2 until one full pass finds no running child Session and no running job anywhere in the Run set. A child can start a new job after the job pass, and interrupting a child also takes down its own jobs. The loop is bounded by a pass count and a deadline that RUN-01a sets; B6 cleared in about 250 ms, so the starting values are 5 passes and 5 s. Reaching the bound gives `stop_partial`.
4. **Parent last.** Call `session.cancel(parent)`. If the parent is idle, the call is a no-op.
5. **Verify.** At +2 s, `session.list` and `job.list` must show no running Session and no running job in the Run set. Only then may the Run become `cancelled`.

Error mapping:

| DSH result | Meaning for Corn |
| --- | --- |
| `interruptByParent` → `{accepted: true}` | Signal admitted; confirm with `session.list` |
| `interruptByParent` → `subagent/unauthorized` | Re-read the lineage. If the child is gone, count it as stopped; otherwise `stop_partial` and audit |
| `interruptByParent` → `gateway/bad-request` / `gateway/internal` | Retry within the step 3 bound, then `stop_partial` |
| `session.cancel(child)` → `session/agent-busy` | Corn bug: children are interrupted, never cancelled |
| `job.kill` → `requested` | Confirm on the next list |
| `job.kill` → `already-finished` | Gone |
| `job.kill` → `job/not-found` (B6 saw the text `unknown job <id>`) | Gone if it follows an interrupt of the owner or the row is no longer listed; otherwise re-list |
| `session.cancel(parent)` → `session/not-found` | Parent not attached; verify by list |

**Parent already idle, or woken after the stop (until U2 or an equivalent lands):**
- Any `turn/start` on a Session in the Run set after step 0 is a **stale Turn**. Corn MUST call `session.cancel` on it as soon as it sees `turn/start`, without waiting for `step/start`. Corn MUST NOT treat its output as progress, adoption or completion, and MUST NOT route it to the Outbox. The C1 fence already blocks its tool calls.
- Corn MUST count and audit every leaked request. A `step/start` in a stale Turn counts as one leaked model request; this is an upper bound, because Corn cannot see the provider call itself. The audit row carries runId, attemptId, stopEpoch, sessionId, turn, the trigger source (`subagent-settled` with `senderSessionId`, or `tool-jobs`) and whether `step/start` was seen. The count is attached to the Run's stop record.
- Leaked requests on their own do not stop the Run from becoming `cancelled`, because no side effect can follow them. They stay visible in the stop audit.
- Notices left in the parent inbox (`cancel` keeps the inbox) may surface on the next prompt; this is untested. Corn SHOULD NOT reuse a stopped Attempt's Worker Session for a new Attempt until that is tested.
- An optional Corn-side alternative that needs no upstream patch is the C1 pre-step fence in [U2-STOP-SETTLEMENT-DRAFT §4](../milestones/U2-STOP-SETTLEMENT-DRAFT.md#4-options). It would reject the stale Turn's step before any request, the same way DSH's own archived-session gate does. It changes the C1 scope beyond `tools.guard`, so it needs its own maintainer decision and probe. **It is not mandated here.**

### U2 and authorisation

- U2 is **drafted only**: [U2-STOP-SETTLEMENT-DRAFT](../milestones/U2-STOP-SETTLEMENT-DRAFT.md). It describes a cancel that withholds settlement wake-ups, plus a probe that verifies it.
- Nothing has been implemented, patched or posted to `deepseek-ai/deepseek-harness`. Implementing or posting U2 needs **separate maintainer authorisation**. U1 is still the only authorised upstream change.

### Revisit condition for the residual gap

Reopen this ADR (trigger fully fired) if any of the following happens:
- The maintainer judges the leaked requests unacceptable, for example because of real-provider cost, latency or content seen in authorised runs.
- U2 is declined (not authorised, or rejected upstream) **and** the C1 pre-step fence is declined or fails its probe.
- A real-Host run under the mandated order leaves a running Session, job or process tree at +2 s.
- A DSH bump changes the delivery paths cited in U2 §3. In that case B6 must be re-run, leaf-first and idle-parent, before `runtime.lock.json` is bumped.

## Addendum 2026-10-12 (b): C1 pre-step fence adopted

The maintainer decided in advance to adopt the C1 pre-step fence if its probe showed zero leaked requests. The B6-idle probe ([DSH-HEADLESS-GATES §7](../milestones/DSH-HEADLESS-GATES.md#7-option-c-pre-step-stop-fence-b6-idle), PR #38) did: in 13 real-Host runs with a fake model, every fenced variant had 0 parent model requests and 0 compaction requests after the stop, and every woken parent Turn ended `blocked` without a step. Unfenced controls leaked 1–2 model requests and, under compaction pressure, 2 compaction requests.

The pre-step fence is therefore **part of C1** (RUN-01a), in addition to `tools.guard`. The residual gap above is closed for the tested paths, and the stale-Turn rules remain as a fallback. Requirements:

- The fence is raised in step 0, before the first stop call, and covers the whole Run set, including children. A fenced child settles early as a result.
- The `agent/pre-step` listener is registered with `prepend`. The probe's zero-compaction result came from plugin load order, which is not a DSH contract.
- A rejected Turn consumes its inbox notice: the model never sees it, and only the session log keeps a summary. Corn MUST record settlement outcomes itself from structured sources (`job.list`, `session.list`, `senderSessionId`) and MUST NOT rely on the parent reading them.
- `blocked` inside a stopped Run is shown as stopped, not as an error. A fenced child's settlement text ("declined the task") is not a user-facing rejection.
- The fence lives in Host memory. After a Host restart, Corn re-pushes the stop epochs of every non-terminal Run before any Session in them is followed or prompted.
- Packaging the fence inside `corn-run-control` and its ADR-0006 admission is RUN-01a's design work. The probe loaded it as a `cordis.patch.yml` insert without touching Claw rows.

Untested and still open: multiple concurrent Runs, a fence that is never lowered for a reused Session, plugin reload while fenced, DSH versions after `dsh-v0.2.0-rc.2`, and real models. U2 stays a draft; it is no longer needed to close this gap, and implementing or posting it still needs separate authorisation.
