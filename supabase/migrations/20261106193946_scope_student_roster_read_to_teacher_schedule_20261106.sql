CREATE OR REPLACE FUNCTION private.frahoosh_teacher_can_access_student(p_student_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.students s
    JOIN public.weekly_schedule_entries w
      ON w.tenant_school_id = s.tenant_school_id
     AND w.class_name = s.class_name
    JOIN public.account_settings a
      ON a.auth_user_id = auth.uid()
     AND a.tenant_school_id = s.tenant_school_id
    WHERE s.id = p_student_id
      AND s.tenant_school_id = private.frahoosh_current_school_id()
      AND lower(w.teacher_username) = lower(a.username)
      AND (
        lower(coalesce(a.role, '')) IN ('teacher', 'دبیر', 'معلم')
        OR EXISTS (
          SELECT 1
          FROM public.school_memberships sm
          WHERE sm.auth_user_id = a.auth_user_id
            AND sm.school_id = s.tenant_school_id
            AND sm.is_active = true
            AND lower(sm.role) IN ('teacher', 'دبیر', 'معلم')
        )
      )
  );
$function$;

DROP POLICY IF EXISTS "staff students select" ON public.students;
DROP POLICY IF EXISTS "students staff read" ON public.students;

CREATE POLICY students_management_read
ON public.students
FOR SELECT
TO authenticated
USING (
  lower(coalesce(private.frahoosh_current_role(), '')) IN
    ('manager', 'educational', 'executive', 'cultural', 'advisor')
);

CREATE POLICY students_teacher_assigned_read
ON public.students
FOR SELECT
TO authenticated
USING (private.frahoosh_teacher_can_access_student(id::bigint));
