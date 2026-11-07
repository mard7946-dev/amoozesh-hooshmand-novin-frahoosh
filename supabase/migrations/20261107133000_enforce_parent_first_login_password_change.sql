-- Block parent data access until the initial national-code password is changed.
-- The check reads auth.users so it remains effective for access tokens minted before a reset.
create or replace function private.frahoosh_parent_password_change_required()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from auth.users u
    where u.id = auth.uid()
      and coalesce(u.raw_app_meta_data ->> 'must_change_password', 'false') = 'true'
  );
$function$;

revoke all on function private.frahoosh_parent_password_change_required() from public, anon;
grant execute on function private.frahoosh_parent_password_change_required() to authenticated;

create or replace function private.frahoosh_current_parent_matches(p_parent_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select not private.frahoosh_parent_password_change_required()
    and exists (
      select 1
      from public.account_settings a
      where a.auth_user_id = auth.uid()
        and (
          lower(coalesce(a.username, '')) = lower(coalesce(p_parent_key, ''))
          or lower(coalesce(a.email, '')) = lower(coalesce(p_parent_key, ''))
          or lower(coalesce(a.national_code, '')) = lower(coalesce(p_parent_key, ''))
        )
    );
$function$;

-- Role-based RLS policies must not continue treating a forced-reset parent as an active parent.
do $migration$
declare
  definition text;
begin
  select pg_get_functiondef('private.frahoosh_current_role()'::regprocedure)
    into definition;

  if position('private.frahoosh_parent_password_change_required()' in definition) > 0 then
    return;
  end if;

  definition := replace(
    definition,
    '  select case lower(trim(replace(replace(replace(coalesce(',
    '  select case when private.frahoosh_parent_password_change_required() then ''parent_password_change_required'' else case lower(trim(replace(replace(replace(coalesce('
  );
  definition := replace(definition, E'  end\n$function$', E'  end end\n$function$');

  if position('parent_password_change_required' in definition) = 0 then
    raise exception 'Could not safely wrap private.frahoosh_current_role()';
  end if;

  execute definition;
end;
$migration$;

-- Hide the parent's own profile row during the forced-reset window. This also
-- blocks older direct-join RLS policies that bind parent data through account_settings.
drop policy if exists account_settings_authenticated_select on public.account_settings;
create policy account_settings_authenticated_select
on public.account_settings
for select
to authenticated
using (
  auth_user_id = auth.uid()
  and not private.frahoosh_parent_password_change_required()
);
