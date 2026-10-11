# Avatar source matrix

Two separate avatar vocabularies exist in the pinned kit (`0248419`). They come from different sources, so their names, shapes and timings must not be mixed. Both are **research-only**: no redistribution licence exists for either implementation, its geometry or its timing tables (see [RIGHTS_REVIEW](RIGHTS_REVIEW.md)). The "Corn v1" column only says whether Corn's own contract (`packages/contracts/src/avatar.ts`, plan §13.3) has a state with the same name. A matching name does not mean Corn reuses the original's motion.

Timing ranges are facts from `assets/avatar-motion/catalog.json`. They serve as comparison points for Corn's own timing contract and are not targets to reproduce.

## Website demo (2026-10-11, version unknown): 35 states, 25 shapes

Shapes: `blob`, `pebble`, `bean`, `egg`, `squircle`, `square`, `tablet`, `capsule`, `cylinder`, `hex`, `gem`, `crystal`, `wedge`, `shield`, `dome`, `arch`, `horseshoe`, `cloud`, `teardrop`, `leaf`, `clover`, `house`, `heart`, `sparkle`, `star6`. Morph shots: progress 2500ms, spawning 2000ms; morph rest 1500ms.

Corn's v1 shapes are designed from scratch with their own geometry and visual identity (maintainer decision; see [ADR-0003](../../docs/adr/ADR-0003-avatar-engine.md)). Corn shape identifiers are Corn's own and may be renamed in PR-02D.

| State | Group | Blink ms | Expression ms | Corn v1 |
| --- | --- | --- | --- | --- |
| `sleeping` | lifecycle | none | 6000–10000 | yes |
| `waking` | lifecycle | none | 800 | yes |
| `idle` | lifecycle | 6000–14000 | 9000–16000 | yes |
| `listening` | lifecycle | 3000–7000 | 2800–5000 | yes |
| `thinking` | lifecycle | 3500–7000 | 2000–3600 | yes |
| `searching` | lifecycle | 1600–4000 | 1000–1800 | yes |
| `working` | lifecycle | 2800–5500 | 1800–3200 | yes |
| `excited` | emotion | 2000–4000 | 1100–2000 | no |
| `surprised` | emotion | 1800–3500 | 2500–4000 | no |
| `suspicious` | emotion | 4500–8000 | 2600–4500 | no |
| `angry` | emotion | 3500–7000 | 2200–3800 | no |
| `drowsy` | emotion | none | 4000–8000 | no |
| `happy` | emotion | 2500–5000 | 2500–4500 | yes |
| `curious` | emotion | 2500–5500 | 1800–3200 | no |
| `confused` | emotion | 2800–5500 | 2200–3800 | yes |
| `bored` | emotion | 4000–8000 | 3500–6000 | no |
| `proud` | emotion | 3500–7000 | 3500–6000 | no |
| `shy` | emotion | 3000–6000 | 3000–5500 | no |
| `sad` | emotion | 4000–8000 | 4000–7000 | no |
| `laughing` | emotion | 2500–5000 | 1200–2400 | no |
| `scared` | emotion | 1200–3000 | 900–1800 | no |
| `playful` | emotion | 2000–4500 | 1500–3000 | no |
| `celebrate` | emotion | 2200–4500 | 1400–2600 | yes |
| `orbit` | agent morph | none | 4000–8000 | no |
| `radar` | agent morph | none | 4000–8000 | no |
| `progress` | agent morph | none | 4000–8000 | yes |
| `spawning` | product lifecycle | none | 1200 | no |
| `humming` | product lifecycle | 4000–8000 | 5000–9000 | no |
| `dictating` | product lifecycle | none | 4000–8000 | yes |
| `writing` | product lifecycle | none | 4000–8000 | yes |
| `sending` | product lifecycle | none | 4000–8000 | yes |
| `receiving` | product lifecycle | none | 4000–8000 | yes |
| `uploading` | product lifecycle | none | 4000–8000 | yes |
| `alerting` | product lifecycle | none | 2000–3600 | yes |
| `powering-down` | product lifecycle | none | 6000–9000 | yes |

