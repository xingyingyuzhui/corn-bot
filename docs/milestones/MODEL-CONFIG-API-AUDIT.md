# M2 Work Package 2: official model-configuration API audit

## Status and evidence scope

**Gate passed: RC2 has a public, persistent write path for the global default model.** It is the generic `settings` Remote addressed to the `agent-default-model` namespace. A live write, Host restart and read-back in a Corn-owned home proves it. No Corn Host Bridge command and no upstream patch is required for the global default. Section 4 records the reasoning, limits and the Main-side command Work Package 3 implements.

This package audits interfaces only. It does not wire Corn UI, IPC or adapters, does not remove the development `model.env` path, and does not claim that a configured provider can serve a model request.

- DSH `0.2.0-rc.2`, tag `dsh-v0.2.0-rc.2`, commit `639ed015397290b3745d163aafe02ffee4aa3f84` (cited below as `path@639ed015`). Source was read only through `git show` / `git grep` on that commit in a local clone of the official repository, never from a working tree or master.
- Wire parameter names and cancellation come from the published generated descriptors `lib/typert.host.js` of `@deepseek-ai/dsh-api-settings-controller@0.2.0-rc.2` and `@deepseek-ai/dsh-llm@0.2.0-rc.2`, not from hand-written types.
- Claw `0.3.0-rc.2` was read from the locked release asset (`sha256 99ea3c20…08cb`, matches `runtime.lock.json`), package `dsh-claw-registry-0.3.0-rc.2.tgz`.
- Live evidence: `scripts/audit/model-config-api-audit.mjs` against a fresh home created by `CORN_DSH_HOME=~/.corn-bot-dev/wt-model-audit/dsh pnpm setup:runtime`, and `scripts/audit/packaged-model-config-probe.mjs` against the packaged `release/mac-arm64/Corn Bot.app` (read-only, its own temp home). The full redacted record is written to `.artifacts/model-config-api-audit.json` (not committed).
- Safety: no user DSH home, DSH application, existing configuration or credential was read. `model.env` was not read; `setup:runtime` boots keyless (`model: null`). Only the fake values `sk-corn-audit-FAKE-0000`, `…-FAKE-ENV-0000`, `…-FAKE-DOTENV-0000` and `…-FAKE-DISCOVERY-0000` were used. No provider endpoint was contacted: discovery used the pi-ai catalog and a loopback stub. The script scans every wire response, all Host stdout/stderr, the evidence record and the whole home tree for each fake value and asserts zero hits; it observed none. Every write was reverted, and all Hosts, the stub and the temp homes were removed.

## 1. Composition: which official services Corn assembles

No official package is missing. Corn's profile declares the bundles `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app` and `dsh-claw-suite` (dev setup and the packaged `profile-template/package.json` are identical). The bundles mount every required service at `0.2.0-rc.2`:

| Capability | Package (exact) | Bundle row | Live evidence |
| --- | --- | --- | --- |
| Settings Remote (`settings.*`, `credentials.*`) | `@deepseek-ai/dsh-api-settings-controller` | `settings-controller` in `packages/bundle/web-app/cordis.patch.yml@639ed015` | dev + packaged: `settings.describe` → `writable: true`, 19 namespaces |
| Settings forms | `@deepseek-ai/dsh-settings` | `settings`, `disabled: !ctx.get('profileContext')` (`bundle/base/cordis.patch.yml`) | enabled because Corn launches the named profile `corn-dev` |
| Config editor (persistence) | `@deepseek-ai/dsh-config-editor` | `config-editor`, same `profileContext` condition | writes land in `profiles/corn-dev/cordis.patch.yml` (§4) |
| Credential store | `@deepseek-ai/dsh-credentials-local` | `credentials` | `credentials.describe/set/unset` (§3) |
| LLM registry Remote | `@deepseek-ai/dsh-llm` (+ `dsh-llm-pi-ai`, `dsh-llm-deepseek-api-key`, `dsh-llm-deepseek-account`) | `llm`, `llm-pi-ai`, `llm-deepseek`, `llm-deepseek-account` | 2 routable providers, 43 configurable entries in 3 namespaces |
| Global default model | `@deepseek-ai/dsh-agent-default-model` | `agent-default-model` (`provider: deepseek-official`, `model: deepseek-flash`) | namespace present with `autoGenerate: false` |
| Model catalog / selection | `@deepseek-ai/dsh-api-session-controller` | `session-controller` | `session.modelCatalog`, `session.selectModel` |

