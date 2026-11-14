create table if not exists public.question_papers (
  id uuid primary key default gen_random_uuid(),
  tenant_school_id uuid not null references public.schools(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 2 and 180),
  subject text not null check (char_length(btrim(subject)) between 2 and 100),
  grade text not null default '',
  status text not null default 'draft'
    check (status in ('draft','submitted','approved','returned')),
  total_points numeric(8,2) not null default 0 check (total_points >= 0 and total_points <= 100),
  submitted_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete restrict,
  review_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.question_paper_items (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references public.question_papers(id) on delete cascade,
  question_id uuid not null references public.question_bank(id) on delete restrict,
  points numeric(8,2) not null check (points > 0 and points <= 100),
  order_index integer not null default 0 check (order_index >= 0),
  created_at timestamptz not null default now(),
  unique (paper_id, question_id)
);

create index if not exists question_papers_school_status_idx
  on public.question_papers(tenant_school_id,status,updated_at desc);
create index if not exists question_papers_owner_idx
  on public.question_papers(tenant_school_id,created_by,updated_at desc);
create index if not exists question_paper_items_order_idx
  on public.question_paper_items(paper_id,order_index,created_at);

alter table public.question_papers enable row level security;
alter table public.question_paper_items enable row level security;
revoke all on public.question_papers, public.question_paper_items from anon, authenticated;
grant all on public.question_papers, public.question_paper_items to service_role;

comment on table public.question_papers is
  'Teacher-created exam papers. Only manager or educational deputy may approve and retrieve final export data through the authenticated question-bank Edge Function.';
comment on table public.question_paper_items is
  'Ordered question selection and per-question points for a teacher exam paper.';
