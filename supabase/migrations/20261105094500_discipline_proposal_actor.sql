alter table public.discipline_score_proposals
  add column if not exists actor_username text not null default '';
create index if not exists discipline_score_proposals_actor_idx
  on public.discipline_score_proposals (tenant_school_id,actor_role,actor_username,status);
