# M2 Work Package 3: model settings on official DSH services

Date: 2026-10-11. Branch `feat/m2-model-settings` from `main` `a72994c`. Installed DSH `0.2.0-rc.2`, Claw `0.3.0-rc.2`. Plan: [model configuration fix plan §6](../plans/CORN_MODEL_CONFIGURATION_FIX_PLAN.md); interfaces: [API audit](MODEL-CONFIG-API-AUDIT.md) and [ADR-0001](../adr/ADR-0001-dsh-transport.md).

Only fake keys (`sk-corn-wp3-FAKE-*`, `corn-review-fake-credential`) were used. No model request was sent. A fake key proves storage and status, not that a provider accepts it.

## Checklist

| Requirement | Status | Evidence |
| --- | --- | --- |
| Settings → 模型 reads the live provider directory, credential status, catalog and default | Done | `smoke:model-settings`; renderer `model-settings.test.ts` |
| Set / change / clear a provider key through `credentials.set/unset`; ref derived by Main | Done | service tests (builtin and catalog routes); smoke steps 2, 7 |
| Custom provider create / edit / remove with schema-derived protocols | Done | service test; smoke step 4 |
| Default model: validate against live catalog → `settings/replace` → read back | Done | service test (invalid model, provider and effort never write); smoke step 3 |
| Revision conflicts are recoverable, never blind overwrites | Done | service test (Corn pre-check and Host fence); smoke step 3 |
| Settings saved but key failed → `partially_applied` with read-back; retry writes only the key | Done | service test |
| Write timeout → `outcome_unknown` resolved by read-back | Done | service test |
| Host generation pinning: stale commands refused, Host change mid-write is `outcome_unknown` | Done | service test; smoke step 6 (real restart) |
| Main serializes writes | Done | service test |
| Closed error codes; no raw message, stack, key or ref in replies or logs | Done | service and IPC tests; smoke leak scan |
| IPC: trusted sender, strict payloads (no ns/ref/path/extra args), preload channels match contract | Done | `model-settings-ipc.test.ts` |
| Adapter allowlist excludes `settings/update`, documents, export, discovery; official argument shapes | Done | `packages/dsh-adapter/tests/model-settings-clients.test.ts` |
| Model status separate from runtime; keyless start reaches `ready` + `needs_configuration` | Done | startup test; Electron dev smoke; packaged smoke |
| Production `CORN_MODEL_*` / `model.env` retired; dev override explicit, labelled, read-only | Done | startup and app-paths tests; review-desktop `legacy-model-env-ignored`, `dev-override-labelled`; smoke step 8 |
| Packaged template keyless; retired variables inert in the packaged App | Done | `smoke:packaged` round 1 |
| Key only in password input + one write; cleared on submit/close | Done | renderer tests; browser check in fixture mode |
| Real key end-to-end ("配置后真实可用") | **Pending (user)**: configuration and persistence now; the request needs Work Package 4's chat wiring | steps below |
| DeepSeek account sign-in | Not delivered | `deepseek-account` is hidden; it signs in rather than storing a key |
| Custom-provider model discovery | Not delivered | models are entered by id |
| Bot model overrides | Out of scope (Work Package 4) | |

## Runs

| Command | Result |
| --- | --- |
| `pnpm check` | 306 tests pass, Biome and typecheck clean |
| `pnpm build` | pass |
| `pnpm smoke:model-settings` | 9/9 steps (artifact `.artifacts/model-settings-smoke.json`) |
| `CORN_DESKTOP_SMOKE=1 pnpm dev:desktop` | ready, `needs_configuration` / `credential_missing`, bridge verified, snapshot redacted, layout passed |
| `CORN_DESKTOP_SMOKE=1 CORN_DESKTOP_CRASH_SMOKE=1 pnpm dev:desktop` | recovered, Host replaced, model status `needs_configuration` before and after |
| `pnpm smoke:review` | 15/15 (8 Claw admission, 9 desktop including the two new model cases) |
| `pnpm package:mac && pnpm smoke:packaged` | 3 fresh rounds + no-Claw refusal; `~/.dsh` untouched |

The layout probe's "720×520, details overlay" scenario failed in the first two development runs on this branch and passed in the following eight runs without a code change; `main` passed in one run. Treat it as an intermittent resize-timing case to watch in CI.

Smoke `smoke:model-settings` steps: keyless read; set key → stored; default model validated, replaced, stale revision conflicts; custom provider via `settings.mutate` + `credentials.set`; credential file `0600` in a `0700` home; Host restart (new generation, stale command refused, state persists); restore (custom removed, default reset, key unset, survives restart); development override labelled and read-only; no key in any reply and the override key never persisted.

Leak scan after all runs: zero occurrences of the fake keys in `.artifacts/` or the worktree's isolated home. The only file that held a fake key was the disposable home's `.credentials.yaml`, deleted with that home.

## Credential storage

Keys go to DSH `credentials-local`: plaintext YAML `<Corn home>/.credentials.yaml`, mode `0600` in a `0700` home, shared with the Host's browser-login signing secret. Not Keychain; no isolation from same-user processes or Agent tools. Environment-supplied keys win and are read-only. See [security boundaries](../security-boundaries.md).

## Pending: real key check (user)

Corn's chat pane still uses the M1 fixture repository; the Main-backed chat arrives with Work Package 4. Until then a real key can be configured and checked for status and persistence from the UI, but the billable "configured key really answers" request cannot be sent from Corn's chat.

1. Start Corn without any model variables (packaged app, or `pnpm dev:desktop`). The chat strip shows "模型未配置" and a 配置模型 button.
2. Click 配置模型 (or Settings → 模型). On DeepSeek, choose 设置密钥, paste a real key and save. The field clears; the row shows the key as stored.
3. Under 默认模型, choose a DeepSeek model (and reasoning effort) and save. The strip's model line disappears.
4. Quit and reopen Corn: the key still reads as stored (never shown) and the default model is kept.
5. Optional: clear the key and confirm the strip returns to "模型未配置".
6. After Work Package 4 wires the chat: send one short message and confirm a streamed reply (one billable request).
