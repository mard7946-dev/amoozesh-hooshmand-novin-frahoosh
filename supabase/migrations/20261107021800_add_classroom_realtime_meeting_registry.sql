create table if not exists public.classroom_realtime_meetings (
  id uuid primary key default gen_random_uuid(),
  tenant_school_id uuid not null,
  online_class_id integer not null references public.online_classes(id) on delete cascade,
  cloudflare_meeting_id text not null unique,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint classroom_realtime_meetings_school_class_unique unique (tenant_school_id, online_class_id)
);

create index if not exists classroom_realtime_meetings_school_idx
  on public.classroom_realtime_meetings (tenant_school_id);

alter table public.classroom_realtime_meetings enable row level security;
revoke all on table public.classroom_realtime_meetings from public, anon, authenticated;
grant all on table public.classroom_realtime_meetings to service_role;
