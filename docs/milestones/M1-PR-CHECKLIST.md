# M1 product UI slice

M0 is accepted except signing and notarization ([ADR-0001](../adr/ADR-0001-dsh-transport.md), [M0 evidence](M0-EVIDENCE.md)). Review findings R1–R3 are closed with evidence; every App start passes the formal Claw admission ([ADR-0006](../adr/ADR-0006-claw-admission.md)). This is the file-level review checklist for M1. Scope follows plan §14 maintainer decisions; kit references follow [SPEC_MAPPING](../../design/grok-kit/SPEC_MAPPING.md).

| PR | Files | Reviewable behaviour |
| --- | --- | --- |
| 02A | `apps/renderer/package.json`, `vite.config.ts`, `src/main.tsx` | Independent React/TypeScript application with a deterministic build; no official DSH Workspace UI |
| 02A | `src/styles/tokens.css`, `layout.css`, `design/design-spec.md` | Single `user-screenshots` profile ([ADR-0004](../adr/ADR-0004-design-profiles.md)). Sidebar stays fixed; details take about 37% of **total** window width. Light theme with semantic tokens |
| 02A | `src/app/CornApp.tsx`, `CornShell.tsx`, `CompositionRoot.tsx`, `layout-state.ts` | Two/three-column transitions keep the selected Bot, composer draft and scroll state; manual sidebar collapse is stored separately from auto-compact |
| 02B | `src/features/roster/*`, `chat/*`, `details/*` | Roster, chat and the 详情/资料库/电脑 panes; narrow-window behaviour; empty/loading/error states |
| 02B | `src/features/chat/ApprovalCard.tsx` | Only DSH RC2 outcomes (allow once, deny, withdrawn/cancelled). "Always allow" is a link to the permission editor, not an answer |
| 02B | `src/features/settings/*`, `bot-editor/*`, `voice/*` | Explicit button contracts. Actions waiting for M2/M7 are disabled with a clear reason. Voice states are visible only under the development fixture route |
| 02B | `design/grok-kit/INTERACTION_COVERAGE.md`, `docs/milestones/M1-UI-KIT-COVERAGE.md` | All 83 kit checklist items recorded as covered / deferred / not-applicable / unknown |
| 02C | `apps/renderer/tests/visual/*`, `apps/renderer/tests/fixtures/*` | Region-based screenshot comparisons against both reference PNGs at fixed macOS/DPR/font/viewport, plus measured layout assertions. Accepted visual-baseline deviation: the fixed status strip above the composer (review fix U1) is absent from the references and must stay visible; the diff masks or rebaselines that band instead of hiding the strip |
| 02D-1 | `packages/contracts/src/avatar.ts`, `packages/ui/src/avatar/*`, renderer `shared/Avatar.tsx` and its usage sites, `design/corn-assets/*` | Import and lock the 16-role/9-shape Corn-original asset family; one static avatar contract across roster/header/details/editor/handoff, stable variants, uploaded-image preservation and old placeholder fallback ([asset integration plan](../plans/CORN_AVATAR_ASSET_INTEGRATION_PLAN.md)) |
| 02D-1 | `apps/desktop/assets/app-icon-source.png`, `scripts/generate-app-icons.mjs` (writes the gitignored `.build/icons/Corn Bot.icns`), builder/package configuration | v3 flat corn icon with `/` eyes; reproducible iconset/ICNS, no external design-folder build dependency; inspect the new packaged App in Finder, Dock and App switcher |
| 02D-2 | `packages/ui/src/avatar/*`, `packages/state/src/avatar-presentation.ts`, avatar fixtures and tests | Original 18-state motion ([ADR-0003](../adr/ADR-0003-avatar-engine.md)); shared scheduling, unique SVG IDs, StrictMode/lifecycle/reduced-motion, regional visuals and 20+ Bot load evidence. Real-event wiring remains M2/03A |
| 02E-1 | `src/features/details/*`, `bot-editor/{bot-editor-controller,editor-specs,use-bot-editor}.ts`, `src/app/layout-state.ts` | Fixture only. Bot management pane navigation (概览 / 配置 / 资料库) and shared embeddable editors with a single write path; unsaved-config guard; per-Bot restore. Avatar integration and joint acceptance wait for 02D-1 |
| all | `packages/contracts`, `apps/desktop/src/ipc/*` | Narrow typed methods, sender validation, credential-free view models; no raw Host endpoint or filesystem proxy |

M1 may use clearly labelled fixtures for visual states. Real creation/binding and persistent Bot/Conversation/Run transactions belong to M2. Fixtures must never report successful model calls, permissions or computer control.