The packaged app ships the same packages at top level in `Contents/Resources/node_modules/@deepseek-ai/*` (all `0.2.0-rc.2`). Its bundled runtime, booted keyless from the bundled template, answers like the dev profile (packaged probe output: `writable: true`, 19 namespaces, `agent-default-model` `autoGenerate: false` value `deepseek-official/deepseek-flash`, `DEEPSEEK_API_KEY` `configured: false, writable: true`, 43 configurable providers, routable `deepseek-official`). Nothing was added to the profile or template.

## 2. Wire contract

All methods are `POST /api/<namespace>/<method>` with body `{ "type": "client-request", "rpcId", "method", "payload": { "args": { …named… } } }`, the same Connection carrier as M0. Named arguments follow the generated descriptor. Every listed method is `invocation: direct`. Business failures return HTTP 200 with `result: { ok: false, error: { code, message, details } }`. An unknown method returns plain-text HTTP 404 `not found`, not an envelope.

| Method | Args (wire names) | Result | Cancellation | Source |
| --- | --- | --- | --- | --- |
| `settings/describe` | `{}` | `{ writable, hasDocument, namespaces: [{ ns, autoGenerate, schema, value, base?, user?, applies: 'live', secrets: [{ path, set }], revision }] }`, secrets redacted | none | `api/settings-controller/src/index.ts@639ed015` L97–105 |
| `settings/update` | `{ ns, patch, expectedRevision }` | redacted `SettingsNamespaceView` after write | none | L115–122 |
| `settings/replace` | `{ ns, section, expectedRevision }` | same | none | L132–139 |
| `settings/mutate` | `{ ns, ops: [{ op: 'set', path, value } \| { op: 'unset', path }], expectedRevision }` | same | none | L151–158 |
| `settings/openSettingsDocument` | `{}` | `{ opened: true }` | `signal` | L166–185; opens a native editor, not exercised, not for Corn |
| `credentials/describe` | `{ refs: string[] }` (≤ 64) | `{ [ref]: { configured, source?, writable } }` | none | `api/settings-controller/src/credentials.ts@639ed015` L82–90 |
| `credentials/set` | `{ ref, value }` | void (`ok: true`, no `value`) | none | L99–105 |
| `credentials/unset` | `{ ref }` | void | none | L112–118 |
| `llm/listProviders` | `{}` | `[{ id, name }]` routable now | none | `llm/llm/src/index.ts@639ed015` L477–480 |
| `llm/listConfigurableProviders` | `{}` | `[{ provider, displayName, settingsNs, settingsPath, declared?, error? }]` | none | L549–552; type `llm/llm/src/types.ts` L245–268 |
| `llm/discoverModels` | `{ settingsNs, request: { provider?, baseURL?, api?, apiKey? } }` | `[{ id, name?, contextWindow?, maxTokens?, inputModalities? }]` | `signal` | L637–658; request type L276–293 |
| `session/modelCatalog` | `{}` | `{ default, routableProviders, groups: [{ id, name, models: [{ id, name, description?, reasoning? }] }], failures }` | none | `api/session-controller/src/catalog.ts@639ed015` L20–72 |
| `session/selectModel` | `{ request: { sessionId, provider, model, reasoningEffort? } }` | `{ selected }` | none | `api/session-controller/src/commands.ts@639ed015` (selectModel) |

Error vocabulary (`api/settings-controller/src/types.ts@639ed015`, `llm/llm/src/types.ts`):

| Code | Observed trigger and message |
| --- | --- |
| `settings/conflict` | stale `expectedRevision`: `settings namespace "ui-theme" changed since it was read (expected revision 0, now 1)`, details `{ ns, expected, actual }` |
| `settings/rejected` | unknown ns `No configurable plugin entry "…"`; non-volatile field `Config field "notAField" is not volatile`; schema violation `invalid config: $.fontSize expected number <= 22 but got 99`; command-line overlay (§5); details `{ ns }` |
| `gateway/bad-request` | credential ref outside `^[A-Za-z_][A-Za-z0-9_]*$`, empty value, more than 64 refs; details carry zod `issues` with the field path, never the value |
| `credential/rejected` | write shadowed by the inherited environment; details `{ ref }` only |
| `llm/model-discovery-rejected` | no discovery for the namespace, or the endpoint refused; details `{ settingsNs, baseURL? }` |
| `gateway/internal` | missing service (§6) |

