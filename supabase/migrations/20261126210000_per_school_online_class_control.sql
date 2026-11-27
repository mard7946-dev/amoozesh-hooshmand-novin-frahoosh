-- Per-school online classroom access.
-- Existing non-trial schools retain the current global setting; demo/trial schools
-- and all schools created after this migration start with online classrooms disabled.

alter table public.schools
  add column if not exists online_class_enabled boolean not null default false;

update public.schools s
   set online_class_enabled = case
     when exists (
       select 1 from public.school_subscriptions ss
        where ss.school_id = s.id and ss.plan_id is null
     ) then false
     else coalesce((
       select f.enabled from public.platform_feature_flags f
        where f.flag_key = 'classroom_online_enabled'
     ), false)
   end;

create or replace function public.frahoosh_platform_set_school_classroom_enabled(
  p_school_id uuid,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_enabled boolean := coalesce(p_enabled, false);
  v_school_name text;
begin
  if not private.frahoosh_is_platform_admin() then
    raise exception 'فقط مدیر کل فراهوش اجازه تغییر کلاس آنلاین هر مدرسه را دارد.' using errcode = '42501';
  end if;

  update public.schools
     set online_class_enabled = v_enabled,
         updated_at = now()
   where id = p_school_id
   returning name into v_school_name;

  if not found then
    raise exception 'مدرسه موردنظر پیدا نشد.' using errcode = 'P0002';
  end if;

  insert into public.platform_audit_logs(actor_auth_user_id, action, school_id, details)
  values (
    auth.uid(),
    'classroom.school_toggled',
    p_school_id,
    jsonb_build_object('enabled', v_enabled, 'school_name', v_school_name)
  );

  return jsonb_build_object('school_id', p_school_id, 'enabled', v_enabled);
end;
$function$;

revoke all on function public.frahoosh_platform_set_school_classroom_enabled(uuid, boolean) from public, anon;
grant execute on function public.frahoosh_platform_set_school_classroom_enabled(uuid, boolean) to authenticated;
