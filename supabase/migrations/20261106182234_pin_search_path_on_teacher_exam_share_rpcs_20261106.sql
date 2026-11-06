-- Rewrite the teacher exam sharing RPCs with schema-qualified relations,
-- then pin their SECURITY DEFINER search paths to the empty path.
CREATE OR REPLACE FUNCTION public.create_teacher_exam_share(
  p_quiz_id integer,
  p_target_school_id text DEFAULT NULL::text,
  p_target_class_name text DEFAULT NULL::text,
  p_start_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_end_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_duration_minutes integer DEFAULT 45
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_teacher_id integer;
  v_share public.teacher_exam_shares;
  v_email text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.teacher_exams t
    WHERE t.id=p_quiz_id
      AND t.tenant_school_id=private.frahoosh_current_school_id()
  ) THEN
    RAISE EXCEPTION 'رکورد متعلق به این مدرسه نیست یا پیدا نشد';
  END IF;
  v_email := coalesce(auth.jwt()->>'email','');
  SELECT e.teacher_id INTO v_teacher_id
  FROM public.teacher_exams e
  JOIN public.teachers t ON t.id=e.teacher_id
  JOIN public.account_settings a ON lower(a.email)=lower(v_email)
  WHERE e.id=p_quiz_id
    AND (a.national_code=t.national_code OR a.username=t.national_code)
  LIMIT 1;
  IF v_teacher_id IS NULL THEN RAISE EXCEPTION 'teacher exam access denied'; END IF;
  IF p_duration_minutes IS NULL OR p_duration_minutes < 1 OR p_duration_minutes > 600 THEN RAISE EXCEPTION 'invalid duration'; END IF;
  IF p_start_at IS NOT NULL AND p_end_at IS NOT NULL AND p_end_at <= p_start_at THEN RAISE EXCEPTION 'end must be after start'; END IF;
  INSERT INTO public.teacher_exam_shares(
    quiz_id,shared_by_teacher_id,target_school_id,target_class_name,start_at,end_at,duration_minutes,active
  )
  VALUES(
    p_quiz_id,v_teacher_id,nullif(trim(p_target_school_id),''),
    nullif(trim(p_target_class_name),''),p_start_at,p_end_at,p_duration_minutes,true
  )
  RETURNING * INTO v_share;
  UPDATE public.teacher_exams
  SET share_enabled=true,share_code=coalesce(share_code,v_share.share_code)
  WHERE id=p_quiz_id;
  RETURN jsonb_build_object(
    'id',v_share.id,'share_code',v_share.share_code,'duration_minutes',v_share.duration_minutes,
    'target_school_id',v_share.target_school_id,'target_class_name',v_share.target_class_name,
    'start_at',v_share.start_at,'end_at',v_share.end_at,'active',v_share.active
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_teacher_exam_shares(p_quiz_id integer)
RETURNS SETOF public.teacher_exam_shares
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT s.*
  FROM public.teacher_exam_shares s
  JOIN public.teacher_exams e ON e.id=s.quiz_id
  JOIN public.teachers t ON t.id=e.teacher_id
  JOIN public.account_settings a ON lower(a.email)=lower(coalesce(auth.jwt()->>'email',''))
  WHERE s.quiz_id=p_quiz_id
    AND e.tenant_school_id=private.frahoosh_current_school_id()
    AND (a.national_code=t.national_code OR a.username=t.national_code)
  ORDER BY s.created_at DESC;
$function$;

CREATE OR REPLACE FUNCTION public.update_teacher_exam_share(
  p_share_id bigint,
  p_target_school_id text DEFAULT NULL::text,
  p_target_class_name text DEFAULT NULL::text,
  p_start_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_end_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_duration_minutes integer DEFAULT 45,
  p_active boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_teacher_id integer;
  v public.teacher_exam_shares;
  v_email text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.teacher_exam_shares t
    WHERE t.id=p_share_id AND t.tenant_school_id=private.frahoosh_current_school_id()
  ) THEN RAISE EXCEPTION 'رکورد متعلق به این مدرسه نیست یا پیدا نشد'; END IF;
  v_email := coalesce(auth.jwt()->>'email','');
  SELECT s.shared_by_teacher_id INTO v_teacher_id
  FROM public.teacher_exam_shares s
  JOIN public.teachers t ON t.id=s.shared_by_teacher_id
  JOIN public.account_settings a ON lower(a.email)=lower(v_email)
  WHERE s.id=p_share_id
    AND (a.national_code=t.national_code OR a.username=t.national_code)
  LIMIT 1;
  IF v_teacher_id IS NULL THEN RAISE EXCEPTION 'share access denied'; END IF;
  IF p_duration_minutes < 1 OR p_duration_minutes > 600 THEN RAISE EXCEPTION 'invalid duration'; END IF;
  IF p_start_at IS NOT NULL AND p_end_at IS NOT NULL AND p_end_at <= p_start_at THEN RAISE EXCEPTION 'end must be after start'; END IF;
  UPDATE public.teacher_exam_shares
  SET target_school_id=nullif(trim(p_target_school_id),''),
      target_class_name=nullif(trim(p_target_class_name),''),
      start_at=p_start_at,end_at=p_end_at,duration_minutes=p_duration_minutes,active=p_active
  WHERE id=p_share_id
  RETURNING * INTO v;
  RETURN jsonb_build_object(
    'id',v.id,'share_code',v.share_code,'duration_minutes',v.duration_minutes,
    'target_school_id',v.target_school_id,'target_class_name',v.target_class_name,
    'start_at',v.start_at,'end_at',v.end_at,'active',v.active
  );
END;
$function$;
