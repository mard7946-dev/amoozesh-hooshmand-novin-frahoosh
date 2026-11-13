-- Global classroom service control and seven-day school trial provisioning.
-- The only platform administrator is authorized to change the global switch and create trials.

create table if not exists public.platform_feature_flags (
  flag_key text primary key,
  enabled boolean not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.platform_feature_flags enable row level security;
revoke all on public.platform_feature_flags from public, anon, authenticated;
grant all on public.platform_feature_flags to service_role;

insert into public.platform_feature_flags(flag_key, enabled)
values ('classroom_online_enabled', false)
on conflict (flag_key) do nothing;

create or replace function public.frahoosh_platform_set_classroom_service_enabled(p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not private.frahoosh_is_platform_admin() then
    raise exception 'فقط مدیر کل پروژه اجازه تغییر وضعیت سراسری کلاس آنلاین را دارد.' using errcode = '42501';
  end if;

  insert into public.platform_feature_flags(flag_key, enabled, updated_by, updated_at)
  values ('classroom_online_enabled', coalesce(p_enabled, false), auth.uid(), now())
  on conflict (flag_key) do update
    set enabled = excluded.enabled,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

  insert into public.platform_audit_logs(actor_auth_user_id, action, details)
  values (
    auth.uid(),
    'classroom.service_toggled',
    jsonb_build_object('enabled', coalesce(p_enabled, false))
  );

  return jsonb_build_object('enabled', coalesce(p_enabled, false));
end;
$function$;

revoke all on function public.frahoosh_platform_set_classroom_service_enabled(boolean) from public, anon;
grant execute on function public.frahoosh_platform_set_classroom_service_enabled(boolean) to authenticated;

create or replace function public.frahoosh_platform_create_demo_school(
  p_name text,
  p_slug text,
  p_school_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_school public.schools%rowtype;
  v_subscription public.school_subscriptions%rowtype;
  v_name text := btrim(coalesce(p_name, ''));
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_code text := upper(btrim(coalesce(p_school_code, '')));
begin
  if not private.frahoosh_is_platform_admin() then
    raise exception 'فقط مدیر کل فراهوش اجازه ایجاد نسخه آزمایشی مدرسه را دارد.' using errcode = '42501';
  end if;
  if char_length(v_name) < 3 or char_length(v_name) > 180 then
    raise exception 'نام مدرسه باید بین ۳ تا ۱۸۰ نویسه باشد.' using errcode = '22023';
  end if;
  if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(v_slug) > 80 then
    raise exception 'شناسه لاتین مدرسه معتبر نیست.' using errcode = '22023';
  end if;
  if char_length(v_code) < 3 or char_length(v_code) > 40 then
    raise exception 'کد مدرسه باید بین ۳ تا ۴۰ نویسه باشد.' using errcode = '22023';
  end if;

  insert into public.schools(name, slug, school_code, status)
  values (v_name, v_slug, v_code, 'active')
  returning * into v_school;

  insert into public.school_subscriptions(
    school_id, plan_id, duration_months, student_min, student_limit, price_irr,
    starts_at, ends_at, grace_days, status, created_by, notes
  ) values (
    v_school.id, null, 1, 1, 2147483647, 0,
    now(), now() + interval '7 days', 0, 'active', auth.uid(),
    'دوره آزمایشی رایگان ۷ روزه؛ بدون محدودیت بسته دانش‌آموزی'
  )
  returning * into v_subscription;

  insert into public.platform_audit_logs(actor_auth_user_id, action, school_id, details)
  values (
    auth.uid(), 'school.demo_created', v_school.id,
    jsonb_build_object(
      'name', v_school.name,
      'slug', v_school.slug,
      'school_code', v_school.school_code,
      'trial_starts_at', v_subscription.starts_at,
      'trial_ends_at', v_subscription.ends_at
    )
  );

  return jsonb_build_object(
    'school', jsonb_build_object(
      'id', v_school.id, 'name', v_school.name, 'slug', v_school.slug,
      'school_code', v_school.school_code, 'status', v_school.status
    ),
    'trial', jsonb_build_object(
      'starts_at', v_subscription.starts_at,
      'ends_at', v_subscription.ends_at,
      'status', v_subscription.status
    )
  );
end;
$function$;

revoke all on function public.frahoosh_platform_create_demo_school(text,text,text) from public, anon;
grant execute on function public.frahoosh_platform_create_demo_school(text,text,text) to authenticated;

-- Expired trial/paid access must also fail closed for every RLS policy that
-- relies on the authenticated user's current school id.
create or replace function private.frahoosh_current_school_id()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_school_id uuid;
begin
  if private.frahoosh_parent_password_change_required() then
    return null;
  end if;

  select a.tenant_school_id into v_school_id
  from public.account_settings a
  where a.auth_user_id = auth.uid()
  order by a.updated_at desc nulls last
  limit 1;

  if v_school_id is null then
    select oc.tenant_school_id into v_school_id
    from public.guest_online_members gm
    join public.online_classes oc on oc.id::text = gm.class_id::text
    where gm.user_id = auth.uid() and gm.left_at is null
    order by gm.joined_at desc
    limit 1;
  end if;

  if v_school_id is null or not private.frahoosh_school_access_active(v_school_id) then
    return null;
  end if;

  return v_school_id;
end;
$function$;
