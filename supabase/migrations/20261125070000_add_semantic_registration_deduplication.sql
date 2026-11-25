-- Add semantic duplicate protection for teacher-entered records.
-- A normal registration has duplicate_override_id = ''. Explicit confirmation gets a fresh UUID,
-- so intentional duplicate records remain possible while accidental repeats are rejected atomically.
BEGIN;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS dedupe_key text;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS duplicate_override_id text NOT NULL DEFAULT '';
ALTER TABLE public.student_grades ADD COLUMN IF NOT EXISTS dedupe_key text;
ALTER TABLE public.student_grades ADD COLUMN IF NOT EXISTS duplicate_override_id text NOT NULL DEFAULT '';
ALTER TABLE public.discipline_records ADD COLUMN IF NOT EXISTS dedupe_key text;
ALTER TABLE public.discipline_records ADD COLUMN IF NOT EXISTS duplicate_override_id text NOT NULL DEFAULT '';
ALTER TABLE public.assignments ADD COLUMN IF NOT EXISTS dedupe_key text;
ALTER TABLE public.assignments ADD COLUMN IF NOT EXISTS duplicate_override_id text NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS attendance_registration_dedupe_uidx ON public.attendance (tenant_school_id, dedupe_key, duplicate_override_id);
CREATE UNIQUE INDEX IF NOT EXISTS student_grades_registration_dedupe_uidx ON public.student_grades (tenant_school_id, dedupe_key, duplicate_override_id);
CREATE UNIQUE INDEX IF NOT EXISTS discipline_records_registration_dedupe_uidx ON public.discipline_records (tenant_school_id, dedupe_key, duplicate_override_id);
CREATE UNIQUE INDEX IF NOT EXISTS assignments_registration_dedupe_uidx ON public.assignments (tenant_school_id, dedupe_key, duplicate_override_id);
CREATE UNIQUE INDEX IF NOT EXISTS assignment_submissions_one_per_student_uidx ON public.assignment_submissions (tenant_school_id, assignment_id, student_id);
COMMIT;
