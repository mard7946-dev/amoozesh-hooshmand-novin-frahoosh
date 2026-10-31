-- Restore active school memberships for accounts already assigned to a school.
-- This is additive and does not reactivate or modify any existing membership.
insert into public.school_memberships (school_id, auth_user_id, role, is_active)
select
  a.tenant_school_id,
  a.auth_user_id,
  lower(trim(a.role)),
  true
from public.account_settings a
where a.tenant_school_id is not null
  and a.auth_user_id is not null
  and lower(trim(a.role)) in ('manager','educational','executive','cultural','advisor','teacher','student','parent')
on conflict (school_id, auth_user_id, role) do nothing;
