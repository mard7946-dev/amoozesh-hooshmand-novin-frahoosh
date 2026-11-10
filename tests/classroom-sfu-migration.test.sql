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
  subscription_data jsonb;
begin
  select count(*) into participant_count
    from public.classroom_sfu_participants
   where room_key = 'school:00000000-0000-4000-8000-000000000001:class:17:42'
     and auth_user_id = '00000000-0000-4000-8000-000000000002';
  select generation, status, publisher_session_id, subscriber_session_id, publications, subscriptions
    into participant_generation, participant_status, publisher_id, subscriber_id, publication_data, subscription_data
    from public.classroom_sfu_participants
   where room_key = 'school:00000000-0000-4000-8000-000000000001:class:17:42'
     and auth_user_id = '00000000-0000-4000-8000-000000000002';

  if participant_count <> 1 or participant_generation <> 2 or participant_status <> 'joining' then
    raise exception 'SFU participant claim did not advance the generation atomically';
  end if;
  if publisher_id is not null or subscriber_id is not null or publication_data <> '[]'::jsonb or subscription_data <> '[]'::jsonb then
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
  if has_function_privilege('anon', 'public.claim_classroom_sfu_session_mutation(uuid,integer,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.claim_classroom_sfu_session_mutation(uuid,integer,text,text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.claim_classroom_sfu_session_mutation(uuid,integer,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.release_classroom_sfu_session_mutation(uuid,integer,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.release_classroom_sfu_session_mutation(uuid,integer,text,text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.release_classroom_sfu_session_mutation(uuid,integer,text,text)', 'EXECUTE') then
    raise exception 'SFU session mutation RPC grants are not service-role-only';
  end if;
  if exists (
    select 1 from pg_proc
     where oid in (
       'public.claim_classroom_sfu_participant(text,uuid,integer,bigint,uuid,uuid,text,text)'::regprocedure,
       'public.claim_classroom_sfu_session_mutation(uuid,integer,text,text)'::regprocedure,
       'public.release_classroom_sfu_session_mutation(uuid,integer,text,text)'::regprocedure
     )
       and prosecdef
  ) then
    raise exception 'SFU RPCs must run as invoker, not SECURITY DEFINER';
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

update public.classroom_sfu_participants
set status = 'active'
where room_key = 'school:00000000-0000-4000-8000-000000000001:class:17:42'
  and auth_user_id = '00000000-0000-4000-8000-000000000002';

do $$
declare
  acquired boolean;
  released boolean;
begin
  select public.claim_classroom_sfu_session_mutation(
    (select id from public.classroom_sfu_participants
      where room_key = 'school:00000000-0000-4000-8000-000000000001:class:17:42'
        and auth_user_id = '00000000-0000-4000-8000-000000000002'),
    2,
    'publisher',
    'publish-mutation-001'
  ) into acquired;
  if not acquired then raise exception 'first publisher mutation lock was not acquired'; end if;

  select public.claim_classroom_sfu_session_mutation(
    (select id from public.classroom_sfu_participants
      where room_key = 'school:00000000-0000-4000-8000-000000000001:class:17:42'
        and auth_user_id = '00000000-0000-4000-8000-000000000002'),
    2,
    'publisher',
    'publish-mutation-002'
  ) into acquired;
  if acquired then raise exception 'concurrent publisher mutation was not blocked'; end if;

  select public.release_classroom_sfu_session_mutation(
    (select id from public.classroom_sfu_participants
      where room_key = 'school:00000000-0000-4000-8000-000000000001:class:17:42'
        and auth_user_id = '00000000-0000-4000-8000-000000000002'),
    2,
    'publisher',
    'publish-mutation-001'
  ) into released;
  if not released then raise exception 'publisher mutation lock was not released'; end if;

  select public.claim_classroom_sfu_session_mutation(
    (select id from public.classroom_sfu_participants
      where room_key = 'school:00000000-0000-4000-8000-000000000001:class:17:42'
        and auth_user_id = '00000000-0000-4000-8000-000000000002'),
    2,
    'subscriber',
    'subscribe-mutation-001'
  ) into acquired;
  if not acquired then raise exception 'subscriber lock should be independent of publisher lock'; end if;

  select public.release_classroom_sfu_session_mutation(
    (select id from public.classroom_sfu_participants
      where room_key = 'school:00000000-0000-4000-8000-000000000001:class:17:42'
        and auth_user_id = '00000000-0000-4000-8000-000000000002'),
    2,
    'subscriber',
    'subscribe-mutation-001'
  ) into released;
  if not released then raise exception 'subscriber mutation lock was not released'; end if;

  select public.claim_classroom_sfu_session_mutation(
    (select id from public.classroom_sfu_participants
      where room_key = 'school:00000000-0000-4000-8000-000000000001:class:17:42'
        and auth_user_id = '00000000-0000-4000-8000-000000000002'),
    2,
    'publisher',
    'bad'
  ) into acquired;
  if acquired then raise exception 'invalid mutation ID unexpectedly acquired a lock'; end if;
end
$$;

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
  participant_generation integer;
  publisher_lock text;
  subscriber_lock text;
begin
  select generation, publisher_mutation_id, subscriber_mutation_id
    into participant_generation, publisher_lock, subscriber_lock
    from public.classroom_sfu_participants
   where room_key = 'school:00000000-0000-4000-8000-000000000001:class:17:42'
     and auth_user_id = '00000000-0000-4000-8000-000000000002';
  if participant_generation <> 3 or publisher_lock is not null or subscriber_lock is not null then
    raise exception 'new SFU generation did not clear stale session mutation locks';
  end if;
end
$$;

select 'classroom SFU mutation lock checks passed' as result;
