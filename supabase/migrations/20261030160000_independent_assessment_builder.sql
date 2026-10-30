create table if not exists public.assessment_exams (
  id uuid primary key default gen_random_uuid(),
  tenant_school_id uuid not null references public.schools(id) on delete cascade,
  teacher_id integer not null references public.teachers(id) on delete restrict,
  title text not null,
  subject text not null default '',
  grade text not null,
  class_name text not null,
  description text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  question_order text not null default 'sequential' check (question_order in ('sequential','random')),
  display_mode text not null default 'single' check (display_mode in ('single','group')),
  group_size integer not null default 1 check (group_size between 1 and 100),
  duration_minutes integer not null default 45 check (duration_minutes between 1 and 600),
  max_attempts integer not null default 1 check (max_attempts between 1 and 10),
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assessment_exam_window check (ends_at > starts_at)
);
create table if not exists public.assessment_questions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.assessment_exams(id) on delete cascade,
  position integer not null check (position > 0),
  question_type text not null check (question_type in ('fill_blank','multiple_choice','true_false','short_answer','essay')),
  prompt text not null,
  options jsonb not null default '[]'::jsonb,
  correct_answer text not null default '',
  points numeric(8,2) not null default 1 check (points >= 0),
  time_limit_seconds integer check (time_limit_seconds is null or time_limit_seconds between 1 and 3600),
  math_markup text not null default '',
  diagram_shapes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (exam_id, position)
);
create table if not exists public.assessment_attempts (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.assessment_exams(id) on delete cascade,
  student_id integer not null references public.students(id) on delete restrict,
  tenant_school_id uuid not null references public.schools(id) on delete cascade,
  status text not null default 'in_progress' check (status in ('in_progress','submitted','expired','graded')),
  question_order jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  score numeric(8,2) not null default 0,
  max_score numeric(8,2) not null default 0
);
create table if not exists public.assessment_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.assessment_attempts(id) on delete cascade,
  question_id uuid not null references public.assessment_questions(id) on delete cascade,
  answer text not null default '',
  score numeric(8,2) not null default 0,
  is_correct boolean,
  auto_graded boolean not null default false,
  answered_at timestamptz not null default now(),
  unique (attempt_id, question_id)
);
create index if not exists assessment_exams_teacher_class_idx on public.assessment_exams (tenant_school_id, teacher_id, grade, class_name, starts_at desc);
create index if not exists assessment_exams_student_window_idx on public.assessment_exams (tenant_school_id, grade, class_name, published, starts_at, ends_at);
create index if not exists assessment_questions_exam_position_idx on public.assessment_questions (exam_id, position);
create index if not exists assessment_attempts_exam_status_idx on public.assessment_attempts (exam_id, status, started_at desc);
create index if not exists assessment_attempts_student_exam_idx on public.assessment_attempts (student_id, exam_id, started_at desc);
create index if not exists assessment_answers_attempt_idx on public.assessment_answers (attempt_id);
alter table public.assessment_exams enable row level security;
alter table public.assessment_questions enable row level security;
alter table public.assessment_attempts enable row level security;
alter table public.assessment_answers enable row level security;
revoke all on public.assessment_exams, public.assessment_questions, public.assessment_attempts, public.assessment_answers from anon, authenticated;
grant all on public.assessment_exams, public.assessment_questions, public.assessment_attempts, public.assessment_answers to service_role;