-- One manager-owned pair of verification times per school bell/period.
-- Existing per-session settings are retained as a legacy fallback until a period setting is configured.
create table if not exists public.classroom_verification_period_settings (
  tenant_school_id uuid not null references public.schools(id) on delete cascade,
  period smallint not null check (period between 1 and 3),
  check1_time time not null,
  check2_time time not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (tenant_school_id, period),
  constraint classroom_verification_period_distinct_times check (check1_time <> check2_time)
);

create index if not exists classroom_verification_period_settings_school_idx
  on public.classroom_verification_period_settings(tenant_school_id, period);

alter table public.classroom_verification_period_settings enable row level security;
revoke all on public.classroom_verification_period_settings from anon, authenticated;
grant all on public.classroom_verification_period_settings to service_role;
