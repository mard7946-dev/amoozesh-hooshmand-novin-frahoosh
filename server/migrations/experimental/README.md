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

## Tenant-aware application branch prepared (not deployed)
A companion draft PR now scopes the Express API by authenticated school context: login and student login, database sessions, manager bootstrap, staff/student writes, Excel import writes/lookups, schedules, class listing/access/start/end, and event records. It includes disposable PostgreSQL tests for duplicate usernames in separate schools and cross-school room access denial.

The companion branch is still draft and has not been deployed. The current Render single-school compatibility fallback is controlled by `ALLOW_DEFAULT_SCHOOL_FALLBACK=true`; it must be disabled for a multi-school deployment, and every client must send `schoolId` or `schoolSlug`.

## Remaining rollout prerequisites
Before any live rollout, independently verify every client sends school context and that all external routes and operational jobs are tenant-scoped. These migrations do not by themselves make the running API tenant-safe.
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
- Database migration rehearsal passed in the original draft PR.
- Companion tenant-aware Express API draft prepared; PostgreSQL integration rerun pending.
- Not applied to production.
- No live records, schema, secrets or deployment settings were changed.
