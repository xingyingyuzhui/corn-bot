# M0 developer runtime evidence

Recorded 2026-10-11. **M0 is not complete.** These are developer-runtime results on macOS, not an installable product.

## Verified

| Check | Result and reproduction |
| --- | --- |
| Frozen dependency install | `pnpm install --frozen-lockfile` passed; DSH 0.2.0-rc.2, Electron 44.7.0 |
| Source and package pin | `pnpm verify:runtime` passed; DSH contract commit `639ed015397290b3745d163aafe02ffee4aa3f84` |
| Static checks and build | `pnpm check` and `pnpm build` passed; 19 boundary/admission/model-route/kit tests |
| Published Claw release | Archive SHA-256 and ten internal package checksums verified; own `corn-dev` install only |
| Independent cold boot | `pnpm smoke:cold`: three empty temporary homes booted/authenticated/listed/stopped; concurrent stop and stop-during-start also passed |
| Real Host integration | `pnpm smoke:host`: 16 checks passed, listed below |
| Electron sandbox/IPC | `CORN_DESKTOP_SMOKE=1 pnpm dev:desktop`: safe status returned through sandboxed preload; independent Host ready; captured diagnostic window |
| SQLite candidate | CLI and Electron Node mode opened/read/wrote WAL database; Electron's Node 24.21.0 / SQLite 3.53.4 |
| Native governance and cancellation | `pnpm smoke:governance`: real Gate deny, Remote reject and Remote cancel passed; queue retained, approval withdrawn, trace matched, zero bash body executions |
| UI/UX research kit pin | `pnpm verify:ui-kit` against `.research/grok-bot-ui-ux-kit` at `0248419`: commit and 16 pinned file hashes match, and no Corn file copies a kit file. The kit's own `npm ci && npm run build && npm run check` reproduced byte-identical outputs and passed 7/7 tests. See [source lock](../../design/grok-kit/SOURCE_LOCK.md). CI has no checkout (private repository) and reports `skipped` |
| Real model stream (MiMo Token Plan) | `pnpm smoke:model` with route `xiaomi-token-plan-cn`, model `mimo-v2.6-flash` through pi-ai: 6 live stream chunks, 1 committed assistant message, completed Turn, contiguous durable seqs and page recovery of the message and Turn end. Key only in private mode-600 `~/.corn-bot-dev/model.env`; patch carries a credential reference only |
| Model lifecycle (MiMo Token Plan) | `pnpm smoke:model-lifecycle`, five real model checks: (1) cancel while the reply streams: Turn ends `aborted`/user, the partial reply is committed with `interrupted: true`, a queued request stays in the next-turn inbox and starts no Turn; (2) model-generated `bash` under `research` is denied by the Claw Gate: blocked `tool/result`, audit `deny`, observability `GATE_POLICY_DENIED` whose `traceId` equals the root-call derivation of the model's `callId`; (3) model-generated `bash` under `developer` raises a Remote approval answered `rejected`: `approval/asked.callId` matches the model call, `approval/decided` is `rejected`, audit `ask`, `GATE_POLICY_ASK` trace matches; (4) SIGKILL after a completed model Turn, restart recovers the same assistant message id and completed `turn/end` at the same seqs; (5) SIGKILL mid-stream, restart preserves every durable event seen before the crash and closes the orphaned Turn as `interrupted`. All recovered logs are contiguous from seq 0 |
| Forced crash indication | `CORN_DESKTOP_SMOKE=1 CORN_DESKTOP_CRASH_SMOKE=1 pnpm dev:desktop`: owned Host killed, sandboxed Renderer received failed status and rendered disconnect message |

The 16 Host checks establish: independent startup/token-cookie exchange; unauthenticated HTTP and WS 401; authenticated wrong-Origin HTTP and WS 403; Session listing; real Claw agent creation and preset ensure; real Session creation and binding; authenticated follow snapshot; reconnect with consistent fresh snapshot; nonexistent Session binding rejected; missing Claw preset rejected; SQLite WAL; concurrent graceful shutdown releases port; restart re-ensures the preset and recovers the durable Session; forced child crash notifies its supervisor and a subsequent manual restart recovers the Session.

