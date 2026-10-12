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
