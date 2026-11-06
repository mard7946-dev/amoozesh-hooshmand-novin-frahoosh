-- Protect school account records: users see their own row, school managers
-- manage only their own active school, and platform administrators retain
-- their platform-wide administrative access.
revoke all on table public.account_settings from anon;
revoke truncate, references, trigger on table public.account_settings from authenticated;

drop policy if exists frahoosh_account_settings_delete_scope on public.account_settings;
drop policy if exists frahoosh_account_settings_insert_scope on public.account_settings;
drop policy if exists frahoosh_account_settings_read_scope on public.account_settings;
drop policy if exists frahoosh_account_settings_update_scope on public.account_settings;
drop policy if exists frahoosh_tenant_boundary_delete on public.account_settings;
drop policy if exists frahoosh_tenant_boundary_insert on public.account_settings;
drop policy if exists frahoosh_tenant_boundary_select on public.account_settings;
drop policy if exists frahoosh_tenant_boundary_update on public.account_settings;
drop policy if exists manager_crud_account_settings on public.account_settings;

-- A manager is limited to accounts belonging to the manager's own active school.
create policy account_settings_manager_crud_scope
on public.account_settings
for all
to authenticated
using (
  private.frahoosh_current_role() = 'manager'
  and tenant_school_id = private.frahoosh_current_school_id()
  and private.frahoosh_school_access_active(tenant_school_id)
)
with check (
  private.frahoosh_current_role() = 'manager'
  and tenant_school_id = private.frahoosh_current_school_id()
  and private.frahoosh_school_access_active(tenant_school_id)
);

-- Platform administrators retain their explicitly privileged cross-school workflow.
create policy account_settings_platform_admin_crud
on public.account_settings
for all
to authenticated
using (private.frahoosh_is_platform_admin())
with check (private.frahoosh_is_platform_admin());

-- Keep account_settings_authenticated_select: ordinary users may read their own row.

-- These RPCs require an authenticated Supabase session. Supabase anonymous
-- sign-ins use the authenticated database role; the raw anon role is not needed.
revoke execute on function public.guest_close_online_class(integer) from public, anon;
grant execute on function public.guest_close_online_class(integer) to authenticated;

revoke execute on function public.guest_create_online_class(text, text) from public, anon;
grant execute on function public.guest_create_online_class(text, text) to authenticated;

revoke execute on function public.is_guest_online_class_host(integer) from public, anon;
grant execute on function public.is_guest_online_class_host(integer) to authenticated;

revoke execute on function public.import_online_class_roster(text, jsonb) from public, anon;
grant execute on function public.import_online_class_roster(text, jsonb) to authenticated;

revoke execute on function public.register_online_class_student_guest_verified(integer, integer, text, text, text) from public, anon;
grant execute on function public.register_online_class_student_guest_verified(integer, integer, text, text, text) to authenticated;

revoke execute on function public.verify_online_class_student(text, text, text, text) from public, anon;
grant execute on function public.verify_online_class_student(text, text, text, text) to authenticated;

revoke execute on function public.get_student_class_schedule(text) from public, anon;
grant execute on function public.get_student_class_schedule(text) to authenticated;

-- get_public_student_class_schedule remains public by design: it returns only
-- the school's published class timetable, not personal student/account records.
