# M0: DSH RC2 API and transport audit

## Status and evidence scope

**M0 is not passed.** This document records source and published-artifact findings for the proposed integration. Live Host, Electron IPC, model execution, packaging, and Claw acceptance remain pending until separately recorded with reproducible results.

- DSH version: `0.2.0-rc.2`.
- Source tag: `dsh-v0.2.0-rc.2`.
- Source commit: `639ed015397290b3745d163aafe02ffee4aa3f84`.
- Source reads used `git show` and `git grep` against this tag, not the current worktree.
- The npm `@deepseek-ai/dsh-api-session-controller@0.2.0-rc.2` published `lib/typert.remote-client.js` was inspected to verify generated argument names.
- No user DSH installation, profile, or credential configuration was used for this source audit.
- [ADR-0001](../adr/ADR-0001-dsh-transport.md) remains **Proposed (live validation pending)**.

## Public package surfaces

Pin all DSH packages to `0.2.0-rc.2`; do not mix RC1 and RC2 controller/client artifacts. The published Session Controller Cordis peer is `~4.0.4`.

| Package export | Purpose |
| --- | --- |
| `@deepseek-ai/dsh-client-connection/client` | `installConnection`, `ClientConnectionRpc`, explicit carrier hooks |
| `@deepseek-ai/dsh-api-gateway/client` | Generated Remote mounting, stream ownership and lifecycle adapters |
| `@deepseek-ai/dsh-api-gateway/stream-protocol` | Public mux frame constants and parsers |
| `@deepseek-ai/dsh-api-session-controller/remote` | Default-export generated Session and auxiliary Remote contribution |
| `@deepseek-ai/dsh-api-session-controller/client` | `SessionEventStream`, Session control and object adapters |
| `@deepseek-ai/dsh-api-session-controller/types` | Browser-safe request/result types |
| `@deepseek-ai/dsh-typert-registry/client` | Client Typert registry |

RC2 Gateway uses `ws ^8.21.0`. A Main-owned Node carrier can implement `ClientConnectionRpc.call/open` and supply it through `installConnection(ctx, { transport: { rpc } })`, allowing official generated Remote methods to retain their descriptors and state adapters. Verify that assembly in the implementation smoke; the source audit does not establish successful Node composition.

## Authentication and HTTP

`packages/client/connection/src/browser-auth.ts` owns launch-token exchange and cookie verification. A valid `GET /?token=<process-token>` returns HTTP 303, `Location: ./`, and a signed cookie. The cookie name derives from the authority; its audience also includes the authority. Attributes include `HttpOnly`, `SameSite=Strict`, `Path=/`, and an absolute expiry; default lifetime is 30 days.

Startup tokens are process-specific. The signing secret is persisted in the Corn-owned credential provider, so a valid cookie can survive a Host restart at the same authority. An authority/port change requires a matching cookie. Main must handle authentication from its owned launch channel and keep all these values private.

`packages/client/connection/src/api-request-trust.ts` requires a loopback or configured trusted Host. It rejects `Sec-Fetch-Site: cross-site`. If Origin is supplied, its authority must match Host; absent Origin is permitted, while an opaque `null` Origin is rejected. Trust failure returns 403 and missing/invalid authentication returns 401. WebSocket upgrades pass the same admission path.

Unary calls use `POST /api/<endpoint>` with `Content-Type: application/json` and the Cookie header:

```json
{
  "type": "client-request",
  "rpcId": "transport-correlation-id",
  "method": "session/create",
  "payload": {
    "args": {
      "request": {
        "sessionId": "corn-owned-session-id",
        "cwd": "/corn-owned-workspace"
      }
    }
  }
}
```

The reply is `{ "type": "server-response", "rpcId": "...", "result": { "ok": true, "value": ... } }` or an `ok: false` result with `error.code`, `error.message`, and `error.details`. Validate both HTTP status and correlation. Binary results can use multipart transport; implement the public codec/carrier behavior before exposing such endpoints.

Gateway payloads contain exactly one plain-object `args` field. Named arguments must match the generated descriptor. The exception in the Session namespace is `list`: its argument is `_request`, so the payload is `{ "args": { "_request": {} } }`, not `request`.

## Session Remote inventory

Source owner: `packages/api/session-controller/src/index.ts`; payload vocabulary: `src/types.ts`; business admission: `src/commands.ts`.

