# ADR-0002: built-in SQLite candidate

- Status: Proposed; developer runtime verified, packaged macOS app pending
- Date: 2026-10-11
- Scope: M0 choice; M2 implements schema and migrations

Use Node's built-in `node:sqlite` in Electron Main as the initial candidate. The pinned Electron 44.7.0 binary supplies Node 24.21.0 and SQLite 3.53.4 on this macOS machine. Both the Node CLI and Electron's Node mode successfully opened a database, selected WAL and performed an insert/read. This avoids introducing a separate SQLite native addon and its Electron ABI rebuild requirement.

This is a compatibility probe, not a database layer. No Bot, Conversation or Run schema exists yet. The final choice requires an installable bundled arm64 app check, explicit writer ownership, migration/backup/rollback tests and crash recovery at M2. Packaging is not verified by launching a developer Electron binary. If the built-in API cannot meet those requirements, evaluate a pinned alternative and revise this ADR.
