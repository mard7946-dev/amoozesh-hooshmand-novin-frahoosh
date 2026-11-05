-- Restrict pending proposals. The adjustment ledger is created by the later
-- apply_approved_discipline_score_adjustments migration; guard it conditionally
-- so this migration also works on a clean database where that table is not present yet.
revoke all on table public.discipline_score_proposals from anon, authenticated;
drop policy if exists discipline_score_proposals_management_write on public.discipline_score_proposals;
drop policy if exists discipline_score_proposals_tenant_select on public.discipline_score_proposals;
grant all on table public.discipline_score_proposals to service_role;

do $$
begin
  if to_regclass('public.student_grade_adjustments') is not null then
    execute 'revoke all on table public.student_grade_adjustments from anon, authenticated';
    execute 'drop policy if exists student_grade_adjustments_school_read on public.student_grade_adjustments';
    execute 'grant all on table public.student_grade_adjustments to service_role';
  end if;
end
$$;
