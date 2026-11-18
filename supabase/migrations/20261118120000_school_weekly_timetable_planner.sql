-- Versioned, school-isolated weekly timetable drafts.
-- Kept separate from weekly_schedule_entries so existing online-class behavior is untouched.
create table if not exists public.school_weekly_timetable_plans (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  academic_year text not null check (char_length(academic_year) between 4 and 20),
  title text not null default 'برنامه اصلی' check (char_length(title) between 2 and 120),
  status text not null default 'draft' check (status in ('draft','published')),
  requirements jsonb not null default '[]'::jsonb,
  teacher_workdays jsonb not null default '[]'::jsonb,
  slots jsonb not null default '[]'::jsonb,
  validation jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  published_by uuid references auth.users(id),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint school_weekly_timetable_requirements_array check (jsonb_typeof(requirements) = 'array'),
  constraint school_weekly_timetable_workdays_array check (jsonb_typeof(teacher_workdays) = 'array'),
  constraint school_weekly_timetable_slots_array check (jsonb_typeof(slots) = 'array'),
  constraint school_weekly_timetable_validation_object check (jsonb_typeof(validation) = 'object')
);

create index if not exists school_weekly_timetable_school_year_idx
  on public.school_weekly_timetable_plans (school_id, academic_year, updated_at desc);

alter table public.school_weekly_timetable_plans enable row level security;
revoke all on public.school_weekly_timetable_plans from anon, authenticated;
grant all on public.school_weekly_timetable_plans to service_role;

comment on table public.school_weekly_timetable_plans is
  'Draft/published school timetables. Each cell stores independent even-week and odd-week assignments; isolated from live classroom schedule entries.';
comment on column public.school_weekly_timetable_plans.slots is
  'Array of {class_name, weekday, period, even:{subject,teacher_id,teacher_name}, odd:{subject,teacher_id,teacher_name}} cells.';
