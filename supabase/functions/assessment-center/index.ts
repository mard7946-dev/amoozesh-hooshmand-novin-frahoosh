import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const clean = (v: unknown) => String(v ?? "").replace(/[\u200c\u200f\u202a-\u202e]/g, "").trim();
const norm = (v: unknown) => clean(v).replace(/[۰-۹]/g, d => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
  .replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/\s+/g, " ").toLocaleLowerCase("fa");
const allowedTypes = new Set(["fill_blank", "multiple_choice", "true_false", "short_answer", "essay"]);
const shuffle = <T>(items: T[]) => {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ message: "درخواست نامعتبر است." }, 405);
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return reply({ message: "برای استفاده از آزمون مستقل ابتدا وارد سامانه شوید." }, 401);

  const url = (Deno.env.get("SUPABASE_URL") ?? "").trim();
  let serviceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  const secretBundle = (Deno.env.get("SUPABASE_SECRET_KEYS") ?? "").trim();
  if (secretBundle) {
    try {
      const parsed = JSON.parse(secretBundle);
      const candidate = typeof parsed === "string" ? parsed : parsed.default ?? parsed.service_role ?? parsed.serviceRole ?? parsed.service_role_key;
      if (typeof candidate === "string" && candidate.trim()) serviceKey = candidate.trim();
    } catch {
      if (secretBundle.startsWith("sb_secret_") || secretBundle.startsWith("eyJ")) serviceKey = secretBundle;
    }
  }
  if (!url || !serviceKey) return reply({ message: "سرویس آزمون مستقل موقتاً در دسترس نیست." }, 503);

  try {
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return reply({ message: "نشست معتبر نیست؛ دوباره وارد سامانه شوید." }, 401);
    const { data: profile, error: profileError } = await admin.from("account_settings")
      .select("username,national_code,display_name,role,auth_user_id,tenant_school_id")
      .eq("auth_user_id", authData.user.id).maybeSingle();
    if (profileError || !profile || !profile.tenant_school_id) {
      return reply({ message: "پروفایل مدرسه یا نقش این حساب تأیید نشد." }, 403);
    }

    const role = norm(profile.role);
    const username = clean(profile.username);
    const nationalCode = clean(profile.national_code);
    const schoolId = profile.tenant_school_id;
    const actionBody = await req.json().catch(() => ({}));
    const action = clean(actionBody.action);

    let teacher: any = null;
    let student: any = null;
    let teacherClasses: any[] = [];
    if (role === "teacher") {
      const { data: teacherRows, error: teacherLookupError } = await admin.from("teachers")
        .select("id,first_name,last_name,national_code,tenant_school_id,phone,mobile,email,employee_code")
        .eq("tenant_school_id", schoolId);
      if (teacherLookupError) throw teacherLookupError;

      const digitsOnly = (value: unknown) => clean(value)
        .replace(/[۰-۹]/g, d => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
        .replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
        .replace(/\\D/g, "");
      const nameKey = (value: unknown) => norm(value).replace(/[\\s‌‍‎‏]+/g, "").replace(/[^\\p{L}\\p{N}]/gu, "");
      const uniqueMatch = (rows: any[]) => rows.length === 1 ? rows[0] : null;
      let candidates: any[] = [];

      if (nationalCode) {
        candidates = (teacherRows ?? []).filter((row: any) => digitsOnly(row.national_code) === digitsOnly(nationalCode));
      }
      if (!candidates.length && username) {
        candidates = (teacherRows ?? []).filter((row: any) => clean(row.employee_code) && norm(row.employee_code) === norm(username));
      }
      if (!candidates.length && profile.phone) {
        const phone = digitsOnly(profile.phone);
        if (phone) candidates = (teacherRows ?? []).filter((row: any) =>
          [row.phone, row.mobile].some((value: unknown) => digitsOnly(value) === phone));
      }
      if (!candidates.length && profile.email) {
        const email = clean(profile.email).toLocaleLowerCase("en");
        if (email) candidates = (teacherRows ?? []).filter((row: any) =>
          clean(row.email).toLocaleLowerCase("en") === email);
      }
      if (!candidates.length && profile.display_name) {
        const displayName = nameKey(profile.display_name);
        if (displayName) candidates = (teacherRows ?? []).filter((row: any) =>
          nameKey([row.first_name, row.last_name].filter(Boolean).join(" ")) === displayName);
      }

      teacher = uniqueMatch(candidates);
      if (!teacher) {
        return reply({ message: candidates.length > 1
          ? "چند پروندهٔ دبیر با اطلاعات این حساب مطابقت دارد؛ مدیر مدرسه باید مشخصات حساب را بررسی کند."
          : "پروندهٔ دبیر با شماره تلفن، ایمیل یا نام حساب پیدا نشد؛ اطلاعات حساب و پرونده باید توسط مدیر مدرسه تطبیق داده شود." }, 403);
      }

      const { data: assigned, error: classError } = await admin.from("teacher_classes")
        .select("id,teacher_id,subject,grade,class_name,active")
        .eq("teacher_id", teacher.id).eq("tenant_school_id", schoolId).eq("active", 1)
        .order("grade").order("class_name");
      if (classError) throw classError;
      teacherClasses = assigned ?? [];
    } else if (role === "student") {
      let sq = admin.from("students").select("id,first_name,last_name,national_code,student_code,grade,class_name,tenant_school_id")
        .eq("tenant_school_id", schoolId);
      if (nationalCode) sq = sq.eq("national_code", nationalCode);
      else sq = sq.eq("student_code", username);
      const { data, error } = await sq.maybeSingle();
      if (error || !data) return reply({ message: "پرونده دانش‌آموز با حساب ورودش تطبیق داده نشد." }, 403);
      student = data;
    } else {
      return reply({ message: "این بخش فقط برای دبیر و دانش‌آموز فعال است." }, 403);
    }

    const classAllowed = (grade: unknown, className: unknown) =>
      teacherClasses.some(c => norm(c.grade) === norm(grade) && norm(c.class_name) === norm(className));

    if (action === "bootstrap") {
      if (role === "teacher") {
        const classes = [];
        for (const c of teacherClasses) {
          const { data: roster, error } = await admin.from("students")
            .select("id,first_name,last_name,student_code,grade,class_name")
            .eq("tenant_school_id", schoolId).eq("grade", c.grade).eq("class_name", c.class_name)
            .order("last_name").order("first_name");
          if (error) throw error;
          classes.push({ ...c, students: roster ?? [] });
        }
        const { data: exams, error } = await admin.from("assessment_exams")
          .select("id,title,subject,grade,class_name,starts_at,ends_at,published,question_order,display_mode,group_size,duration_minutes,created_at")
          .eq("tenant_school_id", schoolId).eq("teacher_id", teacher.id).order("created_at", { ascending: false });
        if (error) throw error;
        return reply({ ok: true, role, profile: { name: [teacher.first_name, teacher.last_name].filter(Boolean).join(" ") || profile.display_name || username }, classes, exams: exams ?? [] });
      }
      const { data: exams, error } = await admin.from("assessment_exams")
        .select("id,title,subject,grade,class_name,description,starts_at,ends_at,duration_minutes,display_mode,group_size,question_order")
        .eq("tenant_school_id", schoolId).eq("grade", student.grade).eq("class_name", student.class_name)
        .eq("published", true).order("starts_at", { ascending: true });
      if (error) throw error;
      const now = Date.now();
      return reply({
        ok: true, role,
        profile: { name: [student.first_name, student.last_name].filter(Boolean).join(" "), grade: student.grade, class_name: student.class_name },
        exams: (exams ?? []).map(e => ({ ...e, availability: now < Date.parse(e.starts_at) ? "upcoming" : now > Date.parse(e.ends_at) ? "closed" : "open" })),
      });
    }

    if (action === "create_exam" && role === "teacher") {
      const title = clean(actionBody.title);
      const grade = clean(actionBody.grade);
      const className = clean(actionBody.class_name);
      const subject = clean(actionBody.subject);
      const startsAt = new Date(actionBody.starts_at);
      const endsAt = new Date(actionBody.ends_at);
      const questions = Array.isArray(actionBody.questions) ? actionBody.questions : [];
      if (!title || !grade || !className || !subject || !Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) {
        return reply({ message: "عنوان، درس، کلاس و بازه زمانی معتبر آزمون را کامل کنید." }, 400);
      }
      if (!classAllowed(grade, className)) return reply({ message: "این کلاس در فهرست کلاس‌های مجاز شما نیست." }, 403);
      if (!questions.length || questions.length > 200) return reply({ message: "آزمون باید حداقل یک سؤال و حداکثر ۲۰۰ سؤال داشته باشد." }, 400);
      for (const q of questions) {
        if (!allowedTypes.has(q.type) || !clean(q.prompt) || Number(q.points) < 0) {
          return reply({ message: "یکی از سؤال‌ها ناقص یا دارای نوع نامعتبر است." }, 400);
        }
        if (q.type === "multiple_choice" && (!Array.isArray(q.options) || q.options.length < 2)) {
          return reply({ message: "سؤال چهارگزینه‌ای باید دست‌کم دو گزینه داشته باشد." }, 400);
        }
      }
      const examPayload = {
        tenant_school_id: schoolId, teacher_id: teacher.id, title, subject, grade, class_name: className,
        description: clean(actionBody.description), starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(),
        question_order: actionBody.question_order === "random" ? "random" : "sequential",
        display_mode: actionBody.display_mode === "group" ? "group" : "single",
        group_size: Math.max(1, Math.min(100, Number(actionBody.group_size) || 1)),
        duration_minutes: Math.max(1, Math.min(600, Number(actionBody.duration_minutes) || 45)),
        published: false,
      };
      const { data: exam, error: insertError } = await admin.from("assessment_exams").insert(examPayload).select("*").single();
      if (insertError) throw insertError;
      const questionRows = questions.map((q: any, i: number) => ({
        exam_id: exam.id, position: i + 1, question_type: q.type, prompt: clean(q.prompt),
        options: Array.isArray(q.options) ? q.options.map((v: unknown) => clean(v)).filter(Boolean) : [],
        correct_answer: clean(q.correct_answer), points: Number(q.points) || 0,
        time_limit_seconds: q.time_limit_seconds ? Math.max(1, Math.min(3600, Number(q.time_limit_seconds))) : null,
        math_markup: clean(q.math_markup), diagram_shapes: Array.isArray(q.diagram_shapes) ? q.diagram_shapes : [],
      }));
      const { error: questionError } = await admin.from("assessment_questions").insert(questionRows);
      if (questionError) {
        await admin.from("assessment_exams").delete().eq("id", exam.id).eq("teacher_id", teacher.id);
        throw questionError;
      }
      return reply({ ok: true, exam_id: exam.id, message: "آزمون به‌صورت پیش‌نویس ذخیره شد." });
    }

    if (action === "publish_exam" && role === "teacher") {
      const examId = clean(actionBody.exam_id);
      const { data: exam, error } = await admin.from("assessment_exams").select("id,grade,class_name,teacher_id")
        .eq("id", examId).eq("tenant_school_id", schoolId).eq("teacher_id", teacher.id).maybeSingle();
      if (error || !exam || !classAllowed(exam.grade, exam.class_name)) return reply({ message: "آزمون یا کلاس مجاز پیدا نشد." }, 403);
      const { error: updateError } = await admin.from("assessment_exams").update({ published: true, updated_at: new Date().toISOString() })
        .eq("id", examId).eq("teacher_id", teacher.id).eq("tenant_school_id", schoolId);
      if (updateError) throw updateError;
      return reply({ ok: true, message: "آزمون برای دانش‌آموزان همان کلاس منتشر شد." });
    }

    if (action === "start_exam" && role === "student") {
      const examId = clean(actionBody.exam_id);
      const { data: exam, error } = await admin.from("assessment_exams").select("*")
        .eq("id", examId).eq("tenant_school_id", schoolId).eq("grade", student.grade)
        .eq("class_name", student.class_name).eq("published", true).maybeSingle();
      if (error || !exam) return reply({ message: "این آزمون برای کلاس شما در دسترس نیست." }, 404);
      const now = Date.now();
      if (now < Date.parse(exam.starts_at) || now > Date.parse(exam.ends_at)) return reply({ message: "زمان شروع یا پایان آزمون فرا نرسیده یا به پایان رسیده است." }, 403);
      const { data: existing } = await admin.from("assessment_attempts").select("id,status")
        .eq("exam_id", exam.id).eq("student_id", student.id).maybeSingle();
      if (existing) return reply({ message: existing.status === "in_progress" ? "برای این آزمون تلاش در حال انجام دارید؛ ادامه آزمون در این نسخه پشتیبانی نمی‌شود." : "پاسخ این آزمون قبلاً ثبت شده است." }, 409);
      const { data: questions, error: qError } = await admin.from("assessment_questions")
        .select("id,position,question_type,prompt,options,points,time_limit_seconds,math_markup,diagram_shapes")
        .eq("exam_id", exam.id).order("position");
      if (qError) throw qError;
      if (!questions?.length) return reply({ message: "سؤال‌های این آزمون هنوز ثبت نشده‌اند." }, 409);
      const ordered = exam.question_order === "random" ? shuffle(questions) : questions;
      const maxScore = questions.reduce((sum: number, q: any) => sum + Number(q.points || 0), 0);
      const { data: attempt, error: attemptError } = await admin.from("assessment_attempts").insert({
        exam_id: exam.id, student_id: student.id, tenant_school_id: schoolId,
        question_order: ordered.map((q: any) => q.id), max_score: maxScore,
      }).select("id,started_at,status").single();
      if (attemptError) throw attemptError;
      return reply({ ok: true, attempt, exam: { id: exam.id, title: exam.title, duration_minutes: exam.duration_minutes, display_mode: exam.display_mode, group_size: exam.group_size }, questions: ordered });
    }

    if (action === "submit_exam" && role === "student") {
      const attemptId = clean(actionBody.attempt_id);
      const answers = Array.isArray(actionBody.answers) ? actionBody.answers : [];
      const { data: attempt, error: attemptError } = await admin.from("assessment_attempts").select("*")
        .eq("id", attemptId).eq("student_id", student.id).eq("tenant_school_id", schoolId).maybeSingle();
      if (attemptError || !attempt) return reply({ message: "برگه آزمون متعلق به این حساب نیست." }, 403);
      if (attempt.status !== "in_progress") return reply({ message: "این آزمون قبلاً تحویل داده شده است." }, 409);
      const { data: exam } = await admin.from("assessment_exams").select("ends_at,duration_minutes")
        .eq("id", attempt.exam_id).maybeSingle();
      const cutoff = Math.min(Date.parse(exam?.ends_at || new Date().toISOString()), Date.parse(attempt.started_at) + Number(exam?.duration_minutes || 45) * 60000);
      if (Date.now() > cutoff + 60000) return reply({ message: "مهلت پاسخ‌گویی به پایان رسیده است." }, 403);
      const { data: questions, error: questionsError } = await admin.from("assessment_questions")
        .select("id,question_type,correct_answer,points").eq("exam_id", attempt.exam_id);
      if (questionsError) throw questionsError;
      const qMap = new Map((questions ?? []).map((q: any) => [q.id, q]));
      let total = 0;
      const rows = [];
      for (const item of answers) {
        const q: any = qMap.get(clean(item.question_id));
        if (!q) continue;
        const answer = clean(item.answer);
        const auto = ["fill_blank", "multiple_choice", "true_false", "short_answer"].includes(q.question_type);
        const correct = auto ? norm(answer) === norm(q.correct_answer) : false;
        const score = correct ? Number(q.points || 0) : 0;
        total += score;
        rows.push({ attempt_id: attempt.id, question_id: q.id, answer, score, is_correct: auto ? correct : null, auto_graded: auto });
      }
      if (rows.length) {
        const { error: answerError } = await admin.from("assessment_answers").upsert(rows, { onConflict: "attempt_id,question_id" });
        if (answerError) throw answerError;
      }
      const { error: finishError } = await admin.from("assessment_attempts").update({
        status: "submitted", submitted_at: new Date().toISOString(), score: total,
      }).eq("id", attempt.id).eq("student_id", student.id);
      if (finishError) throw finishError;
      return reply({ ok: true, score: total, max_score: Number(attempt.max_score), message: "پاسخ‌های آزمون ثبت شد. سؤال‌های تشریحی پس از بررسی دبیر نمره‌گذاری می‌شوند." });
    }

    if (action === "list_attempts" && role === "teacher") {
      const examId = clean(actionBody.exam_id);
      const { data: exam, error } = await admin.from("assessment_exams").select("id,grade,class_name")
        .eq("id", examId).eq("teacher_id", teacher.id).eq("tenant_school_id", schoolId).maybeSingle();
      if (error || !exam || !classAllowed(exam.grade, exam.class_name)) return reply({ message: "آزمون مجاز پیدا نشد." }, 403);
      const { data: attempts, error: attemptError } = await admin.from("assessment_attempts")
        .select("id,student_id,status,started_at,submitted_at,score,max_score")
        .eq("exam_id", exam.id).eq("tenant_school_id", schoolId).order("started_at", { ascending: false });
      if (attemptError) throw attemptError;
      const ids = (attempts ?? []).map((a: any) => a.student_id);
      const { data: roster } = ids.length ? await admin.from("students").select("id,first_name,last_name,student_code")
        .in("id", ids).eq("tenant_school_id", schoolId) : { data: [] };
      const names = new Map((roster ?? []).map((s: any) => [s.id, [s.first_name, s.last_name].filter(Boolean).join(" ")]));
      return reply({ ok: true, attempts: (attempts ?? []).map((a: any) => ({ ...a, student_name: names.get(a.student_id) || "دانش‌آموز" })) });
    }

    return reply({ message: "عملیات درخواست‌شده پشتیبانی نمی‌شود." }, 400);
  } catch (error) {
    console.error("assessment-center error", error);
    return reply({ message: "عملیات آزمون انجام نشد. لطفاً دوباره تلاش کنید." }, 500);
  }
});