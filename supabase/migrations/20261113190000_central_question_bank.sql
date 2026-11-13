create table if not exists public.question_bank (
  id uuid primary key default gen_random_uuid(),
  tenant_school_id uuid not null references public.schools(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  subject text not null,
  grade text not null default '',
  chapter text not null default '',
  topic text not null default '',
  difficulty text not null default 'medium' check (difficulty in ('easy','medium','hard')),
  question_type text not null default 'multiple_choice' check (question_type in ('multiple_choice','true_false','short_answer','essay','fill_blank')),
  prompt text not null,
  options jsonb not null default '[]'::jsonb,
  correct_answer text not null default '',
  explanation text not null default '',
  points numeric(8,2) not null default 1 check (points >= 0),
  source_url text not null default '',
  source_title text not null default '',
  source_license text not null default '',
  source_permission_confirmed boolean not null default false,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.question_collections (
  id uuid primary key default gen_random_uuid(),
  tenant_school_id uuid not null references public.schools(id) on delete cascade,
  owner_auth_user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'سؤال‌های من',
  created_at timestamptz not null default now(),
  unique (tenant_school_id, owner_auth_user_id, title)
);
create table if not exists public.question_collection_items (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.question_collections(id) on delete cascade,
  question_id uuid not null references public.question_bank(id) on delete cascade,
  added_at timestamptz not null default now(),
  unique (collection_id, question_id)
);
create index if not exists question_bank_school_status_idx on public.question_bank(tenant_school_id,status,subject,grade);
create index if not exists question_collection_owner_idx on public.question_collections(tenant_school_id,owner_auth_user_id);
alter table public.question_bank enable row level security;
alter table public.question_collections enable row level security;
alter table public.question_collection_items enable row level security;
revoke all on public.question_bank,public.question_collections,public.question_collection_items from anon,authenticated;
grant all on public.question_bank,public.question_collections,public.question_collection_items to service_role;
