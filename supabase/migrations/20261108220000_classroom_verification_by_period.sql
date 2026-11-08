-- Share two classroom verification checkpoints by bell, not by individual timetable row.
-- The positions are fractions of the bell duration so parallel half-bell sessions
-- receive both checks at equivalent points in their own assigned session.
create table if not exists public.classroom_verification_period_settings (
  tenant_school_id uuid not null references public.schools(id) on delete cascade,
  period integer not null check (period between 1 and 6),
  check1_position numeric(8,7) not null check (check1_position >= 0 and check1_position < 1),
  check2_position numeric(8,7) not null check (check2_position >= 0 and check2_position < 1),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (tenant_school_id, period),
  constraint classroom_verification_period_distinct_positions check (check1_position <> check2_position)
);

create index if not exists classroom_verification_period_settings_school_idx
  on public.classroom_verification_period_settings(tenant_school_id, period);

alter table public.classroom_verification_period_settings enable row level security;
revoke all on public.classroom_verification_period_settings from anon, authenticated;
grant all on public.classroom_verification_period_settings to service_role;

comment on table public.classroom_verification_period_settings is
  'Manager-controlled two-point classroom verification settings shared by every class session in the same bell; positions scale to each session duration.';
