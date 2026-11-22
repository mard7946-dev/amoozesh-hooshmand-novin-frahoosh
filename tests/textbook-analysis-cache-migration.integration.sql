do $$
begin
  if not (select relrowsecurity from pg_class where oid='public.smart_exam_textbook_analysis_cache'::regclass) then
    raise exception 'RLS is not enabled on smart_exam_textbook_analysis_cache';
  end if;
  if has_table_privilege('authenticated','public.smart_exam_textbook_analysis_cache','select')
     or has_table_privilege('authenticated','public.smart_exam_textbook_analysis_cache','insert')
     or has_table_privilege('anon','public.smart_exam_textbook_analysis_cache','select') then
    raise exception 'Browser roles must not access textbook analysis cache directly';
  end if;
  if not has_table_privilege('service_role','public.smart_exam_textbook_analysis_cache','select')
     or not has_table_privilege('service_role','public.smart_exam_textbook_analysis_cache','insert')
     or not has_table_privilege('service_role','public.smart_exam_textbook_analysis_cache','update') then
    raise exception 'Only the authenticated Edge Function service role should mediate analysis cache access';
  end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname='public' and indexname='smart_exam_textbook_analysis_cache_expiry_idx'
  ) then
    raise exception 'Analysis cache expiry index is missing';
  end if;
end;
$$;
