create table if not exists public.school_settings (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null unique references public.schools(id) on delete cascade,
  academic_year text not null default '',
  address text not null default '',
  phone text not null default '',
  email text not null default '',
  logo_url text not null default '',
  calendar text not null default 'persian' check (calendar in ('persian','gregorian')),
  language text not null default 'fa-IR',
  term_settings jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.school_server_connections (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  label text not null,
  provider text not null default 'custom' check (provider in ('supabase','custom','other')),
  supabase_url text not null default '',
  publishable_key text not null default '',
  api_base_url text not null default '',
  environment text not null default 'production' check (environment in ('production','staging','development')),
  notes text not null default '',
  is_primary boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint school_server_connections_label_length check (char_length(label) between 2 and 100)
);

create unique index if not exists school_server_connections_one_primary
  on public.school_server_connections(school_id) where is_primary = true;
create index if not exists school_server_connections_school_idx
  on public.school_server_connections(school_id, updated_at desc);

alter table public.school_settings enable row level security;
alter table public.school_server_connections enable row level security;

revoke all on public.school_settings from anon, authenticated;
revoke all on public.school_server_connections from anon, authenticated;
grant all on public.school_settings to service_role;
grant all on public.school_server_connections to service_role;
