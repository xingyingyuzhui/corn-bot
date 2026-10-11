# Kit specification to Corn mapping — draft

Draft produced by PR-00D. PR-02A/B/C/D fill in the "Evidence" column. Paths under `src/` mean `apps/renderer/src/`. Kit references are relative to the pinned checkout (see [SOURCE_LOCK](SOURCE_LOCK.md)). Every row is an independent Corn implementation; no kit code or asset is copied (see [RIGHTS_REVIEW](RIGHTS_REVIEW.md)).

Scope follows the maintainer decisions recorded in plan §14. Main points:

- `user-screenshots` is the only layout profile in M1 ([ADR-0004](../../docs/adr/ADR-0004-design-profiles.md)).
- Dark theme, group detail tabs, task threads and the `dmg-0681` profile are deferred.
- Voice states appear only in development fixtures.

## In scope for M1

| Kit source | Corn target | Task | Test (in `apps/renderer/tests/`) | PR | Evidence |
| --- | --- | --- | --- | --- | --- |
| User screenshots; `docs/website-comparison.md` | `src/app/CornShell.tsx`, `src/styles/layout.css` | Two-pane and three-pane layout calibrated to the screenshots: sidebar about 27% of window width; details about 37% of **total** width (calibrated in PR-02A: DPR 2, 1024×764 CSS px, 276 / 372 / 376; see [design-spec](../design-spec.md)). Opening details adds a third grid column without moving the sidebar | `visual/roster-two-pane.spec.ts`, `visual/details-three-pane.spec.ts`, `visual/resize.spec.ts` | 02A | Desktop smoke `layout-probe.ts`: sidebar 276, details ratio 0.3670, sidebar shift 0, draft kept; `tests/layout-state.test.ts`. Region diffs in 02C |
| `docs/ui-ux-spec.md` §2.1 (E01–E05, E58) | `src/app/layout-state.ts`, `src/features/roster/BotRoster.tsx` | Keep `preferredSidebarWidth`, `sidebarManualCollapsed` and `sidebarAutoCompact` separate. Narrowing the window must not overwrite the manual preference. Resize cleanup covers pointerup/cancel/lostpointercapture/blur/Esc. Constants other than the screenshot ratios carry `dmg-0681` source labels and are reviewed individually | `visual/resize.spec.ts` | 02A, 02B | 02A: manual collapse and auto-compact are separate fields. 02B: `sidebarPreferredWidth` 240–400 (default 276), 88px rail, drag thresholds 210/220, Esc restore and pointer cleanup in `features/roster/SidebarResizeHandle.tsx`; `tests/layout-state.test.ts` boundary tests at 699/700/701 and 823/824/825 |
| `docs/visual-system.md`, `docs/component-spec.md` §3 | `src/styles/tokens.css`, `src/styles/global.css`, `packages/ui/src/{Surface,Pill}.tsx` | Corn-owned light semantic variables measured from the screenshots, cross-checked against observed values (bubble radius 18px, agent and user fills, 140ms transitions). Variables are semantic so that a later dark theme only adds a mapping. Do not import `tokens/` or `assets/styles/` | `visual/kit-theme.spec.ts` (light only) | 02A | `src/styles/tokens.css` values measured in [design-spec](../design-spec.md). Shared primitives live in `apps/renderer/src/shared/` until a second consumer justifies `packages/ui` |
| `docs/component-spec.md` §1–§2, `src/composer.js`, `docs/integration.md` §4 | `src/features/chat/MessageComposer.tsx`, `src/features/chat/composer-actions.ts` | TypeScript rewrite: Enter sends; Shift+Enter, IME composition and open menus do not; key repeat does not resend; attachment-only messages may be sent; at most 6 attachments with recoverable overflow; a failed send keeps the draft; 28px action circle | `visual/kit-composer-ime.spec.ts` | 02B | Implemented as `features/chat/composer-model.ts` (not `composer-actions.ts`), `use-composer-send.ts`, and `model/draft.ts` (draft payload, send attempts, settling); `tests/composer-model.test.ts`, `tests/layout-state.test.ts` (per-Bot draft settling); browser double-click enqueues once |
| `docs/ui-ux-spec.md` §5 (E26–E33) | `src/features/chat/{MessageFeed,ApprovalCard,HandoffNotice,RunReceiptCard}.tsx` | Separate dimensions for delivery state (queued, dispatching, accepted, failed) and Bot activity. The approval card uses DSH RC2 outcomes only (see below) | `visual/kit-ui-states.spec.ts` | 02B | `DeliveryStatus.tsx`, `ApprovalCard.tsx`, `transcript-model.ts`; `RunReceiptCard` waits for M2 run data. `tests/transcript-model.test.ts`, `tests/transcript-ui-states.test.ts`, `tests/fixture-repository.test.ts` |
| `docs/ui-ux-spec.md` §1 (E56, single-Bot branch only) | `src/features/details/BotDetailsPane.tsx` | Bot tabs 详情 / 资料库 / 电脑. Selecting another Bot re-validates the active tab | `visual/kit-details-tabs.spec.ts` | 02B | Tabs unchanged from 02A; ⋯ menu opens profile, tags, model and permissions dialogs (`features/bot-editor/*`); `tests/details-editors.test.ts`, `tests/tag-editor.test.ts`, `tests/share-export.test.ts` |
| `docs/ui-ux-spec.md` §4.2 | `src/features/voice/{DictationButton,VoiceModeButton}.tsx`, `apps/renderer/tests/fixtures/kit-voice-states.ts` | activating / recording / processing / stop-in-flight / error are visible **only** under the development fixture route. The production UI keeps both buttons disabled with a reason until M7/M8 | `visual/voice-buttons.spec.ts`, `visual/kit-voice-states.spec.ts` | 02B | Implemented as `features/voice/{voice-model.ts,use-voice-fixture.ts,VoiceChip.tsx}` on the `#fixture=ui-states` dev route; `tests/composer-voice.test.ts` |
| `docs/ui-ux-spec.md` §6 (18 shortcuts) | `src/shared/hooks/useCornKeyboardShortcuts.ts`, `src/shared/accessibility/*` | Classify each shortcut as implemented, deferred or not-applicable in `INTERACTION_COVERAGE.md`. Global shortcuts respect focus scope and IME | `visual/keyboard-accessibility.spec.ts` | 02B | Implemented as `src/app/shortcuts.ts` and `use-shell-shortcuts.ts`. The kit table names 19 actions: 11 implemented, 6 deferred, 2 not applicable ([INTERACTION_COVERAGE](INTERACTION_COVERAGE.md#shortcut-registry)); `tests/shortcuts.test.ts` |
| `docs/replication-checklist.md` (83 items, A–I) | `design/grok-kit/INTERACTION_COVERAGE.md`, `docs/milestones/M1-UI-KIT-COVERAGE.md` | Record every item as covered / deferred / not-applicable / unknown with file, fixture and evidence. Items for deferred features are marked `deferred` with a reason | PR-02B review gate | 02B | All 83 recorded: 39 covered, 15 partial, 24 deferred, 5 not applicable, 0 unknown |
| User screenshots; region diffs | `apps/renderer/tests/visual/*` | Region-based Playwright comparisons (sidebar, chat, details, composer) at a fixed viewport, DPR, font and frozen clock | All of the above | 02C | — |
| `docs/avatar-animation.md`, `assets/avatar-motion/catalog.json` | `packages/ui/src/avatar/*`, `packages/contracts/src/avatar.ts`, `packages/state/src/avatar-presentation.ts`, `apps/renderer/tests/fixtures/kit-avatar-states.ts` | Corn-original motion avatar; see [ADR-0003](../../docs/adr/ADR-0003-avatar-engine.md) and the [behaviour mapping](AVATAR_BEHAVIOR_MAPPING.md) | `packages/ui/tests/avatar/*`, `visual/avatar-motion-{states,lifecycle,load}.spec.ts` | 02D | — |

### Approval outcomes

The kit lists approveOnce / deny / alwaysAllow / expired (E31). DSH RC2 answers approvals only with `allowed-once`, `rejected`, `cancelled` or `unavailable` (see [M0 API audit](../../docs/milestones/M0-API-AUDIT.md)). Corn therefore implements:

| Card action or state | DSH RC2 mapping |
| --- | --- |
| Allow once | answer `allowed-once` |
| Deny | answer `rejected` |
| Withdrawn / expired | Remote `cancel` frame, generation replacement or a late reply turned into a no-op → shown as `cancelled` |
| "Always allow" | Not an answer. A link opens the Bot permission editor, which changes Claw policy through its normal revision-checked path. The hard policy cap still applies |

## Deferred

| Kit area | Reason | Target |
| --- | --- | --- |
| Task thread pane, `taskId`, 847/848/849 content-width split (E06–E12) | Not in the target screenshots; Corn has no Task entity. `taskId` will reference `CornTaskRun` | M4/M5 |
| Group detail tabs (overview / media / members) | Groups arrive in M5 | M5 |
| Dark theme mapping | §4.3: light screenshots are the first gold standard | After M1 |
| `dmg-0681` and `website-demo` switchable profiles and their boundary tests | Maintainer decision; screenshots remain the only target | Revisit after M1 |
| Settings sections beyond 通用 / 模型 (§7), floating desktop panel (§8) | Not visible in the target screenshots. PR-02B builds the settings dialog with the general and models sections only | Later milestones |
