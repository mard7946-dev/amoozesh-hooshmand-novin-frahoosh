-- Manager-created ad-hoc online meetings with school-account and audience authorization.
create table if not exists public.classroom_ad_hoc_meetings (
  id uuid primary key default gen_random_uuid(),
  tenant_school_id uuid not null references public.schools(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 2 and 140),
  description text not null default '',
  audience_type text not null check (audience_type in ('all_school', 'roles')),
  audience_roles text[] not null default '{}',
  join_code uuid not null default gen_random_uuid() unique,
  cloudflare_meeting_id text not null,
  status text not null default 'active' check (status in ('active', 'ended', 'cancelled')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  constraint classroom_ad_hoc_meetings_roles_valid check (
    (audience_type = 'all_school' and cardinality(audience_roles) = 0)
    or
    (audience_type = 'roles' and cardinality(audience_roles) > 0)
  )
);

create index if not exists classroom_ad_hoc_meetings_school_created_idx
  on public.classroom_ad_hoc_meetings (tenant_school_id, created_at desc);
create index if not exists classroom_ad_hoc_meetings_active_expiry_idx
  on public.classroom_ad_hoc_meetings (tenant_school_id, status, expires_at);

alter table public.classroom_ad_hoc_meetings enable row level security;
revoke all on public.classroom_ad_hoc_meetings from anon, authenticated;
grant all on public.classroom_ad_hoc_meetings to service_role;

comment on table public.classroom_ad_hoc_meetings is
  'Manager-created ad-hoc RealtimeKit meetings. Join links require a valid school account and an allowed audience role; no recording is enabled by default.';
