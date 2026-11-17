create table if not exists public.school_report_card_teachers (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  grade text not null,
  class_name text not null,
  subject text not null check (subject in ('عربی','علوم','زبان','ریاضی','مطالعات','فارسی','انضباط')),
  teacher_name text not null check (char_length(teacher_name) between 2 and 120),
  created_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  unique (school_id, grade, class_name, subject)
);
create index if not exists school_report_card_teachers_class_idx
  on public.school_report_card_teachers (school_id, grade, class_name);
alter table public.school_report_card_teachers enable row level security;
revoke all on public.school_report_card_teachers from anon, authenticated;
grant all on public.school_report_card_teachers to service_role;