The Electron screen is an M0 diagnostic surface, not M1 product UI. Private reports and screenshot remain ignored under `.artifacts/`: `m0-host-smoke.json`, `m0-electron-smoke.json`, `m0-electron.png`. They contain no model responses or credentials. Test-only governance evidence, when run, is stored separately as `m0-governance-smoke.json` and must be interpreted with its stated native/PTC scope.

Review found and fixed two concrete bugs: path names beginning with `..` could bypass the user-home exclusion, and concurrent lock release could race during repeated quit. Regression tests now cover path-segment checks and concurrent release; cold/Host checks exercise concurrent stop and stop during startup. The official void RPC success envelope may omit `value`; the transport now accepts it, including the approval answer endpoint.

## Acceptance status

| Plan item | Current state |
| --- | --- |
| M0-01 three fresh profiles | Baseline DSH cold boot passed; complete fresh Claw distribution/packaged runtime still pending |
| M0-02 authentication | Passed against real owned Host: 401 and 403 cases |
| M0-03 real model stream and final durable event | Passed with MiMo Token Plan `mimo-v2.6-flash` (pi-ai route `xiaomi-token-plan-cn`); `deepseek-official` route remains wired but not model-validated |
| M0-04 cancel active Turn, preserve queue | Passed for a native tool/approval Turn and for a real streaming model reply: end is aborted/user, partial reply committed as interrupted, queued input retained without starting a Turn |
| M0-05 forced Host failure, UI disconnect and log recovery | Forced crash shows disconnected Renderer status; restart recovers durable Sessions and real model logs (completed and mid-stream); automatic product recovery remains pending |
| M0-06 no preset downgrade | Passed: missing `wa-*` preset is rejected |
| M0-07 Gate rejection and consistent trace | Passed for the native bash pipeline and for model-generated bash calls (Gate deny and Remote reject), each with a trace matching the root call; PTC composition pending |
| PR-00D kit source and design profile | Source lock, rights review, specification mapping draft and [ADR-0004](../adr/ADR-0004-design-profiles.md) recorded; verification script and tests added |
| PR-00E avatar source and engine | Avatar source matrix, behaviour mapping and [ADR-0003](../adr/ADR-0003-avatar-engine.md) (`corn-original`) recorded; no kit code or asset is a Corn dependency |
| Packaged application and SQLite driver | Developer runtime passed; bundled `Corn Bot.app`, arm64 packaging and signing pending |

No existing DSH credentials, settings or memories were read or copied. Ambient provider keys are dropped from the Host environment; only the selected Corn route's credential variable is passed. `smoke:model` requires an explicit Corn model configuration (`CORN_MODEL_PROVIDER`, `CORN_MODEL_ID`, `CORN_MODEL_API_KEY`), verifies the selected live catalog route, then requires stream chunks, a committed assistant message, a completed Turn and durable page recovery. It exports route, model and counts only.

## Governance probe boundary

`tests/fixtures/dsh-corn-m0-probe` is never a product profile dependency. It is enabled only by an explicit patch in a disposable home bearing the test-purpose marker. It verifies a real Registry binding, arms each dedicated Session once, enters the official loop through `session.prompt`, and invokes public `tools.execute` from `agent/pre-step`. The only possible command is a fixed `printf`. The official loop owns Turn boundaries. There is no model request or synthetic assistant message.

The checks passed for policy deny, Remote approval rejected, and cancellation of pending approval. Every negative case had zero bash execution-body entries, actual Gate audit and a matching root-call trace. Approval answers passed through Corn's own `HostTransport`. In the cancellation case, the second queued `requestId` was present in the public inbox projection before and after cancellation, only one Turn started, its end reason was `aborted` with user cause, and the approval audit recorded `cancelled` while the Remote event was withdrawn. Native composition evidence does not establish PTC nested calls or model-generated tool transcripts. Do not count this fixture as M0-03.