Revision semantics (`settings/settings/src/index.ts@639ed015` L302–340, L377–423): one counter per namespace per Host process. It starts at 0 and increments when the entry's `[fiber uid, schema, config]` changes. `expectedRevision: undefined` writes unconditionally. The comparison runs inside the config editor's file lock, so a stale writer gets `settings/conflict`. **Revisions reset to 0 on Host restart** (observed: 1 before restart, 0 after). A revision read from a previous Host generation can therefore match by accident. Corn must discard revisions on every Host generation change and re-read.

Cancellation: only `discoverModels` and `openSettingsDocument` declare a cancellation parameter. Live: aborting the HTTP request of a `discoverModels` call against a hanging loopback endpoint made the Host close its upstream request (`client: AbortError`, `upstreamRequestClosed: true`). Settings and credential writes have no cancellation. Once sent they run to completion, so a timed-out write has an unknown outcome and must be resolved by re-reading.

## 3. Credentials (`credentials-local`)

Live round-trip with `ref: CORN_AUDIT_FAKE_API_KEY`:

| Step | Observed |
| --- | --- |
| `credentials/describe { refs: ['CORN_AUDIT_FAKE_API_KEY'] }` | `{ configured: false, writable: true }` |
| `credentials/set { ref, value: '<FAKE>' }` | `ok: true`, no value |
| describe | `{ configured: true, source: 'file', writable: true }` |
| Host restart, describe | `{ configured: true, source: 'file', writable: true }` (persists) |
| `credentials/unset { ref }`, describe | `{ configured: false, writable: true }`; the fake value is gone from the file |
| Restart with `CORN_AUDIT_ENV_API_KEY=<FAKE>` in the Host environment | `{ configured: true, source: 'env', writable: false }` |
| `set` / `unset` on that ref | `credential/rejected`: `credentials-local: "CORN_AUDIT_ENV_API_KEY" is supplied read-only by the launching environment, so set would be shadowed; unset it in the shell you start dsh from instead` |
| `$DSH_HOME/.env` containing `CORN_AUDIT_DOTENV_API_KEY=<FAKE>` | `{ configured: true, source: 'project-env', writable: true }` |

Storage facts (`credentials/credentials-local/src/index.ts@639ed015` L1–35, L540–640):

- Location: `$DSH_HOME/.credentials.yaml`. In Corn this is `<Corn home>/.credentials.yaml` (dev: `~/.corn-bot-dev/dsh/.credentials.yaml`), never `~/.dsh`. Observed mode `0600`; the Corn home is `0700` (`claimCornHome`). The provider refuses to start on a file with group/other bits.
- Format: plaintext YAML `version: 1`, `refs: { <REF>: <value> }`, `records: { … }`. The same file holds the Host's own browser-auth signing record `client-connection/browser-session`. Writes are atomic under a cross-process lock; external edits hot-reload.
- Precedence: inherited process environment (read-only, wins) > `.credentials.yaml` (writable) > `<cwd>/.env` > `$DSH_HOME/.env`. Corn starts the Host with `cwd` = Corn home, so a `.env` in the Corn home reports as `project-env`.
- **This is local file storage protected by file permissions. It is not the macOS Keychain.** It does not isolate the key from same-user processes, which include Agent tools able to read the Corn home. Whether a sandbox policy blocks a given tool from that path is not established by this audit. An OS vault would need another `CredentialProvider` behind the same seam and is out of scope.

## 4. Gate: public write of the global default model

**Conclusion: yes.** Corn writes the global default with `settings/replace { ns: 'agent-default-model', section: { provider, model, reasoningEffort? }, expectedRevision }`. It is the same public Remote the official Models page uses for provider profiles.

Why this is public and supported, not a private shortcut:

- `AgentDefaultModelConfig.Config` declares `provider`, `model` and `reasoningEffort` as volatile live Config fields (`core/agent-default-model/src/index.ts@639ed015` L51–55). The package README documents that they are live fields and that saved selections update the active profile patch.
- The `auto: false` projection (`index.ts` L60) only registers the page presentation policy. `SettingsForms.describe` turns it into `autoGenerate: false` on the descriptor and still lists the namespace (`settings/settings/src/index.ts@639ed015` L266–277, L312, L326). Writes check only that the entry is configurable and the path is volatile (L377–389). The live descriptor confirmed `autoGenerate: false`, fields `provider, model, reasoningEffort`.
- The write path is the official `ConfigEditor.edit` (`boot/config-editor/src/index.ts@639ed015` L87–153). It is the same storage that `AgentDefaultModelConfig.saveSelection` (`index.ts` L82–94) and therefore `session.selectModel` use: an atomic `0600` write of `profiles/corn-dev/cordis.patch.yml` followed by Loader reconciliation. The Remote returns only after both, so the caller awaits save completion.

