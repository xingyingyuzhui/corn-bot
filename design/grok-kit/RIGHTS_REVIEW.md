# Research kit rights review

Blocking review for every kit path Corn might be tempted to reuse. The kit has **no LICENSE file**; no permission is inferred from its GitHub visibility or authorship. Maintainer decision (2026-10-11): Corn reads kit material only as behavioural reference and rewrites everything in its own TypeScript. No kit file is copied into Corn, including files the maintainer wrote.

| Class | Kit paths | Rights holder | Corn use |
| --- | --- | --- | --- |
| Original app bundle | `reference/renderer/**`, `reference/electron-preload`, `reference/manifest.json` | Original vendor | **Forbidden** in source and product. Read source anchors for facts only. Never run as Corn's frontend; never imitate `window.desktop` or `coordinatorPort` |
| Original fonts | `assets/fonts/**` (`X-VF-*`, `XMono-VF-*`, `cursor-icons-*`, KaTeX copies) | Original vendor / font owners | **Forbidden.** Corn uses system fonts and its own icon set |
| Original images and audio | `assets/images/**`, `assets/audio/**`, `assets/styles/**` | Original vendor and third-party brands | **Forbidden** |
| Recovered tokens and icon map | `tokens/**`, `assets/icon-map.json` | Values recovered from the vendor bundle | Measured values may inform Corn's own semantic variables. Do not import these files or copy variable tables wholesale |
| Website material | `reference/website/**`, `assets/website/**` | Website owner | **Forbidden** in product. Observations only |
| Recovered avatar code | `src/website-avatar.generated.js`, `src/website-avatar-data.generated.js`, `src/website-avatar-still.generated.js`, `src/avatar-engine.generated.js`, `dist/avatar.js` | Original vendor / website owner (`dist/avatar.js.LEGAL.txt` covers only bundled dependencies) | **Forbidden** as dependency, copy or geometry source. See [ADR-0003](../../docs/adr/ADR-0003-avatar-engine.md) |
| Avatar extraction records | `assets/avatar-motion/{catalog,website-extraction,dmg-extraction}.json` | Derived from vendor code | Timing ranges and state names are facts used for comparison. Path and geometry data are forbidden |
| Maintainer-written adapters and examples | `src/{index,theme,composer,avatar}.js`, `src/*.d.ts`, `src/*.css`, `examples/**`, `scripts/**`, `tests/**` | Maintainer, unlicensed; `src/avatar.js` wraps recovered code | Behavioural reference only. Rewrite in Corn TypeScript |
| Analysis documents | `docs/**`, `README.md`, `AGENTS.md`, `NOTICE.md` | Maintainer | Facts and measurements may be cited with source labels |
| Evidence records | `evidence/**` | Maintainer analysis of vendor material | Provenance only |

## Enforcement

- `pnpm verify:ui-kit` fails if any Corn file is a byte-identical copy of a kit file of 256 bytes or larger. This catches verbatim copies but not edited or partial copies, which still require review.
- M8 `scripts/audit-ui-assets.mjs` (PR-09A) enumerates the packaged `.app` and asar, and rejects the forbidden classes above.
- Corn's `THIRD_PARTY_NOTICES.md` lists no kit material because none is distributed.

Any exception needs written redistribution permission from the rights holder, recorded here with scope and date, plus an updated ADR. No exception exists today.
