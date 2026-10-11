# Kit interaction coverage (PR-02B)

Every item of the kit's 83-item acceptance list (`docs/replication-checklist.md` at the pinned commit in [SOURCE_LOCK](SOURCE_LOCK.md), sections A–I) mapped to Corn code and evidence. The milestone summary and gate status are in [M1-UI-KIT-COVERAGE](../../docs/milestones/M1-UI-KIT-COVERAGE.md).

The kit list says what to verify; it is not evidence. A row is **covered** only when the cited Corn test or recorded check exercises it. Statuses:

- **covered**: the M1 behaviour is implemented and verified.
- **partial**: the M1 part is covered; the remainder is deferred, with its owner named.
- **deferred**: not in M1; the owning milestone is named.
- **not-applicable**: Corn deliberately has no such surface.
- **unknown**: not determined. None remain.

Paths are under `apps/renderer/` unless they start with `apps/desktop/` or `design/`. "Browser" means the Vite dev server at 1024×764 on `#fixture=ui-states`; "desktop smoke" means `CORN_DESKTOP_SMOKE=1` with `apps/desktop/src/smoke/layout-probe.ts`.

## A. Scope and provenance

| # | Kit item | Status | Corn implementation | Evidence / remainder |
| --- | --- | --- | --- | --- |
| A1 | Design reproduction and demo data are labelled; screenshots say which app they come from | covered | Chat header "示例数据，未连接真实 Bot"; `shared/BotOriginBadge` "示例" on created Bots in the roster rows, pinned cards, hidden list, chat header and details name | Browser; desktop smoke captures are `m1-layout-*.png` (Corn), references live in `design/references/` |
| A2 | Components and assets trace to source anchors; partial-coverage limits kept | covered | [SPEC_MAPPING](SPEC_MAPPING.md), [SOURCE_LOCK](SOURCE_LOCK.md), [RIGHTS_REVIEW](RIGHTS_REVIEW.md) | `scripts/verify-ui-kit-reference.mjs` byte-identity check reports no copied kit files |
| A3 | View model and adapter independent of the host bridge; runs in a plain browser | covered | `model/repository.ts` (`WorkspaceRepository`), `fixtures/fixture-repository.ts`, `app/workspace-context.tsx` | Renderer runs on the Vite dev server with no preload; `fixture-repository` tests |
| A4 | No real product account data; UI preferences in Corn's own namespace | covered | Fixture Bots and copy are Corn's own (`fixtures/m1-workspace.ts`) | M1 persists no UI preferences (no Web Storage use); the namespace is chosen when M2 persists them |
| A5 | Feature-gated options not shown as proven defaults; gate/platform fixtures exist | covered | `shared/unavailable.ts` reasons; voice states only behind `fixtures/routes.ts` dev route | `fixture-repository` "fixture routes are dev-only"; `transcript-ui-states` "default fixture keeps the reference view" |

## B. Shell, navigation and sidebar