Corn v1 has 18 states, all named in this set. Unknowns: the website build version, whether any state is driven by real product events, and the behaviour of animated group avatars.

## DMG 0.68.1 engine: 53 states

Corn does not use the DMG engine. This table exists so that nobody passes a DMG-only state such as `failed`, `finished`, `waiting` or `streaming` into a website-vocabulary contract.

| State | In website set | Original clip, face and morph facts |
| --- | --- | --- |
| `idle` | yes | clips Idle_B, Idle_D, Idle_A |
| `listening` | yes | clips Idle_D; face calm |
| `thinking` | yes | clips Idle_B; morph thinking |
| `streaming` | **no** | clips Streaming_A, Streaming_B, Streaming_C |
| `searching` | yes | clips Idle_B; morph radar |
| `reading` | **no** | clips Working_A–F |
| `working` | yes | clips Working_A–F |
| `coding` | **no** | clips Working_A–F |
| `running` | **no** | clips Working_A–F |
| `computing` | **no** | clips Working_A–F |
| `controlling` | **no** | clips Working_A–F |
| `waiting` | **no** | clips Idle_B; morph orbit |
| `blocked` | **no** | clips Blocked_A; then drowsy after 120s |
| `finished` | **no** | clips Done_B, Done_A; face happy; then idle |
| `failed` | **no** | clips Blocked_B; then idle |
| `sleeping` | yes | clips Idle_B; face sleepy |
| `waking` | yes | clips Idle_B; face surprised; then idle after 1.6s |
| `happy` | yes | clips Done_A |
| `excited` | yes | clips Done_C |
| `laughing` | yes | clips Done_B |
| `proud` | yes | clips Marketing_B |
| `curious` | yes | clips Working_B; face inspecting |
| `playful` | yes | clips Bodymoves_A |
| `shy` | yes | clips Idle_D; face calm |
| `surprised` | yes | clips Idle_B; face surprised |
| `suspicious` | yes | clips Idle_D; face squinted |
| `angry` | yes | clips Blocked_A; face squinted |
| `confused` | yes | clips Blocked_A |
| `sad` | yes | clips Blocked_B |
| `drowsy` | yes | clips Blocked_C |
| `bored` | yes | clips Idle_B; face sleepy |
| `scared` | yes | clips Idle_D; face surprised |
| `celebrate` | yes | clips Rotation_A; face happy |
| `approving` | **no** | clips Rotation_C; then idle |
| `orbit` | yes | clips Idle_B; morph orbit |
| `radar` | yes | clips Idle_B; morph radar |
| `progress` | yes | clips Idle_B; morph progress |
| `spawning` | yes | clips Idle_B; morph spawning |
| `loading` | **no** | clips Idle_B; morph progress |
| `dictating` | yes | clips Idle_B; morph dictating |
| `sending` | yes | clips Idle_B; morph sending |
| `receiving` | yes | clips Idle_B; morph receiving |
| `uploading` | yes | clips Idle_B; morph uploading |
| `writing` | yes | clips Idle_B; morph writing |
| `alerting` | yes | clips Idle_B; morph alerting |
| `bouncing` | **no** | clips Idle_B; morph bouncing |
| `powering-down` | yes | clips Idle_B; morph powering-down |
| `humming` | yes | clips Idle_B; face calm |
| `notifying` | **no** | clips Done_B; face surprised |
| `dragging` | **no** | clips Idle_B; face surprised |
| `logo` | **no** | clips Logo_A, Logo_B |
| `showcase` | **no** | clips Marketing_A–D |
| `turntable` | **no** | clips Rotation_B |

Even where a state name appears in both sets, the two sources use different algorithms. The website state is not a DMG state.
