-- Final reference schema for the independent multi-school classroom backend.
-- Existing installations must use the reviewed two-phase experimental migrations;
-- do not replace a live schema directly with this reference file.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS school_tenants (
  id UUID PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS classroom_users (
  id BIGSERIAL PRIMARY KEY,
  school_id UUID NOT NULL REFERENCES school_tenants(id),
  role TEXT NOT NULL CHECK (role IN ('manager','teacher','student','educational_deputy','executive_deputy','pastoral_deputy')),
  display_name TEXT NOT NULL,
  family_name TEXT,
  username TEXT,
  password_salt TEXT,
  password_hash TEXT,
  national_id_hash TEXT,
  grade_class TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, school_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS classroom_users_school_username_uidx
  ON classroom_users(school_id,username) WHERE username IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS classroom_users_school_national_id_uidx
  ON classroom_users(school_id,national_id_hash) WHERE national_id_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS classrooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES school_tenants(id),
  title TEXT NOT NULL,
  grade_class TEXT NOT NULL,
  teacher_user_id BIGINT NOT NULL,
  room_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','active','ended')),
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  created_by BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, school_id),
  FOREIGN KEY (teacher_user_id, school_id) REFERENCES classroom_users(id, school_id),
  FOREIGN KEY (created_by, school_id) REFERENCES classroom_users(id, school_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS classrooms_school_room_code_uidx
  ON classrooms(school_id,room_code);
CREATE INDEX IF NOT EXISTS classrooms_teacher_status_idx
  ON classrooms(school_id,teacher_user_id,status);
CREATE INDEX IF NOT EXISTS classrooms_grade_status_idx
  ON classrooms(school_id,grade_class,status);

CREATE TABLE IF NOT EXISTS classroom_sessions (
  token_hash TEXT PRIMARY KEY,
  school_id UUID NOT NULL REFERENCES school_tenants(id),
  user_id BIGINT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id, school_id) REFERENCES classroom_users(id, school_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS school_schedule (
  id BIGSERIAL PRIMARY KEY,
  school_id UUID NOT NULL REFERENCES school_tenants(id),
  day_of_week TEXT NOT NULL,
  period INTEGER NOT NULL CHECK (period BETWEEN 1 AND 12),
  grade_class TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  teacher_user_id BIGINT NOT NULL,
  classroom_id UUID,
  start_time TIME,
  end_time TIME,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (teacher_user_id, school_id) REFERENCES classroom_users(id, school_id),
  FOREIGN KEY (classroom_id, school_id) REFERENCES classrooms(id, school_id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS school_schedule_school_slot_uidx
  ON school_schedule(school_id,day_of_week,period,grade_class);
CREATE INDEX IF NOT EXISTS school_schedule_teacher_day_idx
  ON school_schedule(school_id,teacher_user_id,day_of_week,period);

CREATE TABLE IF NOT EXISTS classroom_memberships (
  school_id UUID NOT NULL REFERENCES school_tenants(id),
  classroom_id UUID NOT NULL,
  student_user_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (classroom_id,student_user_id),
  FOREIGN KEY (classroom_id, school_id) REFERENCES classrooms(id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (student_user_id, school_id) REFERENCES classroom_users(id, school_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS classroom_events (
  id BIGSERIAL PRIMARY KEY,
  school_id UUID NOT NULL REFERENCES school_tenants(id),
  classroom_id UUID NOT NULL,
  actor_user_id BIGINT,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (classroom_id, school_id) REFERENCES classrooms(id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id, school_id) REFERENCES classroom_users(id, school_id)
);
CREATE INDEX IF NOT EXISTS classroom_events_room_time_idx
  ON classroom_events(school_id,classroom_id,created_at);
