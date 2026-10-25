-- Initial SQLite/D1 schema mapping only.
-- This does not migrate existing PostgreSQL data and is not production-ready.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schools (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_name TEXT NOT NULL,
  school_code TEXT NOT NULL UNIQUE,
  school_level TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  manager_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO schools(id,school_name,school_code,school_level,city,manager_name)
VALUES(1,'مدرسه پیش‌فرض فراهوش','FRAH001','','','مدیریت مدرسه');

CREATE TABLE IF NOT EXISTS classroom_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL CHECK (role IN (
    'manager', 'teacher', 'student',
    'educational_deputy', 'executive_deputy', 'pastoral_deputy'
  )),
  display_name TEXT NOT NULL,
  family_name TEXT,
  username TEXT UNIQUE,
  password_salt TEXT,
  password_hash TEXT,
  national_id_hash TEXT UNIQUE,
  grade_class TEXT,
  school_id INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS classrooms (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  grade_class TEXT NOT NULL,
  teacher_user_id INTEGER NOT NULL REFERENCES classroom_users(id),
  room_code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'active', 'ended')),
  starts_at TEXT,
  ends_at TEXT,
  created_by INTEGER NOT NULL REFERENCES classroom_users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  school_id INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id)
);

CREATE TABLE IF NOT EXISTS school_schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day_of_week TEXT NOT NULL,
  period INTEGER NOT NULL CHECK (period BETWEEN 1 AND 12),
  grade_class TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  teacher_user_id INTEGER NOT NULL REFERENCES classroom_users(id),
  classroom_id TEXT REFERENCES classrooms(id) ON DELETE SET NULL,
  start_time TEXT,
  end_time TEXT,
  UNIQUE (day_of_week, period, grade_class)
);

CREATE TABLE IF NOT EXISTS school_schedule_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  day_of_week TEXT NOT NULL,
  period INTEGER NOT NULL CHECK (period BETWEEN 1 AND 12),
  grade_class TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  teacher_user_id INTEGER NOT NULL REFERENCES classroom_users(id),
  classroom_id TEXT REFERENCES classrooms(id) ON DELETE SET NULL,
  start_time TEXT,
  end_time TEXT,
  UNIQUE (school_id, day_of_week, period, grade_class)
);

CREATE INDEX IF NOT EXISTS school_schedule_v2_school_teacher_day_idx
  ON school_schedule_v2(school_id, teacher_user_id, day_of_week, period);

CREATE TABLE IF NOT EXISTS school_schedule_v3 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id),
  day_of_week TEXT NOT NULL,
  period INTEGER NOT NULL CHECK (period BETWEEN 1 AND 12),
  grade_class TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  teacher_user_id INTEGER NOT NULL REFERENCES classroom_users(id),
  classroom_id TEXT REFERENCES classrooms(id) ON DELETE SET NULL,
  start_time TEXT,
  end_time TEXT,
  activation_mode TEXT NOT NULL DEFAULT 'scheduled' CHECK (activation_mode IN ('scheduled', 'manual')),
  UNIQUE (school_id, day_of_week, period, grade_class, subject, teacher_user_id)
);
CREATE INDEX IF NOT EXISTS school_schedule_v3_school_teacher_day_idx
  ON school_schedule_v3(school_id, teacher_user_id, day_of_week, period);


CREATE TABLE IF NOT EXISTS classroom_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES classroom_users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS classroom_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  actor_user_id INTEGER REFERENCES classroom_users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS classroom_users_role_idx ON classroom_users(role);
CREATE INDEX IF NOT EXISTS school_schedule_teacher_day_idx
  ON school_schedule(teacher_user_id, day_of_week, period);
CREATE INDEX IF NOT EXISTS classrooms_teacher_status_idx
  ON classrooms(teacher_user_id, status);
CREATE INDEX IF NOT EXISTS classrooms_grade_status_idx
  ON classrooms(grade_class, status);
CREATE INDEX IF NOT EXISTS classroom_events_room_time_idx
  ON classroom_events(classroom_id, created_at);

CREATE TABLE IF NOT EXISTS classroom_attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  student_user_id INTEGER NOT NULL REFERENCES classroom_users(id) ON DELETE CASCADE,
  session_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'joined'
    CHECK (status IN ('joined', 'prompted', 'present', 'unconfirmed', 'left')),
  joined_at TEXT NOT NULL,
  prompt_due_at TEXT NOT NULL,
  prompted_at TEXT,
  response_deadline TEXT,
  confirmed_at TEXT,
  left_at TEXT,
  UNIQUE (classroom_id, student_user_id, session_date)
);

CREATE INDEX IF NOT EXISTS classroom_attendance_school_date_idx
  ON classroom_attendance(school_id, session_date, status);
CREATE INDEX IF NOT EXISTS classroom_attendance_room_date_idx
  ON classroom_attendance(classroom_id, session_date);
