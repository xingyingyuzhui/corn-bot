# Corn runtime and security boundaries

This document records requirements for the proposed M0 architecture. It does not certify that the checks have passed. Read [ADR-0001](adr/ADR-0001-dsh-transport.md) and the [API audit](milestones/M0-API-AUDIT.md) together with this document.

## Ownership and isolation

Corn owns its application runtime, DSH home, `corn-dev` development profile, Bot bindings, Session data, and provider configuration. The application must work without an existing DSH or Node installation. Development bootstrap must not read, copy, mutate, install into, or launch against an existing user's DSH home, Desktop profile, provider credentials, or registered Bots.

New model configuration is entered explicitly through Corn's settings flow (Settings → 模型), which writes only through the official DSH settings and credentials services of Corn's own Host. Corn does not derive its initial model configuration by copying settings from another application, and the packaged profile template is keyless. `CORN_MODEL_*` variables and `model.env` are not a production configuration path: the App ignores them, and only an unpackaged development build honours an explicit `CORN_DEV_MODEL_ENV_FILE` override, which is labelled in the UI, read-only there, and locks only the settings it injects.

Main owns runtime process identity and the launch channel. It resolves packaged executables and verified runtime assets explicitly. A startup URL from an unrelated process, arbitrary user-supplied endpoint, or unowned local server is not an accepted source of runtime authentication.

## Renderer to Main

Renderer runs with context isolation and receives a narrow preload API. IPC methods name Corn operations, accept validated operation-specific data, and authorize the requesting window/frame. Expose no arbitrary HTTP URL, RPC endpoint, filesystem path operation, SQL, process execution, or credential inspection method.

Renderer may receive redacted model catalog and connection state, Session content, run progress, and the presentation data necessary to answer an active approval. It must not receive startup URLs containing tokens, authentication cookies, model secrets, credential storage paths, or raw launch output. Main validates every IPC request even when TypeScript declares its type.

Renderer receives no stored credentials, startup secrets or read-back keys; a user-typed key may flow one-way to Main. This is the only credential exception: the key exists in a password input and in one write request over the restricted model-settings IPC, which Main passes to the official `credentials.set`. It is never read back, never kept in UI state beyond the input, drafts, LocalStorage, the database, logs or IPC replies; the input is cleared on close and on submit, and a failed write keeps only the non-secret fields and asks for the key again. Model-settings IPC exposes named operations with strict payloads (set/clear a provider key, save/remove a custom provider, choose the default model); Main derives credential refs, namespaces and paths itself, and replies carry only closed error codes and a redacted snapshot.

Approvals are associated with the current event generation, its pending `eventId`, and the owned Bot/Session. Main rejects fabricated, unrelated, stale, or already withdrawn approval handles. A Renderer decision cannot select a free-form outcome or answer an arbitrary Host event.

## Main to Host

The Host binds to loopback using a discovered authority. Both HTTP requests and the WebSocket upgrade pass RC2 Connection authentication. The cookie is signed, `HttpOnly`, `SameSite=Strict`, and bound to the exact Host authority, including its port. Main stores only the cookie data needed for subsequent requests in a private jar; it never recreates the signing algorithm or reads a signing secret to bypass the exchange.

The HTTP carrier uses `POST /api/<namespace>/<method>` with a correlated `client-request` envelope. Streams share `/api/remote.mux` and independently owned stream identifiers. A stream cancellation closes the subscription; it is distinct from `session.cancel`, which requests cancellation of Agent activity.

The Host/Origin fence stays enabled. A supplied Origin must match the Host authority; `null` and explicit cross-site markers are rejected. Ordinary Node requests with no Origin still require a permitted Host and valid authentication cookie. Do not rewrite hostile browser markers to turn an unrestricted Renderer proxy into a privileged Node request.

Use an endpoint allowlist and public, pinned RC2 descriptors. Rejected authentication, missing services, unavailable presets, and malformed stream frames are visible failures. They must not fall back to ungoverned execution or a generic Agent preset.

## Credentials and diagnostic data

Startup tokens, cookies, provider keys, personal logs, and screenshots never enter Git, IPC logs, test fixtures, telemetry, crash exports, or diagnostic bundles. Avoid printing launch output verbatim: it can contain the authenticated URL. Redact at the producer boundary, not only in the display layer.

Credential fields are write-oriented from the settings UI; replies report redacted status rather than echoing secrets.

Keys saved from Corn are stored by DSH's `credentials-local` provider as plaintext YAML in `<Corn home>/.credentials.yaml`, protected only by file permissions (file `0600`, home `0700`); the same file holds the Host's browser-login signing secret. It is not the macOS Keychain and it does not isolate keys from Agent tools or other processes running as the same user. Keys supplied by the launching environment win over stored keys and are read-only to Corn; a `.env` file in the Corn home is also a credential source. A credential value must not appear in a model request body assembled by Corn, a system prompt, or a Session message. Actual provider authentication remains the runtime/provider owner's responsibility.

Tests use isolated fixture credentials and private runtime directories. Acceptance reports contain statuses, counters, event types, and bounded redacted metadata rather than authentic URLs or raw model conversations.

## Approvals and governing execution

RC2 forwards `approval/request` through the `$events` stream as a scoped waterfall. Its ephemeral `eventId` differs from the persistent `approval/asked` audit ID. Answer through `$events/result` using the current `clientId` and event delivery. `allowed-once` is the only grant; `rejected`, `cancelled`, and `unavailable` do not authorize execution.

The UI must withdraw a request when its cancellation frame arrives or its generation ends. Host-side pending requests can be delivered again on reconnect. Reconcile these deliveries instead of caching a blanket permission from an earlier generation. The Host logs the authoritative `approval/asked` and `approval/decided` pair inside its Turn.

Claw policy, Gate, permissions, identity, and memory must be mounted and validated before advertising their guarantees. An unavailable mandatory Claw preset fails closed. UI permission labels and consent metadata cannot replace Host enforcement.

## State and recovery

DSH Session logs remain authoritative for accepted messages, tool operations, approvals, and Turn outcomes. Corn persists metadata, submission identities, and reconstructable projections. An HTTP acknowledgement is not proof that a model Turn completed.

Reconnect opens a fresh Session snapshot. Main replaces the relevant baseline, verifies durable event continuity, and treats temporary assistant stream revisions separately from durable Session sequence numbers. Do not replay a pending send with a newly minted `requestId`: retain its identity and reconcile acceptance first. Serialize in-flight admission for a Session/request to prevent concurrent retry duplicates.

Session cancellation preserves inbox work and is not an atomic cancellation of a specified Run or Turn. Main must check its current binding and reconcile durable outcomes. Further Host support may be required if exact-Turn conditional cancellation is a product guarantee.

## Limits and validation

Bots operating the same macOS user session share the desktop and OS permissions. Corn and Claw govern operations routed through their managed execution path; they do not create OS isolation from same-user malicious processes, arbitrary third-party plugins, or activity outside Corn. Any stronger isolation requires a separate implemented design.

M0 live checks must cover unauthorized HTTP/WS access, illegal origins, unauthorized IPC callers, token/cookie lifecycle, secret redaction, disconnect/restart recovery, approval withdrawal, preserved queue work, unavailable mandatory presets, and Gate denial with traceable audit. Packaging and credential-store behavior require platform evidence before being described as delivered; the M2 model-settings evidence records the credential-store facts above.
