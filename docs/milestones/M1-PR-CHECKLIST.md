# M1 product UI slice

M0 is accepted except signing and notarization ([ADR-0001](../adr/ADR-0001-dsh-transport.md), [M0 evidence](M0-EVIDENCE.md)). This is the file-level review checklist for M1. Scope follows plan §14 maintainer decisions; kit references follow [SPEC_MAPPING](../../design/grok-kit/SPEC_MAPPING.md).

| PR | Files | Reviewable behaviour |
| --- | --- | --- |
| 02A | `apps/renderer/package.json`, `vite.config.ts`, `src/main.tsx` | Independent React/TypeScript application with a deterministic build; no official DSH Workspace UI |
| 02A | `src/styles/tokens.css`, `layout.css`, `design/design-spec.md` | Single `user-screenshots` profile ([ADR-0004](../adr/ADR-0004-design-profiles.md)). Sidebar stays fixed; details take about 37% of **total** window width. Light theme with semantic tokens |
| 02A | `src/app/CornApp.tsx`, `CornShell.tsx`, `CompositionRoot.tsx`, `layout-state.ts` | Two/three-column transitions keep the selected Bot, composer draft and scroll state; manual sidebar collapse is stored separately from auto-compact |
| 02B | `src/features/roster/*`, `chat/*`, `details/*` | Roster, chat and the 详情/资料库/电脑 panes; narrow-window behaviour; empty/loading/error states |
| 02B | `src/features/chat/ApprovalCard.tsx` | Only DSH RC2 outcomes (allow once, deny, withdrawn/cancelled). "Always allow" is a link to the permission editor, not an answer |
| 02B | `src/features/settings/*`, `bot-editor/*`, `voice/*` | Explicit button contracts. Actions waiting for M2/M7 are disabled with a clear reason. Voice states are visible only under the development fixture route |
| 02B | `design/grok-kit/INTERACTION_COVERAGE.md`, `docs/milestones/M1-UI-KIT-COVERAGE.md` | All 83 kit checklist items recorded as covered / deferred / not-applicable / unknown |
| 02C | `apps/renderer/tests/visual/*`, `apps/renderer/tests/fixtures/*` | Region-based screenshot comparisons against both reference PNGs at fixed macOS/DPR/font/viewport, plus measured layout assertions |
| 02D | `packages/contracts/src/avatar.ts`, `packages/ui/src/avatar/*`, `packages/state/src/avatar-presentation.ts` | Corn-original avatar ([ADR-0003](../adr/ADR-0003-avatar-engine.md)); lifecycle, reduced-motion and unmount tests |
| all | `packages/contracts`, `apps/desktop/src/ipc/*` | Narrow typed methods, sender validation, credential-free view models; no raw Host endpoint or filesystem proxy |

M1 may use clearly labelled fixtures for visual states. Real creation/binding and persistent Bot/Conversation/Run transactions belong to M2. Fixtures must never report successful model calls, permissions or computer control.

Not in M1: task threads, group detail tabs, dark theme, and switchable `dmg-0681`/`website-demo` profiles. M2 groundwork that does not touch the Renderer (SQLite schema and migrations, session event reducer, Run state machine) may proceed in parallel, but is wired into the UI only after PR-02C merges.

## PR-02A evidence

| Check | Result |
| --- | --- |
| Calibration | References are DPR 2 at 1024×764 CSS px: sidebar 276, chat 372, details 376 (36.7% of total width), bubble text 13/19 px. Recorded in [design-spec](../../design/design-spec.md); the stale 1416 figures in the plan, ADR-0004 and SPEC_MAPPING are corrected |
| Static checks | `pnpm check` (Biome, typecheck for desktop and renderer, 31 tests including 5 `layout-state` tests) and `pnpm build` (desktop `tsc` plus Vite renderer) pass |
| Real window layout | `CORN_DESKTOP_SMOKE=1 pnpm dev:desktop` runs `smoke/layout-probe.ts`: sidebar 276, details ratio 0.3670, sidebar shift 0 px, draft kept after opening and closing details through the Bot pill. Writes `m1-layout-{two,three}-pane.png` to `.artifacts/` |
| Traffic lights | Native `trafficLightPosition` measured from a real window capture: red centre (17.7, 14.1) against the reference (17.9, 14.0) |
| Packaged app | `pnpm package:mac` copies `apps/renderer/dist` (without source maps); `pnpm smoke:packaged` now also asserts `layout.passed` and passes 3/3 rounds including Host recovery |
| Smoke exit code | Fixed a gap carried over from M0: `app.quit()` exited 0 even after a failed smoke, so CI's `dev:desktop` steps could pass silently. Cleanup now ends with `app.exit(process.exitCode)`, and smoke failures are printed with Host diagnostics redacted |
| Deferred to 02B/02C | Sidebar drag-resize and pointer cleanup, composer send/IME behaviour, approval card, 83-item coverage (02B); Playwright region diffs (02C); remaining roster vertical offsets of about 6 px are left to the 02C diff gate |
