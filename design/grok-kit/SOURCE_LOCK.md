# Grok Bot UI/UX Kit source lock

Corn reads the research kit as a pinned, read-only design input. Nothing from it is a Corn build dependency. The machine-readable pin is [`kit.lock.json`](kit.lock.json); `pnpm verify:ui-kit` checks it.

| Field | Value |
| --- | --- |
| Repository | `xingyingyuzhui/grok-bot-ui-ux-kit` (private research repository) |
| Pinned commit | `5bb4379e9ec1158b9ec29c3c5f1e2cc6604be5af` (2026-10-11, "Audit all avatar states and document cross-source motion differences") |
| Superseded pin | `0248419b80dde84560409802afb98f38803df52c`; two commits, 25 files changed. The earlier pin `c51253833ca89e14cb3630832efe3a612d2afb3f` was superseded by `0248419` |
| Comparison | `https://github.com/xingyingyuzhui/grok-bot-ui-ux-kit/compare/0248419b80dde84560409802afb98f38803df52c...5bb4379e9ec1158b9ec29c3c5f1e2cc6604be5af` |
| Local checkout | `.research/grok-bot-ui-ux-kit` (git-ignored); override with `CORN_UI_KIT_DIR` |
| Original application run | **No.** Grok Bot 0.68.1 was never launched or signed in to for this research |
| Recorded | 2026-10-11 |

## Checkout

```sh
git clone https://github.com/xingyingyuzhui/grok-bot-ui-ux-kit.git .research/grok-bot-ui-ux-kit
git -C .research/grok-bot-ui-ux-kit checkout 5bb4379e9ec1158b9ec29c3c5f1e2cc6604be5af
pnpm verify:ui-kit
```

An existing checkout moves to a new pin with `git -C .research/grok-bot-ui-ux-kit fetch origin` followed by the same `checkout`. A Corn worktree has no `.research/` of its own; point `CORN_UI_KIT_DIR` at a kit checkout (or a `git worktree` of it) at the pinned commit.

The repository is private, so CI has no checkout and reports `status: "skipped"` with a diagnostic. Use `--strict` or `CORN_UI_KIT_STRICT=1` where the checkout is required. With a checkout, the script fails on a different HEAD, a drifted pinned file, or any Corn file that is a byte-for-byte copy of a kit file (256 bytes or larger).

## Three evidence sources

These sources are archived separately. Do not describe one as evidence for another.

| Source ID | Origin | Supports | Does not support |
| --- | --- | --- | --- |
| `user-screenshots` | `design/references/grok-bot-chat-{two,three}-pane.png`, supplied by the user | Pixel layout, pane ratios, typography and component placement of the two target states | Other window widths, hidden flows, timing |
| `dmg-0681` | Static analysis of the user-supplied `Grok_Bot_0.68.1.dmg` (SHA-256 `7c568ac449780ff9ea8da26b65d108391b91390652eb382a68be51c6b2f65fdd`; six integrity differences recorded and unexplained) | Layout constants, state branches, token values located by source anchors | Runtime behaviour, server results, feature-gate defaults |
| `website-demo` | Public `https://x.ai/bot` product demo observed 2026-10-11, version unknown | Demo layout and avatar motion vocabulary at observation time | That 0.68.1 looks or behaves the same |

## Files read

Pinned SHA-256 values are in `kit.lock.json`.

| Kit file | Used for |
| --- | --- |
| `AGENTS.md`, `NOTICE.md`, `docs/provenance.md` | Rights boundary and evidence labels |
| `docs/website-comparison.md` | `website-demo` measurements |
| `docs/integration.md` | Layout order and composer contract |
| `docs/ui-ux-spec.md` | `dmg-0681` behaviour, sizes, shortcut list (anchors E01–E60) |
| `docs/visual-system.md`, `docs/component-spec.md` | Token values and component measurements |
| `docs/replication-checklist.md` | 83-item acceptance list (sections A–I), mapped in PR-02B |
| `docs/capture-plan.md` | Facts still requiring live observation |
| `docs/avatar-animation.md`, `src/avatar.d.ts`, `assets/avatar-motion/catalog.json`, `docs/avatar-motion-validation.json`, `tests/avatar.test.js` | Avatar state and timing vocabulary |
| `docs/avatar-state-audit.md`, `docs/avatar-state-catalog.md`, `docs/avatar-reference.md` | Per-state DMG 0.68.1 behaviour audit (phases, timings, morph and recovery structure, compact sizes) and website-versus-DMG differences; behaviour reference for PR-02D, never geometry |
| `src/composer.js` | Composer behaviour contract (to be rewritten in TypeScript, not copied) |

## Reference environment result

Run in the isolated checkout on 2026-10-11 with Node 24.18.0, npm 11.16.0, Python 3.14.3:

`npm ci --ignore-scripts && npm run build && npm run check` passed. The build reproduced every generated file byte-for-byte (clean `git status` afterwards). The verifier reported 53 asset hashes, 136 token anchors, 808 icons, 7 website SVG snapshots, 3 website avatar modules and 633 DMG motion declarations, and all 7 kit tests passed.

This proves that the research subset is reproducible. It does not prove Corn behaviour, macOS end-to-end behaviour or parity with the original app.
