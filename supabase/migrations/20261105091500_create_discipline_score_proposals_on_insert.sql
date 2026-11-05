-- Create threshold-based, idempotent score proposals at the database boundary.
create unique index if not exists discipline_score_proposals_source_unique
on public.discipline_score_proposals
(tenant_school_id, student_id, actor_role, target_score, subject, source_record_ids);

create or replace function public.frahoosh_create_discipline_score_proposal()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_count integer;
  v_size integer;
  v_target text;
  v_delta numeric(5,2);
  v_ids bigint[];
  v_subject text;
begin
  if new.actor_role = 'teacher' then
    if new.record_type = 'praise' then
      v_size := 2; v_target := 'continuous'; v_delta := 1;
    else
      v_size := 3; v_target := 'continuous'; v_delta := -1;
    end if;
    v_subject := coalesce(new.subject,'');
    select count(*) into v_count
      from public.discipline_records r
     where r.tenant_school_id = new.tenant_school_id
       and r.student_id = new.student_id
       and r.actor_role = 'teacher'
       and coalesce(r.actor_username,'') = coalesce(new.actor_username,'')
       and coalesce(r.teacher_id,-1) = coalesce(new.teacher_id,-1)
       and coalesce(r.subject,'') = v_subject
       and r.record_type = new.record_type;
  elsif new.actor_role = 'deputy' and new.record_type <> 'praise' then
    v_size := 3; v_target := 'discipline'; v_delta := -1; v_subject := '';
    select count(*) into v_count
      from public.discipline_records r
     where r.tenant_school_id = new.tenant_school_id
       and r.student_id = new.student_id
       and r.actor_role = 'deputy'
       and coalesce(r.actor_username,'') = coalesce(new.actor_username,'')
       and r.record_type <> 'praise';
  else
    return new;
  end if;

  if v_count > 0 and mod(v_count,v_size)=0 then
    select array_agg(x.id::bigint order by x.id) into v_ids
      from (
        select r.id
          from public.discipline_records r
         where r.tenant_school_id = new.tenant_school_id
           and r.student_id = new.student_id
           and r.actor_role = new.actor_role
           and coalesce(r.actor_username,'') = coalesce(new.actor_username,'')
           and r.record_type = new.record_type
           and (new.actor_role <> 'teacher' or
             (coalesce(r.teacher_id,-1)=coalesce(new.teacher_id,-1) and coalesce(r.subject,'')=v_subject))
         order by r.id desc limit v_size
      ) x;

    insert into public.discipline_score_proposals
      (tenant_school_id,student_id,actor_role,teacher_id,subject,
       discipline_count,praise_count,proposed_delta,target_score,source_record_ids)
    values
      (new.tenant_school_id,new.student_id,new.actor_role,new.teacher_id,v_subject,
       case when v_delta < 0 then v_size else 0 end,
       case when v_delta > 0 then v_size else 0 end,
       v_delta,v_target,coalesce(v_ids,'{}'::bigint[]))
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_frahoosh_discipline_score_proposal on public.discipline_records;
create trigger trg_frahoosh_discipline_score_proposal
after insert on public.discipline_records
for each row execute function public.frahoosh_create_discipline_score_proposal();