| Endpoint | Transport | Business argument and significant behavior |
| --- | --- | --- |
| `session/list` | Unary | `_request`; cold-readable Session summaries |
| `session/search` | Unary | `request.query`; bounded content search |
| `session/create` | Unary | `request`; optional `sessionId`, `agentPreset`, and either `cwd` or `workspaceId` |
| `session/selectModel` | Unary | `request`; Session selection plus background global-default save |
| `session/initializeDefaultModel` | Unary | Empty args; account-based initial default selection |
| `session/modelCatalog` | Unary | Empty args; grouped available models and provider failures |
| `session/canOpenWorkspacePath` | Unary | Empty args; native opener availability |
| `session/openWorkspacePath` | Unary | `request`; verified native path open/reveal |
| `session/workspacePathApplications` | Unary | `request.path`; native application discovery |
| `session/rename` | Unary | `request.sessionId`, `request.title`; normalized title and event seq |
| `session/fork` | Unary | `request.sessionId`, optional `atSeq`; exact-prefix fork |
| `session/prompt` | Unary | `request`; `requestId`, `sessionId`, `mode`, `content`, optional `clientTimeZone` |
| `session/attachment` | Unary | `request`; image referenced by the addressed Session |
| `session/updateQueue` | Unary | `request`; pending `itemId`, action `edit`, `remove`, or `steer` |
| `session/cancel` | Unary | `request.sessionId`; cancels active Agent activity, retains inbox |
| `session/page` | Unary | `request`; address, `throughSeq`, optional backward page/window limits |
| `session/follow` | Stream | `request`; address and optional window/assistant presentation |
| `session/projections` | Unary | `request.sessionId`; non-activating projection snapshot |
| `session/control` | Stream | Empty args; Host-wide live projection baseline and updates |

`workspaceDesktop` is a Host method without a Remote decorator; do not invent a public Session Remote endpoint for it. The generated contribution additionally selects auxiliary namespaces such as file references, media references, and skills; these do not widen Corn's Renderer API automatically.

## WebSocket mux and Session history

Connect a Main-owned Node WebSocket to `ws://<owned-loopback-authority>/api/remote.mux` with the authority-bound Cookie header. No application subprotocol or token query is required by the RC2 mux. Preserve normal Host checks. The server uses WebSocket Ping control frames; `ws` automatically answers Pong unless explicitly configured otherwise.

Open a logical Session subscription using:

```json
{
  "type": "open",
  "streamId": "independent-stream-id",
  "endpoint": "session/follow",
  "payload": {
    "args": {
      "request": {
        "address": { "kind": "session", "sessionId": "corn-owned-session-id" },
        "assistantStream": true,
        "maxMessages": 100
      }
    }
  }
}
```

Server mux frames are `item` with `streamId` and optional `value`, `error` with structured failure, or `end`. Client `cancel` disposes that logical stream. `item` and `end` additionally support stream uplinks; Session follow requires no application uplink.

`session.follow` starts with a `snapshot`: header, cursor, chronological records, `hasMore`, projections, and the opted-in assistant baseline. Later values are durable `event` entries and optional `assistant-stream` frames. Reconnect opens a fresh snapshot; `SessionFollowRequest` does not declare an `afterSeq` resume field. An outdated implementation comment must not override the type and generated descriptor.

Use the opening `cursor` as `session.page.request.throughSeq`. Durable events continue at cursor + 1. Temporary assistant frames have their own attempt identity, revision, and chunk index; they do not consume durable Session seq. The official `SessionEventStream` validates both continuity spaces and replaces its baseline on reconnect.

## Prompt, queue, Turn, and Run correlation

Connection `rpcId` correlates one physical call. Prompt `requestId` is a separately persisted client identity stored on the accepted user's `source.rpcId`. DSH generates a distinct message `id`; queue mutations address that message identity. The prompt receipt only says `{ "accepted": true }` and does not return a Turn ID or final model result.

Queue admission calls `agent.followup`, inserting into `next-turn`. Steering calls `agent.steer`, inserting into `next-step`. At a Turn's initial boundary, the inbox claims all next-step input and at most one next-turn message. Steering while idle can open a Turn; several steering submissions can be consumed by the same step and Turn. Messages sent after an activity has already been aborted are classified for the next Turn.

