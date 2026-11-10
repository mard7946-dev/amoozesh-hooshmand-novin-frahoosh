create table if not exists public.classroom_sfu_participants (
  id uuid primary key default gen_random_uuid(),
  tenant_school_id uuid not null,
  room_key text not null,
  online_class_id integer references public.online_classes(id) on delete cascade,
  schedule_entry_id bigint,
  ad_hoc_meeting_id uuid references public.classroom_ad_hoc_meetings(id) on delete cascade,
  auth_user_id uuid not null,
  role text not null,
  display_name text not null,
  generation integer not null default 1 check (generation > 0),
  publisher_session_id text,
  subscriber_session_id text,
  publications jsonb not null default '[]'::jsonb check (jsonb_typeof(publications) = 'array'),
  status text not null default 'joining' check (status in ('joining', 'active', 'left')),
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  left_at timestamptz,
  constraint classroom_sfu_participants_room_source_check check (
    (online_class_id is not null and schedule_entry_id is not null and ad_hoc_meeting_id is null)
    or
    (online_class_id is null and schedule_entry_id is null and ad_hoc_meeting_id is not null)
  ),
  constraint classroom_sfu_participants_room_key_nonempty check (length(trim(room_key)) between 1 and 180)
);

create unique index if not exists classroom_sfu_participants_room_user_uidx
  on public.classroom_sfu_participants (room_key, auth_user_id);

create index if not exists classroom_sfu_participants_room_status_idx
  on public.classroom_sfu_participants (room_key, status, last_seen_at desc);

create index if not exists classroom_sfu_participants_school_idx
  on public.classroom_sfu_participants (tenant_school_id, auth_user_id);

alter table public.classroom_sfu_participants enable row level security;
revoke all on table public.classroom_sfu_participants from public, anon, authenticated;
grant select, insert, update, delete on table public.classroom_sfu_participants to service_role;

create or replace function public.claim_classroom_sfu_participant(
  p_room_key text,
  p_tenant_school_id uuid,
  p_online_class_id integer,
  p_schedule_entry_id bigint,
  p_ad_hoc_meeting_id uuid,
  p_auth_user_id uuid,
  p_role text,
  p_display_name text
)
returns table (participant_id uuid, generation integer)
language sql
security definer
set search_path = ''
as $$
  insert into public.classroom_sfu_participants (
    tenant_school_id,
    room_key,
    online_class_id,
    schedule_entry_id,
    ad_hoc_meeting_id,
    auth_user_id,
    role,
    display_name,
    generation,
    status,
    publisher_session_id,
    subscriber_session_id,
    publications,
    joined_at,
    last_seen_at,
    left_at
  )
  values (
    p_tenant_school_id,
    p_room_key,
    p_online_class_id,
    p_schedule_entry_id,
    p_ad_hoc_meeting_id,
    p_auth_user_id,
    p_role,
    p_display_name,
    1,
    'joining',
    null,
    null,
    '[]'::jsonb,
    now(),
    now(),
    null
  )
  on conflict (room_key, auth_user_id)
  do update set
    tenant_school_id = excluded.tenant_school_id,
    online_class_id = excluded.online_class_id,
    schedule_entry_id = excluded.schedule_entry_id,
    ad_hoc_meeting_id = excluded.ad_hoc_meeting_id,
    role = excluded.role,
    display_name = excluded.display_name,
    generation = public.classroom_sfu_participants.generation + 1,
    status = 'joining',
    publisher_session_id = null,
    subscriber_session_id = null,
    publications = '[]'::jsonb,
    joined_at = now(),
    last_seen_at = now(),
    left_at = null
  returning id, public.classroom_sfu_participants.generation;
$$;

revoke all on function public.claim_classroom_sfu_participant(text, uuid, integer, bigint, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_classroom_sfu_participant(text, uuid, integer, bigint, uuid, uuid, text, text)
  to service_role;
