# Corn design spec: `user-screenshots` profile

The layout and visual language target for M1 is the pair of reference screenshots in [`references/`](references/) ([ADR-0004](../docs/adr/ADR-0004-design-profiles.md)). User-approved content changes are recorded below, separately from measured geometry. This file records how the references were measured and where each measurement lives in code. The tokens themselves are in `apps/renderer/src/styles/tokens.css`. If you change a value there, update the matching row here.

## Calibration

The PNGs are 2048×1528 at DPR 2. The macOS traffic lights sit 20 px apart in the image, which is the native 20 pt spacing at 2×. That makes the window **1024×764 CSS px** (the earlier 1416 figure in `SPEC_MAPPING.md` was wrong). All the numbers below are CSS px measured from the PNGs with PIL.

| Region | Two-pane | Three-pane | Rule in code |
| --- | --- | --- | --- |
| Sidebar | 0–276 | 0–276 | Default 276 (`LAYOUT.sidebarWidth`). Opening details never moves it. Users can drag or arrow-key the separator between 240 and 400, and it collapses to an 88 px rail |
| Chat | 276–1024 (748) | 276–648 (372) | Takes the remaining width; collapses to an overlay below `chatMinWidth` |
| Details | — | 648–1024 (376) | `--corn-details-ratio: 0.367` of the **total** window width, not the remaining width. The grid track is `auto` and the pane sets its own `inline-size`, so window resizes don't replay the sidebar transition |

The two ratios differ: details are 36.7 % of the total width, but 50.3 % of the 748 px left after the sidebar. Anything that resizes the window has to keep the total-width rule. `layout-state.ts` (`resolveLayout`) owns the breakpoints; the CSS only reads the resulting `data-sidebar` and `data-details` attributes.

The sidebar auto-compacts to the rail when the window is narrower than its preferred width plus 424 px (700 px at the default). That is the kit's rule (E02) with Corn's 276 default instead of the kit's 280. A manual collapse is stored separately, so widening the window restores the user's choice.

The native traffic lights are placed with `trafficLightPosition: { x: 11, y: 12 }`, which puts the red light's centre at (17.7, 14.1), against (17.9, 14.0) in the reference. `webContents.capturePage` does not include them, so this check uses a `screencapture` of the real window.

## Colour

| Token | Value | Measured at |
| --- | --- | --- |
| `--corn-surface-page` | `#fcfcfc` | Chat background |
| `--corn-surface-sidebar` | `#f7f7f7` | Roster background |
| `--corn-surface-pinned` | `#e1e1e1` | Pinned Bot card |
| `--corn-surface-selected` | `#f0f0f0` | Selected details tab |
| `--corn-bubble-bot` | `#eeeeee` | Bot bubble fill |
| `--corn-bubble-user` | `#070707` | User bubble fill |
| `--corn-divider` | `#eeeeee` | Pane dividers |

## Message typography

| Property | Value | Evidence |
| --- | --- | --- |
| Bubble text | 13 px, 19 px line pitch | Ink bands repeat every 19 px in both screenshots; CJK ink is about 11.5 px tall |
| Bubble padding | 5 px block, 11 px inline | A two-line bubble is 48 px tall (2 × 19 + 10); text starts 11 px from the bubble edge |
| Paragraph gap | 9 px | The gap between paragraphs is 9 px more than the line gap |
| Bubble radius | 18 px | Corner fit |
| Bubble max width | `min(486px, 100% - 72px)` | 486 px in two-pane and 270 px in three-pane; one rule fits both |
| Feed gutter | 14 px | 14.5 px between the bubble and the chat edge |

## Interaction conventions

