# M1 product UI slice — blocked on M0 acceptance

This is a file-level review checklist; it does not authorise skipping the remaining M0 gate. M1 starts once the transport ADR is accepted with the real model, cancellation and governance evidence required by plan v1.3. Scope follows plan §14 maintainer decisions; kit references follow [SPEC_MAPPING](../../design/grok-kit/SPEC_MAPPING.md).

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
