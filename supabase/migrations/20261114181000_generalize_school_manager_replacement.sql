create or replace function public.frahoosh_platform_replace_school_manager(
  p_school_id uuid,
  p_auth_user_id uuid,
  p_username text,
  p_display_name text,
  p_email text,
  p_actor_auth_user_id uuid,
  p_expected_previous_owner_auth_user_id uuid,
  p_phone text default null,
  p_national_code text default null
)
returns jsonb
language plpgsql
set search_path = ''
as $function$
declare
  v_school public.schools%rowtype;
  v_username text := btrim(coalesce(p_username, ''));
  v_display_name text := btrim(coalesce(p_display_name, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_old_memberships integer := 0;
begin
  if current_user <> 'service_role' then
    raise exception 'این عملیات فقط از سرویس امن مدیریت کل مجاز است.' using errcode = '42501';
  end if;
  if p_school_id is null or p_auth_user_id is null or p_actor_auth_user_id is null
     or p_expected_previous_owner_auth_user_id is null
     or p_auth_user_id = p_expected_previous_owner_auth_user_id then
    raise exception 'شناسه‌های مدرسه، مدیر قبلی، مدیر جدید یا مدیر کل معتبر نیست.' using errcode = '22023';
  end if;
  if char_length(v_username) < 4 or char_length(v_username) > 40
     or v_username !~ '^[A-Za-z0-9._-]+$' then
    raise exception 'نام کاربری معتبر نیست.' using errcode = '22023';
  end if;
  if char_length(v_display_name) < 3 or char_length(v_display_name) > 120 then
    raise exception 'نام مدیر باید بین ۳ تا ۱۲۰ نویسه باشد.' using errcode = '22023';
  end if;
  if not (v_email ~ '^[^[:space:]@]+@[A-Za-z0-9-]+[.][A-Za-z]{2,}$'
          or v_email ~ '^manager[+][0-9a-f-]{36}@frahoosh[.]invalid$') then
    raise exception 'شناسه داخلی حساب مدیر معتبر نیست.' using errcode = '22023';
  end if;

  select * into v_school from public.schools where id = p_school_id for update;
  if not found or v_school.status <> 'active' then
    raise exception 'مدرسه موردنظر پیدا نشد یا فعال نیست.' using errcode = 'P0002';
  end if;
  if v_school.owner_auth_user_id is distinct from p_expected_previous_owner_auth_user_id then
    raise exception 'مالک مدرسه تغییر کرده است؛ عملیات برای جلوگیری از جابه‌جایی ناخواسته متوقف شد.' using errcode = '40001';
  end if;
  if exists (select 1 from public.account_settings where auth_user_id = p_auth_user_id or username = v_username) then
    raise exception 'حساب یا نام کاربری جدید قبلاً ثبت شده است.' using errcode = '23505';
  end if;
  if exists (
    select 1 from public.school_memberships
     where school_id = p_school_id and role = 'manager'
       and is_active = true and auth_user_id <> p_expected_previous_owner_auth_user_id
  ) then
    raise exception 'مدیر فعال دیگری برای این مدرسه ثبت شده؛ عملیات متوقف شد.' using errcode = '23505';
  end if;

  update public.school_memberships
     set is_active = false, updated_at = now()
   where school_id = p_school_id and auth_user_id = p_expected_previous_owner_auth_user_id
     and role = 'manager' and is_active = true;
  get diagnostics v_old_memberships = row_count;
  if v_old_memberships <> 1 then
    raise exception 'عضویت فعال مدیر قبلی در این مدرسه با وضعیت مورد انتظار مطابقت ندارد.' using errcode = '40001';
  end if;

  -- The existing account_settings trigger creates the new manager membership.
  -- Preserve the previous account_settings row.
  insert into public.account_settings (
    username, display_name, email, phone, national_code, role,
    auth_user_id, tenant_school_id, preferences
  ) values (
    v_username, v_display_name, v_email,
    nullif(btrim(coalesce(p_phone, '')), ''),
    nullif(btrim(coalesce(p_national_code, '')), ''),
    'manager', p_auth_user_id, p_school_id, '{}'::text
  );

  update public.schools set owner_auth_user_id = p_auth_user_id, updated_at = now()
   where id = p_school_id and owner_auth_user_id = p_expected_previous_owner_auth_user_id;
  if not found then raise exception 'تغییر مالکیت مدرسه انجام نشد.' using errcode = '40001'; end if;

  insert into public.platform_audit_logs (actor_auth_user_id, action, school_id, details)
  values (
    p_actor_auth_user_id, 'school.manager_replaced', p_school_id,
    jsonb_build_object(
      'previous_manager_auth_user_id', p_expected_previous_owner_auth_user_id,
      'manager_auth_user_id', p_auth_user_id, 'username', v_username,
      'previous_membership_deactivated', true, 'previous_account_settings_preserved', true
    )
  );

  return jsonb_build_object(
    'school_id', p_school_id, 'school_name', v_school.name,
    'manager_auth_user_id', p_auth_user_id, 'username', v_username,
    'role', 'manager', 'previous_manager_membership_deactivated', true,
    'previous_account_settings_preserved', true
  );
end;
$function$;

revoke all on function public.frahoosh_platform_replace_school_manager(uuid,uuid,text,text,text,uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.frahoosh_platform_replace_school_manager(uuid,uuid,text,text,text,uuid,uuid,text,text) to service_role;
