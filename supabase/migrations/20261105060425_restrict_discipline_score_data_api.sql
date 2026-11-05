-- Keep pending proposals and approved score adjustments behind authenticated Edge Functions.
-- The classroom, parent and report Edge Functions use the service role and enforce
-- school, student, parent and manager access before returning these records.
revoke all on table public.discipline_score_proposals from anon, authenticated;
revoke all on table public.student_grade_adjustments from anon, authenticated;

drop policy if exists discipline_score_proposals_management_write on public.discipline_score_proposals;
drop policy if exists discipline_score_proposals_tenant_select on public.discipline_score_proposals;
drop policy if exists student_grade_adjustments_school_read on public.student_grade_adjustments;

grant all on table public.discipline_score_proposals to service_role;
grant all on table public.student_grade_adjustments to service_role;
