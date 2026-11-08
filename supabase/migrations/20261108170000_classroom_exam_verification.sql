-- Manager-controlled in-class verification and exam attention checks.
create table if not exists public.classroom_verification_settings (
  schedule_entry_id bigint primary key references public.weekly_schedule_entries(id) on delete cascade,
  tenant_school_id uuid not null references public.schools(id) on delete cascade,
  check1_time time not null,
  check2_time time not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint classroom_verification_distinct_times check (check1_time <> check2_time)
);
create index if not exists classroom_verification_settings_school_idx
  on public.classroom_verification_settings(tenant_school_id, schedule_entry_id);

create table if not exists public.classroom_verification_events (
  id uuid primary key default gen_random_uuid(),
  tenant_school_id uuid not null references public.schools(id) on delete cascade,
  schedule_entry_id bigint not null references public.weekly_schedule_entries(id) on delete cascade,
  student_id integer not null references public.students(id) on delete cascade,
  class_date date not null,
  check_slot smallint not null check (check_slot in (1,2)),
  status text not null default 'pending' check (status in ('pending','confirmed','missed')),
  prompt_at timestamptz not null default now(),
  deadline_at timestamptz not null,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  unique(schedule_entry_id, student_id, class_date, check_slot)
);
create index if not exists classroom_verification_events_student_idx
  on public.classroom_verification_events(tenant_school_id, student_id, class_date, status);

alter table public.assessment_attempts
  add column if not exists verification_due_at timestamptz,
  add column if not exists verification_code text,
  add column if not exists verification_completed_at timestamptz,
  add column if not exists locked_at timestamptz,
  add column if not exists lock_reason text;

alter table public.assessment_attempts drop constraint if exists assessment_attempts_status_check;
alter table public.assessment_attempts add constraint assessment_attempts_status_check
  check (status in ('in_progress','submitted','expired','graded','locked'));

alter table public.classroom_verification_settings enable row level security;
alter table public.classroom_verification_events enable row level security;
revoke all on public.classroom_verification_settings, public.classroom_verification_events from anon, authenticated;
grant all on public.classroom_verification_settings, public.classroom_verification_events to service_role;
