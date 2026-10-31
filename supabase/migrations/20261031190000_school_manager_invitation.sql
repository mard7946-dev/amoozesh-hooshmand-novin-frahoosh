-- Attach one invited school-manager identity to a newly provisioned school.
-- This RPC is callable only by the service-role Edge Function after platform-admin auth.

create or replace function public.frahoosh_platform_attach_school_manager(
  p_school_id uuid,
  p_auth_user_id uuid,
  p_username text,
  p_display_name text,
  p_email text,
  p_phone text default null,
  p_national_code text default null,
  p_actor_auth_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_school public.schools%rowtype;
  v_username text := btrim(coalesce(p_username, ''));
  v_display_name text := btrim(coalesce(p_display_name, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if current_user <> 'service_role' then
    raise exception 'این عملیات فقط از سرویس امن مدیریت کل مجاز است.' using errcode = '42501';
  end if;

  if p_auth_user_id is null or p_school_id is null then
    raise exception 'شناسه حساب و مدرسه الزامی است.' using errcode = '22023';
  end if;
  if char_length(v_username) < 4 or char_length(v_username) > 40 then
    raise exception 'نام کاربری باید بین ۴ تا ۴۰ نویسه باشد.' using errcode = '22023';
  end if;
  if char_length(v_display_name) < 3 or char_length(v_display_name) > 120 then
    raise exception 'نام مدیر باید بین ۳ تا ۱۲۰ نویسه باشد.' using errcode = '22023';
  end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'ایمیل مدیر معتبر نیست.' using errcode = '22023';
  end if;

  select * into v_school
    from public.schools
   where id = p_school_id
   for update;
  if not found then
    raise exception 'مدرسه موردنظر پیدا نشد.' using errcode = 'P0002';
  end if;
  if v_school.status <> 'active' then
    raise exception 'برای مدرسه غیرفعال امکان معرفی مدیر وجود ندارد.' using errcode = '23514';
  end if;
  if v_school.owner_auth_user_id is not null then
    raise exception 'برای این مدرسه قبلاً مدیر اصلی ثبت شده است.' using errcode = '23505';
  end if;
  if exists (
    select 1 from public.school_memberships
     where school_id = p_school_id and role = 'manager' and is_active = true
  ) then
    raise exception 'برای این مدرسه عضویت فعال مدیر ثبت شده است.' using errcode = '23505';
  end if;
  if exists (
    select 1 from public.account_settings
     where auth_user_id = p_auth_user_id or username = v_username
  ) then
    raise exception 'این حساب یا نام کاربری قبلاً در فراهوش ثبت شده است.' using errcode = '23505';
  end if;

  insert into public.account_settings (
    username, display_name, email, phone, national_code, role,
    auth_user_id, tenant_school_id, preferences
  ) values (
    v_username, v_display_name, v_email,
    nullif(btrim(coalesce(p_phone, '')), ''),
    nullif(btrim(coalesce(p_national_code, '')), ''),
    'manager', p_auth_user_id, p_school_id, '{}'::text
  );

  insert into public.school_memberships (
    school_id, auth_user_id, role, is_active
  ) values (
    p_school_id, p_auth_user_id, 'manager', true
  );

  update public.schools
     set owner_auth_user_id = p_auth_user_id,
         updated_at = now()
   where id = p_school_id;

  insert into public.platform_audit_logs (
    actor_auth_user_id, action, school_id, details
  ) values (
    p_actor_auth_user_id, 'school.manager_invited', p_school_id,
    jsonb_build_object(
      'manager_auth_user_id', p_auth_user_id,
      'username', v_username
    )
  );

  return jsonb_build_object(
    'school_id', p_school_id,
    'school_name', v_school.name,
    'manager_auth_user_id', p_auth_user_id,
    'username', v_username,
    'role', 'manager'
  );
end;
$function$;

revoke all on function public.frahoosh_platform_attach_school_manager(uuid,uuid,text,text,text,text,text,uuid)
  from public, anon, authenticated;
grant execute on function public.frahoosh_platform_attach_school_manager(uuid,uuid,text,text,text,text,text)
  to service_role;
