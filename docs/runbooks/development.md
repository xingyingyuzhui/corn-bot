# Independent Corn development

Use Node 24.18.x and pnpm 11.7.0 for development. The eventual app must supply its own runtime; users must not need these developer tools or an existing DSH installation.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm verify:runtime
pnpm setup:runtime
pnpm smoke:cold
pnpm smoke:host
pnpm smoke:governance
pnpm smoke:governance-ptc
pnpm smoke:review
pnpm dev:desktop
pnpm package:mac
pnpm smoke:packaged
```

Every App start goes through the governed entry (`createGovernedHost`): the profile must contain the locked Claw suite and components, list the suite in `dsh.profile.bundles` and not disable or replace any Claw row in a patch layer; after authentication DSH must not have skipped the suite and the Claw Registry must answer. An existing profile is re-validated, never repaired ([ADR-0006](../adr/ADR-0006-claw-admission.md)). The separately named bootstrap entry is used only by `setup:runtime`, the package-time template build and `smoke:cold`; `smoke:cold` is therefore basic-engine evidence. `smoke:host`, `smoke:model`, `smoke:model-lifecycle` and the governance smokes use the governed admission.

A failed start publishes a fixed safe message and one `RuntimeErrorCode`: `model_config_invalid`, `model_config_permissions`, `model_config_unreadable`, `runtime_home_rejected`, `runtime_home_locked`, `runtime_version_mismatch`, `runtime_patch_mismatch`, `claw_missing`, `claw_version_mismatch`, `claw_disabled`, `claw_check_failed` (all terminal) or `host_unavailable` (retried within the recovery budget first).

The installed DSH carries the locked, authorised patches in `runtime.lock.json` `dshPatches`, applied by pnpm `patchedDependencies` from `patches/`. Every Host start, `verify:runtime` and `package:mac` check the patched files byte for byte; a missing or altered patch is `runtime_patch_mismatch`. See [U1](../milestones/U1-SESSION-MODEL-PATCH.md). `smoke:session-model` is the paid real-Host gate for U1 session-only model selection.

`smoke:review` builds, then runs `smoke:review-claw` (real Host through the App entry on disposable copies of the developer profile) and `smoke:review-desktop` (development Electron per case with fresh user data, a disposable home and a fake or absent model file). It fails if any required scenario is missing, stale or failed, and writes `.artifacts/review/`. It never calls a model; the paid `smoke:model*` runs stay separate. `pnpm check` remains lint, typecheck and unit tests only.

`setup:runtime` initializes the isolated `corn-dev` profile using the exact installed DSH CLI, downloads the pinned official Claw release, checks the archive SHA-256 and its inner package checksums, then invokes its installer with that named profile; it reports success only after a governed start passes the Claw admission. Setup takes an exclusive Corn-home lock. It never uses `userDesktop` or the user's installed DSH. `smoke:host` creates disposable test agents/sessions in Corn's developer home, so repeated runs leave test records there. `smoke:cold` uses and removes temporary homes.

The default data root is `~/.corn-bot-dev/dsh`. `CORN_DSH_HOME` can select an absolute empty or already Corn-owned alternative. The user's `~/.dsh`, descendants, ancestors and symlink aliases are rejected. Do not remove a lock until its recorded process owner is confirmed dead; recovery is intentionally manual in M0.

No model credential is configured by setup, and setup, `smoke:cold`, `smoke:host` and `smoke:governance` always boot keyless. Ambient DSH/provider variables are not inherited. The Corn-only model configuration lives in a private file outside the repository, `~/.corn-bot-dev/model.env` (override with `CORN_MODEL_ENV_FILE`). It must be mode `600`; a group- or world-readable file is refused. Setting `CORN_MODEL_PROVIDER` or `CORN_MODEL_API_KEY` in the process replaces the file entirely (all three variables are then required), so a key is never paired with another provider. `CORN_MODEL_ID` alone may override the file's model on the same route:

```sh
CORN_MODEL_PROVIDER=xiaomi-token-plan-cn   # or deepseek-official
CORN_MODEL_ID=mimo-v2.6-flash              # or mimo-v2.6-pro
CORN_MODEL_API_KEY=...                     # never commit, print or paste into chat
```

Corn maps routes in `apps/desktop/src/runtime/model-provider.ts`. Each route passes only its own credential variable into the Host. `deepseek-official` uses the RC2 DeepSeek adapter through `DEEPSEEK_API_KEY`. `xiaomi-token-plan-cn` (MiMo Token Plan, `https://token-plan-cn.xiaomimimo.com/v1`) uses pi-ai's shipped catalog through the dormant `llm-pi-ai` mount: the generated `corn-isolation.patch.yml` adds only an `apiKeyEnv: XIAOMI_TOKEN_PLAN_CN_API_KEY` reference, never the key. pi-ai supplies the endpoint, models and the MiMo `reasoning_content` replay requirement. Adding a provider means adding a route to that table and a test. A user-facing model setup screen and Keychain credential storage are not implemented yet.

