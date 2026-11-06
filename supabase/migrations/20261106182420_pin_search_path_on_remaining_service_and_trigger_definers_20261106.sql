-- These remaining SECURITY DEFINER functions are restricted to service_role
-- or invoked by database triggers. Their relation references are schema-qualified.
ALTER FUNCTION public.approve_discipline_score_proposal(bigint,uuid,text) SET search_path = '';
ALTER FUNCTION public.frahoosh_assign_certificate_registration() SET search_path = '';
ALTER FUNCTION public.frahoosh_role() SET search_path = '';
ALTER FUNCTION public.link_current_auth_users_by_national_code() SET search_path = '';
ALTER FUNCTION public.purge_expired_assignment_submissions() SET search_path = '';
ALTER FUNCTION public.refresh_all_school_relationships() SET search_path = '';
ALTER FUNCTION public.refresh_online_class_statuses() SET search_path = '';
ALTER FUNCTION public.refresh_school_relationships_for(text) SET search_path = '';
ALTER FUNCTION public.sync_account_settings_auth_user() SET search_path = '';
ALTER FUNCTION public.sync_existing_auth_users_to_account_settings() SET search_path = '';
ALTER FUNCTION public.trg_refresh_school_relationships() SET search_path = '';
ALTER FUNCTION public.validate_assignment_submission() SET search_path = '';
ALTER FUNCTION public.validate_teacher_exam_slot() SET search_path = '';
