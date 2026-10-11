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
pnpm dev:desktop
```

`setup:runtime` initializes the isolated `corn-dev` profile using the exact installed DSH CLI, downloads the pinned official Claw release, checks the archive SHA-256 and its inner package checksums, then invokes its installer with that named profile. Setup takes an exclusive Corn-home lock. It never uses `userDesktop` or the user's installed DSH. `smoke:host` creates disposable test agents/sessions in Corn's developer home, so repeated runs leave test records there. `smoke:cold` uses and removes temporary homes.

The default data root is `~/.corn-bot-dev/dsh`. `CORN_DSH_HOME` can select an absolute empty or already Corn-owned alternative. The user's `~/.dsh`, descendants, ancestors and symlink aliases are rejected. Do not remove a lock until its recorded process owner is confirmed dead; recovery is intentionally manual in M0.

No model credential is configured by setup. Ambient DSH/provider variables are not inherited. New Corn-only DeepSeek credentials can later be supplied locally through `CORN_DEEPSEEK_API_KEY`; do not paste a key into chat, commit it, print it or enter it directly in a shell command that persists to history. A user-facing model setup screen and credential storage are not implemented yet. Other providers require an explicit Corn-owned configuration path before validation.

After privately supplying a new Corn key and `CORN_MODEL_ID`, run `pnpm smoke:model`. The requested model must be present under the official RC2 `deepseek-official` route. This makes a real billable model request, checks live chunks and durable completion, and exports counts only. No model test has been run without a new Corn configuration. Model selection changes the isolated Host's default as well as the test Session.

To verify the current sandboxed diagnostic app:

```sh
CORN_DESKTOP_SMOKE=1 pnpm dev:desktop
```

The app checks its status bridge, writes private artifacts under `.artifacts/` and exits. This is a developer build. macOS may emit an unsigned Electron helper resource warning; signing, notarization, packaged runtime resolution and installable `Corn Bot.app` remain pending. Product UI, computer control, routines and messaging are later milestones.

Add `CORN_DESKTOP_CRASH_SMOKE=1` to that command to kill only the diagnostic app's owned Host and verify the disconnected Renderer status. Automatic product restart is not implemented. `smoke:governance` uses a disposable keyless profile with a test-only public tool probe; it does not configure or call a model.
