do $$
declare
  v_public boolean;
  v_limit bigint;
  v_types text[];
begin
  if not (select relrowsecurity from pg_class where oid='public.school_textbook_library'::regclass) then
    raise exception 'RLS is not enabled on school_textbook_library';
  end if;
  if has_table_privilege('authenticated','public.school_textbook_library','select')
     or has_table_privilege('authenticated','public.school_textbook_library','insert')
     or has_table_privilege('anon','public.school_textbook_library','select') then
    raise exception 'Browser roles must not access textbook metadata directly';
  end if;
  select public,file_size_limit,allowed_mime_types
    into v_public,v_limit,v_types
    from storage.buckets where id='school-textbooks';
  if not found or v_public is distinct from false or v_limit is distinct from 52428800
     or v_types is null or not ('application/pdf'=any(v_types)) or cardinality(v_types) <> 1 then
    raise exception 'Textbook bucket must be private, PDF-only, and capped at 50 MiB';
  end if;
  if not has_table_privilege('service_role','public.school_textbook_library','select')
     or not has_table_privilege('service_role','public.school_textbook_library','insert') then
    raise exception 'Service role must mediate textbook metadata access';
  end if;
end;
$$;
