create table if not exists public.question_vaults (
  id uuid primary key default gen_random_uuid(),
  tenant_school_id uuid not null references public.schools(id) on delete cascade,
  subject text not null,
  grade text not null default '',
  subject_key text not null,
  grade_key text not null,
  created_at timestamptz not null default now(),
  unique (tenant_school_id, subject_key, grade_key)
);

alter table public.question_bank add column if not exists vault_id uuid;

-- Build one subject/grade vault for every distinct category already present.
insert into public.question_vaults (tenant_school_id, subject, grade, subject_key, grade_key)
select tenant_school_id, min(subject), min(grade), subject_key, grade_key
from (
  select tenant_school_id, subject, grade,
    lower(translate(regexp_replace(btrim(subject), '[[:space:]‌‏]+', ' ', 'g'), 'يك', 'یک')) as subject_key,
    lower(translate(regexp_replace(btrim(grade), '[[:space:]‌‏]+', ' ', 'g'), 'يك', 'یک')) as grade_key
  from public.question_bank
) normalized
group by tenant_school_id, subject_key, grade_key
on conflict (tenant_school_id, subject_key, grade_key) do nothing;

-- Attach every existing question to its matching school-scoped vault.
update public.question_bank q
set vault_id = v.id
from public.question_vaults v
where v.tenant_school_id = q.tenant_school_id
  and v.subject_key = lower(translate(regexp_replace(btrim(q.subject), '[[:space:]‌‏]+', ' ', 'g'), 'يك', 'یک'))
  and v.grade_key = lower(translate(regexp_replace(btrim(q.grade), '[[:space:]‌‏]+', ' ', 'g'), 'يك', 'یک'))
  and q.vault_id is null;

alter table public.question_bank alter column vault_id set not null;
alter table public.question_bank
  add constraint question_bank_vault_id_fkey
  foreign key (vault_id) references public.question_vaults(id) on delete restrict;

create index if not exists question_vaults_school_idx
  on public.question_vaults(tenant_school_id, subject, grade);
create index if not exists question_bank_vault_status_idx
  on public.question_bank(vault_id, status, created_at desc);

alter table public.question_vaults enable row level security;
revoke all on public.question_vaults from anon, authenticated;
grant all on public.question_vaults to service_role;

comment on table public.question_vaults is
  'School-scoped question repositories, one per subject and grade. Questions are assigned to exactly one vault.';