## PR-02D plan

The source kit at `/Users/qin/DSH/Corn Bot/design-assets/corn-avatar-kit-v1` has been generated and independently checked (9 tests). PR-02D-1 migrated it into the repository (see the evidence below); no build step reads the kit folder. Main plan §15 and the [asset integration plan](../plans/CORN_AVATAR_ASSET_INTEGRATION_PLAN.md) record the selected files and SHA-256 values.

- [x] Review/merge #7 first; then branch runtime R1–R3, U1 and 02D-1 from main in parallel. Require finding closure at milestone sign-off, not before avatar implementation begins; continue the 02C gates.
- [x] Lock and migrate the original 16 variants, 9 shapes and 18 states into repository-owned code/assets; use `/` capsule eyes and the corrected v3 App icon.
- [x] Store variantId explicitly; configure existing fixture variants, choose new Bot defaults by stable ID hash from the non-xiaohuang 15 variants and preserve initials/hue for old/unknown variants. Add the 16-choice picker; leave upload disabled until M2 with the corrected explanation.
- [x] Adapt the current AvatarSpec and all Bot avatar usage sites to one component, preserving dimensions, user/account images and valid fallbacks.
- [x] Normalize the locked source onto a transparent 1024 canvas with recorded inset parameters and generate iconset/ICNS. Source and derived hashes remain distinct.
- [ ] Human check: inspect a fresh packaged `.app` in Finder, Dock and App switcher (icon size against neighbouring Apps, edge alpha, absence of a drop shadow).
- [ ] Integrate React motion/static/uploaded renderers and shared scheduler; prove stable state updates, independent SVG IDs and lifecycle cleanup.
- [ ] Include new package tests in root checks, then collect fixed-clock visual, reduced-motion, StrictMode and load evidence; re-run packaged smoke for the new build. (02D-1 already runs the contract and UI package tests in root `pnpm test`.)
- [x] Record intentional avatar-region baseline changes and remaining/manual checks in design-spec and M1 evidence before sign-off.

The five group avatars are retained as design assets; deferred group product features remain deferred. Real Run/Session/Gate-driven animations are accepted separately in M2/PR-03A.

These planning changes belong in the first commit on the post-#7 02D-1 branch, not in #7. Runtime smoke entry points and U1 announcement deduplication are specified in asset integration plan §7.

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

## PR-02B evidence

| Check | Result |
| --- | --- |
| Scope | Roster interactions (search, pin, fold, hide/restore, context menus, create Bot, connect apps), sidebar resize with an 88px rail, 19-action shortcut registry, composer send/attachments/IME, delivery lines, approval card, dev-route voice states, details ⋯ menu with profile/tags/model/permissions/share-export dialogs, settings (通用 / 模型) |
| Write path | Renderer writes go only through `WorkspaceRepository`; M1 uses the labelled in-memory `FixtureWorkspaceRepository`. Sends stay queued and are idempotent per client id, approvals settle once with RC2 outcomes only, Bot edits are revision-checked |
| Static checks | `pnpm check` (Biome, typecheck, 140 tests) and `pnpm build` pass |
| Real window layout | Desktop smoke unchanged from 02A after the merge: sidebar 276, chat 372, details 376, ratio 0.3670, shift 0, draft kept. The probe now clears pointer hover before capturing |
| Crash and packaged smoke | Crash smoke recovers the Host and the renderer shows `recovering`. `pnpm package:mac && pnpm smoke:packaged` passes 3/3 rounds including automatic Host recovery, and `~/.dsh` is untouched |
| Dev fixture route | `#fixture=ui-states` renders on the Vite dev server: `vite.config.ts` relaxes the CSP for `vite serve` only, and the production `dist/index.html` keeps `script-src 'self'; style-src 'self'; connect-src 'none'` |
| Live checks | On the dev route: a send switched away from mid-flight still clears the sending Bot's draft and queues once; settings dialog, approval cards (pending and stale), failed/queued/dispatching lines and voice error states checked by eye |
| Kit coverage | [M1-UI-KIT-COVERAGE](M1-UI-KIT-COVERAGE.md): 83 of 83 recorded (39 covered, 15 partial, 24 deferred, 5 not applicable, 0 unknown) |
| Review fixes | Branch review: a create that settles after its dialog closed no longer selects the Bot; dialog initial focus works after `showModal()`; a drag that ends on the backdrop no longer closes a dialog; Esc/×/取消 are blocked while a save is in flight; search no longer steals focus on remount; the restricted export also redacts quoted keys, `Basic` credentials and paths with spaces; created Bots start with no permissions; fixture writes re-check after the simulated wait; avatar initials are whole code points; menu triggers toggle via `popoverTarget`; the 示例 badge also shows in the chat header and details. Structure: draft logic moved to `model/draft.ts`, model summaries to `model/models.ts`, all unavailable reasons to `shared/unavailable.ts`, plus a shared copy hook and name helpers. Each behaviour fix has a regression test or was checked in the browser. A second review pass then fixed reopened-search focus, a repeated Escape closing a busy dialog natively, focus loss after a busy save, redaction over-matching (`Basic configuration`, `读/写` after a path) and remaining leaks (quoted values with spaces, `DB_PASSWORD=`, lowercase `basic`), and switched name length and initials to grapheme clusters |
| Design deviations | The details ⋯ button and, since review fix U1, the fixed status strip are the intentional additions to the reference view ([design-spec](../../design/design-spec.md)) |
| Left for 02C | Region screenshot diffs; real OS pointer capture for the resize drag; hidden per-message copy buttons are tab stops |

