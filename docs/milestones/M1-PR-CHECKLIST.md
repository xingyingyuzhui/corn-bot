# M1 product UI slice — blocked on M0 acceptance

This is a file-level review checklist, not authorization to skip the remaining M0 gate. M1 starts once the transport ADR is accepted with the real model, cancellation and governance evidence required by plan v1.1.

| Files | Reviewable behavior |
| --- | --- |
| `apps/renderer/package.json`, `vite.config.ts`, `src/main.tsx` | Independent React/TypeScript application and deterministic build; no official DSH Workspace UI |
| `src/styles/tokens.css`, `layout.css`, `design/design-spec.md` | Measurements from user-provided references; sidebar stays fixed, details occupies about 37% of total window width |
| `src/app/CornApp.tsx`, `CornShell.tsx`, `CompositionRoot.tsx` | Two/three-column transitions retain selected Bot, composer draft and scroll state |
| `src/features/roster/*`, `chat/*`, `details/*` | Roster, chat and overview/knowledge/computer panes; narrow-window behavior and empty/loading/error states |
| `src/features/settings/*`, `bot-editor/*`, `voice/*` | Explicit button contracts; actions awaiting M2/M7 are disabled with a clear reason |
| `packages/contracts`, `apps/desktop/src/ipc/*` | Narrow typed methods, sender validation and credential-free view models; no raw Host endpoint or filesystem proxy |
| `apps/renderer/tests/visual/details-three-pane.spec.ts` | Fixed macOS/DPR/font/viewport screenshots and measured layout assertions against approved references |

M1 may use clearly labelled fixtures for visual states. Genuine creation/binding and persistent Bot/Conversation/Run transactions belong to M2; fixtures must never report successful model calls, permissions or computer control. The M1 PR includes the two reference layout comparisons and behavior specifications for every visible button.
