# Standalone classroom multi-school migration rehearsal

**Experimental rehearsal only. Never apply these drafts to the live Render PostgreSQL database.**

## Confirmed legacy tenant
All existing standalone-classroom records are assigned to:
- School UUID: `5c8b8880-1346-445c-89d8-3f76275a7ae5`
- Slug: `frahoosh-default`

This assignment was explicitly confirmed by the project owner for the current standalone classroom database.

## Two-phase rollout design

### Phase 1 — expand (`001_multischool_expand.sql`)
- Adds a tenant registry and tenant columns.
- Backfills all existing records to the confirmed legacy school.
- Preserves primary keys and existing row contents.
- Adds tenant-aware composite references between users, classrooms, sessions, schedules, memberships and events.
- Uses a temporary default tenant so the existing single-school API continues inserting rows into the only current school while the application is upgraded.
- Retains legacy global unique constraints during the compatibility window.

### Phase 2 — contract (`002_multischool_contract.sql`)
- Removes global username, national-ID hash, room-code and schedule-slot uniqueness.
- Replaces them with school-scoped uniqueness.
- Removes the temporary default tenant from all tables.

**Phase 2 must not be run on a live database until the tenant-aware Express API is deployed and every write supplies an explicit school_id.** Otherwise the old API will fail inserts after the defaults are removed.

## Important application work still required
These migrations do not by themselves make the running Express API tenant-safe. Before any live rollout, update and test all paths:
- password and student login (same usernames may exist in multiple schools; school code/slug must be part of login context);
- DB sessions and `/api/auth/me` (session tenant must be validated on every request);
- manager/staff/teacher/student creation and credentials;
- schedule reads/writes and class lifecycle;
- Excel import (teacher map, student upsert, schedule linking and conflict handling must all include tenant scope);
- classroom access, memberships, events and RTC configuration authorization.

The existing global username-based login cannot safely distinguish two schools that use the same username. The application changes are a hard prerequisite for enabling the second school.

## Disposable CI rehearsal
The existing `.github/workflows/validate.yml` creates a separate PostgreSQL database named `frahoosh_migration_rehearsal` inside the ephemeral GitHub Actions service. It applies the legacy schema, seeds sample legacy rows, runs phases 1 and 2, and executes regression assertions for:
- confirmed legacy tenant backfill and row preservation;
- same usernames, room codes and schedule slots in two schools;
- rejection of cross-school teacher, creator, session, schedule, classroom membership and event references.

The entire database is disposable and is destroyed with the Actions runner. No Supabase or Render production connection is used.

## Current status
- Prepared for rehearsal; awaiting GitHub Actions result.
- Not applied to production.
- No live records, schema, secrets or deployment settings were changed.
