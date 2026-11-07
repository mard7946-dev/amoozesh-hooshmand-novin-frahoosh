alter table public.parent_children
  add column if not exists relationship_type text not null default 'guardian';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.parent_children'::regclass
      and conname = 'parent_children_relationship_type_check'
  ) then
    alter table public.parent_children
      add constraint parent_children_relationship_type_check
      check (relationship_type in ('father','mother','guardian'));
  end if;
end $$;
