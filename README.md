# Corn Bot

An independent macOS workspace for persistent bots, powered by DeepSeek Harness and governed by DSH Claw Suite.

Current work follows the [forward plan](docs/plans/CORN_BOT_FORWARD_PLAN.md). Plan v1.3 and its §14 maintainer decisions remain the [design and contract reference](docs/plans/CORN_BOT_CODE_LEVEL_ITERATION_PLAN.md); historical branch instructions are not the current work queue.

Status checked on 2026-10-12 at main `8b6989c`: the independent runtime, M1 fixture UI, static Corn avatars/icon, management navigation and runtime/save/audit fixes are merged. Real product chat, database/Run storage, avatar motion and computer control are not connected. Model settings [PR #15](https://github.com/xingyingyuzhui/corn-bot/pull/15) is paused at `a026f68`, unmerged, with three remaining review findings. Code merged does not mean the pending GUI, governance and packaged checks have been signed off.

GUI smoke, Electron/packaged-app runs and real-Host verification remain paused until the maintainer explicitly resumes them. Model-settings N1/N3 can proceed to PR only; N2 and merge wait for selection. Start planning with the forward plan and [research index](docs/research/README.md); no runtime replacement has been decided. The [post-merge review](docs/milestones/POST_MERGE_REVIEW_2026-10-12.md) records two new findings awaiting fix PRs.

The development runtime must use its own DSH home. Never launch against the user's existing `~/.dsh` or Desktop profile.

Reference screenshots are user-provided design inputs. They are not Corn product screenshots or redistributable production assets. The private UI/UX research kit is a pinned, read-only input; see the [source lock](design/grok-kit/SOURCE_LOCK.md) and [rights review](design/grok-kit/RIGHTS_REVIEW.md). No kit file is part of Corn.

Start with the [development runbook](docs/runbooks/development.md). Read the [architecture](docs/architecture.md) and [M0 evidence](docs/milestones/M0-EVIDENCE.md) for the distinction between live checks and outstanding work. No existing DSH credentials or model settings are imported.
