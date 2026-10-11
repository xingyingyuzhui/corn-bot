# Corn Bot implementation rules

- Follow `docs/plans/CORN_BOT_CODE_LEVEL_ITERATION_PLAN.md` v1.3; §14 maintainer decisions override conflicting earlier sections. M0 must pass before product UI work.
- The UI/UX research kit is read-only and pinned in `design/grok-kit/kit.lock.json`. Never copy its files, geometry, fonts, images or audio into Corn; rewrite behaviour in Corn TypeScript.
- Read pinned DSH RC2 source, not current master. Do not edit upstream DSH or copy Claw implementation into Corn.
- Research existing official implementations first. Independent audits may run in parallel.
- Use a Corn-owned isolated DSH home and `corn-dev` profile. Never modify `~/.dsh`, existing Desktop packages or registered user bots.
- Never log or commit startup tokens, authentication cookies, model credentials, personal runtime logs or screenshots.
- The packaged app is self-contained ([ADR-0005](docs/adr/ADR-0005-packaging.md)): no package manager, network install or installed DSH at runtime, and never boot without the verified Claw template.
- Renderer receives narrowly typed IPC only. No arbitrary URL, endpoint, filesystem, credentials or SQL access.
- Keep DSH logs authoritative. Corn persists metadata and reconstructable projections.
- Feature branches and reviewable PRs after initial main. Report verified capabilities separately from missing/manual checks.
