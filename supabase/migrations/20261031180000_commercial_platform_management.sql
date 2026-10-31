-- Commercial multi-school platform foundation.
-- All privileged mutations are atomic, audited, and restricted to platform_admins.

create table if not exists public.platform_audit_logs (
  id bigint generated always as identity primary key,
  actor_auth_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  school_id uuid references public.schools(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists platform_audit_logs_created_at_idx
  on public.platform_audit_logs (created_at desc);
create index if not exists platform_audit_logs_school_idx
  on public.platform_audit_logs (school_id, created_at desc);

alter table public.platform_audit_logs enable row level security;
revoke all on public.platform_audit_logs from anon, authenticated;
grant all on public.platform_audit_logs to service_role;

create unique index if not exists schools_school_code_ci_uidx
  on public.schools (lower(btrim(school_code)))
  where school_code is not null and btrim(school_code) <> '';

create or replace function public.frahoosh_platform_create_school(
  p_name text,
  p_slug text,
  p_school_code text,
  p_plan_id uuid,
  p_grace_days integer default 7
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_school public.schools%rowtype;
  v_subscription public.school_subscriptions%rowtype;
  v_plan public.subscription_plans%rowtype;
  v_name text := btrim(coalesce(p_name, ''));
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_code text := upper(btrim(coalesce(p_school_code, '')));
  v_grace integer := coalesce(p_grace_days, 7);
begin
  if not private.frahoosh_is_platform_admin() then
    raise exception 'فقط مدیر کل فراهوش اجازه ثبت مدرسه دارد.' using errcode = '42501';
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
  if v_grace < 0 or v_grace > 30 then
    raise exception 'مهلت ارفاق باید بین صفر تا ۳۰ روز باشد.' using errcode = '22023';
  end if;

  select * into v_plan
    from public.subscription_plans
   where id = p_plan_id and is_active = true;
  if not found then
    raise exception 'طرح اشتراک فعال انتخاب نشده است.' using errcode = '23503';
  end if;
  if v_plan.price_irr <= 0 then
    raise exception 'قیمت طرح اشتراک معتبر نیست.' using errcode = '23514';
  end if;

  insert into public.schools (name, slug, school_code, status)
  values (v_name, v_slug, v_code, 'active')
  returning * into v_school;

  insert into public.school_subscriptions (
    school_id, plan_id, starts_at, ends_at, grace_days, status, created_by,
    notes
  ) values (
    v_school.id, v_plan.id, now(),
    now() + make_interval(months => v_plan.duration_months),
    v_grace, 'active', auth.uid(), 'ایجاد اولیه از پنل مدیریت کل فراهوش'
  )
  returning * into v_subscription;

  insert into public.platform_audit_logs (actor_auth_user_id, action, school_id, details)
  values (
    auth.uid(), 'school.created', v_school.id,
    jsonb_build_object(
      'name', v_school.name,
      'slug', v_school.slug,
      'school_code', v_school.school_code,
      'subscription_id', v_subscription.id,
      'plan_id', v_plan.id
    )
  );

  return jsonb_build_object(
    'school', jsonb_build_object(
      'id', v_school.id, 'name', v_school.name, 'slug', v_school.slug,
      'school_code', v_school.school_code, 'status', v_school.status
    ),
    'subscription', jsonb_build_object(
      'id', v_subscription.id, 'plan_id', v_subscription.plan_id,
      'status', v_subscription.status, 'starts_at', v_subscription.starts_at,
      'ends_at', v_subscription.ends_at, 'student_limit', v_subscription.student_limit,
      'price_irr', v_subscription.price_irr
    )
  );
end;
$function$;

create or replace function public.frahoosh_platform_set_school_status(
  p_school_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_school public.schools%rowtype;
  v_status text := lower(btrim(coalesce(p_status, '')));
begin
  if not private.frahoosh_is_platform_admin() then
    raise exception 'فقط مدیر کل فراهوش اجازه مدیریت مدارس را دارد.' using errcode = '42501';
  end if;
  if v_status not in ('active', 'suspended', 'archived') then
    raise exception 'وضعیت مدرسه معتبر نیست.' using errcode = '22023';
  end if;

  update public.schools
     set status = v_status, updated_at = now()
   where id = p_school_id
   returning * into v_school;
  if not found then
    raise exception 'مدرسه موردنظر پیدا نشد.' using errcode = 'P0002';
  end if;

  insert into public.platform_audit_logs (actor_auth_user_id, action, school_id, details)
  values (auth.uid(), 'school.status_changed', v_school.id,
          jsonb_build_object('status', v_status));

  return jsonb_build_object('id', v_school.id, 'name', v_school.name, 'status', v_school.status);
end;
$function$;

create or replace function public.frahoosh_platform_set_subscription(
  p_school_id uuid,
  p_plan_id uuid,
  p_status text default 'active',
  p_grace_days integer default 7
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_school public.schools%rowtype;
  v_plan public.subscription_plans%rowtype;
  v_subscription public.school_subscriptions%rowtype;
  v_status text := lower(btrim(coalesce(p_status, 'active')));
  v_grace integer := coalesce(p_grace_days, 7);
begin
  if not private.frahoosh_is_platform_admin() then
    raise exception 'فقط مدیر کل فراهوش اجازه مدیریت اشتراک را دارد.' using errcode = '42501';
  end if;
  if v_status not in ('active', 'past_due', 'expired', 'suspended', 'cancelled') then
    raise exception 'وضعیت اشتراک معتبر نیست.' using errcode = '22023';
  end if;
  if v_grace < 0 or v_grace > 30 then
    raise exception 'مهلت ارفاق باید بین صفر تا ۳۰ روز باشد.' using errcode = '22023';
  end if;
  select * into v_school from public.schools where id = p_school_id;
  if not found then raise exception 'مدرسه پیدا نشد.' using errcode = 'P0002'; end if;
  select * into v_plan from public.subscription_plans where id = p_plan_id and is_active = true;
  if not found then raise exception 'طرح اشتراک فعال انتخاب نشده است.' using errcode = '23503'; end if;
  if v_status in ('active', 'past_due') and v_plan.price_irr <= 0 then
    raise exception 'قیمت طرح اشتراک معتبر نیست.' using errcode = '23514';
  end if;

  insert into public.school_subscriptions (
    school_id, plan_id, starts_at, ends_at, grace_days, status, created_by,
    notes
  ) values (
    v_school.id, v_plan.id, now(),
    now() + make_interval(months => v_plan.duration_months),
    v_grace, v_status, auth.uid(), 'تمدید یا تغییر اشتراک از پنل مدیریت کل فراهوش'
  )
  returning * into v_subscription;

  insert into public.platform_audit_logs (actor_auth_user_id, action, school_id, details)
  values (
    auth.uid(), 'subscription.created', v_school.id,
    jsonb_build_object(
      'subscription_id', v_subscription.id,
      'plan_id', v_plan.id,
      'status', v_status,
      'student_limit', v_subscription.student_limit,
      'price_irr', v_subscription.price_irr
    )
  );

  return jsonb_build_object(
    'id', v_subscription.id, 'school_id', v_subscription.school_id,
    'plan_id', v_subscription.plan_id, 'status', v_subscription.status,
    'starts_at', v_subscription.starts_at, 'ends_at', v_subscription.ends_at,
    'student_limit', v_subscription.student_limit, 'price_irr', v_subscription.price_irr
  );
end;
$function$;

revoke all on function public.frahoosh_platform_create_school(text,text,text,uuid,integer) from public, anon;
revoke all on function public.frahoosh_platform_set_school_status(uuid,text) from public, anon;
revoke all on function public.frahoosh_platform_set_subscription(uuid,uuid,text,integer) from public, anon;
grant execute on function public.frahoosh_platform_create_school(text,text,text,uuid,integer) to authenticated;
grant execute on function public.frahoosh_platform_set_school_status(uuid,text) to authenticated;
grant execute on function public.frahoosh_platform_set_subscription(uuid,uuid,text,integer) to authenticated;