| # | Kit item | Status | Corn implementation | Evidence / remainder |
| --- | --- | --- | --- | --- |
| B1 | Sidebar, chat, composer, details/thread and settings layers are independent | covered | `app/CornShell.tsx`, `app/OverlayHost.tsx`, `app/layout-state.ts` | `layout-state` tests (per-Bot draft/scroll/tab; one overlay at a time) |
| B2 | Search, new, select, pin/unpin, folds, hide/restore have events, distinct from delete | covered | `features/roster/*` (`RosterSearchField`, `HiddenBotsSection`, `use-bot-menu.ts`), repository `setPinned`/`setHidden` | `roster-order` tests; browser (pin, hide, restore, fold, search). No delete in M1 |
| B3 | Default 280, drag range 240–400, collapsed 88, CSS px | covered | `LAYOUT` in `app/layout-state.ts`, `RosterRail.tsx` | Default is 276 by screenshot calibration ([design-spec](../design-spec.md)), not the kit's 280; `layout-state` clamp test |
| B4 | Auto-compact when `windowWidth < expandedWidth + 424` | covered | `autoCompactFor` in `app/layout-state.ts` | `layout-state` boundary tests |
| B5 | Manual collapse separate from auto-compact; widening restores preference | covered | `sidebarCollapsed` vs `sidebarAutoCompact` | `layout-state` tests |
| B6 | Boundary widths for 280 and 400 | covered | as B4 | Tested at 699/700/701 (276 + 424) and 823/824/825 (400 + 424); the kit's 703–705 assume its 280 default |
| B7 | Drag below 210 collapses; 220 threshold from compact; no forced expand | covered | `resolveSidebarDrag` | `layout-state` drag tests; browser drag |
| B8 | pointerup / cancel / lostpointercapture / blur / Esc clean up cursor and user-select | covered | `features/roster/SidebarResizeHandle.tsx` | Browser with scripted pointer events; real OS pointer capture not exercised (PR-02C) |
| B9 | Sidebar animation .2s; reduced motion recorded separately | covered | `--corn-sidebar-duration: 200ms`; `prefers-reduced-motion` in `styles/layout.css` | Reduced motion is Corn's addition |
| B10 | Selected, unread, working/offline and focus styles distinct; compact rail labelled | covered | `BotListItem.tsx`, `RosterRail.tsx`, `roster.css` | Browser. Rail tooltips are native `title`, not styled |
| B11 | Account name display and edit separate; cancel/failure keep value | deferred | — | No account surface in M1; no milestone assigned |
| B12 | Selection stable across list updates; shortcuts use the order on screen | covered | `visibleBotOrder` in `roster-order.ts`, `use-shell-shortcuts.ts` | `roster-order` and `shortcuts` tests; browser Mod+1…9 after pin |

## C. Details pane and task threads

| # | Kit item | Status | Corn implementation | Evidence / remainder |
| --- | --- | --- | --- | --- |
| C1 | Details 320/min 280; single-Bot tabs overview/media/computer; group tabs | partial | `features/details/BotDetailsPane.tsx` (概览 / 配置 / 资料库, catalog in `details-navigation.ts`) | Width follows the `user-screenshots` profile (0.367 of total width, desktop smoke) instead of 320. 02E-1 replaces 电脑 with a read-only 本机操作 section under 配置 → 权限; the M3 computer view is not built. `details-navigation`, `management-panel` and `unsaved-config-guard` tests; browser (arrow keys, focus return, 720×520 overlay). Configuration subpages and the profile dialog lock their fields while saving and leave only once the current draft is stored (round-2 F2; `bot-editor-controller` / `unsaved-config-guard` regressions, browser and trusted-keyboard check at 720×520). Group and members-only tabs: M5 |
| C2 | Opening details keeps the chat minimum; no unreachable controls or overflow when narrow | covered | `resolveLayout` overlay mode | `layout-state` overlay test; desktop smoke |
| C3 | Task thread has its own taskId/reply context; replies never reach the main chat | deferred | — | Task threads are out of M1 (plan §14 decision 3); M4/M5 with `CornTaskRun` |
| C4 | Side-by-side opt-in defaults to false | deferred | — | As C3 |
| C5 | Measure main content width 847/848/849, not viewport | deferred | — | As C3 |
| C6 | Same viewport with sidebar/details toggled; content width decides | deferred | — | As C3 |
| C7 | Thread width formula at A = 848 / 1000 / preferred 650 | deferred | — | As C3 |
| C8 | Preferred width constrained; NaN/Infinity/0/negatives filtered | deferred | — | As C3 |
| C9 | Width saved on drag end, restored on reopen; RTL delta | deferred | — | As C3 |
| C10 | Thread separator role, label, orientation | deferred | — | As C3. The sidebar separator already has `role="separator"`, `aria-orientation` and keyboard resizing (B8) |

## D. Input, attachments and sending