Live end-to-end evidence (dev home, keyless):

| Step | Request | Observed |
| --- | --- | --- |
| Read | `settings/describe` | `agent-default-model` value `{ provider: 'deepseek-official', model: 'deepseek-flash' }`, `user: {}`, revision 0 |
| Write | `settings/update { ns: 'agent-default-model', patch: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'max' }, expectedRevision: 0 }` | returned view value = user = target, revision 1; profile patch gains an `agent-default-model` row, mode `600` |
| Read-back, same Host | `session/modelCatalog`, `POST /api/dsh-claw/registry/models` | `default` = target; Claw `official` = target |
| Stale write | same `expectedRevision: 0` | `settings/conflict` expected 0, actual 1 |
| **Host restart** | `settings/describe`, `session/modelCatalog`, Claw `registry/models` | all three = `{ provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'max' }`; revision 0 |
| Revert | `settings/replace { ns, section: {}, expectedRevision }` | value back to base `deepseek-flash`, `user: {}`, profile row removed |

Constraints for the Corn command (Work Package 3):

1. **No catalog validation upstream.** `settings/update` accepted `model: 'corn-audit-not-in-catalog'`, and `session.modelCatalog().default` then reported it. Main must validate `(provider, model, reasoningEffort)` against a fresh `session/modelCatalog` (group, model id, `reasoning.efforts`) before writing. Main must also treat a stored default outside the catalog as `needs_model`.
2. **Use `replace`, not `update`.** `update` merges, so omitting `reasoningEffort` kept the previous `max`. `replace` resets the live fields to the composition base and sets the supplied ones, which matches `saveSelection`'s complete-selection semantics. `replace` with `{}` restores the composition default and removes the profile row.
3. Write with the revision from the same Host generation. On `settings/conflict`, re-read and present a recoverable state. After the write, re-read `session/modelCatalog().default` and compare.
4. The namespace id is fixed by Main. Renderer never names `ns`.

Stability caveat: the official web UI never writes this namespace directly. It saves the default only through `session.selectModel` and, for account login, `session.initializeDefaultModel` (DeepSeek account only, `api/session-controller/src/index.ts@639ed015`). The settings path relies on the generic settings contract plus the documented volatile fields. Re-run `scripts/audit/model-config-api-audit.mjs` on every DSH upgrade before shipping it.

Bridge or upstream: neither is needed for this gate. Had the namespace been absent or non-volatile, the only public alternative would have been `session.selectModel`, which needs a Session and mutates it. A Host Bridge would then have had to call the non-Remote `ctx.agentDefaultModel.saveSelection`. That is a Host service API, not a public Remote, and it does not validate. The decision rule was therefore an upstream patch exposing a validated public default-model write, never a fake Session.

## 5. Provider catalog and configuration schema

