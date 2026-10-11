# Corn Bot

An independent macOS workspace for persistent bots, powered by DeepSeek Harness and governed by DSH Claw Suite.

Implementation follows [plan v1.1](docs/plans/CORN_BOT_CODE_LEVEL_ITERATION_PLAN.md). The project is at **M0: runtime and authenticated transport validation**. Product UI, computer control, messaging and routines are not implemented yet.

The development runtime must use its own DSH home. Never launch against the user's existing `~/.dsh` or Desktop profile.

Reference screenshots are user-provided design inputs. They are not Corn product screenshots or redistributable production assets.

Start with the [development runbook](docs/runbooks/development.md). Read the [architecture](docs/architecture.md) and [M0 evidence](docs/milestones/M0-EVIDENCE.md) for the distinction between live checks and outstanding work. No existing DSH credentials or model settings are imported.
