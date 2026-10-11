# M0 developer runtime evidence

Recorded 2026-10-11. **M0 is not complete.** These are developer-runtime results on macOS, not an installable product or a claim of real model conversation.

## Verified

| Check | Result and reproduction |
| --- | --- |
| Frozen dependency install | `pnpm install --frozen-lockfile` passed; DSH 0.2.0-rc.2, Electron 44.7.0 |
| Source and package pin | `pnpm verify:runtime` passed; DSH contract commit `639ed015397290b3745d163aafe02ffee4aa3f84` |
| Static checks and build | `pnpm check` and `pnpm build` passed; 9 boundary/admission tests |
| Published Claw release | Archive SHA-256 and ten internal package checksums verified; own `corn-dev` install only |
| Independent cold boot | `pnpm smoke:cold`: three empty temporary homes booted/authenticated/listed/stopped; concurrent stop and stop-during-start also passed |
| Real Host integration | `pnpm smoke:host`: 14 checks passed, listed below |
| Electron sandbox/IPC | `CORN_DESKTOP_SMOKE=1 pnpm dev:desktop`: safe status returned through sandboxed preload; independent Host ready; captured diagnostic window |
| SQLite candidate | CLI and Electron Node mode opened/read/wrote WAL database; Electron's Node 24.21.0 / SQLite 3.53.4 |
| Native governance and cancellation | `pnpm smoke:governance`: real Gate deny, Remote reject and Remote cancel passed; queue retained, approval withdrawn, trace matched, zero bash body executions |
| Forced crash indication | `CORN_DESKTOP_SMOKE=1 CORN_DESKTOP_CRASH_SMOKE=1 pnpm dev:desktop`: owned Host killed, sandboxed Renderer received failed status and rendered disconnect message |

The 14 Host checks establish: independent startup/token-cookie exchange; unauthenticated 401; authenticated wrong-Origin 403; Session listing; real Claw agent creation and preset ensure; real Session creation and binding; authenticated follow snapshot; reconnect with consistent fresh snapshot; nonexistent Session binding rejected; missing Claw preset rejected; SQLite WAL; concurrent graceful shutdown releases port; restart re-ensures the preset and recovers the durable Session; forced child crash notifies its supervisor and a subsequent manual restart recovers the Session.

The Electron screen is an M0 diagnostic surface, not M1 product UI. Private reports and screenshot remain ignored under `.artifacts/`: `m0-host-smoke.json`, `m0-electron-smoke.json`, `m0-electron.png`. They contain no model responses or credentials. Test-only governance evidence, when run, is stored separately as `m0-governance-smoke.json` and must be interpreted with its stated native/PTC scope.

Review found and fixed two concrete bugs: path names beginning with `..` could bypass the user-home exclusion, and concurrent lock release could race during repeated quit. Regression tests now cover path-segment checks and concurrent release; cold/Host checks exercise concurrent stop and stop during startup. The official void RPC success envelope may omit `value`; the transport now accepts it, including the approval answer endpoint.

## Acceptance status

| Plan item | Current state |
| --- | --- |
| M0-01 three fresh profiles | Baseline DSH cold boot passed; complete fresh Claw distribution/packaged runtime still pending |
| M0-02 authentication | Passed against real owned Host: 401 and 403 cases |
| M0-03 real model stream and final durable event | Pending a new Corn-only model configuration; `pnpm smoke:model` is prepared but has not been model-validated |
| M0-04 cancel active Turn, preserve queue | Passed for real native tool/approval Turn: end is aborted/user, second queued input remains in public inbox projection; model-in-flight cancellation still pending |
| M0-05 forced Host failure, UI disconnect and log recovery | Forced crash shows disconnected Renderer status; manual Host restart recovers durable Session; model log recovery and automatic product recovery remain pending |
| M0-06 no preset downgrade | Passed: missing `wa-*` preset is rejected |
| M0-07 Gate rejection and consistent trace | Passed for native bash pipeline with matching official root-call trace; PTC and model-generated tool transcript pending |
| Packaged application and SQLite driver | Developer runtime passed; bundled `Corn Bot.app`, arm64 packaging and signing pending |

No existing DSH credentials, settings or memories were read or copied. Ambient provider keys are dropped from the Host environment. `smoke:model` requires explicit new `CORN_DEEPSEEK_API_KEY` and `CORN_MODEL_ID`, verifies the `deepseek-official` live catalog route, then requires stream chunks, a committed assistant message, a completed Turn and durable page recovery. It exports counts only. This script is prepared validation code, not evidence of a successful model call.

## Governance probe boundary

`tests/fixtures/dsh-corn-m0-probe` is never a product profile dependency. It is enabled only by an explicit patch in a disposable home bearing the test-purpose marker. It verifies a real Registry binding, arms each dedicated Session once, enters the official loop through `session.prompt`, and invokes public `tools.execute` from `agent/pre-step`. The only possible command is a fixed `printf`. The official loop owns Turn boundaries. There is no model request or synthetic assistant message.

The checks passed for policy deny, Remote approval rejected, and cancellation of pending approval. Every negative case had zero bash execution-body entries, actual Gate audit and a matching root-call trace. Approval answers passed through Corn's own `HostTransport`. In the cancellation case, the second queued `requestId` was present in the public inbox projection before and after cancellation, only one Turn started, its end reason was `aborted` with user cause, and the approval audit recorded `cancelled` while the Remote event was withdrawn. Native composition evidence does not establish PTC nested calls or model-generated tool transcripts. Do not count this fixture as M0-03.
