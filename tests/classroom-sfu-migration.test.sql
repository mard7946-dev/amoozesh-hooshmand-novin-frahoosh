\set ON_ERROR_STOP on

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then execute 'create role anon nologin'; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'create role authenticated nologin'; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then execute 'create role service_role nologin'; end if;
end
$$;

create table public.online_classes (id integer primary key);
create table public.classroom_ad_hoc_meetings (id uuid primary key);

\ir ../supabase/migrations/20261110100000_classroom_sfu_pilot.sql

insert into public.online_classes (id) values (17);
insert into public.classroom_ad_hoc_meetings (id)
values ('00000000-0000-4000-8000-000000000017');

select * from public.claim_classroom_sfu_participant(
  'school:00000000-0000-4000-8000-000000000001:class:17:42',
  '00000000-0000-4000-8000-000000000001',
  17,
  42,
  null,
  '00000000-0000-4000-8000-000000000002',
  'teacher',
  'دبیر آزمایشی'
);

update public.classroom_sfu_participants
set publisher_session_id = 'old-publisher',
    subscriber_session_id = 'old-subscriber',
    publications = '[{"kind":"audio","trackName":"audio","mid":"0"}]'::jsonb,
    status = 'active';

select * from public.claim_classroom_sfu_participant(
  'school:00000000-0000-4000-8000-000000000001:class:17:42',
  '00000000-0000-4000-8000-000000000001',
  17,
  42,
  null,
  '00000000-0000-4000-8000-000000000002',
  'teacher',
  'دبیر آزمایشی'
);

do $$
declare
  participant_count integer;
  participant_generation integer;
  participant_status text;
  publisher_id text;
  subscriber_id text;
  publication_data jsonb;
begin
  select count(*) into participant_count
    from public.classroom_sfu_participants
   where room_key = 'school:00000000-0000-4000-8000-000000000001:class:17:42'
     and auth_user_id = '00000000-0000-4000-8000-000000000002';
  select generation, status, publisher_session_id, subscriber_session_id, publications
    into participant_generation, participant_status, publisher_id, subscriber_id, publication_data
    from public.classroom_sfu_participants
   where room_key = 'school:00000000-0000-4000-8000-000000000001:class:17:42'
     and auth_user_id = '00000000-0000-4000-8000-000000000002';

  if participant_count <> 1 or participant_generation <> 2 or participant_status <> 'joining' then
    raise exception 'SFU participant claim did not advance the generation atomically';
  end if;
  if publisher_id is not null or subscriber_id is not null or publication_data <> '[]'::jsonb then
    raise exception 'SFU participant claim did not clear old session state';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.classroom_sfu_participants'::regclass) then
    raise exception 'RLS is not enabled on the SFU participant registry';
  end if;
  if has_table_privilege('anon', 'public.classroom_sfu_participants', 'SELECT')
     or has_table_privilege('authenticated', 'public.classroom_sfu_participants', 'SELECT')
     or not has_table_privilege('service_role', 'public.classroom_sfu_participants', 'SELECT') then
    raise exception 'SFU participant registry grants are not service-role-only';
  end if;
  if has_function_privilege('anon', 'public.claim_classroom_sfu_participant(text,uuid,integer,bigint,uuid,uuid,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.claim_classroom_sfu_participant(text,uuid,integer,bigint,uuid,uuid,text,text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.claim_classroom_sfu_participant(text,uuid,integer,bigint,uuid,uuid,text,text)', 'EXECUTE') then
    raise exception 'SFU participant claim RPC grants are not service-role-only';
  end if;

  begin
    insert into public.classroom_sfu_participants (
      tenant_school_id, room_key, online_class_id, schedule_entry_id,
      auth_user_id, role, display_name
    ) values (
      '00000000-0000-4000-8000-000000000001',
      'invalid-partial-class',
      17,
      null,
      '00000000-0000-4000-8000-000000000003',
      'teacher',
      'دبیر آزمایشی'
    );
    raise exception 'invalid partial class source unexpectedly passed';
  exception when check_violation then
    null;
  end;
end
$$;

select 'classroom SFU migration checks passed' as result;