`pnpm smoke:model` reads that configuration, requires the model under the selected live catalog route, makes a real billable request, checks live chunks and the completed Turn as read back from the live Host (disk persistence is checked by `smoke:model-lifecycle`), and exports route, model and counts only. Model selection changes the isolated Host's default as well as the test Session.

`pnpm smoke:model-lifecycle` runs five billable model Turns in the developer home: cancel during streaming with a queued request, model-generated `bash` denied by the Claw Gate (`research`) and rejected through Remote approval (`developer`), and two forced Host exits (after completion and mid-stream) followed by log recovery. It exports ids, codes and counts to `.artifacts/m0-model-lifecycle-smoke.json`, never response text. Each run leaves disposable Bots and Sessions in the developer home.

Design work reads the private UI/UX research kit from a git-ignored checkout pinned in `design/grok-kit/kit.lock.json`:

```sh
git clone https://github.com/xingyingyuzhui/grok-bot-ui-ux-kit.git .research/grok-bot-ui-ux-kit
git -C .research/grok-bot-ui-ux-kit checkout 0248419b80dde84560409802afb98f38803df52c
pnpm verify:ui-kit --strict
```

Without a checkout, `pnpm verify:ui-kit` reports `skipped`, and `--strict` turns that into a failure. Never copy kit files into Corn; see `design/grok-kit/RIGHTS_REVIEW.md`.

To verify the current sandboxed diagnostic app:

```sh
CORN_DESKTOP_SMOKE=1 pnpm dev:desktop
```

The app checks its status bridge, writes private artifacts under `.artifacts/` and exits. macOS may emit an unsigned Electron helper resource warning. Product UI, computer control, routines and messaging are later milestones.

Add `CORN_DESKTOP_CRASH_SMOKE=1` to that command to kill only the diagnostic app's owned Host and verify automatic recovery: the Renderer sees `recovering`, Main starts a new Host (at most 3 attempts per 60 s) and status returns to `ready`. `smoke:governance` uses a disposable keyless profile with a test-only public tool probe; it does not configure or call a model. `smoke:governance-ptc` runs the same probe with the official `run_code` tool enabled.

## Packaged app

`pnpm package:mac` (macOS arm64 only) builds an unsigned `release/mac-arm64/Corn Bot.app`; see [ADR-0005](../adr/ADR-0005-packaging.md). It downloads and verifies the pinned Claw release once (cached in `.runtime/claw`), builds the bundled profile template in a temporary home, and stages the production dependency tree under `.build/`. Do not interrupt it while `pnpm deploy` runs; it restores pnpm's workspace state file afterwards.

The packaged app needs no Node, pnpm, network or installed DeepSeek Harness. Its data lives in `~/Library/Application Support/Corn Bot/`: `dsh` (Host home), `artifacts` and `model.env` (same format and mode `600` rule as the developer file). `CORN_DSH_HOME`, `CORN_ARTIFACTS_DIR` and `CORN_MODEL_ENV_FILE` override them.

`pnpm smoke:packaged` launches the built app three times with fresh scratch data and a clean environment, the third time with a forced Host crash, then once on an existing profile without Claw, which must fail with `claw_missing` without spawning a Host or changing the profile. It also checks that `~/.dsh` is untouched. Gatekeeper blocks the unsigned app if it is downloaded; open local builds directly or with right-click → Open.
