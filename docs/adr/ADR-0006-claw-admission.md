# ADR-0006: Formal Claw admission on every App Host start

- Status: **Accepted (2026-10-11)** — closes review finding R1 (existing profile without Claw reached `ready`)
- Milestone: M0 review fixes
- DSH: `0.2.0-rc.2`, tag `dsh-v0.2.0-rc.2`, commit `639ed015397290b3745d163aafe02ffee4aa3f84` (the contract commit in `runtime.lock.json`)
- Claw Suite: `0.3.0-rc.2`

## Context

Seeding is skipped whenever `profiles/corn-dev/package.json` exists ([ADR-0005](ADR-0005-packaging.md) point 5). The App then started DSH on whatever that profile composed, so a Corn profile created from DSH's `web` template before Claw was installed booted as plain DSH and reported `ready`. DSH does not fail a boot for a missing bundle; it skips it and prints a diagnostic.

## Verified DSH load entry

Read-only from the tag above (`git show dsh-v0.2.0-rc.2:<path>`). The documented official checkout path was absent on this machine, so the local DeepSeek Harness clone at `/Users/qin/deepseek-harness` was used; the tag resolves to the same commit as Corn's lock.

| Fact | Source |
| --- | --- |
| The load list is `dsh.profile.bundles` in the profile `package.json`; bundles declare `dsh.bundle.patch` (a file or ordered list) | `packages/boot/app-boot/src/profile.ts:5-14`, `:58-63` |
| Bundles resolve from the DSH installation first, then the profile directory | `profile.ts:16-19`, `resolveBundleDir` `:630-641` |
| An unresolvable, manifest-less or incompatible bundle is skipped (`skippedBundles`), not fatal | `loadProfileDirectory` `profile.ts:655-689` (catch at `:680-682`) |
| The skip is reported once per start as `dsh: skipping profile bundle "<name>": <reason>` on stderr | `reportSkippedBundles` `profile.ts:118-121` |
| Patch order: bundle layers, profile `cordis.patch.yml`, `$DSH_HOME/cordis.patch.yml`, then `--patch` overlays | `readProfilePatches` `packages/boot/app-boot/src/profile-context.ts:63-70` |
| `loadProfile` creates a profile only when `package.json` is absent; an existing manifest is loaded as-is | `profile.ts:704-721` |

The Claw meta bundle's `cordis.patch.yml` inserts nine rows (`dsh-claw-suite`, `-policy`, `-permissions`, `-observability`, `-identity`, `-memory`, `-gate`, `-delegate`, `-registry`, each `name === id`); `dsh-claw-core` is a library dependency without a row.

## Decision

1. The App has one formal entry, `createGovernedHost` (`apps/desktop/src/runtime/claw-runtime-check.ts`), used by `createAppRuntime` for the first start and every recovery. An existing profile prevents re-seeding only; it is re-validated each start and never repaired, re-seeded or installed online.
2. **Before spawn** (`verifyClawProfile`): the suite resolves through DSH's own anchor order at the locked version and is listed in `dsh.profile.bundles`; its declared bundle patches insert every Claw row unmodified; every component resolves from the suite at the locked version; neither the profile nor the home patch layer disables (`disabled`) or replaces (`name` different from `id`) a Claw row. A patch layer that cannot be parsed without errors or warnings (for example `!!js` expressions) is unverifiable and refused.
3. **After authentication**, bound to the child's lifetime with a 10 s bound: DSH did not report skipping the suite, and the Claw Registry answers `list` with a valid `revision`. No new health endpoint is invented.
4. Admission failures are terminal: the child is stopped, the lock released, and the Renderer receives `failed` with a closed `RuntimeErrorCode` (`claw_missing`, `claw_version_mismatch`, `claw_disabled`, `claw_check_failed`) and a fixed safe message. Only `host_unavailable` enters bounded recovery.
5. `createBootstrapHost` (`host-bootstrap.ts`) is a separately named, keyless basic-engine entry for `setup:runtime`, the package-time template build and `smoke:cold` only. Setup and the template must pass the governed admission after installing Claw. No environment variable or Renderer path reaches it, and there is no skip-governance switch; a unit test guards that `main.ts` and the startup control never import it.
6. PTC stays disabled; Claw policy and upstream DSH/Claw are unchanged.

## Consequences

- An old no-Claw Corn profile now fails with `claw_missing` and needs a manual profile repair (re-run `pnpm setup:runtime` in development). Profile migration remains out of scope.
- Evidence: `pnpm smoke:review` (real Host negatives and Electron cases), `pnpm smoke:packaged` (no-Claw rejection round) and the deterministic tests in `apps/desktop/tests/claw-admission.test.ts`; see [M0 evidence](../milestones/M0-EVIDENCE.md).
- A future DSH or Claw upgrade must re-verify the facts above at the new tag before bumping `runtime.lock.json`.
