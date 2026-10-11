# ADR-0005: Unsigned M0 macOS package with a private bundled runtime

- Status: **Accepted** (maintainer decision 2026-10-11: bundle the pinned engine; defer signing and notarization)
- Milestone: M0 (M0-01, M0-05)

## Context

Corn Bot is an independent app. It must boot on a machine without Node, pnpm, network access to npm or an installed DeepSeek Harness, and it must never read or modify `/Applications/DeepSeek Harness.app` or `~/.dsh`. The DSH Host and the Claw suite are pinned in `runtime.lock.json` (DSH `0.2.0-rc.2`, Claw `0.3.0-rc.2`). The Claw installer composes a profile with `pnpm install`, which needs network access and a package manager.

electron-builder's dependency collector skips peer dependencies (the DSH tree resolves 289 `@deepseek-ai` packages; the collector kept 262), and `extraResources` always drops `node_modules` directories.

## Decision

1. Package with electron-builder 26.15.3, arm64 `dir` target, `appId` `io.github.xingyingyuzhui.cornbot`, product name `Corn Bot`. No signing identity and no hardened runtime in M0.
2. Stage production dependencies with `pnpm --filter @corn-bot/desktop deploy --prod --legacy --config.node-linker=hoisted`. The packaging script saves and restores `node_modules/.pnpm-workspace-state-v1.json`, which `deploy` would otherwise rewrite.
3. `app.asar` contains only Corn code (`package.json`, `dist`, `renderer`) and declares no dependencies. `afterPack` copies the complete deployed `node_modules` (peers included) to `Contents/Resources/node_modules`. ESM resolution walks up from `app.asar` to that directory, and the DSH Host runs from real files. `default_app.asar` is removed. `npmRebuild` is off because the DSH native modules are N-API.
4. The Claw profile is built once at package time in a temporary Corn home, using the verified Claw release (archive SHA-256 plus inner `SHA256SUMS`). Only `package.json`, `cordis.yml`, `cordis.patch.yml` and `node_modules` are kept, with a manifest (`corn-profile-template.json`) recording versions and a SHA-256 per file. `afterPack` copies it to `Contents/Resources/profile-template`.
5. On first boot the supervisor verifies the manifest, copies the template into a staging directory and renames it into place. A failed verification fails the boot. An existing profile is not re-seeded, but every start and recovery re-validates it through the formal Claw admission ([ADR-0006](ADR-0006-claw-admission.md)); a profile without verified Claw fails without spawning a Host and is never repaired. No package manager or network is used at runtime.
6. Packaged data lives under `~/Library/Application Support/Corn Bot/` (`dsh`, `artifacts`, `model.env`). `CORN_DSH_HOME`, `CORN_ARTIFACTS_DIR` and `CORN_MODEL_ENV_FILE` override these for tests.
7. The Main process restarts a failed Host automatically: at most 3 attempts per 60 s window with exponential delay from 500 ms to 4 s. The Renderer sees `recovering`, then `ready` or `failed`. Only an unavailable Host is retried; configuration, home, version and Claw admission failures are terminal and carry a `RuntimeErrorCode`.

## Consequences

- The M0 app is about 846 MB, of which `Resources/node_modules` is about 526 MB. Most of it is DSH optional capability (libreoffice-kit, sherpa-onnx, sharp). Pruning needs a per-package audit against the Host contract and is tracked as size debt.
- Gatekeeper rejects the unsigned app when it is downloaded. M0 builds are for local verification only. Signing, hardened runtime entitlements and notarization need a Developer ID and a new ADR before any distribution.
- Upgrading DSH or Claw means updating `runtime.lock.json` and rebuilding; an existing profile is never overwritten (seeding is skipped when `package.json` exists), so a profile behind the lock fails admission until it is repaired. Profile migration is out of M0 scope.
