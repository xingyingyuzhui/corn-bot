# Corn design spec: `user-screenshots` profile

The only visual target for M1 is the pair of reference screenshots in [`references/`](references/) ([ADR-0004](../docs/adr/ADR-0004-design-profiles.md)). This file records how they were measured and where each measurement lives in code. The tokens themselves are in `apps/renderer/src/styles/tokens.css`. If you change a value there, update the matching row here.

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

- **Unavailable controls keep the reference look.** A control whose feature hasn't shipped yet (dictation, live voice, app connectors, avatar upload and so on) is drawn exactly as in the screenshot. It is marked `aria-disabled` and given a reason via `aria-description` and `title`, and a click shows that reason in the polite notice region (`shared/notice.tsx`, `shared/unavailable.ts`). It is never dimmed, because dimming would break fidelity to the reference.
- **The Bot pill is the details toggle.** The reference has no separate details button. Clicking the centred Bot name opens or closes the details pane (`aria-expanded`, `aria-controls="corn-bot-details"`), and Escape inside details also closes it.
- **One intentional deviation: the details ⋯ button.** The details header adds a ⋯ menu (edit profile, tags, model, permissions) to the left of share and close. The reference shows no such control, but those editors need an entry point that doesn't change the default view.
- **Per-Bot state survives layout changes.** The draft, scroll position and selected details tab are kept per Bot in `layout-state.ts`. The feed stays pinned to the newest message when the chat column resizes, unless the user has scrolled up.
- **Placeholders are labelled.** Until PR-02D lands, avatars are hue-and-initial placeholders. Image attachments are grey placeholder boxes. The fixture conversation carries the visible notice "示例数据，未连接真实 Bot".

## Verification

`CORN_DESKTOP_SMOKE=1` drives the real Electron window through `apps/desktop/src/smoke/layout-probe.ts`. At 1024×764 it:

1. Types a draft.
2. Measures the regions with details closed.
3. Opens details through the Bot pill and measures again.
4. Closes details and confirms the draft is still there.

The smoke fails unless:

- the sidebar is 276 ± 1 px wide;
- the sidebar moves by less than 1 px between the two states;
- details take 0.367 ± 0.01 of the window width;
- the draft is kept.

The probe sends a pointer leave before measuring, so hover-only chrome such as message copy buttons stays out of the captures. The run writes `m1-layout-two-pane.png` and `m1-layout-three-pane.png` to `.artifacts/` (gitignored) for review by eye. Pixel-level region diffs come with PR-02C.
