alter table public.family_education_invitations
  add column if not exists event_weekday text not null default '',
  add column if not exists approval_status text not null default 'pending',
  add column if not exists manager_note text not null default '',
  add column if not exists manager_reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists manager_reviewed_at timestamptz;

update public.family_education_invitations
set approval_status='approved'
where approval_status='pending' and invited_at < now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='family_education_invitations_approval_status_check'
      and conrelid='public.family_education_invitations'::regclass
  ) then
    alter table public.family_education_invitations
      add constraint family_education_invitations_approval_status_check
      check (approval_status in ('pending','approved','rejected'));
  end if;
end $$;

create index if not exists family_education_invitations_approval_idx
on public.family_education_invitations (tenant_school_id, approval_status, invited_at desc);