-- EXPERIMENTAL ONLY: do not run against production.
-- Expand-phase rehearsal for the standalone PostgreSQL classroom service.
-- All legacy rows are assigned to the school explicitly confirmed by the owner.
-- No rows are deleted or primary keys rewritten.
BEGIN;

CREATE TABLE IF NOT EXISTS school_tenants (
  id UUID PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO school_tenants (id, slug, display_name)
VALUES (
  '5c8b8880-1346-445c-89d8-3f76275a7ae5',
  'frahoosh-default',
  'دبیرستان سردار شهید حاجی‌زاده ۲'
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE classroom_users ADD COLUMN IF NOT EXISTS school_id UUID;
ALTER TABLE classrooms ADD COLUMN IF NOT EXISTS school_id UUID;
ALTER TABLE school_schedule ADD COLUMN IF NOT EXISTS school_id UUID;
ALTER TABLE classroom_sessions ADD COLUMN IF NOT EXISTS school_id UUID;
ALTER TABLE classroom_memberships ADD COLUMN IF NOT EXISTS school_id UUID;
ALTER TABLE classroom_events ADD COLUMN IF NOT EXISTS school_id UUID;

-- Backfill is intentionally deterministic and scoped to the confirmed legacy tenant.
UPDATE classroom_users SET school_id='5c8b8880-1346-445c-89d8-3f76275a7ae5' WHERE school_id IS NULL;
UPDATE classrooms SET school_id='5c8b8880-1346-445c-89d8-3f76275a7ae5' WHERE school_id IS NULL;
UPDATE school_schedule SET school_id='5c8b8880-1346-445c-89d8-3f76275a7ae5' WHERE school_id IS NULL;
UPDATE classroom_sessions SET school_id='5c8b8880-1346-445c-89d8-3f76275a7ae5' WHERE school_id IS NULL;
UPDATE classroom_memberships SET school_id='5c8b8880-1346-445c-89d8-3f76275a7ae5' WHERE school_id IS NULL;
UPDATE classroom_events SET school_id='5c8b8880-1346-445c-89d8-3f76275a7ae5' WHERE school_id IS NULL;

ALTER TABLE classroom_users ALTER COLUMN school_id SET DEFAULT '5c8b8880-1346-445c-89d8-3f76275a7ae5';
ALTER TABLE classroom_users ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE classrooms ALTER COLUMN school_id SET DEFAULT '5c8b8880-1346-445c-89d8-3f76275a7ae5';
ALTER TABLE classrooms ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE school_schedule ALTER COLUMN school_id SET DEFAULT '5c8b8880-1346-445c-89d8-3f76275a7ae5';
ALTER TABLE school_schedule ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE classroom_sessions ALTER COLUMN school_id SET DEFAULT '5c8b8880-1346-445c-89d8-3f76275a7ae5';
ALTER TABLE classroom_sessions ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE classroom_memberships ALTER COLUMN school_id SET DEFAULT '5c8b8880-1346-445c-89d8-3f76275a7ae5';
ALTER TABLE classroom_memberships ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE classroom_events ALTER COLUMN school_id SET DEFAULT '5c8b8880-1346-445c-89d8-3f76275a7ae5';
ALTER TABLE classroom_events ALTER COLUMN school_id SET NOT NULL;

ALTER TABLE classroom_users
  ADD CONSTRAINT classroom_users_school_id_fkey FOREIGN KEY (school_id) REFERENCES school_tenants(id);
ALTER TABLE classrooms
  ADD CONSTRAINT classrooms_school_id_fkey FOREIGN KEY (school_id) REFERENCES school_tenants(id);
ALTER TABLE school_schedule
  ADD CONSTRAINT school_schedule_school_id_fkey FOREIGN KEY (school_id) REFERENCES school_tenants(id);
ALTER TABLE classroom_sessions
  ADD CONSTRAINT classroom_sessions_school_id_fkey FOREIGN KEY (school_id) REFERENCES school_tenants(id);
ALTER TABLE classroom_memberships
  ADD CONSTRAINT classroom_memberships_school_id_fkey FOREIGN KEY (school_id) REFERENCES school_tenants(id);
ALTER TABLE classroom_events
  ADD CONSTRAINT classroom_events_school_id_fkey FOREIGN KEY (school_id) REFERENCES school_tenants(id);

-- Composite keys allow tenant-safe foreign keys in the next application-code phase.
ALTER TABLE classroom_users ADD CONSTRAINT classroom_users_id_school_id_key UNIQUE (id, school_id);
ALTER TABLE classrooms ADD CONSTRAINT classrooms_id_school_id_key UNIQUE (id, school_id);

-- Keep legacy global unique constraints during the expand phase. The application
-- continues to use ON CONFLICT(username) until tenant-aware API code is deployed.
-- Tenant-scoped unique indexes and removal of these legacy constraints belong to
-- the gated contract migration, after all writers pass explicit school_id.

ALTER TABLE classrooms
  ADD CONSTRAINT classrooms_teacher_school_fkey
  FOREIGN KEY (teacher_user_id, school_id) REFERENCES classroom_users(id, school_id);
ALTER TABLE classrooms
  ADD CONSTRAINT classrooms_creator_school_fkey
  FOREIGN KEY (created_by, school_id) REFERENCES classroom_users(id, school_id);
ALTER TABLE school_schedule
  ADD CONSTRAINT school_schedule_teacher_school_fkey
  FOREIGN KEY (teacher_user_id, school_id) REFERENCES classroom_users(id, school_id);
ALTER TABLE school_schedule
  ADD CONSTRAINT school_schedule_classroom_school_fkey
  FOREIGN KEY (classroom_id, school_id) REFERENCES classrooms(id, school_id);
ALTER TABLE classroom_sessions
  ADD CONSTRAINT classroom_sessions_user_school_fkey
  FOREIGN KEY (user_id, school_id) REFERENCES classroom_users(id, school_id) ON DELETE CASCADE;
ALTER TABLE classroom_memberships
  ADD CONSTRAINT classroom_memberships_classroom_school_fkey
  FOREIGN KEY (classroom_id, school_id) REFERENCES classrooms(id, school_id) ON DELETE CASCADE;
ALTER TABLE classroom_memberships
  ADD CONSTRAINT classroom_memberships_student_school_fkey
  FOREIGN KEY (student_user_id, school_id) REFERENCES classroom_users(id, school_id) ON DELETE CASCADE;
ALTER TABLE classroom_events
  ADD CONSTRAINT classroom_events_classroom_school_fkey
  FOREIGN KEY (classroom_id, school_id) REFERENCES classrooms(id, school_id) ON DELETE CASCADE;
ALTER TABLE classroom_events
  ADD CONSTRAINT classroom_events_actor_school_fkey
  FOREIGN KEY (actor_user_id, school_id) REFERENCES classroom_users(id, school_id);

COMMIT;
