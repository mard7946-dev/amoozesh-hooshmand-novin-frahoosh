-- Legacy roster-check and unverified guest-registration RPCs are no longer
-- used by the current classroom clients. Keep them service-role-only.
REVOKE EXECUTE ON FUNCTION public.verify_online_class_student(text,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.register_online_class_student_guest(integer,integer,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_online_class_student(text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.register_online_class_student_guest(integer,integer,text,text) TO service_role;
