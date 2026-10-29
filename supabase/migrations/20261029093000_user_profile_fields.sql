-- Fields required by the manager's staff/student profile view and Excel import.
-- Safe to re-run: these columns may already exist in a live environment.
alter table public.teachers add column if not exists father_name text;
alter table public.teachers add column if not exists religion text;
alter table public.teachers add column if not exists sect text;
alter table public.staff add column if not exists father_name text;
