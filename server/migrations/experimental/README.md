# Standalone classroom multi-school migration rehearsal

**Experimental rehearsal only. Never apply this draft to the live Render PostgreSQL database.**

## Confirmed legacy tenant
All existing standalone-classroom records are assigned to:
- School UUID: `5c8b8880-1346-445c-89d8-3f76275a7ae5`
- Slug: `frahoosh-default`

This assignment was explicitly confirmed by the project owner for the current standalone classroom database.

## Scope
- Additive tenant registry and nullable tenant columns, followed by deterministic backfill and NOT NULL.
- Preserve all existing primary keys and row contents.
- Convert global username, national-ID hash, room-code and schedule-slot uniqueness to school-scoped uniqueness.
- Add composite user/school references for classroom teacher and creator.
- Add disposable PostgreSQL assertions for two-school coexistence and cross-school reference rejection.

## Important limitations
This is only the **database expand-phase rehearsal**. It does not yet make the running Express API tenant-safe. The API still needs a mandatory tenant context and tenant predicates for every read/write, including login, sessions, schedule, Excel import, class lifecycle, memberships and events. The production deployment must remain unchanged until that application phase is complete and tested.

The draft assumes the existing schema from `server/schema.sql` and the startup schema in `server/src/server.js` have been reconciled. The startup schema currently creates a subset of the same tables; that reconciliation is a prerequisite before any real migration.

## Local / CI rehearsal
1. Create an empty disposable PostgreSQL database.
2. Apply `server/schema.sql`.
3. Insert representative legacy fixtures **before** the migration.
4. Apply `server/migrations/experimental/001_multischool_expand.sql`.
5. Run `server/tests/multischool-migration.test.sql`.
6. Verify row counts and primary keys are unchanged.
7. Destroy the disposable database.

No command in this folder targets Supabase or the live Render database.
