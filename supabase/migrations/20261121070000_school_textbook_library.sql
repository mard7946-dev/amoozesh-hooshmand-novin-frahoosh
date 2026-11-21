-- Private school textbook library for the smart exam designer.
-- All metadata and file access are mediated by the authenticated Edge Function.
create table if not exists public.school_textbook_library (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  grade smallint not null check (grade between 7 and 9),
  book_code text not null check (book_code ~ '^[A-Z][0-9]{2,5}$'),
  subject text not null check (char_length(btrim(subject)) between 2 and 120),
  title text not null default '',
  edition text not null default '۱۴۰۵–۱۴۰۶',
  file_name text not null check (file_name ~ '^[A-Za-z0-9._-]+[.]pdf$'),
  storage_path text not null unique,
  file_size_bytes bigint not null check (file_size_bytes > 0 and file_size_bytes <= 52428800),
  mime_type text not null default 'application/pdf' check (mime_type = 'application/pdf'),
  is_active boolean not null default true,
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, grade, book_code, edition)
);

create index if not exists school_textbook_library_lookup_idx
  on public.school_textbook_library (school_id, grade, subject, is_active, book_code);

alter table public.school_textbook_library enable row level security;
revoke all on public.school_textbook_library from public, anon, authenticated;
grant all on public.school_textbook_library to service_role;

-- Private bucket. Signed upload/download URLs are issued only by the authenticated
-- smart-exam-designer Edge Function after checking school membership and role.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('school-textbooks', 'school-textbooks', false, 52428800, array['application/pdf'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
