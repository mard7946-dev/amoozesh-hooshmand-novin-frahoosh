create table if not exists public.exam_entry_cards (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id integer not null references public.students(id) on delete cascade,
  exam_period text not null default 'نوبت اول',
  first_name text not null,
  last_name text not null,
  father_name text not null default '',
  grade text not null default '',
  class_name text not null default '',
  seat_number text not null,
  photo_data text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, student_id, exam_period),
  constraint exam_entry_cards_photo_size check (photo_data is null or length(photo_data) <= 500000)
);
create index if not exists exam_entry_cards_school_period_class_idx
 on public.exam_entry_cards (school_id, exam_period, grade, class_name);
create unique index if not exists exam_entry_cards_unique_seat
 on public.exam_entry_cards (school_id, exam_period, seat_number)
 where seat_number <> '';
alter table public.exam_entry_cards enable row level security;
revoke all on public.exam_entry_cards from anon, authenticated;
grant all on public.exam_entry_cards to service_role;
