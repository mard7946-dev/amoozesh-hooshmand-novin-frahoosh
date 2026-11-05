-- Keep the four platform landing-page school-name drafts reproducible.
-- The production table already exists; IF NOT EXISTS makes this migration safe there too.
create table if not exists public.platform_school_drafts (
  id uuid primary key default gen_random_uuid(),
  slot_no smallint not null unique check (slot_no between 1 and 4),
  school_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.platform_school_drafts (slot_no)
select slots.slot_no
from generate_series(1, 4) as slots(slot_no)
where not exists (
  select 1
  from public.platform_school_drafts existing
  where existing.slot_no = slots.slot_no
);

alter table public.platform_school_drafts enable row level security;

-- Only the protected platform-management Edge Function uses the service role.
revoke all on table public.platform_school_drafts from anon, authenticated;
grant all on table public.platform_school_drafts to service_role;
