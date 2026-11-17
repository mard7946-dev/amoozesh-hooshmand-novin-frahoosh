-- Keep the exam seat primary key generator aligned without changing an existing identity column.
do $$
declare
  v_is_identity text;
  v_sequence text;
begin
  select is_identity into v_is_identity
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'exam_seats'
    and column_name = 'id';

  if v_is_identity = 'YES' then
    v_sequence := pg_get_serial_sequence('public.exam_seats', 'id');
    if v_sequence is null then
      raise exception 'exam_seats.id is identity but has no owned sequence';
    end if;
    execute format(
      'select setval(%L::regclass, coalesce((select max(id) from public.exam_seats), 0) + 1, false)',
      v_sequence
    );
  else
    create sequence if not exists public.exam_seats_id_seq;
    perform setval(
      'public.exam_seats_id_seq',
      coalesce((select max(id) from public.exam_seats), 0) + 1,
      false
    );
    alter table public.exam_seats
      alter column id set default nextval('public.exam_seats_id_seq');
    alter sequence public.exam_seats_id_seq
      owned by public.exam_seats.id;
  end if;
end
$$;
