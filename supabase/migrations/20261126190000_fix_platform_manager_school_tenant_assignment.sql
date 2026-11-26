-- Ensure platform-created manager accounts keep the explicitly selected school tenant.
-- The custom flag is only set inside the service-role-only manager attachment RPC.

create or replace function private.frahoosh_set_tenant_school()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_school_id uuid;
  v_class_id text;
  v_platform_admin boolean;
  v_auth_link_sync boolean;
  v_platform_school_assignment boolean;
begin
  v_platform_admin := private.frahoosh_is_platform_admin();
  v_auth_link_sync := coalesce(current_setting('frahoosh.auth_link_sync', true), '') = 'true';
  v_platform_school_assignment := coalesce(current_setting('frahoosh.platform_school_assignment', true), '') = 'true';

  if tg_table_name = 'account_settings' and tg_op = 'UPDATE' and not v_platform_admin and not v_auth_link_sync
     and to_jsonb(new)->>'auth_user_id' is distinct from to_jsonb(old)->>'auth_user_id' then
    raise exception 'تغییر شناسه حساب احراز هویت فقط برای مدیر کل سامانه مجاز است.' using errcode = '42501';
  end if;

  if coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' or v_platform_admin then
    if new.tenant_school_id is null and tg_op = 'UPDATE' then
      new.tenant_school_id := old.tenant_school_id;
    end if;
    return new;
  end if;

  -- The service-role-only manager attachment RPC sets this transaction-local flag
  -- after validating the target school. Preserve that exact tenant instead of
  -- silently assigning the default school during account creation.
  if v_platform_school_assignment
     and tg_table_name = 'account_settings'
     and lower(coalesce(to_jsonb(new)->>'role', '')) = 'manager'
     and new.tenant_school_id is not null then
    return new;
  end if;

  v_school_id := private.frahoosh_current_school_id();
  if v_school_id is null and tg_op = 'INSERT' and to_jsonb(new)?'class_id' then
    v_class_id := to_jsonb(new)->>'class_id';
    if v_class_id is not null then
      select oc.tenant_school_id into v_school_id
      from public.online_classes oc where oc.id::text = v_class_id limit 1;
    end if;
  end if;

  -- New profiles created during initial school setup must be assigned to the default school,
  -- regardless of which school-scoped profile table the signup flow writes to.
  if v_school_id is null and tg_op = 'INSERT' then
    select s.id into v_school_id from public.schools s where s.slug = 'frahoosh-default' limit 1;
  end if;

  if v_school_id is not null then
    new.tenant_school_id := v_school_id;
  elsif tg_op = 'UPDATE' then
    new.tenant_school_id := old.tenant_school_id;
  elsif new.tenant_school_id is null then
    raise exception 'مدرسهٔ کاربر مشخص نیست؛ ثبت اطلاعات انجام نشد.' using errcode = '42501';
  end if;
  return new;
end;
$function$;

create or replace function public.frahoosh_platform_attach_school_manager(
  p_school_id uuid,
  p_auth_user_id uuid,
  p_username text,
  p_display_name text,
  p_email text,
  p_actor_auth_user_id uuid,
  p_phone text default null::text,
  p_national_code text default null::text
)
returns jsonb
language plpgsql
set search_path to ''
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
  if not (
    v_email ~ '^[^[:space:]@]+@[A-Za-z0-9-]+[.][A-Za-z]{2,}$'
    or v_email ~ '^manager[+][0-9a-f-]{36}@frahoosh[.]invalid$'
  ) then
    raise exception 'شناسه داخلی حساب مدیر معتبر نیست.' using errcode = '22023';
  end if;

  select * into v_school from public.schools where id = p_school_id for update;
  if not found then raise exception 'مدرسه موردنظر پیدا نشد.' using errcode = 'P0002'; end if;
  if v_school.status <> 'active' then raise exception 'برای مدرسه غیرفعال امکان معرفی مدیر وجود ندارد.' using errcode = '23514'; end if;
  if v_school.owner_auth_user_id is not null then raise exception 'برای این مدرسه قبلاً مدیر اصلی ثبت شده است.' using errcode = '23505'; end if;
  if exists (select 1 from public.school_memberships where school_id = p_school_id and role = 'manager' and is_active = true) then
    raise exception 'برای این مدرسه عضویت فعال مدیر ثبت شده است.' using errcode = '23505';
  end if;
  if exists (select 1 from public.account_settings where auth_user_id = p_auth_user_id or username = v_username) then
    raise exception 'این حساب یا نام کاربری قبلاً در فراهوش ثبت شده است.' using errcode = '23505';
  end if;

  -- This transaction-local marker is consumed by the tenant trigger. It is set
  -- only after the RPC has verified that the caller is service_role and the
  -- target school is active and eligible.
  perform set_config('frahoosh.platform_school_assignment', 'true', true);

  insert into public.account_settings (
    username, display_name, email, phone, national_code, role, auth_user_id, tenant_school_id, preferences
  ) values (
    v_username, v_display_name, v_email,
    nullif(btrim(coalesce(p_phone, '')), ''),
    nullif(btrim(coalesce(p_national_code, '')), ''),
    'manager', p_auth_user_id, p_school_id, '{}'::text
  );

  insert into public.school_memberships (school_id, auth_user_id, role, is_active)
  values (p_school_id, p_auth_user_id, 'manager', true)
  on conflict (school_id, auth_user_id, role)
  do update set is_active = true, updated_at = now();

  update public.schools set owner_auth_user_id = p_auth_user_id, updated_at = now() where id = p_school_id;
  insert into public.platform_audit_logs (actor_auth_user_id, action, school_id, details)
  values (
    p_actor_auth_user_id, 'school.manager_invited', p_school_id,
    jsonb_build_object('manager_auth_user_id', p_auth_user_id, 'username', v_username, 'email_delivery', false)
  );
  return jsonb_build_object(
    'school_id', p_school_id, 'school_name', v_school.name,
    'manager_auth_user_id', p_auth_user_id, 'username', v_username, 'role', 'manager'
  );
end;
$function$;
