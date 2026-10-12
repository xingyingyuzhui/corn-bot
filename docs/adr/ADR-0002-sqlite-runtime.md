# ADR-0002: built-in SQLite runtime

- Status: Accepted (2026-10-12): `node:sqlite` is Corn's SQLite driver
- Date: 2026-10-11 (proposed); 2026-10-12 (accepted after P3 slice D0)
- Scope: driver choice only. Schema, migrations, backup policy and the writer live in `packages/local-db` (P3 D1) and Main data wiring (P3 D2)

## Decision

Corn uses Node's built-in `node:sqlite` (`DatabaseSync`) in Electron Main, the only writer, with `journal_mode=WAL` and `synchronous=FULL`. The maintainer took decisions 1A and 4A in `docs/plans/CORN_P3_REAL_CHAT_PLAN.md` §7.1. Corn ships no SQLite native addon, so there is no Electron ABI rebuild, no `asar.unpack` and no new `allowBuilds` entry.

## Evidence

Decision 3A requires evidence from the hosted macOS CI runner, not from a maintainer machine. [PR #34](https://github.com/xingyingyuzhui/corn-bot/pull/34) added `apps/desktop/src/smoke/sqlite-probe.ts` to `CORN_DESKTOP_SMOKE`. The probe runs in Electron Main and works on a scratch database:

1. Open the database with `DatabaseSync`.
2. Set `journal_mode=WAL`. It must return `wal`, and a `-wal` file must exist after a write.
3. Set `synchronous=FULL` and read it back as `2`.
4. Read `foreign_keys = 1`, then try an orphan insert. It must fail with `SQLITE_CONSTRAINT_FOREIGNKEY`.
5. Run an online `backup()`. Reopen the copy read-only; it must pass `quick_check` and hold the rows.
6. Run `wal_checkpoint(TRUNCATE)`, close, and delete the scratch directory.

The `sqlite` smoke check fails unless every fact holds and `process.type === 'browser'`. `scripts/smoke-packaged.mjs` also asserts every fact for each fresh packaged round.

CI run [38236892676](https://github.com/xingyingyuzhui/corn-bot/actions/runs/38236892676), `runtime-smoke` job on `macos-14` (arm64), at PR #34 head `d5d4a4d`. Every row below reported the same facts: `{"sqliteVersion":"3.53.4","wal":true,"synchronousFull":true,"foreignKeys":true,"backupOk":true,"mainProcess":true,"failure":null}`.

| Run | Electron / Node | Packaged |
| --- | --- | --- |
| `CORN_DESKTOP_SMOKE=1 pnpm dev:desktop` | 44.7.0 / 24.21.0 | no |
| Crash smoke (`CORN_DESKTOP_CRASH_SMOKE=1`) | 44.7.0 / 24.21.0 | no |
| `pnpm smoke:packaged`, fresh rounds 1–3 (round 3 adds Host kill and recovery) | 44.7.0 / 24.21.0 | yes, unsigned arm64 `release/mac-arm64/Corn Bot.app` |

The earlier M0 check covered only Electron's Node mode (`ELECTRON_RUN_AS_NODE`). This run covers Electron Main itself and the packaged App.

## Conditions and remaining gaps

- `node:sqlite` is Stability 1.2 (release candidate). All production calls go through one `driver.ts` in `packages/local-db`, so a rename such as Node 26's `Database` (DEP0210) touches only that file.
- The CI `check` job runs Node 24.18 on Ubuntu, while Electron 44.7.0 embeds Node 24.21. Unit tests may only use the API both share.
- The packaged evidence comes from an unsigned App launched from the release directory. Signed, notarised and DMG-installed builds have not been checked; they are covered by the packaging milestone, not this ADR.
- Not covered here: migrations, rollback, crash recovery of a real Corn database, and Main-thread latency under real writes. Those belong to D1 and D2.

## Revisit triggers

Switch to a pinned `better-sqlite3` and revise this ADR (plan §3.1) if any of these happen:

- `node:sqlite` becomes unavailable in the packaged App, or behaves differently there.
- An Electron or Node upgrade removes or breaks the API.
- WAL, foreign keys or `backup()` stops working in a packaged build.
- Synchronous writes measurably block Main.
