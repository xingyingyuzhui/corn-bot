# Corn Bot implementation rules

- Follow `docs/plans/CORN_BOT_CODE_LEVEL_ITERATION_PLAN.md` v1.1. M0 must pass before product UI work.
- Read pinned DSH RC2 source, not current master. Do not edit upstream DSH or copy Claw implementation into Corn.
- Research existing official implementations first. Independent audits may run in parallel.
- Use a Corn-owned isolated DSH home and `corn-dev` profile. Never modify `~/.dsh`, existing Desktop packages or registered user bots.
- Never log or commit startup tokens, authentication cookies, model credentials, personal runtime logs or screenshots.
- Renderer receives narrowly typed IPC only. No arbitrary URL, endpoint, filesystem, credentials or SQL access.
- Keep DSH logs authoritative. Corn persists metadata and reconstructable projections.
- Feature branches and reviewable PRs after initial main. Report verified capabilities separately from missing/manual checks.
