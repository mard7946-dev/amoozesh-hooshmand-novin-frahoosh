-- Restrict sensitive helper RPCs that do not need public client access.
-- finance_audit_row is invoked by existing triggers; lookup_auth_email_by_national_code
-- has no database dependents and is not used by the current server-side login flow.

alter function public.finance_audit_row()
  set search_path = '';

alter function public.lookup_auth_email_by_national_code(text)
  set search_path = '';

revoke all on function public.finance_audit_row()
  from public, anon, authenticated;
grant execute on function public.finance_audit_row()
  to service_role;

revoke all on function public.lookup_auth_email_by_national_code(text)
  from public, anon, authenticated;
grant execute on function public.lookup_auth_email_by_national_code(text)
  to service_role;