- Keyless `llm/listProviders`: `deepseek-official`, `deepseek-account`. `session/modelCatalog`: default `deepseek-official/deepseek-flash`, routable `['deepseek-official']`, models `deepseek-flash`, `deepseek-v4-pro` with efforts `off/low/high/max` (default `high`), no failures. A route is routable and listed without a key; usability is not proven by the catalog.
- `llm/listConfigurableProviders`: 43 entries in `llm-pi-ai` (pi-ai catalog routes, `declared: false`, `settingsPath: ['providers', <route>]`), `llm-deepseek` and `llm-deepseek-account`. 41 of them are configurable but not routable.
- Provider profile shape comes from the settings schema, not a Corn list. `llm-deepseek` fields: `baseURL, thinking, reasoningEffort, maxTokens, defaultContextWindow, models, … , retryPolicy, apiKeyEnv` (credential-ref, default `DEEPSEEK_API_KEY`). `llm-pi-ai`: `providers: { [route]: { displayName?, api?, baseURL?, apiKeyEnv?, models?, compat?, retryPolicy?, … } }`. Protocol enum and compat options are in that schema (`llm/llm-pi-ai/src/index.ts@639ed015` module docs).
- Configurable → active, live: `settings/mutate { ns: 'llm-pi-ai', ops: [{ op: 'set', path: ['providers', 'corn-audit-gateway'], value: { displayName, api: 'openai-completions', baseURL: <loopback>, apiKeyEnv: 'CORN_AUDIT_FAKE_API_KEY', models: [{ id: 'corn-audit-model' }] } }] }` made the route `declared: true`, routable and listed in the catalog. The state survived a restart. Unsetting the path withdrew it. No model request was made.
- Discovery: only `llm-pi-ai` registers discovery. `llm-deepseek` returns `llm/model-discovery-rejected` `no model discovery is registered for "llm-deepseek"`; its models come from its schema `models` list. A pi-ai catalog route (`request: { provider: 'deepseek' }`) answers from the installed catalog without network (`llm/llm-pi-ai/src/discovery.ts@639ed015` L269–286). A `baseURL` draft is fetched with the one-shot `apiKey` as `Bearer` (loopback stub saw it). The key was not echoed in the reply.
- **Command-line overlays block settings writes.** When the Host started with Corn's development route overlay for `llm-pi-ai` (`routePlan('xiaomi-token-plan-cn')`), `settings/mutate` on `llm-pi-ai` returned `settings/rejected`: `Configuration for "llm-pi-ai" is overridden by a home patch or command-line overlay` (`boot/config-editor/src/index.ts@639ed015` L136–141). The production `--patch` must carry only isolation rows (today: `workspace-controller`), never model or provider rows.

## 6. Missing-service behaviour

- Settings absent (overlay `{ id: settings, disabled: true }`): `settings/describe` → `gateway/internal` `settings service is absent: mount @deepseek-ai/dsh-settings with @deepseek-ai/dsh-config-editor in the profile composition`. `session/modelCatalog` still answers from the composition default.
- Credentials absent (overlay `{ id: credentials, disabled: true }`): the Host exits before readiness because browser authentication keeps its signing record in the credential provider. The Remote error (`gateway/internal` `credentials service is absent: …`, `credentials.ts` L120–131) is therefore unreachable in a bootable Corn composition. Corn surfaces this case as a runtime start failure, not as a model state.

## 7. `session.selectModel` and Claw Bot models (for Work Package 4)

- `session.selectModel` installs the selection for the Session's next request. It then saves the same selection as the global default **in the background, without awaiting it** (`commands.ts@639ed015` selectModel, `void this.ctx.agentDefaultModel.saveSelection(selected)`). Live: on a fresh Session, selecting `deepseek-v4-pro` returned `{ selected: { provider, model, reasoningEffort: 'high' } }` (effort filled from the model default). Within the poll window the global default became that selection and the profile patch row appeared. It cannot implement a Bot-only override.
- Claw `registry/models` (`dsh-claw-registry host.js` L460–467) is read-only. It returns `{ official: agentDefaultModel.currentSelection(), groups }` from the live LLM registry. Live, it tracked every write above.
- Claw `registry/model` (L469–482, `registry-store.mjs setAgentModel`) stores `{ provider, model, reasoningEffort? }` on one Claw agent (`agentId` must start with `wa_`), or `null` with `inherit: true`. It performs no catalog validation and has no revision guard on the agent row. The registry revision increments, but the route takes no expected revision. Claw applies the stored model only from its browser client (`registry-navigation.mjs` L164–175, `registry-claw-browser.mjs` L241–250) via `session.selectModel` on a new Claw Session, which inherits the global-default side effect. Corn has no Claw browser client, so nothing applies a Bot model automatically.
- Pending for Work Package 4: RC2 exposes no Remote for a Session-only selection without the global save. Whether a Host-side public service offers one was not audited here. If none exists, the answer is an upstream patch, not select-then-restore.

## 8. Capability summary

