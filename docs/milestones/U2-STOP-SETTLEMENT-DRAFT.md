# U2: stop without settlement wake-ups (upstream DSH patch draft)

- Status: **DRAFT — not implemented, not posted; needs maintainer authorisation.** No upstream code, Corn code or patch exists. Nothing was sent to `deepseek-ai/deepseek-harness`.
- Authorisation: on 2026-10-12 the maintainer authorised **drafting only**. Implementing, patching or posting U2 each needs a separate decision. U1 ([PR #27](https://github.com/xingyingyuzhui/corn-bot/pull/27)) is still the only authorised upstream change.
- Context: the [ADR-0007 addendum 2026-10-12](../adr/ADR-0007-execution-runtime.md#addendum-2026-10-12-targeted-stop-verdict) (verdict: conditional) and B6 in [DSH-HEADLESS-GATES §6](https://github.com/xingyingyuzhui/corn-bot/blob/a7a75dc318213fc4ef7f85cd9be7a876f07a408d/docs/milestones/DSH-HEADLESS-GATES.md#6-run-level-stop-via-dsh-apis-only-b6) ([PR #30](https://github.com/xingyingyuzhui/corn-bot/pull/30), `a7a75dc`).
- Naming: this is not the optional Claw audit patch that the matrix calls "(U2)". See the ADR-0007 addendum.
- **Status update 2026-10-12: the Option C probe (arm 3 of §6) has run; verdict CONDITIONAL YES.** Evidence: [DSH-HEADLESS-GATES §7](DSH-HEADLESS-GATES.md#7-option-c-pre-step-stop-fence-b6-idle). A probe-only `agent/pre-step` fence plugin, admitted as a home-patch insert under ADR-0006, was tested with and without the fence. Variants: idle parent woken by a job, by a subagent and by both; parent-first; leaf-first; and compaction pressure.
  - Every fenced run had **0 parent model requests and 0 compaction requests** after T0, and every woken Turn ended `blocked`. The controls leaked 1–2 model requests, plus 2 compaction requests under pressure.
  - The foreground Session and the next Run after the fence lifted were unaffected.
  - Conditions:
    - Arm the fence before the first stop call.
    - Register it `prepend`.
    - Corn must keep its own settlement record: notices claimed by a rejected Turn are consumed and never reach the model.
    - Map `blocked` inside a fenced Run as "stopped", including the child's "declined the task" notice.
  - Arms 1, 2, 4 and 5 were not run. Adopting C and any U2 implementation still need separate maintainer decisions.
- Source: DSH `dsh-v0.2.0-rc.2` (`639ed015`), read only with `git -C /Users/qin/deepseek-harness show|grep dsh-v0.2.0-rc.2:…`. The clone was not checked out or modified. All line numbers below are at that tag. `master` was not re-read (§7).

## 1. Problem

When a job or a continuable subagent settles, DSH tells the owning Agent with a notice. If the owner is idle, the notice **opens a new Turn**, and that Turn makes a model request. A user stop settles jobs and children by definition, so stopping a Run whose parent is idle wakes the parent that was just stopped.

Corn can avoid this only while the parent Turn is still running, by stopping leaf-first and cancelling the parent last (ADR-0007 addendum). Background Runs often have an idle parent ("started the work, will report back"), and no order helps there. C1's `tools.guard` fence denies the woken Turn's tool calls, but it cannot stop its model request.

U2 asks for a stop that settles a Run's work **without** delivering the resulting notices as wake-ups.

## 2. Evidence (B6, real Host, fake model)

| Order | Parent model requests after its cancel | New parent Turns | Trigger |
| --- | --- | --- | --- |
| sessions-first (parent cancelled first) | 1, at 208 ms | 1 | `subagent-settled` notice → `agent/inbox/spliced next-turn` → `turn/start {turn: 2}` |
| jobs-first | 1, at 37 ms | 1 | `tool-jobs` notice for `bash-1` (killed by `job.kill`) on the idle parent |
| leaf-first (parent cancelled last) | 0 | 0 | Notices landed while the parent Turn was running; spliced `next-step`, never claimed |
| sessions-first + re-cancel | 0 (race won at 203 ms) | 1 (aborted before its first step) | Same as sessions-first; not a guarantee |

Correlation (§6.4 there): `subagent-settled` carries `senderSessionId` in a structured field. `tool-jobs` carries the job id **only in text**. No event carries a Corn run id.

## 3. Where DSH delivers the notices (`dsh-v0.2.0-rc.2`)

### 3.1 Job settlement → owner inbox

`packages/jobs/tool-jobs/src/index.ts`:
- L271–308: the `ctx.jobs.events` listener on `settled`. It skips delivery when the model itself killed or awaited the job, or when the cause is `teardown` (L277–278). It builds a `tool-jobs` notice (L284–294). Then:
  - L295–305: if `completionDelivery === 'wakeup'` (the default, L62) and the owner is `idle`, it calls **`owner.followup(message)`**, which opens a Turn. The optional `maxConsecutiveWakes` budget (L48–56, L296–305) only caps wakes per owner and is refilled by user input (L211–216).
  - L307: otherwise it calls `owner.inject(message)`, which does not wake.
- L262–266 states the design: an idle owner "is woken instead, because an undelivered notice is a completion the model never learns about".

`packages/api/job-controller/src/index.ts`:
- L98–127: `job.kill` is a **human** kill (`'cancelled by the user'`, L125). By design it "is not one the model requested, so the owning agent still receives the completion notice" (L5–7, L103–105).
- L113–120: a failed lookup becomes `job/not-found`, with the registry error text (`unknown job …`) as the message.
- `packages/jobs/jobs/src/types.ts` L187–192: `JobSettleCause = 'producer' | 'kill' | 'teardown'`. Only `teardown` suppresses the notice.

### 3.2 Subagent settlement → parent inbox

`packages/subagent/subagent/src/continuation-activation.ts`:
- L862–866: when an Activation is disposed (natural end or interrupt), the final step calls `notifySettlement`.
- L870–888 `notifySettlement`:
  - If the parent's lineage is in a closing teardown (L877–879), the notice is `parent.inject`ed with no wake.
  - Otherwise L881 calls `sendWaking(parent, message, parent.status === 'idle' ? 'queue' : 'steer')`.
- L334–346 `sendWaking`: for a parent that is not itself a resident Activation (a root Worker Session), L344–345 calls **`parent.steer` / `parent.followup`**. Both wake the parent.
- L283–326 `interrupt`: what `interruptByParent` (`packages/subagent/subagent/src/index.ts` L482–503) calls. It cancels the child with `{keepInbox: true}` (L322–325). The notice text "…was stopped before it finished" comes from `continuation-messages.ts` L111–112, built in L135–159.

### 3.3 Inbox → new Turn

`packages/core/agent-loop/src/agent.ts`:
- L154–161 `send(message, target, wakeup)`: splices the message into the inbox. With `wakeup`, it calls `wakeDriver`. If the current activity was already aborted, the target is rewritten to `next-turn` (L157–158).
- L163–173: `followup` sends `next-turn` with wake, `steer` sends `next-step` with wake, and `inject` sends `next-step` without wake.
- L214–235 `wakeDriver`:
  - On an **idle** Agent it starts a new driver (L225–234), which runs `turn()`. This is the auto-start.
  - On an aborted or maintenance activity it latches `wakeRequested` (L219–222).
- L257–263: the latch is replayed when the aborted driver converges (L262), so a notice that arrives during a cancel's convergence window also opens a Turn.
- L296–396 `turn()`: `turn/start` (L305), then the pre-step (L316). Only after that come `step/start` (L329) and the model request inside `step()` (L398ff). At L390–395, a Turn that ends with the inbox still pending loops into another Turn.

### 3.4 Cancel

- `packages/api/session-controller/src/commands.ts` L511–525: `session.cancel` → `agent.cancel({kind: 'user'}, {keepInbox: true})` (L523). It refuses a subagent-owned Session (L520–522, `session/agent-busy`). `SessionCancelRequest` holds only `sessionId` (`types.ts` L373–375).
- `agent.ts` L175–181 `cancel`: aborts the active activity. With `keepInbox` it keeps the inbox and does not clear the wake latch. On an idle Agent it does nothing, so **it cannot arm anything against a later wake** (`packages/core/agent/src/runtime-types.ts` L177–183).

### 3.5 Upstream precedents U2 can reuse

- **Archive stops work and blocks the wakes it causes.** `packages/workspace/workspace/src/index.ts` L346–385 `archiveSession({stopActivity: true})`:
  1. It writes the archived set first.
  2. Then it fans out `workspace/session-stop` (L480–491) to:
     - `packages/core/agent/src/archive-admission.ts` L34–37 (cancel the turn);
     - `packages/jobs/jobs/src/archive-admission.ts` L32–41 (kill the jobs);
     - `packages/subagent/subagent/src/archive-admission.ts` L30–39 (cancel the descendants);
     - the schedule plugin.
  3. `packages/api/session-controller/src/archived-session-gate.ts` L15–31 rejects `agent/pre-step` for an archived lineage. In its own words (L18–21): "A late waking delivery to an archived Session — a subagent settlement, a queued follow-up — proposes a step the gate rejects, which the loop ends as `blocked` without a request." The JSDoc at L353–356 says the same.
  This is exactly U2's behaviour, but tied to archiving. B6 ruled `workspace/archiveSession` out because it archives the Session.
- **`agent/pre-step` reject is public.** `runtime-types.ts` L309–320. A rejected step ends the Turn `blocked` (`agent.ts` L317–320). The claimed message "is neither discarded nor re-emitted" (`runtime-types.ts` L290–292). Corn's M0 probe fixture already registers `agent/pre-step` (`tests/fixtures/dsh-corn-m0-probe/host.js`).
- **`completionDelivery: 'quiet'`** (tool-jobs L33–38, L62) already turns idle wakes into injects, but for jobs only and for every completion, not just stopped ones.

## 4. Options

### Option A (recommended upstream): `session.cancel` with `settlement: 'quiet'`

An optional field on the existing Remote. Existing callers are unchanged.

```ts
export type SessionCancelSettlement = 'deliver' | 'quiet'

export interface SessionCancelRequest {
  readonly sessionId: SessionId
  /** What later settlement notices do to this Agent; omitted means `deliver`. */
  readonly settlement?: SessionCancelSettlement
}

export interface SessionCancelValue {
  readonly accepted: true
  /** Settlement mode the Host applied. */
  readonly settlement: SessionCancelSettlement
}
```

- `deliver` or omitted: today's behaviour.
- `quiet`: as well as the cancel, the Agent sets a process-local **quiet-wake latch** that works even when the Agent is idle. While the latch is set:
  - `Agent.send(…, wakeup: true)` for a message whose `source.kind` is not `user` inserts the message without waking. `wakeDriver` is not called and `wakeRequested` is not latched.
  - The latch is cleared when the next user-authored message is claimed, the same refill rule as `maxConsecutiveWakes` (tool-jobs L211–216).
- Choke point: both producers already go through `Agent.send`: tool-jobs `followup` (§3.1) and subagent `sendWaking` → `followup`/`steer` (§3.2), including the resident-Activation path `inbox.deliver` (`inbox.ts` L46–55). One change in `agent-loop/src/agent.ts` therefore covers both. The notice stays in the inbox, so the model still learns about it on the next real prompt. This keeps the "undelivered completion" concern of tool-jobs L262–266.
- Files (estimate S–M):
  - `core/agent/src/runtime-types.ts`: `CancelOptions.quietWakes` and its JSDoc.
  - `core/agent-loop/src/agent.ts`: `cancel`, `send`, and the latch clear on `agent/inbox/claimed`.
  - `session-controller` `types.ts`, `commands.ts` and `index.ts`.
  - The README pair, the regenerated api-catalog, and host specs.
- Back-compat:
  - The field is optional, so existing callers are unaffected.
  - Typert request codecs strip unknown keys (as found for U1), so an **unpatched Host silently ignores `settlement`** and still wakes. The reply echo lets Corn detect that.
  - No persistence format change. The latch is process-local, and after a Host restart pending notices do not auto-start anyway (B4).
- Not covered: Corn still has to run the leaf-first sequence itself, because the stop is not server-side.

### Option B: `session.stop` with `scope: 'tree'` (archive stop machinery without archiving)

A new Remote, or a `scope` on `session.cancel`. It reuses §3.5:
1. Add the Session to a process-local **stopped set**.
2. Fan out `workspace/session-stop` for the Session (turn, jobs, descendants, schedule).
3. Gate `agent/pre-step` for the stopped lineage in the same way `archived-session-gate` gates an archived one.
4. Lift the gate on the next user prompt, or with an explicit `session.resume`.

```ts
export interface SessionStopRequest {
  readonly sessionId: SessionId
  readonly scope: 'tree'
}
export interface SessionStopValue {
  readonly accepted: true
  readonly scope: 'tree'
  /** Activity reported before the stop, as `workspace/session-activity` families. */
  readonly stopped: readonly SessionActivity[]
}
```

- Pros:
  - The whole stop is server-side and atomic against new wakes, which removes Corn's re-list loop.
  - It reuses providers that already exist and are tested.
  - A stale woken Turn ends `blocked` with no request.
- Cons:
  - Larger (M). It touches the workspace registry and the session-controller, and needs a decision on where the stopped set lives.
  - The subagent provider uses `child.cancel({kind: 'parent'})` (§3.5), not the continuable interrupt, so whether that path emits a settlement notice needs checking.
  - Upstream may prefer to keep stop semantics on archive.
- Back-compat: purely additive. An unpatched Host returns a not-found Remote error, so it fails closed.

### Option C (Corn-side, no upstream change): C1 pre-step stop fence

`corn-run-control` also registers `agent/pre-step` and rejects a step for any Session in a Run set whose stop epoch is fenced. This copies `archived-session-gate` L27–30.

- A woken stale Turn logs `turn/start`, then `turn/end blocked`, and makes **no model request**. The claimed notice ends there (`runtime-types.ts` L290–292).
- Fence lifecycle: the fence is lifted only when Corn itself starts a new Attempt or user prompt on that Session.
- Not an upstream patch, but it changes C1's scope beyond `tools.guard` (ADR-0007 C1 row). **It needs a maintainer decision.**
- Risks:
  - Waterfall order. `compaction-basic` runs a pressure compaction inside its own `agent/pre-step` listener before `next()` (`packages/compaction/compaction-basic/src/index.ts` L158–176). If it runs outside Corn's listener, it could make a compaction request first. The probe must count every upstream request.
  - `blocked` must be mapped as expected after a stop.

### Rejected

- **Config only, `completionDelivery: 'quiet'`**: covers jobs, not subagents. It also silences every normal completion of a background Worker, which defeats "will report back".
- **Re-cancel race**: Corn already does this as the interim rule, but it is not a guarantee (B6: requests at 37–208 ms).
- **`workspace/archiveSession`**: archives the Session (B6 §6.6).

**Recommendation:** probe Option C first, because it needs no upstream change. Propose Option A upstream as the clean contract. Keep Option B as the alternative if upstream wants a server-side tree stop.

## 5. Corn-side detection and fail-closed design

- Adapter: `SessionClient.cancel(sessionId, {settlement: 'quiet'})` refuses a reply that does not echo `settlement: 'quiet'`, as U1 does for `scope`. For Option B, `stop()` refuses a reply without `scope: 'tree'`.
- Transport allowlist: admit `session/cancel` with `settlement` only when the locked runtime declares U2 (`runtime.lock.json` `dshPatches` gains `U2`). `verifyDshPatches` fails with `runtime_patch_mismatch`, as U1 does.
- Fail-closed:
  - If U2 is not verified, Corn keeps the ADR-0007 interim rule: leaf-first, cancel any stale Turn as soon as it starts, and count and audit leaked requests.
  - Corn never assumes quiet delivery without the echo.
  - With U2 verified, Corn still runs the stale-Turn detector. Any `turn/start` in a fenced Run set after a quiet cancel is a **U2 violation**: audited as `u2_violation`, then cancelled.
- Leak accounting stays in place under every option. Under U2 the expected count is 0, and a non-zero count is an alarm, not a tolerance.

## 6. Probe design (B6-idle; arm 3 run 2026-10-12, see the status update above)

Variant of `scripts/gates/b6-run-level-stop.mjs`, same harness: real Host, unsandboxed, scrubbed environment, loopback fake model, `ps` watcher at 25 ms, foreground Session streaming 40 chunks.

- Setup: the parent starts `bash-1` and a background continuable child, then **ends its Turn** (`completed`, "will report back"). The child starts `bash-2` and is held at the release gate before `bash-3`. The parent is `idle` before T0. This is the case no order fixes today.
- Arms, one per run, all leaf-first:
  1. **baseline**: no U2. Expect ≥ 1 parent Turn and ≥ 1 parent model request. This reproduces the gap.
  2. **interim**: stale-Turn cancel on `turn/start`. Record request count and latency; expect it to be 0 or 1, never more.
  3. **Option C**: pre-step fence in the gate's own fixture plugin. Expect `turn/end blocked` and **0 parent model requests**, counting compaction and title requests separately.
  4. **Option A**: needs an authorised patched Host. `cancel(parent, {settlement: 'quiet'})` at T0, then leaf-first. Expect **0 new parent Turns and 0 parent model requests through +10 s**, and the reply echoes `quiet`.
  5. **Option A, unpatched Host**: expect a missing echo, an adapter refusal, and a fallback to the interim arm.
- Common pass conditions:
  - All three trees gone by PID.
  - No running Session or job at +2 s and +10 s.
  - Foreground `completed` 40/40.
  - No non-loopback endpoint.
  - Cleanup leaves no Host, no `sleep 5x.*` and no lock.
- Follow-up check for arms 3 and 4: send one user prompt to the parent afterwards. Record whether the retained notices surface in that Turn (open in B6 §6.3) and whether the latch or fence lifts.
- Records: parent model requests (from the fake server, by marker), parent `turn/start`/`turn/end` reasons, inbox splices, notice sources, and the time of each.
- Nothing runs until authorised. Arm 4 additionally needs U2 implementation authorisation.

## 7. Risks and open items

- Only `dsh-v0.2.0-rc.2` was read. The local `master` ref is stale (`0.1.0-rc.8`), so drift in `0.2.1-alpha.*` was not checked. A port would start with a fresh read of `master`.
- Option A changes a core-loop rule (`send` wake semantics). Upstream may prefer a narrower hook, such as a `quiet` flag only on the two producers. That would touch two packages instead of one.
- The latch lifecycle is process-local. A Host restart clears it, which is harmless today (B4: pending items do not auto-start) but would matter if upstream changes recovery.
- Retained notices: with Options A and C the notices stay in or end in the inbox. For Option C this is now measured (gates §7.4): claimed-then-rejected notices never reach the model; pending `next-step` notices surface with the next prompt. Option A is untested.
- `job.kill` errors: the `unknown job` text is the `job/not-found` message (§3.1). Corn maps the code and treats the text only as a hint.
- PR #29's crash blind spot (< 2 s) is about Host death and is unaffected by U2.
