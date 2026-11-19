create table if not exists public.school_planning_records (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  academic_year text not null default '۱۴۰۵–۱۴۰۶'
    check (char_length(academic_year) between 4 and 24),
  record_type text not null
    check (record_type in ('annual_plan','calendar_event','balanced_assessment','operational_plan','daily_challenge')),
  title text not null check (char_length(title) between 2 and 180),
  summary text not null default '' check (char_length(summary) <= 2000),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  status text not null default 'draft'
    check (status in ('draft','active','in_progress','completed','needs_review','archived','cancelled')),
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists school_planning_records_school_year_type_idx
  on public.school_planning_records (school_id, academic_year, record_type, updated_at desc);
create index if not exists school_planning_records_school_status_idx
  on public.school_planning_records (school_id, status, updated_at desc);

alter table public.school_planning_records enable row level security;
revoke all on public.school_planning_records from anon, authenticated;
grant all on public.school_planning_records to service_role;

comment on table public.school_planning_records is
  'School-scoped annual plans, executive calendar, balanced-school assessments, operational actions, and daily challenges. Access is mediated by the manager-only school-planning Edge Function.';