## Review fix U1: sample marker and runtime status stay visible

| Check | Result |
| --- | --- |
| Finding | "示例数据，未连接真实 Bot" and the runtime status were the first line of the feed's scrolling content, so they scrolled out of view |
| Change | Both facts moved out of `MessageFeed` into a normal-flow strip between the feed and the composer (`chat/RuntimeNotice.tsx`). The fixture check uses `repository.label`. The runtime wording covers starting, ready, recovering, failed, and status unavailable; ready describes the Host only. One polite, atomic live region at the composition root (`app/RuntimeAnnouncer.tsx`) announces changes. Dedupe compares with the previous `(status, safe error code)` only, so failed → recovering → failed announces the failure again. The existing 1 s polling is unchanged. Safe Main error codes plug into `errorCodeText` in `app/runtime-notice.ts` once the runtime contract defines them |
| Negative regression | The extended layout probe was committed first and run against the unfixed renderer. The smoke exited 1 with `layout.passed: false`; at feed bottom the marker was outside the visible chat pane, clipped by the feed's scroll container and covered |
| Unit | `apps/renderer/tests/runtime-notice.test.ts`: key and wording per state, no raw Main text, a pending reading is never announced, polling stays silent, adjacent-only dedupe, bridge unavailable as its own key, source-change announcements, dev-only runtime fixtures |
| Real window | `CORN_DESKTOP_SMOKE=1`: eight strip scenarios pass (two-pane with the feed at the bottom and top, three-pane, other Bot, roster collapsed, 720×520 overlay, 720×520 closed, back on the first Bot) with no announcer mutations; sidebar 276, chat 372, details 376, ratio 0.3670, shift 0, draft kept across the Bot switch. The crash smoke shows `recovering` in the strip with the same geometry checks |
| Browser | Vite dev server, `#fixture=ui-states&runtime=<state>` (dev only): the same geometry check passes at 1024×764 two-pane and three-pane, after switching Bot, with the roster collapsed, and at 720×520 closed and overlay. Editing the hash failed → recovering → failed → failed announces exactly twice. Approval results, delivery lines and handoff render next to the visible marker |
| `main.ts` | Three lines inside the crash smoke self-check call `probeRecoveringNotice` and require it to pass |

## PR-02D-1 evidence