| # | Kit item | Status | Corn implementation | Evidence / remainder |
| --- | --- | --- | --- | --- |
| D1 | Multiline textbox with accessible label and clear focus | covered | `features/chat/MessageComposer.tsx` (`#corn-composer-field`) | Browser |
| D2 | Enter submits; Shift+Enter newline; IME Enter never sends; held Enter never repeats | covered | `shouldSubmit` in `composer-model.ts` | `composer-model` tests |
| D3 | Open menu owns Enter/Tab/Esc/arrows | deferred | `shouldSubmit` accepts `menuOpen` | The composer has no menu in M1; no milestone assigned |
| D4 | Esc cancels reply; otherwise blurs; cancels voice and refocuses | partial | `MessageComposer.tsx` | Blur and voice cancel covered (browser, `composer-voice`); no reply target in M1 |
| D5 | Prompt and rich text stored separately; draft/edit/cancel never overwrite each other | not-applicable | Plain-text drafts per Bot (`ComposerDraft`) | Corn's composer has no rich text |
| D6 | Six-attachment cap incl. 6th/7th, multi-add, 5 + 3; clear overflow feedback | covered | `stageAttachments` in `composer-model.ts`, `AttachmentChips.tsx` | `composer-model` tests; browser 5 + 3 case |
| D7 | Pasted files staged; multiline text kept; mixed clipboard neither drops nor duplicates | covered | `pastePlan` in `composer-model.ts` | `composer-model` tests |
| D8 | No invented file limits; sizes/types come from the adapter | deferred | Chips say "未上传" | Upload limits arrive with the M2 adapter |
| D9 | Voice action without payload, send arrow with payload; disabled when it cannot send | covered | `composerAction` | `composer-model` tests; browser |
| D10 | Paused/access/rebuild locks block sending and keep draft and attachments | partial | `blockedReason` for loading/error; read-only field | Browser on `ui-states` (news, excel, cad Bots). Runtime locks arrive with M2 |
| D11 | replyTarget and taskId travel with submit; submit is not a bare string | partial | `sendMessage({ botId, clientId, text, attachments })` | Structured submit covered; replyTarget/taskId arrive with task threads (C3) |
| D12 | Cancel queued vs non-cancellable dispatching; resend without double enqueue | covered | `DeliveryStatus.tsx`, `use-composer-send.ts`, repository `cancelQueued`/`resend` | `fixture-repository` and `transcript-model` tests; browser double click enqueued once |
| D13 | Offline shows waiting / send after reconnect, never "done"; same-id echo on reconnect | partial | Queued line "等待连接 Bot 后发送" | `fixture-repository` "never marked delivered". Echo confirmation by id arrives with M2 |

## E. Voice and calls

| # | Kit item | Status | Corn implementation | Evidence / remainder |
| --- | --- | --- | --- | --- |
| E1 | Dictation, voice memo and live call are distinct intents | covered | Separate dictation and live-voice buttons with separate reasons | Browser. Real dictation is M7; live voice is planned after M8; voice memo is not planned |
| E2 | activating / recording / processing / stop-in-flight / error fixtures | covered | `features/voice/voice-model.ts`, `VoiceChip.tsx` (dev route) | `composer-voice` tests; browser |
| E3 | Repeated clicks never start a second task | covered | `voice-model.ts` | `composer-voice` "repeated starts or stops" |
| E4 | Permission / no-mic / transcription errors visible; recovery keeps input | covered | Dev-route error scenarios | `composer-voice` "errors are recoverable"; browser. Playback error does not apply |
| E5 | No claim that real audio was recorded | covered | Completion notice says no microphone was used and no text produced | Browser |
| E6 | Switching Bot/thread never inserts text into the wrong conversation | covered | `use-voice-fixture.ts` resets per Bot | `composer-voice` "switching Bot resets any task" |

## F. Transcript and status cards

