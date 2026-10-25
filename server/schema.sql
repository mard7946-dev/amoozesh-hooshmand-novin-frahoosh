-- Reference schema for the independent Frahoosh classroom backend.
-- The server also applies compatible CREATE/ALTER statements at startup.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS classroom_users (
  id BIGSERIAL PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('manager','teacher','student')),
  display_name TEXT NOT NULL,
  family_name TEXT,
  username TEXT UNIQUE,
  password_salt TEXT,
  password_hash TEXT,
  national_id_hash TEXT,
  grade_class TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS classroom_users_national_id_hash_uidx
  ON classroom_users(national_id_hash) WHERE national_id_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS classrooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  grade_class TEXT NOT NULL,
  teacher_user_id BIGINT NOT NULL REFERENCES classroom_users(id),
  room_code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','active','ended')),
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  created_by BIGINT NOT NULL REFERENCES classroom_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS classrooms_teacher_status_idx ON classrooms(teacher_user_id,status);
CREATE INDEX IF NOT EXISTS classrooms_grade_status_idx ON classrooms(grade_class,status);

CREATE TABLE IF NOT EXISTS classroom_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES classroom_users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS school_schedule (
  id BIGSERIAL PRIMARY KEY,
  day_of_week TEXT NOT NULL,
  period INTEGER NOT NULL CHECK (period BETWEEN 1 AND 12),
  grade_class TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  teacher_user_id BIGINT NOT NULL REFERENCES classroom_users(id),
  classroom_id UUID REFERENCES classrooms(id) ON DELETE SET NULL,
  start_time TIME,
  end_time TIME,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(day_of_week,period,grade_class)
);
CREATE INDEX IF NOT EXISTS school_schedule_teacher_day_idx ON school_schedule(teacher_user_id,day_of_week,period);

CREATE TABLE IF NOT EXISTS classroom_memberships (
  classroom_id UUID NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  student_user_id BIGINT NOT NULL REFERENCES classroom_users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (classroom_id,student_user_id)
);

CREATE TABLE IF NOT EXISTS classroom_events (
  id BIGSERIAL PRIMARY KEY,
  classroom_id UUID NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  actor_user_id BIGINT REFERENCES classroom_users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS classroom_events_room_time_idx ON classroom_events(classroom_id,created_at);
