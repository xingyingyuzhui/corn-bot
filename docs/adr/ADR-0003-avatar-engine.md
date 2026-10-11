# ADR-0003: Corn-original avatar motion engine

- Status: **Accepted** (maintainer decision 2026-10-11)
- Milestone: M0 (PR-00E); implemented in M1 (PR-02D), wired to real events in M2 (PR-03A), audited for release in M8 (PR-09A)
- Inputs: research kit pinned at `0248419b80dde84560409802afb98f38803df52c` ([source lock](../../design/grok-kit/SOURCE_LOCK.md), [rights review](../../design/grok-kit/RIGHTS_REVIEW.md), [source matrix](../../design/grok-kit/AVATAR_SOURCE_MATRIX.md))

## Context

Plan v1.3 §13 adds animated Bot avatars. The research kit recovered two working engines: the website demo component (35 states, 25 shapes) and the DMG 0.68.1 mathematical engine (53 states). Both are third-party code that the kit reproduces without a redistribution licence. `dist/avatar.js.LEGAL.txt` covers only bundled dependencies such as React, not the recovered animation code. The kit's own NOTICE says the same.

## Options

| Option | Description | Verdict |
| --- | --- | --- |
| `research-only` | No animation; static avatars only | Rejected: the plan requires motion and live state feedback |
| `licensed-component` | Ship the recovered website component or DMG engine | Rejected: no licence exists. Would only be reconsidered with written permission from the rights holder |
| `corn-original` | Corn designs its own geometry, faces and motion. The kit is used only for behavioural facts: which kinds of states exist, typical timing ranges, lifecycle hygiene | **Accepted** |

## Decision

1. Corn implements its own SVG avatar under `packages/ui/src/avatar/`. Geometry, eye and face design, palette and motion curves are drawn from scratch with a visual identity distinct from Grok Bot. The general idea of coloured shapes with eyes may stay; the shapes, proportions, faces and movement must not imitate the original's distinctive forms. No recovered SVG path, presentation constant (for example turn/tilt/roll or body scale) or clip is copied or traced.
2. `packages/contracts/src/avatar.ts` defines Corn's own vocabulary: 18 `AvatarVisualState` values and a provisional set of `CornAvatarShape` identifiers. The identifiers are generic labels owned by Corn and may change in PR-02D. Kit state strings never pass through Corn APIs, and unknown values are rejected by type or safely mapped to a fallback.
3. Timing follows Corn's own contract, tested with a fake clock. Kit cadences (for example idle blink 6–14s) are comparison points, not values to match.
4. A seed derived from the stable `botId` makes each Bot's rhythm reproducible. No `Math.random()` is called per render.
5. Uploaded avatars keep the user's image unchanged; motion only adds an external status ring or badge.
6. Lifecycle requirements follow §13.6. A shared scheduler caps frame delta. Animation pauses on `IntersectionObserver` exit, `document.hidden`, `prefers-reduced-motion` and the `animatedAvatars=false` setting, falling back to `StaticAvatar`. Effects are cleaned up under StrictMode double mount and on unmount. No per-frame persistence.
7. `AvatarRenderer` keeps the renderer behind a stable interface. A licensed replacement could only be selected after this ADR is superseded.
8. The state-selection rules live in [AVATAR_BEHAVIOR_MAPPING](../../design/grok-kit/AVATAR_BEHAVIOR_MAPPING.md).

## Consequences

- PR-02D needs original visual design work, not porting. Reviewers compare silhouettes against the kit gallery to confirm the forms are clearly distinct.
- `pnpm verify:ui-kit` blocks byte copies of kit files. Visual similarity and traced geometry still need human review in PR-02D.
- PR-09A extends `scripts/audit-ui-assets.mjs` so that the packaged app contains no kit-derived code, geometry, fonts, images or audio.
