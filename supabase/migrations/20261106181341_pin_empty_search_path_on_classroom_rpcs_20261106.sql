-- These SECURITY DEFINER RPCs use fully schema-qualified relations and helpers.
-- Pin an empty search_path to prevent object shadowing at the privileged boundary.
alter function public.guest_close_online_class(integer) set search_path = '';
alter function public.is_guest_online_class_host(integer) set search_path = '';
alter function public.import_online_class_roster(text, jsonb) set search_path = '';
alter function public.register_online_class_student_guest_verified(integer, integer, text, text, text) set search_path = '';
alter function public.verify_online_class_student(text, text, text, text) set search_path = '';
alter function public.get_student_class_schedule(text) set search_path = '';
alter function public.get_public_student_class_schedule(text, uuid) set search_path = '';
