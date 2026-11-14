-- One-school, guarded manager replacement for Shahid Ghadir 1.
-- The previous identity remains untouched in account_settings; only its manager
-- membership for this specific school is deactivated.
create or replace function public.frahoosh_platform_replace_shahid_ghadir_manager(
  p_school_id uuid, p_auth_user_id uuid, p_username text, p_display_name text,
  p_email text, p_actor_auth_user_id uuid, p_phone text default null,
  p_national_code text default null
)
returns jsonb language plpgsql security invoker set search_path = ''
as $function$
declare
  v_school public.schools%rowtype;
  v_username text := btrim(coalesce(p_username, ''));
  v_display_name text := btrim(coalesce(p_display_name, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_deactivated integer := 0;
begin
  if current_user <> 'service_role' then
    raise exception 'این عملیات فقط از سرویس امن مدیریت کل مجاز است.' using errcode = '42501';
  end if;
  if p_school_id is distinct from '7d1bf3f2-1e04-4075-8e2a-1816f4ec8a5b'::uuid then
    raise exception 'این مسیر فقط برای مدرسه شاهد غدیر ۱ مجاز است.' using errcode = '42501';
  end if;
  if p_auth_user_id is null or p_auth_user_id = '0717bcdc-8adb-41a7-8990-4dec91e6b10f'::uuid or p_actor_auth_user_id is null then
    raise exception 'شناسه حساب مدیر جدید یا مدیر کل معتبر نیست.' using errcode = '22023';
  end if;
  if char_length(v_username) < 4 or char_length(v_username) > 40 or v_username !~ '^[A-Za-z0-9._-]+$' then
    raise exception 'نام کاربری معتبر نیست.' using errcode = '22023';
  end if;
  if char_length(v_display_name) < 3 or char_length(v_display_name) > 120 then
    raise exception 'نام مدیر باید بین ۳ تا ۱۲۰ نویسه باشد.' using errcode = '22023';
  end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'نشانی داخلی حساب مدیر معتبر نیست.' using errcode = '22023';
  end if;

  select * into v_school from public.schools where id = p_school_id for update;
  if not found or v_school.status <> 'active' then
    raise exception 'مدرسه موردنظر پیدا نشد یا فعال نیست.' using errcode = 'P0002';
  end if;
  if v_school.owner_auth_user_id is distinct from '0717bcdc-8adb-41a7-8990-4dec91e6b10f'::uuid then
    raise exception 'مالک مدرسه تغییر کرده است؛ عملیات برای جلوگیری از جابه‌جایی ناخواسته متوقف شد.' using errcode = '40001';
  end if;
  if exists (select 1 from public.account_settings where auth_user_id = p_auth_user_id or username = v_username) then
    raise exception 'حساب یا نام کاربری جدید قبلاً ثبت شده است.' using errcode = '23505';
  end if;
  if exists (
    select 1 from public.school_memberships
    where school_id = p_school_id and role = 'manager' and is_active = true
      and auth_user_id <> '0717bcdc-8adb-41a7-8990-4dec91e6b10f'::uuid
  ) then
    raise exception 'مدیر فعال دیگری برای این مدرسه ثبت شده؛ عملیات متوقف شد.' using errcode = '23505';
  end if;

  update public.school_memberships set is_active = false, updated_at = now()
   where school_id = p_school_id and auth_user_id = '0717bcdc-8adb-41a7-8990-4dec91e6b10f'::uuid
     and role = 'manager' and is_active = true;
  get diagnostics v_deactivated = row_count;
  if v_deactivated <> 1 then
    raise exception 'عضویت مدیر قبلی در مدرسه با وضعیت مورد انتظار مطابقت ندارد.' using errcode = '40001';
  end if;

  -- Existing account_settings trigger creates the new manager membership.
  -- Never mutate the previous account_settings identity or duplicate that insert.
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
   where id = p_school_id and owner_auth_user_id = '0717bcdc-8adb-41a7-8990-4dec91e6b10f'::uuid;
  if not found then raise exception 'تغییر مالکیت مدرسه انجام نشد.' using errcode = '40001'; end if;

  insert into public.platform_audit_logs (actor_auth_user_id, action, school_id, details)
  values (
    p_actor_auth_user_id, 'school.manager_replaced', p_school_id,
    jsonb_build_object(
      'previous_manager_auth_user_id', '0717bcdc-8adb-41a7-8990-4dec91e6b10f',
      'manager_auth_user_id', p_auth_user_id, 'username', v_username,
      'previous_membership_deactivated', true, 'previous_account_settings_preserved', true
    )
  );
  return jsonb_build_object(
    'school_id', p_school_id, 'school_name', v_school.name,
    'manager_auth_user_id', p_auth_user_id, 'username', v_username,
    'role', 'manager', 'previous_manager_membership_deactivated', true
  );
end;
$function$;

revoke all on function public.frahoosh_platform_replace_shahid_ghadir_manager(uuid,uuid,text,text,text,uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.frahoosh_platform_replace_shahid_ghadir_manager(uuid,uuid,text,text,text,uuid,text,text)
  to service_role;