| Capability | Status | Evidence |
| --- | --- | --- |
| Official packages assembled (dev profile) | verified | §1, live `settings.describe` / `llm.*` |
| Official packages assembled (packaged `.app`) | verified | packaged probe, §1 |
| `settings.describe` shape, redaction, `autoGenerate` | verified | §2, live |
| `settings.update` / `mutate` round-trip on a harmless field (`ui-theme.fontSize` 14→15→unset) | verified | §2; profile row removed after revert |
| `settings.replace` | verified | §4 revert |
| `settings/conflict` + `expectedRevision` | verified | §2, §4 |
| Revision reset on restart | verified | §2 |
| `settings/rejected` cases, unknown method 404 | verified | §2 |
| Settings write blocked by command-line overlay | verified | §5 |
| `credentials.describe/set/unset` (fake key), persistence across restart | verified | §3 |
| Credential file path and mode, env read-only precedence, `.env` layer | verified | §3 |
| Credential request validation errors | verified | §2 |
| `llm.listProviders`, `listConfigurableProviders`, configurable-but-inactive entries | verified | §5 |
| Hand-declared provider via settings → routable → removed | verified | §5 |
| `llm.discoverModels` from catalog (no network), unknown namespace, loopback endpoint, cancellation | verified | §5, §2 |
| `session.modelCatalog` keyless | verified | §5 |
| **Global default public write + restart persistence** | **verified** | §4 |
| Global default catalog validation by DSH | unavailable (Corn validates) | §4 |
| `session.selectModel` global-default side effect | verified | §7 |
| Claw `registry/models` read | verified (live read + source) | §7 |
| Claw `registry/model` write semantics | verified (source only, not exercised) | §7 |
| Settings service absent error | verified | §6 |
| Credentials service absent error | unavailable at runtime (Host does not boot) | §6 |
| `llm-deepseek` discovery | unavailable (no registration) | §5 |
| Session-only model selection without global save | unavailable via Remote; Host-service route pending (WP4) | §7 |
| Discovery against a real provider endpoint with a real key | pending (excluded: no real keys, no network to providers) | — |
| A real model request after `credentials.set` | pending (WP3 authorized smoke only) | — |
| Outcome of a settings/credential write whose HTTP request is aborted | pending (descriptor: not cancellable; re-read required) | §2 |
| DeepSeek account login / `initializeDefaultModel` | pending (out of scope) | §4 |
| `settings.openSettingsDocument` | not exercised (opens a native editor; not for Corn) | §2 |

## 9. Inputs to Work Package 3

Credential input exception (maintainer decision 2026-10-11): the key exists only in a password input and one write request. It travels through one restricted IPC to Main, which calls exactly `POST /api/credentials/set` with `{ "args": { "ref": <REF>, "value": <key> } }` (Remote `credentials.set(ref, value)`). It is never read back, and it is never kept in UI state, drafts, logs or IPC replies. Details for the IPC:

- Renderer supplies a provider id and the key, never a ref. Main resolves the ref from the current `settings.describe` profile: the profile's `apiKeyEnv`, else the official derivation `<ROUTE>_API_KEY` (uppercase, non-alphanumeric runs → `_`; `client/ui-settings-models/src/client/store.ts@639ed015` `deriveKeyRef`). The ref must match `^[A-Za-z_][A-Za-z0-9_]*$`.
- For a pi-ai route without `apiKeyEnv`, the official order is `settings/mutate` to set `providers.<route>.apiKeyEnv` (only when a key is entered), then `credentials/set` (`ProviderEditor.tsx@639ed015` L261–305). The two steps are not atomic, which is the plan's `partially_applied` case. `llm-deepseek` already defaults to `DEEPSEEK_API_KEY`.
- `credential/rejected` with `source: 'env'` means read-only. Show it as such and do not retry.
- Clear uses `POST /api/credentials/unset { ref }`; status uses `credentials/describe { refs }` (≤ 64), which returns `configured/source/writable` only.

Risks:

1. `credentials-local` is a plaintext `0600` file in the Corn home, not Keychain, and it does not isolate from same-user Agent tools (§3). The same file holds the Host browser-auth signing secret.
2. The development `CORN_MODEL_*` path injects provider env vars and the `llm-pi-ai` overlay. Either one makes the matching settings read-only (`source: 'env'`) or unwritable (overlay refusal). Production and the default dev App must launch without both.
3. A `.env` file in the Corn home becomes a credential source (`project-env`) below the managed store.
4. Revisions reset per Host process. Never carry one across a Host generation.
5. DSH does not validate the default model against the catalog; Main must.
6. The default-model write path is generic settings, not an official UI flow. Re-audit on every DSH upgrade.
7. `session.selectModel` mutates the global default asynchronously. Corn must not call it from global-settings code. Work Package 4 must resolve Bot overrides before using it.