| # | Kit item | Status | Corn implementation | Evidence / remainder |
| --- | --- | --- | --- | --- |
| F1 | One fixture each for text, rich text, attachment, notice, form, approval, tool placeholder | partial | `fixtures/ui-states.ts`: text, attachment, notice, approval, handoff | `transcript-ui-states` tests. Rich text, forms and tool widgets are not in the M1 model; they come from run events and state cards (M2/M4) |
| F2 | loading / error / savedSnapshot / readOnly render separately; readOnly cannot send | partial | `ChatPane.tsx`, `MessageFeed.tsx` | `transcript-ui-states` "read-only, loading and error". savedSnapshot needs persisted conversations (M2) |
| F3 | Message delivery is a different dimension from Bot typing/working/offline | covered | `FeedItem.delivery` vs `BotView.activity` | `transcript-model` "accepted is not presented as a Bot reply" |
| F4 | Approval pending / submitting / settled states | covered | `features/chat/ApprovalCard.tsx` | `transcript-model` RC2 outcome test; browser. Outcomes are RC2's allowed-once / rejected / cancelled; "始终允许…" opens the permissions editor |
| F5 | Stale response settles as expired; failed submit restores; no fake success | covered | Repository `answerApproval` with `staleRequestIds` | `fixture-repository` "approvals settle once"; browser `req-2` shows "请求已失效" |
| F6 | Failed "always" save never claims a permanent allow | not-applicable | "Always" is not an approval answer in Corn | Permission writes arrive with the M2 permissions editor |
| F7 | Publish/connector/permission cards have their own state definitions | not-applicable | Approval is the only card type in M1 | Connector cards arrive with M7 |
| F8 | Copy/reply/jump/thread/more actions return focus clearly | partial | Copy in `MessageBubble.tsx`; focus stays on the button | Reply/jump/thread arrive with task threads (C3) |
| F9 | New messages never drag a reader to the bottom; unread divider and jump button | partial | `MessageFeed.tsx` follow logic and "回到最新" | `transcript-model` "only moves a reader who is pinned or who just sent". Unread divider: no milestone assigned |
| F10 | Stable entry ids across refresh/switch/restore | covered | Feed keyed by entry id | `transcript-ui-states`; per-Bot scroll in `layout-state` tests |

## G. Shortcuts and focus

| # | Kit item | Status | Corn implementation | Evidence / remainder |
| --- | --- | --- | --- | --- |
| G1 | Mod is Command on Mac, Ctrl elsewhere; browser conflicts recorded | covered | `platformOf`, `matchShortcut` in `app/shortcuts.ts` | `shortcuts` tests; conflicts in the table below |
| G2 | Mod+K, Mod+Shift+F, Mod+F, Mod+I, Mod+B | partial | Mod+Shift+F, Mod+I, Mod+B | `shortcuts` tests; browser. Mod+K (command menu) and Mod+F (find in chat) deferred, no milestone assigned |
| G3 | Mod+, settings, Mod+Shift+, Bot settings, Mod+Enter send; no-ops when unavailable | covered | `use-shell-shortcuts.ts` (Mod+Shift+, opens 配置 → 核心设定 for the current Bot); Mod+Enter in the composer | `shortcuts` and `layout-state` tests |
| G4 | Alt+↑/↓, Mod+[ / ], Mod+1…9 | partial | Alt+↑/↓ (no wrap), Mod+1…9 | `shortcuts` and `roster-order` tests. Mod+[ / ] need navigation history, no milestone assigned |
| G5 | Mod+L, Mod+Shift+M, Mod+Shift+W, Mod+Alt+B if in scope | partial | Mod+Alt+B (plus Mod+Shift+I on Mac) toggles details | Mod+L deferred (quote selection, no milestone assigned); Mod+Shift+M/W not applicable (no tools/skills panes; Claw covers governance) |
| G6 | Mod+N means new Bot | covered | Opens `CreateBotDialog` | `shortcuts` tests; browser |
| G7 | Ctrl+Tab cycle cursor with release confirm | deferred | — | Needs a hold-Ctrl overlay; no milestone assigned |
| G8 | Global shortcuts respect focus scope during dialogs/menus/IME/locks; Esc closes the nearest context | covered | `shouldRunShortcut`; details Esc ignores menu-origin events | `shortcuts` focus-scope tests; browser (Alt+↓ ignored with a dialog open; Esc in menu keeps details open) |
| G9 | Tab reaches sidebar, composer, menus, settings and back; inert areas never take focus | covered | Native `<dialog>` modality, `Menu` focus return | Browser. Hidden per-message copy buttons are tab stops (noted for PR-02C) |

### Shortcut registry

The kit's shortcut table has 16 rows naming 19 actions; `app/shortcuts.ts` registers all 19.

