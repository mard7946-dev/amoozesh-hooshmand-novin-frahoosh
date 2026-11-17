create table if not exists public.school_exam_plans (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  title text not null check (char_length(title) between 2 and 160),
  start_date date not null,
  end_date date not null,
  allowed_weekdays smallint[] not null default array[0,1,2,3,4,5,6]::smallint[],
  holidays date[] not null default '{}'::date[],
  grade_plans jsonb not null default '[]'::jsonb,
  schedule jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft','published')),
  created_by uuid not null references auth.users(id),
  published_by uuid references auth.users(id),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint school_exam_plans_date_range check (end_date >= start_date),
  constraint school_exam_plans_grade_plans_array check (jsonb_typeof(grade_plans) = 'array'),
  constraint school_exam_plans_schedule_array check (jsonb_typeof(schedule) = 'array')
);
create index if not exists school_exam_plans_school_status_idx
  on public.school_exam_plans (school_id, status, start_date desc);
alter table public.school_exam_plans enable row level security;
revoke all on public.school_exam_plans from anon, authenticated;
grant all on public.school_exam_plans to service_role;
