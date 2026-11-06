-- Pin reviewed SECURITY DEFINER routines to an empty search_path.
-- Every relation/helper reference in these function bodies is schema-qualified.
ALTER FUNCTION public.create_payment_attempt(integer,integer) SET search_path = '';
ALTER FUNCTION public.finance_close_year(text,text) SET search_path = '';
ALTER FUNCTION public.current_account_username() SET search_path = '';
ALTER FUNCTION public.frahoosh_can_activate_modules() SET search_path = '';
ALTER FUNCTION public.get_shared_attempt_questions(bigint) SET search_path = '';
ALTER FUNCTION public.get_shared_exam(text) SET search_path = '';
ALTER FUNCTION public.get_shared_exam_questions(text) SET search_path = '';
ALTER FUNCTION public.get_teacher_exam_questions(bigint) SET search_path = '';
ALTER FUNCTION public.guest_create_online_class(text,text) SET search_path = '';
ALTER FUNCTION public.is_module_active(text) SET search_path = '';
ALTER FUNCTION public.register_online_class_student_guest(integer,integer,text,text) SET search_path = '';
ALTER FUNCTION public.request_module_activation(text) SET search_path = '';
ALTER FUNCTION public.send_school_message(text,text,text,text,text) SET search_path = '';
ALTER FUNCTION public.start_shared_teacher_exam(text,integer,text) SET search_path = '';
ALTER FUNCTION public.start_teacher_exam(integer,integer,text) SET search_path = '';
ALTER FUNCTION public.submit_teacher_exam(bigint,jsonb) SET search_path = '';
