-- EXPERIMENTAL ONLY: gated contract phase.
-- Apply only after the Express API has been deployed with explicit school_id
-- on every insert, login lookup, session lookup and tenant-scoped query.
-- Do not apply to production as part of this rehearsal.
BEGIN;

ALTER TABLE classroom_users DROP CONSTRAINT IF EXISTS classroom_users_username_key;
DROP INDEX IF EXISTS classroom_users_national_id_hash_uidx;
ALTER TABLE classrooms DROP CONSTRAINT IF EXISTS classrooms_room_code_key;
ALTER TABLE school_schedule DROP CONSTRAINT IF EXISTS school_schedule_day_of_week_period_grade_class_key;

CREATE UNIQUE INDEX IF NOT EXISTS classroom_users_school_username_uidx
  ON classroom_users (school_id, username);
CREATE UNIQUE INDEX IF NOT EXISTS classroom_users_school_national_id_uidx
  ON classroom_users (school_id, national_id_hash) WHERE national_id_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS classrooms_school_room_code_uidx
  ON classrooms (school_id, room_code);
CREATE UNIQUE INDEX IF NOT EXISTS school_schedule_school_slot_uidx
  ON school_schedule (school_id, day_of_week, period, grade_class);

-- No fallback tenant is allowed after tenant-aware application code is live.
ALTER TABLE classroom_users ALTER COLUMN school_id DROP DEFAULT;
ALTER TABLE classrooms ALTER COLUMN school_id DROP DEFAULT;
ALTER TABLE school_schedule ALTER COLUMN school_id DROP DEFAULT;
ALTER TABLE classroom_sessions ALTER COLUMN school_id DROP DEFAULT;
ALTER TABLE classroom_memberships ALTER COLUMN school_id DROP DEFAULT;
ALTER TABLE classroom_events ALTER COLUMN school_id DROP DEFAULT;

COMMIT;
