-- Secure teacher draft -> confidential final exam vault workflow.
-- Existing question-bank records are preserved; this migration adds an isolated workflow.
create table if not exists public.smart_exam_papers (
  id uuid primary key default gen_random_uuid(),
  tenant_school_id uuid not null references public.schools(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 2 and 180),
  subject text not null check (char_length(btrim(subject)) between 2 and 100),
  grade smallint not null check (grade between 7 and 9),
  book_title text not null check (char_length(btrim(book_title)) between 2 and 180),
  book_edition text not null default '۱۴۰۵–۱۴۰۶',
  chapter text not null default '',
  lesson text not null default '',
  topic text not null default '',
  page_reference text not null default '',
  curriculum_source_url text not null default 'https://chap.sch.ir/',
  status text not null default 'draft'
    check (status in ('draft','submitted','archived')),
  total_points numeric(8,2) not null default 0
    check (total_points >= 0 and total_points <= 100),
  submitted_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.smart_exam_draft_payloads (
  paper_id uuid primary key references public.smart_exam_papers(id) on delete cascade,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz not null default now()
);

create table if not exists public.smart_exam_vault (
  paper_id uuid primary key references public.smart_exam_papers(id) on delete restrict,
  tenant_school_id uuid not null references public.schools(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  title text not null,
  subject text not null,
  grade smallint not null check (grade between 7 and 9),
  book_title text not null,
  book_edition text not null,
  chapter text not null default '',
  lesson text not null default '',
  topic text not null default '',
  page_reference text not null default '',
  curriculum_source_url text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  total_points numeric(8,2) not null check (total_points > 0 and total_points <= 100),
  status text not null default 'active' check (status in ('active','archived')),
  finalized_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references auth.users(id) on delete restrict
);

create table if not exists public.smart_exam_audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_school_id uuid not null references public.schools(id) on delete cascade,
  paper_id uuid not null references public.smart_exam_papers(id) on delete restrict,
  actor_auth_user_id uuid not null references auth.users(id) on delete restrict,
  event_type text not null check (event_type in ('draft_created','draft_updated','finalized','archived')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists smart_exam_papers_owner_idx
  on public.smart_exam_papers(tenant_school_id, created_by, updated_at desc);
create index if not exists smart_exam_vault_school_status_idx
  on public.smart_exam_vault(tenant_school_id, status, finalized_at desc);
create index if not exists smart_exam_audit_paper_idx
  on public.smart_exam_audit_logs(tenant_school_id, paper_id, created_at desc);

alter table public.smart_exam_papers enable row level security;
alter table public.smart_exam_draft_payloads enable row level security;
alter table public.smart_exam_vault enable row level security;
alter table public.smart_exam_audit_logs enable row level security;

revoke all on public.smart_exam_papers, public.smart_exam_draft_payloads,
  public.smart_exam_vault, public.smart_exam_audit_logs from anon, authenticated;
grant all on public.smart_exam_papers, public.smart_exam_draft_payloads,
  public.smart_exam_vault, public.smart_exam_audit_logs to service_role;

-- Final content cannot be rewritten after insertion. Only archive metadata may change.
create or replace function public.prevent_smart_exam_vault_content_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.paper_id is distinct from old.paper_id
     or new.tenant_school_id is distinct from old.tenant_school_id
     or new.created_by is distinct from old.created_by
     or new.title is distinct from old.title
     or new.subject is distinct from old.subject
     or new.grade is distinct from old.grade
     or new.book_title is distinct from old.book_title
     or new.book_edition is distinct from old.book_edition
     or new.chapter is distinct from old.chapter
     or new.lesson is distinct from old.lesson
     or new.topic is distinct from old.topic
     or new.page_reference is distinct from old.page_reference
     or new.curriculum_source_url is distinct from old.curriculum_source_url
     or new.payload is distinct from old.payload
     or new.total_points is distinct from old.total_points
     or new.finalized_at is distinct from old.finalized_at then
    raise exception 'Final exam content is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists smart_exam_vault_immutable_content on public.smart_exam_vault;
create trigger smart_exam_vault_immutable_content
before update on public.smart_exam_vault
for each row execute function public.prevent_smart_exam_vault_content_update();

-- These RPCs are callable only by the Edge Function's service-role client.
create or replace function public.save_smart_exam_draft(
  p_paper_id uuid,
  p_school_id uuid,
  p_actor_id uuid,
  p_title text,
  p_subject text,
  p_grade smallint,
  p_book_title text,
  p_book_edition text,
  p_chapter text,
  p_lesson text,
  p_topic text,
  p_page_reference text,
  p_curriculum_source_url text,
  p_payload jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_paper_id uuid;
  v_event text;
begin
  if p_grade not between 7 and 9
     or char_length(btrim(coalesce(p_title,''))) not between 2 and 180
     or char_length(btrim(coalesce(p_subject,''))) not between 2 and 100
     or char_length(btrim(coalesce(p_book_title,''))) not between 2 and 180
     or jsonb_typeof(p_payload) <> 'object'
     or jsonb_typeof(p_payload->'questions') <> 'array' then
    raise exception 'Invalid smart exam draft';
  end if;

  if p_paper_id is null then
    insert into public.smart_exam_papers (
      tenant_school_id, created_by, title, subject, grade, book_title,
      book_edition, chapter, lesson, topic, page_reference, curriculum_source_url
    ) values (
      p_school_id, p_actor_id, btrim(p_title), btrim(p_subject), p_grade,
      btrim(p_book_title), coalesce(nullif(btrim(p_book_edition),''),'۱۴۰۵–۱۴۰۶'),
      coalesce(p_chapter,''), coalesce(p_lesson,''), coalesce(p_topic,''),
      coalesce(p_page_reference,''), coalesce(nullif(btrim(p_curriculum_source_url),''),'https://chap.sch.ir/')
    ) returning id into v_paper_id;
    v_event := 'draft_created';
  else
    update public.smart_exam_papers
    set title=btrim(p_title), subject=btrim(p_subject), grade=p_grade,
        book_title=btrim(p_book_title),
        book_edition=coalesce(nullif(btrim(p_book_edition),''),'۱۴۰۵–۱۴۰۶'),
        chapter=coalesce(p_chapter,''), lesson=coalesce(p_lesson,''),
        topic=coalesce(p_topic,''), page_reference=coalesce(p_page_reference,''),
        curriculum_source_url=coalesce(nullif(btrim(p_curriculum_source_url),''),'https://chap.sch.ir/'),
        updated_at=now()
    where id=p_paper_id and tenant_school_id=p_school_id
      and created_by=p_actor_id and status='draft'
    returning id into v_paper_id;
    if v_paper_id is null then
      raise exception 'Draft not found or locked';
    end if;
    v_event := 'draft_updated';
  end if;

  insert into public.smart_exam_draft_payloads(paper_id,payload,updated_at)
  values(v_paper_id,p_payload,now())
  on conflict(paper_id) do update
    set payload=excluded.payload, updated_at=now();

  insert into public.smart_exam_audit_logs(
    tenant_school_id,paper_id,actor_auth_user_id,event_type,details
  ) values (
    p_school_id,v_paper_id,p_actor_id,v_event,
    jsonb_build_object('question_count',jsonb_array_length(p_payload->'questions'))
  );
  return v_paper_id;
end;
$$;

create or replace function public.finalize_smart_exam(
  p_paper_id uuid,
  p_school_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_paper public.smart_exam_papers%rowtype;
  v_payload jsonb;
  v_count integer;
  v_invalid_points integer;
  v_total numeric(8,2);
begin
  select p.* into v_paper
  from public.smart_exam_papers p
  where p.id=p_paper_id and p.tenant_school_id=p_school_id
    and p.created_by=p_actor_id and p.status='draft'
  for update;
  if not found then
    raise exception 'Draft not found or already locked';
  end if;

  select d.payload into v_payload
  from public.smart_exam_draft_payloads d
  where d.paper_id=p_paper_id
  for update;
  if not found or jsonb_typeof(v_payload->'questions') <> 'array' then
    raise exception 'Draft questions are missing';
  end if;

  select count(*)::integer,
         count(*) filter (where coalesce(question->>'points','') !~ '^[0-9]+([.][0-9]{1,2})?$')::integer,
         coalesce(sum(case
           when coalesce(question->>'points','') ~ '^[0-9]+([.][0-9]{1,2})?$'
           then (question->>'points')::numeric else 0 end),0)::numeric(8,2)
  into v_count,v_invalid_points,v_total
  from jsonb_array_elements(v_payload->'questions') as items(question);

  if v_count < 1 or v_count > 100 or v_invalid_points > 0
     or v_total <= 0 or v_total > 100 then
    raise exception 'Invalid question count or total points';
  end if;

  insert into public.smart_exam_vault(
    paper_id,tenant_school_id,created_by,title,subject,grade,book_title,
    book_edition,chapter,lesson,topic,page_reference,curriculum_source_url,
    payload,total_points
  ) values (
    v_paper.id,v_paper.tenant_school_id,v_paper.created_by,v_paper.title,
    v_paper.subject,v_paper.grade,v_paper.book_title,v_paper.book_edition,
    v_paper.chapter,v_paper.lesson,v_paper.topic,v_paper.page_reference,
    v_paper.curriculum_source_url,v_payload,v_total
  );

  update public.smart_exam_papers
  set status='submitted',total_points=v_total,submitted_at=now(),updated_at=now()
  where id=v_paper.id;

  delete from public.smart_exam_draft_payloads where paper_id=v_paper.id;

  insert into public.smart_exam_audit_logs(
    tenant_school_id,paper_id,actor_auth_user_id,event_type,details
  ) values (
    p_school_id,v_paper.id,p_actor_id,'finalized',
    jsonb_build_object('total_points',v_total,'question_count',v_count)
  );

  return jsonb_build_object('paper_id',v_paper.id,'total_points',v_total,'status','submitted');
end;
$$;

create or replace function public.archive_smart_exam(
  p_paper_id uuid,
  p_school_id uuid,
  p_actor_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_paper_id uuid;
begin
  select paper_id into v_paper_id
  from public.smart_exam_vault
  where paper_id=p_paper_id and tenant_school_id=p_school_id and status='active'
  for update;
  if v_paper_id is null then
    return false;
  end if;

  update public.smart_exam_vault
  set status='archived',archived_at=now(),archived_by=p_actor_id
  where paper_id=p_paper_id and tenant_school_id=p_school_id;

  update public.smart_exam_papers
  set status='archived',archived_at=now(),updated_at=now()
  where id=p_paper_id and tenant_school_id=p_school_id;

  insert into public.smart_exam_audit_logs(
    tenant_school_id,paper_id,actor_auth_user_id,event_type,details
  ) values (p_school_id,p_paper_id,p_actor_id,'archived','{}'::jsonb);
  return true;
end;
$$;

revoke all on function public.prevent_smart_exam_vault_content_update() from public, anon, authenticated;
revoke all on function public.save_smart_exam_draft(uuid,uuid,uuid,text,text,smallint,text,text,text,text,text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.finalize_smart_exam(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.archive_smart_exam(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.save_smart_exam_draft(uuid,uuid,uuid,text,text,smallint,text,text,text,text,text,text,text,jsonb) to service_role;
grant execute on function public.finalize_smart_exam(uuid,uuid,uuid) to service_role;
grant execute on function public.archive_smart_exam(uuid,uuid,uuid) to service_role;

comment on table public.smart_exam_vault is
  'Immutable finalized school exam content. Access is mediated only by the smart-exam-designer Edge Function for manager and executive deputy roles.';
comment on table public.smart_exam_draft_payloads is
  'Mutable teacher-owned draft payloads. Removed atomically when a paper is finalized.';
