do $$
declare
  v_paper uuid;
  v_result jsonb;
  v_vault_count integer;
  v_draft_count integer;
  v_audit_count integer;
  v_trigger_error text;
begin
  if not (select relrowsecurity from pg_class where oid='public.smart_exam_papers'::regclass) then
    raise exception 'RLS is not enabled on smart_exam_papers';
  end if;
  if has_table_privilege('authenticated','public.smart_exam_papers','select')
     or has_table_privilege('authenticated','public.smart_exam_vault','select')
     or has_table_privilege('anon','public.smart_exam_vault','select') then
    raise exception 'Client roles must not read private smart exam tables directly';
  end if;
  if has_function_privilege('authenticated','public.finalize_smart_exam(uuid,uuid,uuid)','execute')
     or has_function_privilege('anon','public.finalize_smart_exam(uuid,uuid,uuid)','execute') then
    raise exception 'Client roles must not execute privileged finalization RPC';
  end if;
end;
$$;

set role service_role;
do $$
declare
  v_paper uuid;
  v_result jsonb;
  v_vault_count integer;
  v_draft_count integer;
  v_audit_count integer;
  v_trigger_error text;
begin
  v_paper := public.save_smart_exam_draft(
    null,
    '5c8b8880-1346-445c-89d8-3f76275a7ae5',
    '11111111-1111-4111-8111-111111111111',
    'آزمون آزمایشی',
    'ریاضی',
    7::smallint,
    'ریاضی هفتم',
    '۱۴۰۵–۱۴۰۶',
    'فصل اول',
    'درس اول',
    'عددهای صحیح',
    'صفحه ۱۲',
    'https://chap.sch.ir/',
    '{"header":{"class_name":"هفتم الف","teacher_name":"دبیر آزمایشی","exam_date":"۱۴۰۵/۰۹/۰۱","duration_minutes":"60"},"questions":[{"question_type":"essay","prompt":"پرسش آزمایشی","points":10}]}'::jsonb
  );

  v_result := public.finalize_smart_exam(
    v_paper,
    '5c8b8880-1346-445c-89d8-3f76275a7ae5',
    '11111111-1111-4111-8111-111111111111'
  );

  select count(*) into v_vault_count from public.smart_exam_vault where paper_id=v_paper;
  select count(*) into v_draft_count from public.smart_exam_draft_payloads where paper_id=v_paper;
  select count(*) into v_audit_count from public.smart_exam_audit_logs where paper_id=v_paper;

  if v_vault_count <> 1 or v_draft_count <> 0 or v_audit_count <> 2
     or v_result->>'status' <> 'submitted' then
    raise exception 'Finalization did not atomically move and lock the draft';
  end if;

  begin
    update public.smart_exam_vault set payload='{"tampered":true}'::jsonb where paper_id=v_paper;
  exception when others then
    get stacked diagnostics v_trigger_error = message_text;
  end;
  if v_trigger_error is distinct from 'Final exam content is immutable' then
    raise exception 'Expected immutable trigger rejection, got %', coalesce(v_trigger_error,'no error');
  end if;

  if not public.archive_smart_exam(
    v_paper,
    '5c8b8880-1346-445c-89d8-3f76275a7ae5',
    '11111111-1111-4111-8111-111111111111'
  ) then
    raise exception 'Archive operation did not report success';
  end if;

  if not exists(select 1 from public.smart_exam_vault where paper_id=v_paper and status='archived') then
    raise exception 'Archive status was not persisted';
  end if;
end;
$$;
reset role;
