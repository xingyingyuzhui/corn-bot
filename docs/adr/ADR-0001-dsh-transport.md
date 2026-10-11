# ADR-0001: Corn-owned DSH runtime and Electron Main transport

- Status: **Accepted (2026-10-11)** — candidate B, after the live M0 checks recorded in [M0 evidence](../milestones/M0-EVIDENCE.md). Signing and notarization are deferred ([ADR-0005](ADR-0005-packaging.md)); nested PTC governance is not verified and PTC stays disabled (plan §14 #10)
- Date: 2026-10-10; selection recorded 2026-10-11
- Milestone: M0
- DSH: `0.2.0-rc.2`, tag `dsh-v0.2.0-rc.2`, commit `639ed015397290b3745d163aafe02ffee4aa3f84`
- Claw Suite: `0.3.0-rc.2`; release asset and digest are recorded in `../../runtime.lock.json`.

## Context

Corn requires the complete Host Session API, interactive approvals, ordered live events, cancellation, and recovery. The TypeScript SDK subprocess candidate does not establish these requirements by itself. A Renderer served from `file:` or an independent development origin cannot directly use the DSH HTTP API: RC2 checks the request authority, rejects a cross-site Fetch Metadata marker, and requires any supplied Origin to match the Host authority.

Corn is an independent application. Its shipped runtime, runtime dependencies, DSH home, profile, sessions, and model configuration belong to Corn. Installation and execution must not require an existing DSH application, CLI, Node installation, or user profile. Model setup starts from new Corn configuration; existing DSH credentials, provider settings, and models are not imported or copied.

## Decision

Choose candidate B: Electron Main supervises a Corn-owned DSH Host and owns a Node HTTP/WebSocket carrier using the published RC2 Connection and Typert Gateway protocols. Renderer accesses narrowly typed Corn IPC methods. Main keeps startup tokens, browser authentication cookies, and model credentials outside Renderer state, IPC responses, logs, and exported diagnostics.

Use the normal Connection authentication and Host/Origin checks. Do not disable authentication, manufacture signed cookies, modify upstream internals, or expose an unrestricted local proxy. Prefer public package exports, generated Remote descriptors, and official stream adapters where they remove owned protocol code. Any custom carrier is a pinned implementation of the published transport, not a replacement Agent Loop.

Live validation established authentication, real model streaming, approval, cancellation, crash recovery, isolation, Claw enforcement for ordinary tool calls and the packaged runtime. Source inspection alone was not counted as evidence.

## Runtime and authentication lifecycle

1. Main acquires Corn's process ownership lock and prepares a fresh Corn-owned home and `corn-dev` profile. The supported DSH home redirection and launcher configuration must be validated against RC2.
2. Main launches its packaged runtime using an application-supported DSH profile. Development may use an isolated exact-version installation; packaged execution must resolve the bundled runtime without relying on the user's PATH or installed DSH.
3. Host readiness supplies its actual loopback authority and authenticated launch URL. The port is discovered rather than assumed. Main accepts the URL only from the child it owns and validates its expected loopback authority.
4. Main exchanges the launch URL through a `GET /?token=...` request with redirects handled explicitly. A successful RC2 exchange returns HTTP 303 and an authority-bound signed cookie. Main removes the launch token from subsequent requests and retains the cookie privately.
5. Main connects the `/api/remote.mux` WebSocket and opens `$events`. Its `ready` item establishes an event generation and `clientId`. Main opens Session follow streams and applies their opening snapshots before delivering live state to Renderer.
6. If a stream or Host fails, Main marks the connection unavailable, withdraws generation-specific pending UI, and reconnects with bounded retry. It replaces Session snapshots and approval generation identifiers; it does not blindly replay actions.
7. On child restart, Main reconciles durable Session events and pending Corn metadata. A launch token is process-specific. Existing signed cookies may remain valid at the same authority because their signing secret is durable; a new port changes their audience. Main must handle both cases and renew authentication through the new owned launch URL when needed.
8. On shutdown, Main closes logical streams, prevents new submissions, and applies the defined quit policy before terminating its owned Host. Safe shutdown and crash recovery remain live validation items.

## Session and Run semantics

Connection `rpcId` correlates one HTTP request and response. Session prompt `requestId` is a separate client-minted durable message identity recorded as `source.rpcId`. It is not a DSH Turn identifier. Turn identity is scoped to a Session and appears as the numeric `turn` on `turn/start` and `turn/end`.

Corn must retain explicit relationships among Run, submission `requestId`, accepted message identity, Session, and Turn. The domain relation is many-to-many: a Run can span several submissions or Turns, and several steering submissions or Runs can contribute to one Turn. Do not infer a one-to-one relation from receipt acknowledgements.

`session.cancel` targets the current live Agent activity by Session, preserves its pending inbox, and returns an acknowledgement before the durable terminal event. Main must reconcile the addressed Turn's `turn/end` and leave unrelated pending work intact. If Corn needs cancellation conditional on an exact Turn, RC2's Session endpoint alone does not provide an atomic expected-Turn check; validate a serialized Main policy or a minimal public Host extension before promising that behavior.

`session.selectModel` installs a Session selection and also saves it as the Host global default in the background. Corn must own its global default independently and explicitly apply Bot selections. A Session-only model extension, if needed, must use an audited public Host seam rather than a private-method shortcut.

## Alternatives

- **A: same-origin Corn frontend served by Host.** Compatible with browser authentication in principle, but requires a maintained hosting composition and may tie Corn UI delivery to Host composition. Keep as a fallback subject to the same live checks.
- **C: SDK subprocess.** Useful for an isolated model spike. It is not accepted as the production transport without demonstrated complete approval, control, and lifecycle support.

If B fails a required check, record the failure and validate A or a minimal public Host Bridge plugin. Do not proceed to product UI on fabricated integration success.

## Maintainer selection (2026-10-11)

B is the selected production direction, and A is no longer pursued unless B fails a required check. Plan §2's `plugins/dsh-corn-bridge` Host plugin is deferred. Main already calls the public Session Remote and Claw Registry routes directly, so the plugin is created only when Corn needs a Host-side route that RC2 and Claw do not expose. Each such route must be recorded here with the reason. The remaining checks named at selection time (real model streaming, model-in-flight cancellation and the packaged runtime) have since passed.

## Evidence and consequences

RC2 ownership is documented by `packages/client/connection/src/{browser-auth,api-request-trust,rpc-host}.ts`, `packages/api/gateway/src/{index,stream-protocol,stream-server}.ts`, `packages/api/session-controller/src/{index,types,commands,history}.ts`, and `packages/core/agent-loop/src/{agent,inbox}.ts`. The source audit and exact wire examples are in [M0 API audit](../milestones/M0-API-AUDIT.md). Security requirements are in [security boundaries](../security-boundaries.md).

The proposal adds a Main-owned credential jar, child lifecycle supervisor, typed IPC allowlist, and stream generation management. It preserves DSH as the authoritative execution log and keeps Renderer separate from privileged transport. Runtime packaging, native dependencies, SQLite selection, real model execution, and Claw enforcement remain validation work; this ADR does not certify them.

Developer implementation now boots an independently installed RC2 Host, exchanges the exact 303 `./` redirect, rejects unauthenticated/wrong-Origin requests, creates and binds a Claw Session, opens/reopens its WS snapshot and recovers it after a graceful restart. A sandboxed Electron diagnostic window receives only safe runtime status. See [M0 evidence](../milestones/M0-EVIDENCE.md). Later M0 work added real model streaming and lifecycle, Gate deny/approval for model tool calls, automatic Host recovery and an unsigned packaged app with three fresh-profile boots; together these accept candidate B.
