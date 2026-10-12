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

`session.selectModel` installs a Session selection and also saves it as the Host global default in the background. Corn never uses it to set the global default. Corn writes the global default through the public settings Remote (see "Model configuration interfaces") and applies Bot selections explicitly. A Session-only model extension, if needed, must use an audited public Host seam rather than a private-method shortcut.

## Alternatives

- **A: same-origin Corn frontend served by Host.** Compatible with browser authentication in principle, but requires a maintained hosting composition and may tie Corn UI delivery to Host composition. Keep as a fallback subject to the same live checks.
- **C: SDK subprocess.** Useful for an isolated model spike. It is not accepted as the production transport without demonstrated complete approval, control, and lifecycle support.

If B fails a required check, record the failure and validate A or a minimal public Host Bridge plugin. Do not proceed to product UI on fabricated integration success.

## Maintainer selection (2026-10-11)

B is the selected production direction, and A is no longer pursued unless B fails a required check. Plan §2's `plugins/dsh-corn-bridge` Host plugin is deferred. Main already calls the public Session Remote and Claw Registry routes directly, so the plugin is created only when Corn needs a Host-side route that RC2 and Claw do not expose. Each such route must be recorded here with the reason. The remaining checks named at selection time (real model streaming, model-in-flight cancellation and the packaged runtime) have since passed.

## Model configuration interfaces (M2 Work Package 2, 2026-10-11)

Verified against RC2 source, generated descriptors and a live Corn-owned Host; evidence is in [model-configuration API audit](../milestones/MODEL-CONFIG-API-AUDIT.md). These are interface decisions; Work Package 3 (below) implements them.

Accepted decisions:

1. Corn's existing profile composition (`dsh-base` + `dsh-web-app` + `dsh-claw-suite`) already mounts the official Settings Controller, settings forms, config editor, `credentials-local`, the LLM registry and the default-model service, in dev and in the packaged app. Corn adds no package and writes no substitute service.
2. Global default model: Main calls `settings/replace { ns: 'agent-default-model', section: { provider, model, reasoningEffort? }, expectedRevision }`. Before the write, Main validates the selection against a fresh `session/modelCatalog`; after it, Main re-reads `session/modelCatalog().default`. The write persists to the Corn profile's `cordis.patch.yml` through the official config editor, survived a Host restart and is read by Session creation and Claw `registry/models`. Corn stores no second copy. **No `plugins/dsh-corn-bridge` route is needed for this.**
3. Provider profiles: Main writes them with `settings/mutate` path ops on the namespace and path from `llm/listConfigurableProviders`. It never uses wholesale `replace` for provider namespaces, because the descriptor is redacted. Profile shape and protocols come from the live settings schema.
4. Credentials: Main calls `credentials/describe { refs }`, `credentials/set { ref, value }` and `credentials/unset { ref }`. Main derives the ref from the provider profile's `apiKeyEnv` or the official `<ROUTE>_API_KEY` rule; Renderer never supplies one. Reads return only `configured/source/writable`.
5. Concurrency: every settings write carries the revision read from the same Host generation. `settings/conflict` is a recoverable state. Revisions reset when the Host restarts and are discarded on a generation change. Settings and credential writes are not cancellable, so an aborted or timed-out write is resolved by re-reading.
6. Corn's Host `--patch` overlay carries only isolation rows. An overlay row for a settings namespace makes the official editor refuse writes to it. A provider key in the Host environment makes that ref read-only.

Credential input exception (maintainer decision, 2026-10-11): the API key exists only in a password input and one write request. It crosses one restricted IPC method to Main, which forwards it once to `credentials/set`. It is never read back or returned over IPC, and it is never kept in Renderer state, drafts, storage or logs. `docs/security-boundaries.md` records this exception in Work Package 3.

Credential storage (maintainer decision, 2026-10-11): this round uses the official `credentials-local` provider. It is a plaintext YAML file at `<Corn home>/.credentials.yaml`, mode `0600`, inside a `0700` home. File permissions are its only protection. It is not Keychain and does not isolate keys from same-user processes, including Agent tools. An OS credential vault would be a separate `CredentialProvider` behind the same seam.

Implemented in Work Package 3 (2026-10-11):

- Adapters `packages/dsh-adapter/src/{model-settings-client,credentials-client,model-catalog-client}.ts` call only `settings/{describe,replace,mutate}`, `credentials/{describe,set,unset}`, `llm/{listProviders,listConfigurableProviders}` and `session/modelCatalog`; the transport allowlist denies `settings/update`, settings documents, credential export and discovery.
- `apps/desktop/src/model-settings/service.ts` is Main's only caller. It pins every reply to a Host generation (the authenticated Host identity), serializes writes, re-reads before each write, validates commands against the live directory, schema and catalog, and judges success by a read-back. Failures are closed codes (`conflict`, `partially_applied`, `outcome_unknown`, `stale_generation`, `read_only`, …) with a redacted snapshot, never raw Host messages.
- `apps/desktop/src/ipc/model-settings.ts` exposes seven named channels with strict payloads and trusted-sender checks; Renderer never names a namespace, path, ref or RPC.
- Model status (`needs_configuration | available | unavailable | checking`) is separate from runtime status. The production `CORN_MODEL_*` / `model.env` path is retired; an unpackaged build honours only an explicit `CORN_DEV_MODEL_ENV_FILE` override, labelled and read-only in the UI. The packaged profile template is keyless.
- Not delivered: DeepSeek account sign-in (`deepseek-account` is hidden; it signs in rather than storing a key) and model discovery for custom providers (models are entered by id).

Proposals, not yet decided:

- Bot model overrides (Work Package 4): RC2's Remote surface has no Session-only model selection; `session.selectModel` always saves the global default. Claw `registry/model` only stores a per-agent model. Before Bot overrides ship, audit whether a public Host service applies a Session-only selection. If none exists, propose an upstream patch. Select-then-restore and private-method calls are excluded. A Corn Host Bridge route is allowed only if it calls official public services, awaits completion and reads back.
- Upgrade guard: re-run `scripts/audit/model-config-api-audit.mjs` on every DSH upgrade. The default-model path depends on the generic settings contract and the volatile `agent-default-model` fields, not on an official UI flow.

## Evidence and consequences

RC2 ownership is documented by `packages/client/connection/src/{browser-auth,api-request-trust,rpc-host}.ts`, `packages/api/gateway/src/{index,stream-protocol,stream-server}.ts`, `packages/api/session-controller/src/{index,types,commands,history}.ts`, and `packages/core/agent-loop/src/{agent,inbox}.ts`. The source audit and exact wire examples are in [M0 API audit](../milestones/M0-API-AUDIT.md). Security requirements are in [security boundaries](../security-boundaries.md).

The proposal adds a Main-owned credential jar, child lifecycle supervisor, typed IPC allowlist, and stream generation management. It preserves DSH as the authoritative execution log and keeps Renderer separate from privileged transport. Runtime packaging, native dependencies, SQLite selection, real model execution, and Claw enforcement remain validation work; this ADR does not certify them.

Developer implementation now boots an independently installed RC2 Host, exchanges the exact 303 `./` redirect, rejects unauthenticated/wrong-Origin requests, creates and binds a Claw Session, opens/reopens its WS snapshot and recovers it after a graceful restart. A sandboxed Electron diagnostic window receives only safe runtime status. See [M0 evidence](../milestones/M0-EVIDENCE.md). Later M0 work added real model streaming and lifecycle, Gate deny/approval for model tool calls, automatic Host recovery and an unsigned packaged app with three fresh-profile boots; together these accept candidate B.
