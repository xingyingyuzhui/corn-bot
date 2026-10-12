# M2 Work Package 2: official model-configuration API audit

## Status and evidence scope

**Gate passed: RC2 has a public, persistent write path for the global default model.** It is the generic `settings` Remote addressed to the `agent-default-model` namespace. A live write, Host restart and read-back in an audit-owned Corn lab proves it (re-recorded with the owned-lab harness, §10). No Corn Host Bridge command and no upstream patch is required for the global default. Section 4 records the reasoning, limits and the Main-side command Work Package 3 implements.

This package audits interfaces only. It does not wire Corn UI, IPC or adapters, does not remove the development `model.env` path, and does not claim that a configured provider can serve a model request.

- DSH `0.2.0-rc.2`, tag `dsh-v0.2.0-rc.2`, commit `639ed015397290b3745d163aafe02ffee4aa3f84` (cited below as `path@639ed015`). Source was read only through `git show` / `git grep` on that commit in a local clone of the official repository, never from a working tree or master.
- Wire parameter names and cancellation come from the published generated descriptors `lib/typert.host.js` of `@deepseek-ai/dsh-api-settings-controller@0.2.0-rc.2` and `@deepseek-ai/dsh-llm@0.2.0-rc.2`, not from hand-written types.
- Claw `0.3.0-rc.2` was read from the locked release asset (`sha256 99ea3c20…08cb`, matches `runtime.lock.json`), package `dsh-claw-registry-0.3.0-rc.2.tgz`.
- Live evidence: `node scripts/audit/model-config-api-audit.mjs` (no arguments) and `node scripts/audit/packaged-model-config-probe.mjs "<worktree>/release/mac-arm64/Corn Bot.app"` (read-only; not part of this re-review's acceptance, see §10; the §1 packaged facts come from the first audit). Each creates and destroys its own lab (§10). The redacted records are written to `.artifacts/model-config-api-audit.json` and `.artifacts/packaged-model-config-probe.json` (not committed). The first audit run used an externally supplied `CORN_DSH_HOME`; the re-review (F3/F4) rejected that harness. The evidence below was re-recorded on 2026-10-11 with the owned-lab harness on branch `fix/model-audit-isolation`. All conclusions held.
- Safety: no user DSH home, DSH application, existing Corn home, configuration or credential was read. `model.env` was not read. The Host environment is Corn's allowlist plus fake `CORN_AUDIT_*` refs only, and any other key-shaped value is rejected. Only the fake values `sk-corn-auditc-FAKE-0000`, `…-FAKE-ENV-0000`, `…-FAKE-DOTENV-0000` and `…-FAKE-DISCOVERY-0000` were used. No provider endpoint was contacted: discovery used the pi-ai catalog and a loopback stub. The script scans every wire response, all Host stdout/stderr and the whole lab home tree for each fake value and asserts zero hits. The report writer also refuses to persist one. No hits were observed.
- Two different guarantees. **Restore to lab initial values**: every write is reverted through the public Remotes and asserted (global default `user: {}`, fake credential unset, custom provider withdrawn). This is capability `lab-restored`. **Destroy the lab**: afterwards all Hosts are stopped, the stub is closed, the lock is released and the lab directory is removed. This is the report's `cleanup`. Neither applies to any home the audit did not create, because it refuses to use one.

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

Cancellation: only `discoverModels` and `openSettingsDocument` declare a cancellation parameter. Live, asserted (capability `discovery-cancellation`, §10): the `discoverModels` request reached the hanging loopback endpoint (4 ms) and only then was its HTTP request aborted. The client ended with `AbortError`, and the Host closed its upstream request unanswered 2 ms after the abort (`hangRequests: 1`). Each step has a bound, and any other outcome fails the audit. This proves cancellation of discovery HTTP only. Settings and credential writes have no cancellation. Once sent they run to completion, so a timed-out write has an unknown outcome and must be resolved by re-reading.

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

Live end-to-end evidence (audit-owned lab, keyless; capabilities `global-default-write` and `global-default-restart-persistence`):

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
| `llm.discoverModels` from catalog (no network), unknown namespace, loopback endpoint | verified | §5 |
| `llm.discoverModels` HTTP cancellation reaches upstream (asserted, bounded) | verified (owned-lab harness, branch `fix/model-audit-isolation`) | §2, §10 |
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
| Audit refuses an external home before any read/write/spawn | verified (regression + live old-fail/new-pass) | §10 |
| Audit cleanup on success and failure (Hosts, stub, lock, lab removed; bounded) | verified (regressions + live API audit) | §10 |
| Packaged probe with the owned-lab harness | pending (packaged `.app` launches paused; unit regressions only) | §10 |
| Cleanup of an audit killed with SIGKILL | unavailable (no handler can run; the lab stays in the OS temp dir) | §10 |

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

## 10. Audit harness guarantees (re-review F3/F4)

Status updated 2026-10-12: PR #16 is merged at main `8b6989c`, including F3/F4 and round 3 N4; finite supervisor stop is merged through PR #19. F3/F4 have historical live headless audit evidence. N4 interrupted-template cleanup and finite stop have unit/fake-child evidence; their real-Host interruption checks and packaged acceptance remain pending while verification is paused. Do not infer that this merge or the old audit result establishes those new checks. Current work order is in the [forward plan](../plans/CORN_BOT_FORWARD_PLAN.md).

### Lab lifecycle (`scripts/lib/model-audit-fixtures.mjs`)

- **No external home.** `CORN_DSH_HOME`, any positional path or any flag makes both scripts exit `2` from the argv/env strings alone. No file is read or written, no Host is spawned and no report is touched. The packaged probe accepts exactly one `.app` path.
- **Owned lab.** `mkdtemp` in the OS temp dir. `home/` gets an owner marker `{ owner: 'corn-bot', purpose: 'model-config-audit', labId }` and passes Corn's `claimCornHome`, and the Corn process lock is held for the whole run. The lab path is fixed at creation. Removal re-checks that the marker still carries this `labId` and refuses otherwise.
- **Profile source.** The profile comes only from a template that `assertCredentialFreeTemplate` accepts: top level limited to `package.json`, `cordis.yml`, `cordis.patch.yml`, `node_modules` and the manifest, no `.env*` / `.credentials*` entry anywhere, and `verifyTemplate` hash/version check. The API audit builds that template inside the lab with `buildProfileTemplate` (locked DSH plus the SHA-checked Claw release, the same flow as `package:mac`). The packaged probe uses the app's bundled template read-only. Existing homes are never copied.
- **Versions** are read from the installed packages: DSH from the resolved `@deepseek-ai/dsh/package.json` (or the app's bundled copy), Claw from `profiles/corn-dev/node_modules/dsh-claw-suite` and all 9 components. They are compared with the contract and `runtime.lock.json`. A mismatch fails the run and destroys the lab.
- **Host process.** Each Host is spawned in its own process group. A spawn `error`, an `exit` before readiness or a 45 s readiness deadline rejects the start. Stop sends SIGTERM with an 8 s grace, then SIGKILL with a 5 s bound, then reaps any survivor in the group. A survivor is a cleanup failure, never an endless wait. After cancellation the lab refuses new Hosts and stops running ones.
- **Cleanup order** on success and failure: stop every Host, close tracked stubs (all connections dropped, 5 s bound), release the lock, verify the marker, remove the lab. Any failed step makes `cleanup.ok: false` and a non-zero exit, and nothing claims the cleanup succeeded.
  - If any Host stop is not confirmed (it survived SIGKILL, or its process group did), stubs are still closed. The **lab, its home and the process lock are kept**: the lock is not released and nothing is removed under a possibly live Host. This is the same rule as `OwnedResources`.
  - The cleanup record then lists `unconfirmedHosts`, `retained: ['lab', 'process lock']` and `labRoot` (post-merge review PMR-01).
  - Destroy runs once; a second call returns the same outcome.

### Interruption and the template build (round 3 N4)

- **Signals only cancel.** SIGINT/SIGTERM abort the run's `AbortController` (`audit.signal`). The handler does not exit. The body and everything it owns settle, then the lab is destroyed, then the report is written, then the script exits. Repeated signals during cleanup are logged and change nothing.
- **Template build ownership** (`scripts/lib/owned-resources.mjs`, `profile-template-build.mjs`). The build's `corn-profile-template-*` temp home, the bootstrap and governed Hosts and every Claw release/install child (`tar`, `shasum`, the release installer) are registered the moment they exist.
  - The signal is checked before each phase (bootstrap, install, governed check, copy, verify, manifest). No phase starts after cancellation.
  - On abort, owned processes are stopped at once, including one registered after the abort. Each release runs at most once, has a bound (Host stop 20 s; children: SIGTERM, 8 s grace, SIGKILL, 5 s, then a process-group reap) and is awaited before the build settles.
  - The copy is not abandoned mid-way, because it could keep writing after its target is removed. It finishes, then the signal is checked.
  - If a Host or child is not confirmed stopped, the build fails with `OwnedCleanupError`. Its temp home is **kept**, not removed underneath a live process. The report records `cleanup.ok: false` and `cleanup.owned` (`released`, `failed`, `retained`).
- **Interrupted report.** The terminal status is `interrupted`, with `interrupted: 'SIGINT' | 'SIGTERM'`, never `running` or `passed`.
  - Exit code is the shell convention 128 + signal: **130** for SIGINT, **143** for SIGTERM. It is used even when cleanup also failed; `cleanup.ok: false` then records the failure.
  - After writing the report the scripts exit explicitly, so a child that survived a failed cleanup cannot keep the run alive.

### Report semantics (`scripts/lib/model-audit-report.mjs`)

- At start the report is replaced by `{ status: 'running' }`. A failed, crashed or interrupted run can therefore never leave an older `passed` report behind. A signalled run ends `interrupted`, see above.
- `passed` (exit 0) requires every required capability recorded as `pass` with no `false` fact, no failed capability, no error and `cleanup.ok`. Anything else is `failed` with exit 1, and the safe failure reason is recorded. A report containing a fake key is not written. A failure record without evidence is written instead.
- API audit required capabilities: `runtime-versions`, `discovery-cancellation`, `global-default-write`, `global-default-restart-persistence`, `lab-restored` and `fake-key-leak-scan`. Packaged probe: `runtime-versions`, `packaged-read`, and `app-unmodified` (path/mode/size/mtime fingerprint of the whole bundle, equal before and after).

### Cancellation assertion (`scripts/lib/model-audit-cancellation.mjs`)

The abort fires only after the request has arrived at the hanging stub; there is no fixed delay. A pass then requires all of the following, each with a bound: the client ends with `AbortError` (5 s), and the upstream request closes unanswered (5 s). The failure reasons are `upstream-never-reached`, `call-settled-before-abort`, `client-not-settled`, `client-not-aborted`, `upstream-not-closed` and `upstream-completed`. Each one throws, and the run fails with that reason recorded.

### Old-fail / new-pass

| Check | Baseline `a72994c` | This branch |
| --- | --- | --- |
| External fake Corn home (`.env`, `.credentials.yaml`, patch sentinels, broken profile) via `CORN_DSH_HOME` | exit 1 after 217 ms. A Host was spawned, `documents/` was created and the existing **`.env` was deleted** | exit 2 after 164 ms. Path, mode, mtime and bytes identical. No new entry and the previous report untouched |
| Same via a positional path / `--home` flag; packaged probe with an env home or a non-`.app` argument | old packaged probe read the bundle path first (exit 1) | exit 2, home unchanged |
| Cancellation that never reaches upstream, is not propagated, answers early, or never settles | swallowed by `catch(() => false)`, so the audit could still exit 0 | each fails the probe within its bound (1–2 s per case in tests) and the run exits 1 |
| Regression suites `scripts/tests/model-audit-{isolation,cancellation}.test.mjs` (23 tests) | fail (commit `e6362a8`: missing harness; CLI cases spawn a Host / exit 1) | 23/23 pass inside root `pnpm check` (273 tests, 9 s) |
| SIGINT to a running audit (`scripts/tests/model-audit-interrupt.test.mjs`, fake Host) | exit 130 but the report **stays `running`** (handler exits right after `lab.destroy`) | `interrupted`, exit 130, lab removed, Host dead, lock released |
| SIGINT/SIGTERM during the template build's bootstrap Host, Claw install (TERM-ignoring child), governed check and verify; repeated signals; a Host whose stop never settles (6 tests, injected fake Hosts and children) | not runnable: the old builder takes no signal and owns nothing (the old-code run fails at load) | each ends `interrupted` with 130/143 within 8 s. No owned process or template home is left, and no later phase starts. The wedged Host hits the bound, keeps its home and reports `cleanup.ok: false` |
| Ownership unit tests (`scripts/tests/owned-resources.test.mjs`, 6 tests) | — (new module) | idempotent close, abort stops at once, bounded wedged release keeps the directory, TERM→KILL escalation, completed build releases everything, a pre-aborted build creates nothing |

### Live runs (2026-10-11, keyless, fake keys only)

| Command | Wall time | Result | Cleanup |
| --- | --- | --- | --- |
| `node scripts/audit/model-config-api-audit.mjs` | 11 s (internal 10.4 s, including the template build) | `passed`. All 6 capabilities pass. DSH `0.2.0-rc.2` (commit `639ed015`), Claw `0.3.0-rc.2` × 9 components. Global default write and restart persistence asserted. Cancellation reached upstream after 4 ms, closed 2 ms after the abort. Leaks 0 | 7 Hosts spawned (6 booted, 1 exited before readiness as expected), all halted by the audit, 1 stub closed, lock released, lab removed. No template build dir and no DSH process left |
| `pnpm package:mac`, then `node scripts/audit/packaged-model-config-probe.mjs "$PWD/release/mac-arm64/Corn Bot.app"` | — | **Not part of this package's acceptance evidence.** On 2026-10-11 the maintainer stopped all smoke, Electron and packaged `.app` launches. Both commands had already run once, before that instruction (probe `passed`, app fingerprint unchanged, lab removed, no process left). They were not re-run, and the build outputs were deleted. The probe's code fix is covered by the unit regressions only. Re-run it when packaged launches are allowed again | — |

### Not covered

- Not run for acceptance: any `smoke:*` script, `package:mac`, Electron, and the packaged `.app` probe (see the table above).

- An audit killed with SIGKILL (or a machine crash) cannot clean up. Its lab and any `corn-profile-template-*` home stay under the OS temp dir. The next run does not reuse them. This exception is SIGKILL only; SIGINT/SIGTERM always go through cleanup.
- N4 is fixed in code and covered by fake-child tests only. **Real-audit acceptance is pending**: interrupting a real template build and a real headless audit (round 3 §10, "C headless lifecycle") has not been run while smokes are paused.
- The template build's Host stop is bounded here at 20 s regardless of the product supervisor. The product's own bounded SIGKILL wait is a separate change (round 3 §5) and is not required by this package.
- The cancellation evidence covers discovery HTTP only. Settings and credential write timeouts stay unknown outcomes that require a read-back (§2).
- The `session.selectModel` side-effect step (§7) remains an observation with a 10 s poll, not a required capability.
