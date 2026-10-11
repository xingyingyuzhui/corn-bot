# Avatar behaviour mapping

This is Corn's own product rule for turning Bot activity into an avatar state. It does **not** describe Grok Bot's server protocol. The kit's own preview mappings (sent → happy, queued → working, failed → confused, listening → dictating → idle) are labelled by the kit itself as arbitrary example choices and carry no authority here.

The renderer receives an `AvatarPresentation` computed by the pure function `packages/state/src/avatar-presentation.ts` from `AvatarRuntimeSignals`. In M1 the signals come from named fixtures. From M2 (PR-03A), `packages/state/src/avatar-state-reducer.ts` derives them from schema-validated Corn domain events. Avatars never parse message text or DOM.

## Mapping

| Priority | Corn signal | Visual state | Tone | Kind | DSH RC2 source | Confidence |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | Pending Claw Gate approval for this Bot | `alerting` | attention | stable until settled | `$events` `approval/request` waterfall item; withdrawn by a `cancel` frame | Source audited (M0-API-AUDIT); live UI pending |
| 2 | Latest Run for this Bot `failed`, or a tool error | `confused` | error | stable until the next Run starts or the user dismisses it | Run state from Corn's Run service (M2); tool error event to be identified in PR-03A | Run: planned. Tool error event: **gap** |
| 3 | Dictation active | `dictating` | neutral | stable while active | Corn voice state (M7); fixture only before then | Planned |
| 3 | Live voice call listening | `listening` | neutral | stable while active | Not implemented (after M8); fixture only | Planned |
| 4 | Model reasoning in the foreground Run | `thinking` | neutral | stable | Session follow stream / control projection between `turn/start` and the first tool or assistant output | Event shape to be confirmed in PR-03A |
| 4 | Search or browser query tool running | `searching` | neutral | stable | Tool metadata, when it identifies a search; otherwise `working` | **Gap**: classification rule needed |
| 4 | Any other managed tool running, or Run `running` | `working` | neutral | stable | Run state plus tool start/end projection | Tool events: **gap** to confirm |
| 4 | Waiting for a resource (computer lease, queue) | `progress` | neutral | stable | Run `waiting_resource` (M3/M4) | Planned |
| 5 | Bot-to-Bot message sent / received | `sending` / `receiving` | neutral | transient (TTL) | Corn Messenger (M5) | Planned |
| 5 | Attachment upload in flight | `uploading` | neutral | transient | Real upload event only, not UI staging (M2+) | Planned |
| 6 | Run completed | `happy`; `celebrate` only for user-visible deliverables | success | transient (TTL), then fall back | Durable `turn/end` reconciled into Run `completed` | Planned |
| 7 | No active Run, approval or message | `idle` | neutral | stable | Default | — |
| — | Host or session connection lost | last reliable state, rendered static, plus an explicit offline marker | — | overlay | Corn connection status | Planned |
| — | Bot archived or app shutting down | `powering-down`, then static | neutral | transient | Corn lifecycle | Planned |
| — | Long idle, or the app returning from sleep | `sleeping` / `waking` | neutral | stable / transient | Corn presentation policy only | Optional |

Within the same priority, the most recent valid event wins. Priority order: approval > failure > voice > reasoning/tool > messaging > completion > idle.

## Rules

1. `session.prompt` acceptance only means the message was queued. It never yields `happy` or `celebrate`; only a reconciled completed Run can.
2. Every event carries `botId`, `runId` (once the Run exists) and a monotonic Corn sequence number. An event older than the Bot's last applied sequence is dropped and never reverses a newer state.
3. If a Bot has several Runs, `foregroundRunId` decides; the remaining Runs only contribute to the aggregate (approval or failure still outrank them).
4. A transient state lasts for one Corn-configured TTL, tested with a fake clock, and then reverts to the current stable state. Assistant stream chunks do not retrigger transients.
5. Switching the viewed Bot changes nothing for other Bots. Hiding the window pauses animation without changing state.
6. After a crash or reconnect, the state is recomputed from persisted Run and Session events. An unreconciled Run shows `progress` with the offline/reconciling marker, never `happy`.
7. The avatar is decorative (`aria-hidden`). The same state is exposed as text next to the Bot name and announced through a throttled live region.
8. If an event Corn needs is not public in RC2, record the gap in this file and fall back to `working` or an "unknown" marker. Never fabricate an event.