| Check | Result |
| --- | --- |
| Scope | `packages/contracts/src/avatar.ts` (18 states, 9 shapes, 16 variant ids, preference with `variantId`), a real `packages/ui` package (`artwork.ts`, `variants.ts`, `StaticAvatar`, `BotAvatar`), `shared/Avatar.tsx` as a thin adapter, a 16-role picker in the create and profile dialogs, and the macOS App icon pipeline. No motion controller, gallery or samples |
| Provenance | [`ASSET_LOCK.json`](../../design/corn-assets/ASSET_LOCK.json) and [`PROVENANCE.md`](../../design/corn-assets/PROVENANCE.md). The 16 static and 5 group SVGs, `catalog.json` and the App icon source are byte-identical to the kit. `artwork.ts` and `variants.ts` are adaptations with their own hashes; a test proves that serialising the element tree reproduces all 21 SVGs byte for byte |
| Identity | Fixture Bots store `variantId` equal to their role id. Created Bots get FNV-1a(id) mod 15 over the non-小黄 roles (`mock-1` → news, `mock-2` → word, `mock-3` → cad) and can change it. Unknown or missing ids, and the account avatar, render the initial + hue placeholder (unit tested) |
| Static checks | `pnpm check` (Biome, typecheck for desktop, `packages/ui` and renderer, 167 tests) and `pnpm build` pass |
| Browser checks | Vite dev server: every slot measured at its reference size (rows 32, rail 36, hidden 24, pinned 52, header 24, details 60, profile 48, handoff 14, account 30 as an initial). Three 小黄 instances have distinct SVG ids, and compact sizes have none. Create picker driven by trusted keyboard input (Tab into the group, arrow keys move and select, visible focus ring, Shift+Tab leaves), profile picker change propagates to the pinned card, header and details, and `#fixture=ui-states` renders |
| Real window layout | Electron smoke with an isolated DSH home and no model env: `layout.passed`, sidebar 276, chat 372.2, details 375.8, ratio 0.3670, shift 0, draft kept |
| App icon | `pnpm package:mac` runs `scripts/generate-app-icons.mjs`: verifies the source SHA (`4b783687…4d2942`), scales the 1254 px tile to 824 px on a transparent 1024 canvas (body bbox 100–924, Apple's grid) without a second mask, then builds the 16–512 pt @1x/@2x iconset and `Corn Bot.icns` with `sips` + `iconutil`. Output is reproducible (identical hashes across runs) and gitignored under `.build/icons`. The packaged `.app` has `Contents/Resources/icon.icns`, byte-identical to the generated file, and `CFBundleIconFile` = `icon.icns`. Unpackaged runs set the same icon on the Dock |
| Packaged smoke | `pnpm package:mac && pnpm smoke:packaged` passes 3/3 rounds including automatic Host recovery; `~/.dsh` untouched |
| Open | Finder / Dock / App switcher inspection by a human. The source tile keeps its generator alpha (247–253) and has no drop shadow; judge both by eye there |

## PR-02E-1 evidence

Fixture only. Avatar integration and the joint acceptance with 02D-1 come after PR #9 merges; this PR keeps the `shared/Avatar.tsx` placeholder.

| Check | Result |
| --- | --- |
| Scope | Details tabs 概览 / 配置 / 资料库 as an ARIA tablist (←/→/Home/End). 配置 has entry rows for 核心设定 / 模型 / 权限 / 技能 that open subpages with 返回配置; 资料库 has 资料 / 记忆. The 电脑 tab is removed; no M3 computer UI. ⋯ 编辑资料 / 模型 / 权限, the Bot-settings shortcut and the approval card's 权限设置 link open the current Bot's subpage |
| Navigation | One catalog (`features/details/details-navigation.ts`) drives labels, keys and restore. Old stored values map `details→overview`, `library→library/artifacts`, `computer→configuration/permissions`; unknown values fall back to 概览 and invalid subpages to the 配置 home. Tab, subpage, section and pane scroll are kept per Bot in `layout-state.ts` |
| Write path | `BotProfileDialog` and the 核心设定 / 模型 subpages share one `BotEditorController` per spec (`editor-specs.ts`), writing only through `WorkspaceRepository` with revision checks. Dialog `busy`, conflict handling, `nameLengthError` and the unavailable reasons are kept. Results are pinned to the Bot that started them and ignored once the editor detaches |
| Unsaved guard | Leaving a dirty subpage (tab, Bot, back, close, created Bot) asks 保存 / 放弃 / 取消 in the reducer. A failed save keeps the draft and does not switch; 取消 stays. No config draft is kept across Bots; chat drafts are unchanged |
| Honest states | Identity documents, skills, artifacts, memory, routines and the Bot workspace show 尚未接通 (or loading / empty / error on `#fixture=ui-states`); permissions are read-only; global memory settings are not shown as a Bot setting. 概览 copies only the Corn Bot ID; the Claw Agent ID is labelled separately and empty until bound |
| Static checks | `pnpm check` (Biome, typecheck, 171 tests including `details-navigation`, `management-panel`, `unsaved-config-guard`, `bot-editor-controller`) and `pnpm build` pass |
| Browser checks | Vite dev server at 1024×764: arrow keys move tab focus and selection; opening a subpage focuses its heading and 返回配置 returns focus to the entry; a dirty 模型 draft asks before switching Bot (取消 stays, 保存 saves then switches); each Bot reopens on its last subpage. At 720×520 the pane is a 320 px overlay with no horizontal overflow and Escape closes it |
| Not done | Electron layout smoke was not rerun for this PR; avatar integration and the 02D-1 joint acceptance; refresh actions for sections that have no data source yet; 02E-2 visual baselines |
