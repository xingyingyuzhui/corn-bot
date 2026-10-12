# ADR-0003: Corn-original avatar motion engine

- Status: **Accepted** (maintainer decision 2026-10-11); amended by the [2026-10-12 addendum](#addendum-2026-10-12-dmg-behaviour-reference-borrowing-boundary-unified-scheduler)
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

## Addendum 2026-10-12: DMG behaviour reference, borrowing boundary, unified scheduler

Maintainer decision, 2026-10-12. This addendum narrows and clarifies the decision above; it does not replace it. Implementation detail lives in the [avatar plan](../plans/CORN_AVATAR_ASSET_INTEGRATION_PLAN.md) §3A–§5.

1. **Behaviour reference.** The DMG 0.68.1 installed-app engine is the behaviour reference: time-sampled, 53 states, keeping the 5 orbit/spawning particles and the standby halo. The website component is consulted only for idle body/eye motion parameters. The two sources are never mixed within one state. Corn records every deviation from DMG as a Corn choice. The website's frame-dependent ink sampling and its node-reuse hiding (3 visible orbit dots, hidden spawning particles, hidden standby halo) are not reproduced. Facts are read from the kit at `5bb4379`; moving `kit.lock.json` from `0248419` to `5bb4379` is a separate small code PR.
2. **Borrowing boundary.** Corn re-implements in its own TypeScript the DMG behaviour: state semantics, timings and phases (for example writing 2500ms with 68% pen-down / 32% lift, radar 1300ms with three staggered rings, progress 2500ms show / 1500ms rest, spawning 2000/1500ms, send 1500ms, receive 1700ms, alert 2.2s damped shake), easing curves, morph structure (which states fully morph and hide the eyes, morph→idle recovery), particle and ring counts, time-based ink path sampling (precomputed path, capped points, time-based erase), compact behaviour below 48px and the overflow-visible rule. This supersedes Decision 3 ("cadences are comparison points, not values to match") and the "motion curves drawn from scratch" clause of Decision 1, for these behavioural parameters only.
3. **Still forbidden.** Kit or Grok source files, minified code, SVG path data, assets, DMG clip keyframe data and exact morph geometry (for example shaft size, travel range, base angle, stroke width, ring radii) are not copied. The rest of Decision 1 stands: Corn body, eyes, faces, palette and morph shapes stay original. Copying code or geometry would be a separate boundary change and is not authorised. `pnpm verify:ui-kit` and the PR-09A audit apply unchanged. This records a product decision about re-implementing behaviour; it does not claim a licence, and [RIGHTS_REVIEW](../../design/grok-kit/RIGHTS_REVIEW.md) is unchanged.
4. **Unified scheduler.** One `requestAnimationFrame` loop serves all mounted instances; observers and listeners are shared. Frames are a pure function of the shared virtual animation time (with state entry time, seed, display size and transition data), driven by an injectable clock. The scheduler caps each tick's advance of virtual time at 100ms (DMG-like), which is how Decision 6's delta cap is realised. Maintainer decision on long gaps: after a background tab, sleep or any other long gap, animation time advances by at most 100ms and continues from where it was, with no phase jump; plan v1.3's "reset phase after hidden" is not adopted. Frame-rate independence means the same virtual time yields the same frame at 30/60/120 FPS and under irregular deltas below the cap; long-gap behaviour is tested separately as "advances at most 100ms, no jump". RAF, observers and listeners return to zero after unmount, Bot switch, StrictMode double mount and window destroy.
5. **No engine-driven state change.** The engine has no `next`/`hold` transitions. DMG auto-return to idle (finished/failed/approving, waking after 1.6s) and blocked→drowsy are not inherited for business-significant states. Presentation comes from the PR-03A reducer on real events; short states such as happy/celebrate expire through the presentation-layer TTL ([AVATAR_BEHAVIOR_MAPPING](../../design/grok-kit/AVATAR_BEHAVIOR_MAPPING.md) rule 4).
6. **Assets and vocabulary.** Corn-original morph targets ship in a new `corn-avatar-kit-v2` with its own asset lock; v1 static avatars, the 16 variants and the app icon are unchanged. The 18-state vocabulary in Decision 2 stays for PR-02D-2a. Second-batch morphs without a Corn state (orbit/waiting, spawning) require an explicit contract change in their PR.

Consequences: PR-02D-2 is split into 02D-2a (motion engine on v1 visuals, virtual-clock and JSDOM tests only) and 02D-2b (v2 morphs and visual acceptance). [AVATAR_SOURCE_MATRIX](../../design/grok-kit/AVATAR_SOURCE_MATRIX.md) statements that Corn does not use the DMG engine and that timings are not targets should be read together with this addendum: Corn still ships no DMG code, but now matches DMG behavioural parameters.
