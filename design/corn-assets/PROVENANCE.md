# Corn avatar and App icon provenance

All avatar artwork and the App icon in this repository are Corn-original. They come from the Corn avatar kit v1 (`corn-avatar-kit-v1`, version 0.1.0), produced for Corn Bot on 2026-10-11 and kept outside the repository at `Corn Bot/design-assets/corn-avatar-kit-v1`. No build, test or packaging step reads that folder; everything the App needs was migrated into the paths below. [`ASSET_LOCK.json`](ASSET_LOCK.json) is the machine-checked record and `packages/ui/tests/asset-lock.test.ts` fails if a file drifts from it.

Nothing here comes from the Grok research kit (`grok-bot-ui-ux-kit`): no recovered geometry, presentation constants, generated code or images ([ADR-0003](../../docs/adr/ADR-0003-avatar-engine.md), [RIGHTS_REVIEW](../grok-kit/RIGHTS_REVIEW.md)).

## Locked source inputs

The four inputs fixed in the [asset integration plan](../../docs/plans/CORN_AVATAR_ASSET_INTEGRATION_PLAN.md) §1 were re-hashed before migration and matched:

| Kit file | SHA-256 | Used as |
| --- | --- | --- |
| `assets/app-icon.png` | `4b783687…4d2942` | Copied byte-identical to `apps/desktop/assets/app-icon-source.png` |
| `src/artwork.ts` | `642d014c…670061` | Adapted into `packages/ui/src/avatar/artwork.ts` and `variants.ts` |
| `src/avatar.ts` | `075f8127…f8e314` | Resting poses adapted into `packages/ui/src/avatar/motion-presets.ts` (PR-02D-2a); its per-instance controller was not migrated |
| `assets/catalog.json` | `a5395558…6e536f` | Copied byte-identical to `packages/ui/assets/catalog.json` |

## Migrated files (byte-identical)

- `packages/ui/assets/avatars/*.svg`: the 16 static role avatars, one per variant.
- `packages/ui/assets/groups/*.svg`: the 5 group avatars. Archived as design assets only; M1 adds no group feature.
- `packages/ui/assets/catalog.json`: roles, shapes, states and groups.

Each file's hash equals the kit's own `assets/manifest.json` entry. The gallery, contact sheets, 288 role-state samples, shape and state samples, `dist/` and the motion controller were deliberately left out.

## Adapted code (new hashes)

`artwork.ts` keeps the kit's geometry, palette, `/` capsule eyes (35° tilt) and decorations unchanged. It returns an element tree rather than an SVG string so React renders it without `dangerouslySetInnerHTML`, takes a per-instance id prefix (`useId`) so two instances of one Bot never share a clip path, and adds a `compact` detail for 24 px and below that drops the barely visible seam lines. The tests prove the adaptation is faithful: serialising the tree with the kit's wrapper reproduces all 16 migrated static avatars and all 5 group avatars byte for byte. The adapted files are not byte-identical to the kit source, so `ASSET_LOCK.json` records their own hashes separately. Change them only with a provenance review and a lock update.

PR-02D-2a extends `artwork.ts` with an optional `morph` on motion frames; frames without one serialise exactly as before, so the byte-for-byte checks above still hold. `motion-presets.ts` keeps the kit's resting poses (sway, blink, gaze, expression and decoration per state) as time-sampled functions. The morph figures (side dots, rings, progress track, pen trail, alert shake) and their curves are new Corn drawings. Only their cycle lengths and phase structure follow the Grok Bot 0.68.1 behaviour audit, as recorded in [ADR-0003](../../docs/adr/ADR-0003-avatar-engine.md#amendment-2026-10-12-dmg-timed-behaviour). No geometry, path data or source from the research kit is used. The kit's per-instance animation controller was replaced by the shared scheduler and is still not migrated.

## App icon

The PNG was produced with the built-in image generator for the kit: a flat corn on a dark rounded tile, black capsule eyes tilted `/`, green husks and a light gradient (external name `corn-bot-app-icon-v3-eyes-fixed.png`). It is 1254×1254 with a full-bleed rounded tile and no margin. Its body alpha is 247–253 rather than 255, an artefact of the generator. The generator keeps it as is and does not edit pixels.

`scripts/generate-app-icons.mjs` builds the macOS icon from it at packaging time. The derived files are written to the gitignored `.build/icons/` and never committed. The script:

1. Verifies the source hash against this lock.
2. Scales the tile to 824×824, keeping the aspect ratio, and centres it on a transparent 1024×1024 canvas (100 px margin). This is Apple's macOS icon grid, where the body is 824 of 1024 with a corner radius of about 22.5%. The source's own corner radius is about 24% of its side, close enough that no second rounded mask is applied.
3. Renders the 16/32/128/256/512 pt @1x/@2x iconset with `sips`, then the `.icns` with `iconutil`.

The script prints the derived hashes on every run.
