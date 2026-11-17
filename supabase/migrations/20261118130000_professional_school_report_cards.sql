create table if not exists public.school_report_cards (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  student_ref text not null,
  student_id integer,
  student_name text not null check (char_length(student_name) between 2 and 160),
  grade text not null,
  class_name text not null,
  academic_year text not null,
  term text not null default 'میان‌ترم',
  subjects jsonb not null default '[]'::jsonb check (jsonb_typeof(subjects) = 'array'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, student_ref, academic_year, term)
);
create index if not exists school_report_cards_rank_idx
  on public.school_report_cards (school_id, academic_year, term, grade, class_name);
alter table public.school_report_cards enable row level security;
revoke all on public.school_report_cards from anon, authenticated;
grant all on public.school_report_cards to service_role;
