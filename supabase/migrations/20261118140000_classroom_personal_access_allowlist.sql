create table if not exists public.classroom_user_access (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  tenant_school_id uuid not null,
  enabled boolean not null default false,
  is_owner boolean not null default false,
  granted_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.classroom_user_access enable row level security;
revoke all on table public.classroom_user_access from anon, authenticated;
grant all on table public.classroom_user_access to service_role;

-- The designated account is provisioned separately by the controlled deployment
-- migration/administrative process; no other account receives access by default.
