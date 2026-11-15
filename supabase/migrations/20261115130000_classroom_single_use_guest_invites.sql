-- Single-use, school-scoped guest invitations for ad-hoc LiveKit sessions.
create table if not exists public.classroom_guest_invites (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.classroom_ad_hoc_meetings(id) on delete cascade,
  tenant_school_id uuid not null references public.schools(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  max_uses integer not null default 1 check (max_uses between 1 and 5),
  use_count integer not null default 0 check (use_count between 0 and max_uses),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists classroom_guest_invites_meeting_idx
  on public.classroom_guest_invites (meeting_id, created_at desc);
create index if not exists classroom_guest_invites_expiry_idx
  on public.classroom_guest_invites (expires_at)
  where revoked_at is null;

alter table public.classroom_guest_invites enable row level security;
revoke all on public.classroom_guest_invites from anon, authenticated;
grant all on public.classroom_guest_invites to service_role;

comment on table public.classroom_guest_invites is
  'Hashed, single-use guest tokens for a single ad-hoc meeting. Raw invitation tokens are returned once and never stored.';
