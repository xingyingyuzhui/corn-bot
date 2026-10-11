# ADR-0004: Single user-screenshot design profile for M1

- Status: **Accepted** (maintainer decision 2026-10-11)
- Milestone: M0 (PR-00D); applies to M1 (PR-02A/B/C)

## Context

Plan v1.3 §12.1 lists three visual sources: the user's two screenshots (`user-screenshots`), the static analysis of the 0.68.1 installer (`dmg-0681`) and the public website demo (`website-demo`). It proposes switchable layout profiles plus boundary tests for `dmg-0681`. These sources disagree. For example, the `dmg-0681` sidebar defaults to 280px with details at 320px, while the screenshots show roughly 380px and 37% of the window width at 1416 CSS px.

## Decision

1. M1 ships one layout and token profile, `user-screenshots`. It is calibrated from the reference PNGs: sidebar about 27% of the window width; details about 37% of **total** width, which is about half of the width remaining after the sidebar. Calibration measures divider positions and records the CSS px / DPR conversion. PNG pixels are not treated as CSS px.
2. No runtime profile switch, `layoutReferenceProfile` state or `kit-layout-profiles.spec.ts` / `kit-thread-resize.spec.ts` in M1.
3. Where the screenshots are silent (for example the minimum chat width, the auto-compact threshold, the resize cleanup sequence or the 6-attachment limit), PR-02A may adopt individual `dmg-0681` facts. Each adopted constant carries a source comment with its E## anchor and is listed in [SPEC_MAPPING](../../design/grok-kit/SPEC_MAPPING.md). Adopted constants never override a screenshot-measured value.
4. `website-demo` values are used only as visual comparison during review.
5. Light theme only. Tokens are semantic so that a dark mapping can be added later without rewriting components.

## Consequences

- Visual tests compare only against the two screenshots, by region, at a fixed viewport, DPR and font.
- Revisiting multi-profile support requires a new ADR and evidence that a second profile serves a product need.
