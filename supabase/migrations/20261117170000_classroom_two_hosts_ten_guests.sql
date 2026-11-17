-- Support two explicitly capacity-limited school hosts and up to ten guest entries.
-- Existing invitations keep their current max_uses values; only newly created links use ten.
alter table public.classroom_guest_invites
  drop constraint if exists classroom_guest_invites_max_uses_check;
alter table public.classroom_guest_invites
  add constraint classroom_guest_invites_max_uses_check
  check (max_uses between 1 and 10);
alter table public.classroom_guest_invites
  drop constraint if exists classroom_guest_invites_use_count_check;
alter table public.classroom_guest_invites
  add constraint classroom_guest_invites_use_count_check
  check (use_count between 0 and max_uses);

create table if not exists public.classroom_meeting_host_slots (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.classroom_ad_hoc_meetings(id) on delete cascade,
  tenant_school_id uuid not null references public.schools(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  unique (meeting_id, auth_user_id)
);
create index if not exists classroom_meeting_host_slots_school_idx
  on public.classroom_meeting_host_slots (tenant_school_id, meeting_id);
alter table public.classroom_meeting_host_slots enable row level security;
revoke all on public.classroom_meeting_host_slots from anon, authenticated;
grant all on public.classroom_meeting_host_slots to service_role;

-- Atomic guest-use claim: concurrent joins cannot overrun max_uses or spuriously
-- reject all but one request that observed the same previous use_count.
create or replace function public.claim_classroom_guest_invite(p_token_hash text)
returns setof public.classroom_guest_invites
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.classroom_guest_invites
     set use_count = use_count + 1
   where token_hash = p_token_hash
     and revoked_at is null
     and expires_at > now()
     and use_count < max_uses
  returning *;
$$;
revoke all on function public.claim_classroom_guest_invite(text) from public, anon, authenticated;
grant execute on function public.claim_classroom_guest_invite(text) to service_role;

-- A school-scoped, concurrency-safe two-seat host claim. The Edge Function
-- validates active manager/deputy membership before calling this function.
create or replace function public.claim_classroom_meeting_host_slot(
  p_meeting_id uuid,
  p_school_id uuid,
  p_auth_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  existing_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_meeting_id::text, 0));

  if not exists (
    select 1 from public.classroom_ad_hoc_meetings
     where id = p_meeting_id
       and tenant_school_id = p_school_id
       and status = 'active'
       and expires_at > now()
  ) then
    return false;
  end if;

  if exists (
    select 1 from public.classroom_meeting_host_slots
     where meeting_id = p_meeting_id
       and tenant_school_id = p_school_id
       and auth_user_id = p_auth_user_id
  ) then
    return true;
  end if;

  select count(*) into existing_count
    from public.classroom_meeting_host_slots
   where meeting_id = p_meeting_id
     and tenant_school_id = p_school_id;

  if existing_count >= 2 then
    return false;
  end if;

  insert into public.classroom_meeting_host_slots(meeting_id, tenant_school_id, auth_user_id)
  values (p_meeting_id, p_school_id, p_auth_user_id);

  return true;
end;
$$;
revoke all on function public.claim_classroom_meeting_host_slot(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_classroom_meeting_host_slot(uuid, uuid, uuid) to service_role;

comment on table public.classroom_meeting_host_slots is
  'At most two distinct active school manager/deputy identities may hold host privileges in an ad-hoc meeting.';