| Shortcut | Status | Notes |
| --- | --- | --- |
| Mod+K | deferred | No command menu in M1 |
| Mod+Shift+F | implemented | Opens and focuses Bot search, expanding the roster first |
| Mod+N | implemented | Create Bot (local sample) |
| Mod+Enter | implemented | Handled by the composer; the global listener ignores it |
| Mod+I | implemented | Focuses `#corn-composer-field` |
| Mod+F | deferred | No in-chat find; the key is not intercepted |
| Mod+B | implemented | Same preference as "显示名册" |
| Mod+, | implemented | Settings, general section |
| Mod+Shift+, | implemented | Current Bot's profile |
| Alt+↑ / Alt+↓ | implemented | Visible order, no wrap |
| Mod+[ / Mod+] | deferred | No navigation history |
| Mod+1…9 | implemented | Pinned first, then unfolded groups; hidden and folded Bots skipped |
| Mod+L | deferred | Composer cannot quote a selection yet |
| Mod+Shift+M / Mod+Shift+W | not-applicable | No tools/skills panes |
| Mod+Alt+B (Mod+Shift+I on Mac) | implemented | Toggles details |
| Ctrl+Tab / Ctrl+Shift+Tab | deferred | Needs a hold-Ctrl cycle overlay |

In a plain browser, Mod+N, Mod+1…9, Mod+L and Ctrl+Tab are taken by the browser; the Electron window receives them.

## H. Settings, theme and language

| # | Kit item | Status | Corn implementation | Evidence / remainder |
| --- | --- | --- | --- | --- |
| H1 | Four sections: general / computer / usage / updates | partial | 通用 and 模型 (`features/settings/SettingsDialog.tsx`) | M1 scope is general + models. Computer: M3; updates: M8; usage: no milestone assigned |
| H2 | Rows separate value / pending / failure / policy-disabled; failure keeps value with retry | covered | `SettingsRow.tsx`, `save-state.ts` | `settings` tests. A save failure cannot be triggered from the M1 UI; unit-tested only |
| H3 | System / light / dark with sync across surfaces | partial | All three shown; 系统 and 深色 explain why they are unavailable | Light only in M1; dark theme is out of M1 (checklist "Not in M1") |
| H4 | Bot colour setting is gated | not-applicable | — | Corn has no Bot colour setting |
| H5 | Searchable, closable language picker; translated placeholders and labels | deferred | Only 简体中文 available, others give a reason | Localisation after M1; no milestone assigned |
| H6 | Resolved-language change reloads or switches live without losing drafts | deferred | — | As H5 |
| H7 | Notification switch separate from the sound picker | deferred | Switch shown unavailable with its reason | Notifications arrive with M2 run status; no sound picker planned |
| H8 | Thread side-by-side opt-in; spellcheck and auto-review rules if in scope | not-applicable | — | Threads deferred (C3); Corn has no spellcheck or auto-review settings |
| H9 | Admin/policy, unsupported platform and ordinary failures shown differently | partial | Unavailable (reason) vs failure (retry) are distinct row states | `settings` tests. No policy source until M2 |

## I. Desktop floating panel

Corn has no floating desktop panel in M1; SPEC_MAPPING assigns it to a later milestone. No milestone owns it yet.

| # | Kit item | Status |
| --- | --- | --- |
| I1 | Hidden when unmounted; composer inert; current Bot updates mark/name/placeholder | deferred |
| I2 | Trigger expands and focuses; Esc collapses and returns focus; blur collapses only when empty | deferred |
| I3 | Right-click Bot menu with `menuitemradio`; selecting the current Bot does not switch | deferred |
| I4 | Menu arrow loop, Home/End, Esc/Tab, outside click and blur close | deferred |
| I5 | Drag threshold 4 px; drag never triggers the expand click | deferred |
| I6 | Enter sends; empty trimmed text never sends; no repeat submit while disabled | deferred |
| I7 | Success clears and collapses; failure keeps text; controls recover | deferred |
| I8 | Textarea 44–140 px with expanded data attribute; long text scrolls | deferred |
| I9 | Web build declares an in-page demo, not a real OS window | deferred |

The shared `Menu` (`shared/Menu.tsx`) already implements I4's keyboard contract (arrow loop, Home/End, Tab closes, focus return) for the roster and details menus.