- **Unavailable controls keep the reference look.** A control whose feature hasn't shipped yet (dictation, live voice, app connectors, avatar upload and so on) is drawn exactly as in the screenshot. It is marked `aria-disabled` and given a reason via `aria-description` and `title`, and a click shows that reason in the polite notice region (`shared/notice.tsx`). Every reason string lives in `shared/unavailable.ts`. It is never dimmed, because dimming would break fidelity to the reference.
- **The Bot pill is the details toggle.** The reference has no separate details button. Clicking the centred Bot name opens or closes the details pane (`aria-expanded`, `aria-controls="corn-bot-details"`), and Escape inside details also closes it.
- **Intentional deviation: the details ⋯ button.** The details header adds a ⋯ menu to the left of share and close. The reference shows no such control. It holds low-frequency actions (tags) and entries that open 配置 → 核心设定 / 模型 / 权限 for the current Bot. Copying an ID is not in the menu; it lives in 概览 → 标识.
- **Intentional deviation: the fixed status strip.** A one-line caption sits between the feed and the composer (`features/chat/RuntimeNotice.tsx`). It states two separate facts: "示例数据，未连接真实 Bot" while the repository is the fixture (`repository.label`), and the local Host runtime status (starting, ready, recovering, failed, or that the status can't be read). "运行时已就绪" describes the Host only and never says a Bot is connected. The strip is in normal flow, so the feed gets about 22 px shorter (more where it wraps) and the strip never scrolls away, covers a message, the composer or the Bot pill. With details as an overlay it pads itself into the part of the chat the overlay leaves visible. The reference screenshots have no such line. PR-02C must treat it as an accepted baseline difference, not hide it to match the old captures. The strip is silent. A single polite, atomic live region above the shell (`app/RuntimeAnnouncer.tsx`) announces the sample source once (and again if it changes) and each runtime change, keyed on the previous status and safe error code. Polling, Bot switches, layout changes and ChatPane remounts don't re-announce.
- **Intentional deviation: the management tabs (PR-02E-1).** The reference tabs 详情 / 资料库 / 电脑 become 概览 / 配置 / 资料库, defined once in `features/details/details-navigation.ts`. 配置 lists 核心设定, 模型, 权限 and 技能 as entry rows; each opens a subpage in the pane with 返回配置, focusing its heading, and going back returns focus to the entry. 资料库 has 资料 and 记忆 sections. The 电脑 tab is gone; 权限 shows a read-only 本机操作 section until M3.
- **Honest section states.** Sections without a data source (identity documents, skills, artifacts, memory, routines) show 尚未接通, loading, empty or error from `SectionState`; they never show fake saves or a fake zero. Permissions are read-only. 概览 labels the Corn Bot ID and the Claw Agent ID separately and shows no Claw Agent ID until the Bot is bound.
- **Unsaved configuration is never carried across.** Switching tab or Bot, leaving a subpage, closing the pane or creating a Bot with an unsaved 核心设定 or 模型 draft asks 保存 / 放弃 / 取消. A failed save keeps the draft and stays. Chat drafts keep their own per-Bot behaviour.
- **Per-Bot state survives layout changes.** The draft, chat scroll, and the details tab, subpage, library section and pane scroll are kept per Bot in `layout-state.ts`. The feed stays pinned to the newest message when the chat column resizes, unless the user has scrolled up.
- **Placeholders are labelled.** Image attachments are grey placeholder boxes. The fixed status strip keeps "示例数据，未连接真实 Bot" in view next to every fixture send, approval and handoff result.
- **Intentional change: Corn role avatars (PR-02D-1).** Every Bot avatar region now shows a static Corn-original role avatar (`packages/ui` `BotAvatar`) where the reference screenshots show the Grok kit's artwork. This is a deliberate content change, not drift: the slots keep their reference sizes (roster rows 32, rail 36, hidden rows 24, pinned card 52, chat header 24, details 60, profile dialog 48, handoff line 14), and the sidebar 276 / chat 372 / details 376 split is unchanged. At 24 px and below the seam lines are dropped, but the `/` eyes stay. A Bot stores its role as an explicit `variantId`. Created Bots get a stable default chosen by hashing their id, never 小黄. Records without a known role, and the account avatar, keep the hue-and-initial placeholder. 02C region diffs should treat avatar areas as changed content. Motion arrives in PR-02D-2.

## Verification

`CORN_DESKTOP_SMOKE=1` drives the real Electron window through `apps/desktop/src/smoke/layout-probe.ts`. At 1024×764 it:

1. Types a draft.
2. Measures the regions with details closed.
3. Opens details through the Bot pill and measures again.
4. Closes details and confirms the draft is still there.
5. Checks the status strip with the feed scrolled to the bottom and top, in three-pane, after switching Bot, with the roster collapsed, at 720×520 with details as an overlay and closed, and back on the first Bot at 1024×764.

The smoke fails unless:

- the sidebar is 276 ± 1 px wide;
- the sidebar moves by less than 1 px between the two states;
- details take 0.367 ± 0.01 of the window width;
- the draft is kept, including across the Bot switch;
- in every strip scenario, the sample marker (found by its text) and the runtime status (`data-runtime-status`, matching what Main reports) are rendered inside the visible chat pane, in normal flow, outside every scroll container and live region, unclipped, uncovered at their centre, and clear of the composer, Bot pill, roster and details;
- there is exactly one polite, atomic runtime announcer outside the chat pane, and it doesn't change during the walk.

The crash smoke (`CORN_DESKTOP_CRASH_SMOKE=1`) runs the same strip check while Main is recovering and fails unless the window shows `recovering`.

The probe sends a pointer leave before measuring, so hover-only chrome such as message copy buttons stays out of the captures. The run writes `m1-layout-two-pane.png` and `m1-layout-three-pane.png` to `.artifacts/` (gitignored) for review by eye. Pixel-level region diffs come with PR-02C.
