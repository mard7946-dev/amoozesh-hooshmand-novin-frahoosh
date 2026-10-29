import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
});
const clean = (v: unknown) => String(v ?? "").replace(/[\u200c\u200f\u202a-\u202e]/g, "").trim();
const norm = (v: unknown) => clean(v).replace(/[۰-۹]/g, d => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
  .replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).toLocaleLowerCase("fa");
const rolesManager = ["manager", "مدیر", "مدیریت", "executive", "educational", "deputy", "معاون", "معاون اجرایی", "معاون آموزشی"];
const isManager = (role: string) => rolesManager.some(r => norm(role).includes(norm(r)));
const isTeacher = (role: string) => ["teacher", "دبیر", "معلم"].some(r => norm(role).includes(norm(r)));
const asInt = (v: unknown) => Number.isFinite(Number(v)) ? Number(v) : null;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ message: "فقط درخواست POST پذیرفته می‌شود." }, 405);
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return reply({ message: "ابتدا وارد سامانه شوید." }, 401);
  const url = (Deno.env.get("SUPABASE_URL") ?? "").trim();
  let serviceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  const bundleRaw = (Deno.env.get("SUPABASE_SECRET_KEYS") ?? "").trim();
  if (bundleRaw) {
    try {
      const bundle = JSON.parse(bundleRaw);
      const candidate = typeof bundle === "string" ? bundle : bundle.default ?? bundle.service_role ?? bundle.serviceRole ?? bundle.service_role_key;
      if (typeof candidate === "string" && candidate.trim()) serviceKey = candidate.trim();
    } catch { if (bundleRaw.startsWith("sb_secret_") || bundleRaw.startsWith("eyJ")) serviceKey = bundleRaw; }
  }
  if (!url || !serviceKey) return reply({ message: "اتصال امن پایگاه داده تنظیم نشده است." }, 503);
  try {
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return reply({ message: "نشست معتبر نیست؛ دوباره وارد شوید." }, 401);
    const { data: profile, error: profileError } = await admin.from("account_settings")
      .select("username,national_code,display_name,role,auth_user_id,tenant_school_id")
      .eq("auth_user_id", authData.user.id).maybeSingle();
    if (profileError || !profile) return reply({ message: "مجوز نقش این حساب تأیید نشد." }, 403);
    const role = norm(profile.role);
    const manager = isManager(role);
    const teacher = isTeacher(role);
    const studentRole = ["student", "دانش آموز", "دانش‌آموز"].includes(role);
    if (!manager && !teacher && !studentRole) return reply({ message: "این نقش مجوز دسترسی به اطلاعات کلاس را ندارد." }, 403);
    if (!profile.tenant_school_id) return reply({ message: "شناسه مدرسه برای این حساب ثبت نشده است." }, 403);
    const school = profile.tenant_school_id;
    const callerName = clean(profile.display_name) || clean(profile.username);
    const teacherNames = [...new Set([callerName, clean(profile.username)].filter(Boolean))];
    let studentClassName = "";
    if (studentRole) {
      const { data: studentProfile, error: studentError } = await admin.from("students").select("class_name")
        .eq("tenant_school_id", school).eq("national_code", clean(profile.national_code)).maybeSingle();
      if (studentError || !studentProfile?.class_name) return reply({ message: "کلاس ثبت‌شده برای دانش‌آموز پیدا نشد." }, 403);
      studentClassName = clean(studentProfile.class_name);
    }
    const assertTeacherClass = async (className: string) => {
      if (manager) return true;
      if (!className) return false;
      const { data, error } = await admin.from("online_classes").select("id")
        .eq("tenant_school_id", school).eq("class_name", className).in("teacher", teacherNames).limit(1);
      if (error) throw error;
      return !!data?.length;
    };
    const body = await req.json().catch(() => null);
    if (!body || typeof body.action !== "string") return reply({ message: "درخواست ناقص است." }, 400);
    const action = body.action;
    const boundedRows = (rows: unknown) => Array.isArray(rows) && rows.length <= 1000 ? rows : null;

    if (action === "list_students") {
      if (studentRole) return reply({ message: "دانش‌آموز اجازهٔ مشاهدهٔ فهرست سایر دانش‌آموزان را ندارد." }, 403);
      let q = admin.from("students").select("id,first_name,last_name,national_code,student_code,grade,class_name").eq("tenant_school_id", school).order("last_name");
      if (teacher && !manager) {
        const className = clean(body.class_name);
        if (!className) return reply({ message: "برای مشاهده فهرست دانش‌آموزان، کلاس را انتخاب کنید." }, 400);
        if (!await assertTeacherClass(className)) return reply({ message: "به فهرست دانش‌آموزان این کلاس دسترسی ندارید." }, 403);
        q = q.eq("class_name", className);
      } else if (clean(body.class_name)) q = q.eq("class_name", clean(body.class_name));
      const { data, error } = await q.limit(1000);
      if (error) throw error;
      return reply({ ok: true, students: data ?? [] });
    }

    if (action === "list_classes") {
      let q = admin.from("online_classes").select("id,title,subject,teacher,grade,class_name,start_time,end_time,day_of_week,status,tenant_school_id").eq("tenant_school_id", school).order("id", { ascending: false });
      if (studentRole) q = q.eq("class_name", studentClassName);
      else if (teacher && !manager) q = q.in("teacher", teacherNames);
      const { data, error } = await q.limit(500);
      if (error) throw error;
      return reply({ ok: true, classes: data ?? [] });
    }

    if (action === "set_class_day") {
      if (!manager) return reply({ message: "فقط مدیریت می‌تواند برنامه هفتگی را تغییر دهد." }, 403);
      const classId = asInt(body.class_id), day = clean(body.day_of_week);
      if (!classId || !["شنبه","یکشنبه","دوشنبه","سه‌شنبه","چهارشنبه","پنجشنبه","جمعه"].includes(day)) return reply({ message: "کلاس یا روز هفته معتبر نیست." }, 400);
      const { data, error } = await admin.from("online_classes").update({ day_of_week: day }).eq("id", classId).eq("tenant_school_id", school).select("id,day_of_week").single();
      if (error) throw error;
      return reply({ ok: true, class: data });
    }

    if (action === "create_class") {
      if (!manager) return reply({ message: "فقط مدیریت می‌تواند کلاس ایجاد کند." }, 403);
      const title = clean(body.title), className = clean(body.class_name), teacherName = clean(body.teacher), subject = clean(body.subject);
      if (!title || !className || !teacherName || !subject) return reply({ message: "عنوان، نام کلاس، دبیر و درس الزامی است." }, 400);
      const row = { title, class_name: className, teacher: teacherName, subject, lesson: subject, grade: clean(body.grade), start_time: clean(body.start_time), end_time: clean(body.end_time), day_of_week: clean(body.day_of_week), status: "برنامه‌ریزی‌شده", tenant_school_id: school, activated_by: callerName };
      const { data, error } = await admin.from("online_classes").insert(row).select("id,title,class_name,teacher,subject,grade,start_time,end_time,status").single();
      if (error) throw error;
      return reply({ ok: true, class: data });
    }

    if (action === "attendance") {
      if (!teacher && !manager) return reply({ message: "مجوز ثبت حضور و غیاب ندارید." }, 403);
      const rows = boundedRows(body.rows);
      if (!rows || rows.length < 1) return reply({ message: "فهرست حضور و غیاب خالی یا بیش از حد بزرگ است." }, 400);
      const className = clean(body.class_name), subject = clean(body.subject), date = clean(body.date) || new Date().toISOString().slice(0, 10);
      if (!className) return reply({ message: "کلاس انتخاب نشده است." }, 400);
      if (!await assertTeacherClass(className)) return reply({ message: "ثبت حضور و غیاب برای این کلاس مجاز نیست." }, 403);
      const { data: students, error: studentError } = await admin.from("students").select("id,first_name,last_name,class_name").eq("tenant_school_id", school).eq("class_name", className);
      if (studentError) throw studentError;
      const allowed = new Map((students ?? []).map((s: any) => [Number(s.id), s]));
      const inserts = [];
      for (const raw of rows) {
        const r = raw as Record<string, unknown>, studentId = asInt(r.student_id);
        const status = norm(r.status);
        if (!studentId || !allowed.has(studentId) || !["حاضر","غایب","تاخیر","تأخیر","موجه","غیرموجه","present","absent","late","excused"].includes(status)) continue;
        inserts.push({ student_id: studentId, date, attendance_date: date, status: ["حاضر","present"].includes(status) ? "حاضر" : ["غایب","absent"].includes(status) ? "غایب" : ["تاخیر","تأخیر","late"].includes(status) ? "تأخیر" : status, teacher_id: asInt(body.teacher_id), subject, class_name: className, tenant_school_id: school, description: clean(r.description) });
      }
      if (!inserts.length) return reply({ message: "هیچ ردیف معتبر برای ثبت وجود ندارد." }, 400);
      const { data, error } = await admin.from("attendance").insert(inserts).select("id");
      if (error) throw error;
      return reply({ ok: true, saved: data?.length ?? inserts.length });
    }

    if (action === "grades") {
      if (!teacher && !manager) return reply({ message: "مجوز ثبت نمره ندارید." }, 403);
      const rows = boundedRows(body.rows);
      if (!rows || rows.length < 1) return reply({ message: "فهرست نمرات خالی یا بیش از حد بزرگ است." }, 400);
      const className = clean(body.class_name), subject = clean(body.subject), assessment = clean(body.assessment_title) || "ارزشیابی";
      if (!className || !subject) return reply({ message: "کلاس و درس الزامی است." }, 400);
      if (!await assertTeacherClass(className)) return reply({ message: "ثبت نمره برای این کلاس مجاز نیست." }, 403);
      const { data: students, error: studentError } = await admin.from("students").select("id").eq("tenant_school_id", school).eq("class_name", className);
      if (studentError) throw studentError;
      const allowed = new Set((students ?? []).map((s: any) => Number(s.id)));
      const inserts = [];
      for (const raw of rows) {
        const r = raw as Record<string, unknown>, studentId = asInt(r.student_id), score = Number(r.score);
        const maxScore = Number(body.max_score) > 0 ? Number(body.max_score) : 20;
        if (!studentId || !allowed.has(studentId) || !Number.isFinite(score) || score < 0 || score > maxScore) continue;
        inserts.push({ student_id: studentId, teacher_id: asInt(body.teacher_id), subject, class_name: className, assessment_type: clean(body.assessment_type) || "کلاسی", assessment_title: assessment, score: (score / (Number(body.max_score) > 0 ? Number(body.max_score) : 20)) * 20, coefficient: Number(body.coefficient) || 1, grade_date: new Date().toISOString().slice(0, 10), term: clean(body.month), description: "سقف نمره: " + (Number(body.max_score) > 0 ? Number(body.max_score) : 20) + "؛ نمره ثبت‌شده: " + score + "؛ " + clean(r.description), tenant_school_id: school, manager_released: 0 });
      }
      if (!inserts.length) return reply({ message: "هیچ نمره معتبر (۰ تا ۲۰) برای ثبت وجود ندارد." }, 400);
      const { data, error } = await admin.from("student_grades").insert(inserts).select("id");
      if (error) throw error;
      return reply({ ok: true, saved: data?.length ?? inserts.length });
    }


    if (action === "create_assignment") {
      if (!teacher && !manager) return reply({ message: "مجوز ثبت تکلیف ندارید." }, 403);
      const className = clean(body.class_name), subject = clean(body.subject), title = clean(body.title);
      if (!className || !title) return reply({ message: "کلاس و عنوان تکلیف الزامی است." }, 400);
      if (!await assertTeacherClass(className)) return reply({ message: "ثبت تکلیف برای این کلاس مجاز نیست." }, 403);
      const { data: roster, error: rosterError } = await admin.from("students").select("id").eq("tenant_school_id", school).eq("class_name", className);
      if (rosterError) throw rosterError;
      if (!roster?.length) return reply({ message: "فهرست دانش‌آموزان این کلاس هنوز وارد سامانه نشده است." }, 400);
      const { data: assignment, error } = await admin.from("assignments").insert({
        title, description: clean(body.description), subject, class_name: className,
        due_date: clean(body.due_date), teacher_id: asInt(body.teacher_id),
        status: "active", tenant_school_id: school
      }).select("id").single();
      if (error) throw error;
      const submissions = roster.map((s: any) => ({
        assignment_id: assignment.id, student_id: s.id, status: "not_done", tenant_school_id: school
      }));
      const { error: subError } = await admin.from("assignment_submissions").insert(submissions);
      if (subError) throw subError;
      return reply({ ok: true, assignment_id: assignment.id, students: submissions.length });
    }

    if (action === "assignment_status") {
      if (!teacher && !manager) return reply({ message: "مجوز تغییر وضعیت تکلیف ندارید." }, 403);
      const rows = boundedRows(body.rows);
      const className = clean(body.class_name), assignmentId = asInt(body.assignment_id);
      if (!rows || !rows.length || !className || !assignmentId) return reply({ message: "اطلاعات تکلیف ناقص است." }, 400);
      if (!await assertTeacherClass(className)) return reply({ message: "به این کلاس دسترسی ندارید." }, 403);
      const { data: assignment, error: assignmentError } = await admin.from("assignments").select("id,class_name").eq("id", assignmentId).eq("tenant_school_id", school).eq("class_name", className).maybeSingle();
      if (assignmentError) throw assignmentError;
      if (!assignment) return reply({ message: "تکلیف این کلاس پیدا نشد." }, 404);
      const { data: roster, error: rosterError } = await admin.from("students").select("id").eq("tenant_school_id", school).eq("class_name", className);
      if (rosterError) throw rosterError;
      const allowed = new Set((roster ?? []).map((s: any) => Number(s.id)));
      let saved = 0;
      for (const raw of rows) {
        const r = raw as Record<string, unknown>, studentId = asInt(r.student_id), status = clean(r.status);
        if (!studentId || !allowed.has(studentId) || !["done", "incomplete", "not_done"].includes(status)) continue;
        const { error } = await admin.from("assignment_submissions").update({ status }).eq("assignment_id", assignmentId).eq("student_id", studentId).eq("tenant_school_id", school);
        if (error) throw error;
        saved++;
      }
      return reply({ ok: true, saved });
    }

    if (action === "discipline") {
      if (!teacher && !manager) return reply({ message: "مجوز ثبت انضباط ندارید." }, 403);
      const rows = boundedRows(body.rows), className = clean(body.class_name);
      if (!rows || !rows.length || !className) return reply({ message: "کلاس یا فهرست موارد انضباطی ناقص است." }, 400);
      if (!await assertTeacherClass(className)) return reply({ message: "ثبت مورد انضباطی برای این کلاس مجاز نیست." }, 403);
      const { data: roster, error: rosterError } = await admin.from("students").select("id").eq("tenant_school_id", school).eq("class_name", className);
      if (rosterError) throw rosterError;
      const allowed = new Set((roster ?? []).map((s: any) => Number(s.id)));
      const inserts = rows.map((raw: any) => {
        const studentId = asInt(raw.student_id), title = clean(raw.title);
        return { student_id: studentId, title, description: clean(raw.description), status: "ثبت‌شده",
          priority: "عادی", actor_username: clean(profile.username), actor_role: clean(profile.role),
          incident_date: clean(body.date) || new Date().toISOString().slice(0,10), tenant_school_id: school };
      }).filter((r: any) => r.student_id && allowed.has(r.student_id) && r.title);
      if (!inserts.length) return reply({ message: "هیچ مورد انضباطی معتبر انتخاب نشده است." }, 400);
      const { data, error } = await admin.from("discipline_records").insert(inserts).select("id");
      if (error) throw error;
      return reply({ ok: true, saved: data?.length ?? inserts.length });
    }

    if (action === "import_timetable") {
      if (!manager) return reply({ message: "فقط مدیریت می‌تواند برنامه را وارد کند." }, 403);
      const rows = boundedRows(body.rows);
      if (!rows || rows.length < 1) return reply({ message: "فایل برنامه خالی یا بیش از ۱۰۰۰ ردیف است." }, 400);

      // Idempotent roster import: match by school + normalized class + normalized subject.
      // Preserve existing meeting times/status; the uploaded assignment workbook has no timetable times.
      const prepared = rows.map((raw: any) => ({
        title: clean(raw.title) || clean(raw.subject),
        class_name: clean(raw.class_name), subject: clean(raw.subject), lesson: clean(raw.subject),
        teacher: clean(raw.teacher), grade: clean(raw.grade),
        start_time: clean(raw.start_time), end_time: clean(raw.end_time), day_of_week: clean(raw.day_of_week),
      })).filter((r: any) => r.title && r.class_name && r.subject && r.teacher);
      if (!prepared.length) return reply({ message: "ستون‌های لازم یافت نشدند؛ کلاس، درس و دبیر را بررسی کنید." }, 400);

      const unique = new Map<string, any>();
      for (const row of prepared) {
        const key = norm(row.class_name) + "::" + norm(row.subject);
        if (!unique.has(key)) unique.set(key, row);
      }
      const { data: existing, error: listError } = await admin.from("online_classes")
        .select("id,title,subject,lesson,teacher,grade,class_name,start_time,end_time,day_of_week,status")
        .eq("tenant_school_id", school).limit(1000);
      if (listError) throw listError;

      const byKey = new Map<string, any>();
      for (const row of existing ?? []) {
        const key = norm(row.class_name) + "::" + norm(row.subject || row.lesson || row.title);
        if (!byKey.has(key)) byKey.set(key, row);
      }
      let inserted = 0, updated = 0, unchanged = 0;
      for (const [key, row] of unique) {
        const current = byKey.get(key);
        if (current) {
          const patch: Record<string, unknown> = {};
          if (clean(current.teacher) !== row.teacher) patch.teacher = row.teacher;
          if (clean(current.grade) !== row.grade && row.grade) patch.grade = row.grade;
          if (!clean(current.title) && row.title) patch.title = row.title;
          if (clean(current.day_of_week) !== row.day_of_week && row.day_of_week) patch.day_of_week = row.day_of_week;
          if (!clean(current.lesson) && row.lesson) patch.lesson = row.lesson;
          if (Object.keys(patch).length) {
            const { error } = await admin.from("online_classes").update(patch)
              .eq("id", current.id).eq("tenant_school_id", school);
            if (error) throw error;
            updated++;
          } else unchanged++;
        } else {
          const insertRow = {
            title: row.title, class_name: row.class_name, subject: row.subject, lesson: row.lesson,
            teacher: row.teacher, grade: row.grade, start_time: row.start_time, end_time: row.end_time, day_of_week: row.day_of_week,
            status: "برنامه‌ریزی‌شده", tenant_school_id: school, activated_by: callerName,
            auto_activate: false, auto_close: false,
          };
          const { data, error } = await admin.from("online_classes").insert(insertRow).select("id").single();
          if (error) throw error;
          inserted++;
          byKey.set(key, { ...insertRow, id: data.id });
        }
      }
      return reply({ ok: true, saved: inserted + updated + unchanged, inserted, updated, unchanged, duplicates_in_file: prepared.length - unique.size });
    }

    if (action === "import_students") {
      if (!manager) return reply({ message: "فقط مدیریت می‌تواند دانش‌آموزان را وارد کند." }, 403);
      const rows = boundedRows(body.rows);
      if (!rows || rows.length < 1) return reply({ message: "فایل دانش‌آموزان خالی یا بیش از ۱۰۰۰ ردیف است." }, 400);
      const normalizeNationalCode = (value: unknown) => {
        let code = clean(value).replace(/[۰-۹]/g, d => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
          .replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[^0-9]/g, "");
        if (code.length === 8 || code.length === 9) code = code.padStart(10, "0");
        return (code.length === 10 || code.length === 11) ? code : "";
      };
      const inserts = rows.map((raw: any) => {
        const code = normalizeNationalCode(raw.national_code || raw.student_code);
        return {
          first_name: clean(raw.first_name), last_name: clean(raw.last_name),
          national_code: code, student_code: code,
          grade: clean(raw.grade), class_name: clean(raw.class_name), tenant_school_id: school,
        };
      }).filter((r: any) => r.first_name && r.last_name && r.class_name && r.national_code);
      if (!inserts.length) return reply({ message: "ستون‌های نام، نام خانوادگی، کلاس و کد دانش‌آموز را بررسی کنید." }, 400);
      const { data, error } = await admin.from("students").insert(inserts).select("id");
      if (error) throw error;
      return reply({ ok: true, saved: data?.length ?? inserts.length });
    }

    return reply({ message: "عملیات درخواستی پشتیبانی نمی‌شود." }, 400);
  } catch (error) {
    console.error("classroom-management error", String(error));
    return reply({ message: "عملیات انجام نشد. ساختار داده‌ها و دسترسی پایگاه داده را بررسی کنید.", detail: String((error as any)?.message ?? error).slice(0, 240) }, 500);
  }
});