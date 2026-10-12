# Corn Bot implementation rules

- Use `docs/plans/CORN_BOT_FORWARD_PLAN.md` for current status, work order and acceptance gates. Keep v1.3 `docs/plans/CORN_BOT_CODE_LEVEL_ITERATION_PLAN.md` and its §14 maintainer decisions as the design/contract reference. Do not execute obsolete handoff branch instructions. M0/R1 pending checks must pass before their dependent capability is signed off; existing M1 fixture UI is not evidence of real product chat.
- Keep GUI smoke/Electron/packaged-app and real-Host verification paused until the maintainer explicitly resumes them. Only model-settings N1/N3 implementation and light fake tests may proceed to the existing PR; N2, integration, merge and real tests wait for runtime selection. Never auto-schedule verification.
- Current DSH is implemented; OpenClaw/Mastra are candidates in the forward plan. Do not replace or stack execution loops until the runtime decision is recorded with evidence. Do not change another agent's worktree during documentation cleanup.
- The UI/UX research kit is read-only and pinned in `design/grok-kit/kit.lock.json`. Never copy its files, geometry, fonts, images or audio into Corn; rewrite behaviour in Corn TypeScript.
- Read pinned DSH RC2 source, not current master. Do not edit upstream DSH or copy Claw implementation into Corn.
- Research existing official implementations first. Independent audits may run in parallel.
- Use a Corn-owned isolated DSH home and `corn-dev` profile. Never modify `~/.dsh`, existing Desktop packages or registered user bots.
- Never log or commit startup tokens, authentication cookies, model credentials, personal runtime logs or screenshots.
- The packaged app is self-contained ([ADR-0005](docs/adr/ADR-0005-packaging.md)): no package manager, network install or installed DSH at runtime, and never boot without the verified Claw template.
- Renderer receives narrowly typed IPC only. No arbitrary URL, endpoint, filesystem, credentials or SQL access.
- Keep DSH logs authoritative. Corn persists metadata and reconstructable projections.
- Feature branches and reviewable PRs after initial main. Report verified capabilities separately from missing/manual checks.