`turn/start` and `turn/end` carry the Session-local numeric `turn`. Corn Run is a domain identity, not an upstream Turn or RPC identity. Store a many-to-many Run/submission/Turn relation: a Run may require several submissions or Turns, and one Turn can include contributions from several steering submissions or Runs. Reconcile actual logged messages and boundaries rather than assigning a guessed Turn at HTTP receipt time.

Prompt deduplication checks `source.rpcId` in the live inbox and existing `user/message` events before asynchronous admission. That check is not an atomic guarantee for simultaneous duplicate requests. Main must serialize or single-flight retries for the same Session/request and preserve the original `requestId`; reconcile durable acceptance after a lost response.

`session.cancel` calls `agent.cancel({ kind: 'user' }, { keepInbox: true })`. It addresses the live Session, not an expected Turn or Run. Cancellation acknowledgement precedes authoritative `turn/end`. Existing pending work stays pending and does not necessarily resume immediately: the aborted driver restarts only when a wake was latched and pending work remains. A new prompt during cancellation can latch that wake. A cancelled Run must not incorrectly finish or delete the preserved queue.

`session.selectModel` also calls `agentDefaultModel.saveSelection` in the background. Implementing Bot overrides through this endpoint can change the default for another Bot. Corn must explicitly preserve and apply its own default/override policy or validate a public Session-only model seam.

## Interactive approval contract

Open `$events` on the same mux with `{ "args": {} }`. The first item is `{ "type": "ready", "clientId": "...", "host": ... }`. A pending approval is a `waterfall` item with `event: "approval/request"`, ephemeral `eventId`, `agentId`, and presentation `request` fields such as `toolName`, `callId`, and `reason`. The wire request omits the direct Agent object and AbortSignal.

Reply using unary `POST /api/$events/result` with normal authentication/envelope and:

```json
{
  "args": {
    "clientId": "current-events-generation-id",
    "eventId": "pending-delivery-id",
    "outcome": { "kind": "result", "value": "allowed-once" }
  }
}
```

Approval outcome vocabulary is `allowed-once`, `rejected`, `cancelled`, and `unavailable`; only `allowed-once` grants the action. A `next` outcome delegates to other answerers. Do not leave unrelated waterfall types silently unanswered; delegate or implement their declared flow.

The audit `approval/asked.data.id` differs from Remote `eventId`. Persistent audit IDs are not valid event reply handles. A `cancel` frame withdraws the pending UI. Disconnect removes that delivery but pending Host questions can be delivered again to a new event generation. Old or completed deliveries are idempotent no-ops; an unknown inactive `clientId` can fail. Use the current generation for replies.

The approval service requires an open Turn and records the authoritative asked/decided pair. `ask` delegates to configured answerers and fails closed without an available answerer; `never` deterministically rejects. This source behavior must be demonstrated through Corn's live Bridge before approvals are called implemented.

## Acceptance still required

| Check | Required evidence | Status |
| --- | --- | --- |
| M0-01 | Three isolated cold starts without dependency residue | Pending |
| M0-02 | Unauthorized HTTP/WS denied; illegal Origin and unauthorized window/frame denied | Pending |
| M0-03 | New Corn model configuration; real prompt, live chunks, durable final events | Pending |
| M0-04 | Active Turn cancellation confirmed; pending queue preserved and correctly reconciled | Pending |
| M0-05 | Forced Host exit, unavailable UI state, restart and authoritative log recovery | Pending |
| M0-06 | Unavailable mandatory Claw preset fails without standard-preset fallback | Pending |
| M0-07 | Gate denies a prohibited tool call with consistent traceable audit | Pending |
| Authentication lifecycle | Startup token rotation, same-authority cookie behavior, authority change, WS reconnect | Pending |
| Approval lifecycle | Allow/reject, cancellation withdrawal, generation replacement, late response | Pending |
| Secret handling | No real tokens, cookies, provider credentials, or personal logs in Renderer or diagnostics | Pending |
| Independent packaging | Packaged app runs with bundled runtime and without installed DSH/Node | Pending |
| SQLite choice | Driver, migrations, ownership, native/platform packaging evidence | Pending |

Record live commands, versioned fixtures, outcomes, and bounded redacted artifacts as they become available. Source findings do not replace these checks or authorize advancing beyond M0.
