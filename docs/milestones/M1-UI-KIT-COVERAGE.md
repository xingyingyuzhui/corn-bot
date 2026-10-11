# M1 UI kit coverage

Progress against the kit's 83-item acceptance list as of PR-02B. The per-item index (Corn files, tests and remainders) is [INTERACTION_COVERAGE](../../design/grok-kit/INTERACTION_COVERAGE.md); status definitions are there too. Every item has a status; none is `unknown`.

| Section | Items | Covered | Partial | Deferred | Not applicable |
| --- | --- | --- | --- | --- | --- |
| A. Scope and provenance | 5 | 5 | 0 | 0 | 0 |
| B. Shell, navigation, sidebar | 12 | 11 | 0 | 1 | 0 |
| C. Details and task threads | 10 | 1 | 1 | 8 | 0 |
| D. Input, attachments, sending | 13 | 6 | 4 | 2 | 1 |
| E. Voice and calls | 6 | 6 | 0 | 0 | 0 |
| F. Transcript and status cards | 10 | 4 | 4 | 0 | 2 |
| G. Shortcuts and focus | 9 | 5 | 3 | 1 | 0 |
| H. Settings, theme, language | 9 | 1 | 3 | 3 | 2 |
| I. Desktop floating panel | 9 | 0 | 0 | 9 | 0 |
| **Total** | **83** | **39** | **15** | **24** | **5** |

Voice items (E) are covered as dev-route fixture states only. No real microphone is used, and the default route shows both voice buttons as unavailable.

## Merge gate

The plan's M1 task list (item 10) requires the Shell, Composer, Transcript, details, task-thread, theme and keyboard groups to pass before PR-02 merges. Applied to M1 after the §14 maintainer decisions:

| Group | Kit items | Status |
| --- | --- | --- |
| Shell | B1–B12 | Passes. B11 (account name) has no M1 surface |
| Composer | D1–D13, E1–E6 | Passes for M1. The remainders need the M2 adapter (D8, D10, D13), task threads (D11) or a composer menu (D3) |
| Transcript | F1–F10 | Passes for M1. Rich cards and savedSnapshot need M2/M4 run data |
| Details | C1–C2 | Passes. Width follows the `user-screenshots` profile; group tabs are M5 |
| Task threads | C3–C10 | Out of M1 by §14 decision 3 (M4/M5) |
| Theme | H3 | Light only. Dark theme is out of M1 by the PR checklist |
| Keyboard | G1–G9 | Passes for M1: 11 of the 19 registered shortcut actions are implemented, 2 are not applicable and 6 are deferred |

PR-02C still has to add the region screenshot diffs before PR-02 as a whole is complete.

## Deferred, by owner

| Owner | Items |
| --- | --- |
| M2 (persistence, real runs) | D8 upload limits, D10 runtime send locks, D13 echo by id, F2 savedSnapshot, H7 notifications, H9 policy source |
| M2/M4 (run events, state cards) | F1 rich text, forms, tool widgets |
| M3 (Computer Use) | H1 电脑 settings section |
| M4/M5 (task threads) | C3–C10, D11 reply/task context, F8 reply/jump/thread actions |
| M5 (groups) | C1 group and members-only tabs |
| M7 (connectors, dictation) | F7 connector cards, real dictation behind E1–E6 |
| M8 (release) | H1 updates section |
| No milestone assigned | B11 account name, D3 composer menu, F9 unread divider, G2 Mod+K / Mod+F, G4 Mod+[ / ], G5 Mod+L, G7 Ctrl+Tab, H1 usage section, H5–H6 localisation, I1–I9 floating panel |
