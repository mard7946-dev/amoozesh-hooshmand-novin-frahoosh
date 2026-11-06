import { createClient } from "npm:@supabase/supabase-js@2";
import { buildDisciplineScoreBatches, isSchoolManagerRole } from "./discipline-rules.ts";
import { activeTeacherAccounts, resolveTeacherAccount } from "./teacher-identity.ts";

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
const isDeputy = (role: string) => ["executive", "educational", "cultural", "deputy", "معاون"].some(r => norm(role).includes(norm(r)));
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
    const body = await req.json().catch(() => null);
    if (!body || typeof body.action !== "string") return reply({ message: "درخواست ناقص است." }, 400);
    const mainRole = norm(profile.role);
    const requestedRole = norm(body.active_role);
    const { data: activeMemberships, error: membershipsError } = await admin.from("school_memberships")
      .select("role").eq("school_id", profile.tenant_school_id).eq("auth_user_id", authData.user.id).eq("is_active", true);
    if (membershipsError) return reply({ message: "بررسی سمت‌های فعال حساب انجام نشد." }, 503);
    const membershipRoles = new Set((activeMemberships ?? []).map((item: any) => norm(item.role)));
    const hasTeacherMembership = membershipRoles.has("teacher") || membershipRoles.has("دبیر") || membershipRoles.has("معلم");
    const role = requestedRole === "teacher" && hasTeacherMembership ? "teacher" : mainRole;
    if (requestedRole === "teacher" && role !== "teacher") return reply({ message: "عضویت فعال دبیر برای این حساب تأیید نشد." }, 403);
    const manager = isManager(role);
    const schoolManager = isSchoolManagerRole(role);
    const teacher = isTeacher(role);
    const deputy = isDeputy(role);
    const studentRole = ["student", "دانش آموز", "دانش‌آموز"].includes(role);
    if (!manager && !teacher && !deputy && !studentRole) return reply({ message: "این نقش مجوز دسترسی به اطلاعات کلاس را ندارد." }, 403);
    if (!profile.tenant_school_id) return reply({ message: "شناسه مدرسه برای این حساب ثبت نشده است." }, 403);
    const school = profile.tenant_school_id;
    const callerName = clean(profile.display_name) || clean(profile.username);
    const teacherNames = [...new Set([callerName, clean(profile.username)].filter(Boolean))];
    // Teacher-to-class ownership is keyed by teachers.id in teacher_classes.
    // Do not infer ownership from display-name text in online_classes.teacher.
    let teacherRecordId: number | null = null;
    if (teacher) {
      const accountNationalCode = clean(profile.national_code);
      if (accountNationalCode) {
        const { data: teacherRow, error: teacherError } = await admin.from("teachers").select("id")
          .eq("tenant_school_id", school).eq("national_code", accountNationalCode).limit(1).maybeSingle();
        if (teacherError) throw teacherError;
        teacherRecordId = teacherRow?.id ?? null;
      } else {
        // Legacy accounts may have no national code in either account_settings
        // or teachers. Allow only a unique exact full-name match with a
        // matching active teacher_classes assignment; never use name alone.
        const identityName = norm(callerName);
        if (identityName) {
          const { data: teacherRows, error: teacherRowsError } = await admin.from("teachers")
            .select("id,first_name,last_name,national_code")
            .eq("tenant_school_id", school);
          if (teacherRowsError) throw teacherRowsError;
          const matches = (teacherRows ?? []).filter((row: any) =>
            !clean(row.national_code) &&
            norm(`${clean(row.first_name)} ${clean(row.last_name)}`) === identityName
          );
          if (matches.length === 1) {
            const candidateId = matches[0].id;
            const { data: linkedRows, error: linkedError } = await admin.from("teacher_classes")
              .select("id,teacher_name").eq("tenant_school_id", school)
              .eq("teacher_id", candidateId).eq("active", 1);
            if (linkedError) throw linkedError;
            const hasMatchingAssignment = (linkedRows ?? []).some((row: any) =>
              teacherNames.some(name => norm(row.teacher_name) === norm(name))
            );
            if (hasMatchingAssignment) teacherRecordId = candidateId;
          }
        }
      }
    }
    let studentClassName = "";
    if (studentRole) {
      const { data: studentProfile, error: studentError } = await admin.from("students").select("class_name")
        .eq("tenant_school_id", school).eq("national_code", clean(profile.national_code)).maybeSingle();
      if (studentError || !studentProfile?.class_name) return reply({ message: "کلاس ثبت‌شده برای دانش‌آموز پیدا نشد." }, 403);
      studentClassName = clean(studentProfile.class_name);
    }
    const assertTeacherClass = async (className: string) => {
      if (manager) return true;
      if (!teacher || !teacherRecordId || !className) return false;
      const { data, error } = await admin.from("teacher_classes").select("id")
        .eq("tenant_school_id", school).eq("teacher_id", teacherRecordId)
        .eq("class_name", className).eq("active", 1).limit(1);
      if (error) throw error;
      return !!data?.length;
    };
    const assertTeacherSubject = async (className: string, subject: string) => {
      if (schoolManager) return true;
      if (!teacher || !teacherRecordId || !className || !subject) return false;
      const { data, error } = await admin.from("teacher_classes").select("id")
        .eq("tenant_school_id", school).eq("teacher_id", teacherRecordId)
        .eq("class_name", className).eq("subject", subject).eq("active", 1).limit(1);
      if (error) throw error;
      return !!data?.length;
    };
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
      let q = admin.from("online_classes")
        .select("id,title,subject,teacher,grade,class_name,start_time,end_time,day_of_week,status,tenant_school_id")
        .eq("tenant_school_id", school).order("id", { ascending: false });
      if (studentRole) q = q.eq("class_name", studentClassName);
      else if (teacher && !manager) q = q.in("teacher", teacherNames);
      const { data, error } = await q.limit(500);
      if (error) throw error;
      return reply({ ok: true, classes: data ?? [] });
    }

    // Separate operational class selector. The online-class schedule/room listing above
    // deliberately keeps its existing source and behavior.
    if (action === "list_teacher_assignments") {
      if (!teacher || !teacherRecordId) return reply({ message: "حساب دبیر به پرونده همکار متصل نیست." }, 403);
      const { data, error } = await admin.from("teacher_classes")
        .select("id,teacher_id,teacher_name,subject,grade,class_name,active")
        .eq("tenant_school_id", school).eq("teacher_id", teacherRecordId).eq("active", 1)
        .order("class_name", { ascending: true });
      if (error) throw error;
      return reply({ ok: true, assignments: data ?? [] });
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
      if (!teacher && !deputy && !manager) return reply({ message: "مجوز ثبت انضباط و تشویق ندارید." }, 403);
      const rows = boundedRows(body.rows), className = clean(body.class_name), subject = clean(body.subject);
      if (!rows || !rows.length || !className || (teacher && !subject)) return reply({ message: "کلاس، درس دبیر یا فهرست موارد ناقص است." }, 400);
      if (teacher && (!await assertTeacherClass(className) || !await assertTeacherSubject(className, subject)))
        return reply({ message: "این درس در برنامه تدریس فعال شما برای کلاس انتخاب‌شده ثبت نشده است." }, 403);
      const { data: roster, error: rosterError } = await admin.from("students").select("id").eq("tenant_school_id", school).eq("class_name", className);
      if (rosterError) throw rosterError;
      const allowed = new Set((roster ?? []).map((x: any) => Number(x.id)));
      let teacherId: number | null = null;
      if (teacher) {
        const { data: teacherRow } = await admin.from("teachers").select("id").eq("tenant_school_id", school).eq("national_code", clean(profile.national_code)).maybeSingle();
        teacherId = teacherRow?.id ?? null;
      }
      const actorRole = teacher ? "teacher" : deputy ? "deputy" : "manager";
      const inserts = rows.map((raw: any) => {
        const studentId = asInt(raw.student_id), title = clean(raw.title);
        return { student_id: studentId, teacher_id: teacherId, title,
          description: clean(raw.description), note: clean(raw.description),
          record_type: clean(raw.record_type) === "praise" ? "praise" : "discipline",
          class_name: className, subject: teacher ? subject : "", status: "pending", priority: "normal",
          actor_username: clean(profile.username), actor_role: actorRole,
          incident_date: clean(body.date) || new Date().toISOString().slice(0,10), tenant_school_id: school };
      }).filter((x: any) => x.student_id && allowed.has(x.student_id) && x.title);
      if (!inserts.length) return reply({ message: "هیچ ردیف معتبر برای ثبت وجود ندارد." }, 400);
      const { data, error } = await admin.from("discipline_records").insert(inserts).select("*");
      if (error) throw error;
      const auditRows=(data??[]).map((row:any)=>({tenant_school_id:school,record_id:row.id,action:"insert",
        actor_username:clean(profile.username),actor_role:actorRole,
        after_data:row}));
      if(auditRows.length){const {error:auditError}=await admin.from("discipline_record_audit").insert(auditRows);if(auditError) throw auditError;}
      let proposalsCreated = 0;
      for (const studentId of [...new Set((data ?? []).map((x: any) => Number(x.student_id)))]) {
        let historyQuery = admin.from("discipline_records").select("id,record_type")
          .eq("tenant_school_id",school).eq("student_id",studentId).eq("actor_role",actorRole)
          .eq("actor_username",clean(profile.username)).is("deleted_at",null).order("id",{ascending:true}).limit(2000);
        if (teacher) historyQuery = historyQuery.eq("subject",subject);
        const { data: history, error: historyError } = await historyQuery;
        if (historyError) throw historyError;
        const batches = buildDisciplineScoreBatches(
          history ?? [],
          (data ?? []).map((record: any) => Number(record.id)),
          teacher ? "teacher" : "deputy",
        );
        for (const batch of batches) {
          let existsQuery=admin.from("discipline_score_proposals").select("id,source_record_ids")
            .eq("tenant_school_id",school).eq("student_id",studentId).eq("actor_role",actorRole)
            .eq("target_score",batch.targetScore).eq("subject",teacher?subject:"");
          const {data:existing,error:existingError}=await existsQuery;
          if(existingError) throw existingError;
          if((existing??[]).some((p:any)=>Array.isArray(p.source_record_ids)&&p.source_record_ids.length===batch.sourceRecordIds.length&&batch.sourceRecordIds.every((id:number)=>p.source_record_ids.includes(id)))) continue;
          const {data:proposalData,error:proposalError}=await admin.from("discipline_score_proposals").upsert({
            tenant_school_id:school,student_id:studentId,actor_role:actorRole,actor_username:clean(profile.username),teacher_id:teacherId,
            subject:teacher?subject:"",discipline_count:batch.disciplineCount,
            praise_count:batch.praiseCount,proposed_delta:batch.delta,target_score:batch.targetScore,
            source_record_ids:batch.sourceRecordIds
          },{onConflict:"tenant_school_id,student_id,actor_role,target_score,subject,source_record_ids",ignoreDuplicates:true}).select("id");
          if(proposalError) throw proposalError;
          proposalsCreated+=proposalData?.length??0;
        }
      }
      return reply({ ok: true, saved: data?.length ?? inserts.length, proposals_created:proposalsCreated,
        praise: (data ?? []).filter((x: any) => x.record_type === "praise").length,
        discipline: (data ?? []).filter((x: any) => x.record_type !== "praise").length });
    }

    if (action === "discipline_summary") {
      if (!teacher && !deputy && !manager) return reply({ message: "مجوز مشاهده سوابق را ندارید." }, 403);
      let q = admin.from("discipline_records").select("id,student_id,teacher_id,title,record_type,class_name,subject,actor_role,actor_username,incident_date")
        .eq("tenant_school_id", school).is("deleted_at",null).order("incident_date", { ascending: false }).limit(2000);
      if (teacher) {
        q = q.eq("actor_role","teacher").eq("actor_username",clean(profile.username));
      } else if (deputy && !schoolManager) {
        q = q.eq("actor_role","deputy").eq("actor_username",clean(profile.username));
      }
      const { data, error } = await q;
      if (error) throw error;
      const ids = [...new Set((data ?? []).map((x: any) => Number(x.student_id)).filter(Boolean))];
      const { data: roster, error: rosterError } = ids.length
        ? await admin.from("students").select("id,first_name,last_name").eq("tenant_school_id",school).in("id",ids)
        : { data: [], error: null };
      if (rosterError) throw rosterError;
      const names = new Map((roster ?? []).map((x: any) => [Number(x.id), clean(x.first_name)+" "+clean(x.last_name)]));
      const grouped = new Map<string, any>();
      for (const row of data ?? []) {
        const key = [row.actor_role,row.teacher_id,row.actor_username,row.student_id,row.class_name,row.subject].join("|");
        const item = grouped.get(key) ?? { actor_role: row.actor_role, student_name: names.get(Number(row.student_id)) ?? "دانش‌آموز",
          class_name: row.class_name, subject: row.subject, discipline_count: 0, praise_count: 0, proposed_adjustment: 0 };
        if (row.record_type === "praise") item.praise_count++; else item.discipline_count++;
        item.proposed_adjustment = item.actor_role === "teacher"
          ? Math.floor(item.praise_count/2)-Math.floor(item.discipline_count/3)
          : -Math.floor(item.discipline_count/3);
        grouped.set(key,item);
      }
      const records = (data ?? []).map((x: any) => ({...x, student_name:names.get(Number(x.student_id)) ?? "دانش‌آموز"}));
      let proposalsQuery = admin.from("discipline_score_proposals")
        .select("id,student_id,actor_role,subject,discipline_count,praise_count,proposed_delta,target_score,status,source_record_ids,created_at,reviewed_at,reviewed_by,review_note")
        .eq("tenant_school_id",school).order("created_at",{ascending:false}).limit(500);
      if (teacher) proposalsQuery = proposalsQuery.eq("actor_role","teacher").eq("actor_username",clean(profile.username));
      else if (deputy && !schoolManager) proposalsQuery = proposalsQuery.eq("actor_role","deputy").eq("actor_username",clean(profile.username));
      const {data: proposals,error: proposalsError}=await proposalsQuery;
      if(proposalsError) throw proposalsError;
      const proposalStudentIds=[...new Set((proposals??[]).map((x:any)=>Number(x.student_id)).filter(Boolean))];
      const {data: proposalStudents,error: proposalStudentsError}=proposalStudentIds.length
        ? await admin.from("students").select("id,first_name,last_name").eq("tenant_school_id",school).in("id",proposalStudentIds)
        : {data:[],error:null};
      if(proposalStudentsError) throw proposalStudentsError;
      const proposalNames=new Map((proposalStudents??[]).map((x:any)=>[Number(x.id),clean(x.first_name)+" "+clean(x.last_name)]));
      return reply({ ok: true, rows: [...grouped.values()], records,
        proposals:(proposals??[]).map((x:any)=>({...x,student_name:proposalNames.get(Number(x.student_id))??"دانش‌آموز"})) });
    }

    if (action === "discipline_update" || action === "discipline_delete") {
      if (!teacher && !deputy && !manager) return reply({message:"مجوز ویرایش سوابق را ندارید."},403);
      const recordId=asInt(body.record_id);
      if(!recordId) return reply({message:"شناسه سابقه معتبر نیست."},400);
      const {data:record,error:recordError}=await admin.from("discipline_records").select("*")
        .eq("id",recordId).eq("tenant_school_id",school).is("deleted_at",null).maybeSingle();
      if(recordError) throw recordError;
      if(!record) return reply({message:"سابقه پیدا نشد یا قبلاً حذف شده است."},404);
      const ownsRecord=schoolManager || (teacher && record.actor_role==="teacher" && record.actor_username===clean(profile.username))
        || (deputy && record.actor_role==="deputy" && record.actor_username===clean(profile.username));
      if(!ownsRecord) return reply({message:"فقط ثبت‌کننده یا مدیریت مجاز به تغییر این سابقه است."},403);
      const {data:used,error:usedError}=await admin.from("discipline_score_proposals").select("id")
        .eq("tenant_school_id",school).contains("source_record_ids",[recordId]).limit(1);
      if(usedError) throw usedError;
      if(used?.length) return reply({message:"این سابقه مبنای پیشنهاد امتیاز شده و برای حفظ سوابق قابل ویرایش یا حذف نیست."},409);
      if(action==="discipline_delete") {
        const {data:updated,error}=await admin.from("discipline_records").update({deleted_at:new Date().toISOString(),updated_at:new Date().toISOString()})
          .eq("id",recordId).eq("tenant_school_id",school).select("*").single();
        if(error) throw error;
        const {error:auditError}=await admin.from("discipline_record_audit").insert({tenant_school_id:school,record_id:recordId,action:"delete",
          actor_username:clean(profile.username),actor_role:teacher?"teacher":deputy?"deputy":"manager",before_data:record,after_data:updated});
        if(auditError) throw auditError;
        return reply({ok:true,deleted:true});
      }
      const title=clean(body.title),description=clean(body.description),recordType=clean(body.record_type);
      const className=clean(body.class_name),subject=teacher?clean(body.subject):"";
      if(!title||!className||!["discipline","praise"].includes(recordType)||(teacher&&!subject)) return reply({message:"عنوان، کلاس، درس دبیر و نوع سابقه الزامی است."},400);
      if(teacher && (!await assertTeacherClass(className) || !await assertTeacherSubject(className, subject)))
        return reply({message:"این درس در برنامه تدریس فعال شما برای کلاس انتخاب‌شده ثبت نشده است."},403);
      const {data:student,error:studentError}=await admin.from("students").select("id").eq("id",record.student_id)
        .eq("tenant_school_id",school).eq("class_name",className).maybeSingle();
      if(studentError) throw studentError;
      if(!student) return reply({message:"دانش‌آموز در کلاس انتخاب‌شده نیست."},400);
      const {data:updated,error}=await admin.from("discipline_records").update({title,description,note:description,record_type:recordType,
        class_name:className,subject,incident_date:clean(body.incident_date),updated_at:new Date().toISOString()})
        .eq("id",recordId).eq("tenant_school_id",school).select("*").single();
      if(error) throw error;
      const {error:auditError}=await admin.from("discipline_record_audit").insert({tenant_school_id:school,record_id:recordId,action:"update",
        actor_username:clean(profile.username),actor_role:teacher?"teacher":deputy?"deputy":"manager",before_data:record,after_data:updated});
      if(auditError) throw auditError;
      return reply({ok:true,record:updated});
    }

    if (action === "student_academic_summary") {
      if(!studentRole) return reply({message:"این گزارش فقط برای حساب دانش‌آموز قابل مشاهده است."},403);
      const {data:student,error:studentError}=await admin.from("students").select("id,first_name,last_name,class_name,grade")
        .eq("tenant_school_id",school).eq("national_code",clean(profile.national_code)).maybeSingle();
      if(studentError) throw studentError;
      if(!student) return reply({message:"پرونده دانش‌آموز پیدا نشد."},404);
      const [gradesResult,adjustmentsResult]=await Promise.all([
        admin.from("student_grades").select("id,subject,assessment_type,assessment_title,score,coefficient,grade_date_shamsi,term")
          .eq("tenant_school_id",school).eq("student_id",student.id).eq("manager_released",1).order("id",{ascending:false}).limit(1000),
        admin.from("student_grade_adjustments").select("id,target_score,subject,term,delta,actor_role,applied_at")
          .eq("tenant_school_id",school).eq("student_id",student.id).order("applied_at",{ascending:false}).limit(500)
      ]);
      if(gradesResult.error) throw gradesResult.error;
      if(adjustmentsResult.error) throw adjustmentsResult.error;
      const grades=gradesResult.data??[],adjustments=adjustmentsResult.data??[];
      const groups=new Map<string,any>();
      for(const g of grades){
        const key=clean(g.subject);
        const item=groups.get(key)??{subject:clean(g.subject),term:"مجموع نوبت‌های منتشرشده",weighted:0,weight:0};
        const w=Math.max(0,Number(g.coefficient)||1);item.weighted+=Number(g.score||0)*w;item.weight+=w;groups.set(key,item);
      }
      const continuous=[...groups.values()].map(g=>{
        const delta=adjustments.filter(a=>a.target_score==="continuous"&&a.subject===g.subject).reduce((n,a)=>n+Number(a.delta||0),0);
        const base=g.weight?g.weighted/g.weight:0;
        return {...g,base_score:Number(base.toFixed(2)),adjustment:Number(delta.toFixed(2)),final_score:Number(Math.max(0,Math.min(20,base+delta)).toFixed(2))};
      });
      const disciplineDelta=adjustments.filter(a=>a.target_score==="discipline").reduce((n,a)=>n+Number(a.delta||0),0);
      return reply({ok:true,student,grades,adjustments,continuous,discipline_adjustment:Number(disciplineDelta.toFixed(2))});
    }

    if (action === "discipline_review") {
      if(!schoolManager) return reply({message:"فقط مدیر مدرسه مجاز به تأیید یا رد پیشنهاد امتیاز است."},403);
      const proposalId=asInt(body.proposal_id), status=clean(body.status);
      if(!proposalId||!["approved","rejected"].includes(status)) return reply({message:"وضعیت بررسی معتبر نیست."},400);
      if(status==="approved"){
        const {data,error}=await admin.rpc("approve_discipline_score_proposal",{
          p_proposal_id:proposalId,p_school_id:school,p_reviewer:clean(profile.username)
        });
        if(error) throw error;
        return reply({ok:true,proposal:data,applied:true});
      }
      const {data,error}=await admin.from("discipline_score_proposals").update({status:"rejected",reviewed_at:new Date().toISOString(),
        reviewed_by:clean(profile.username),review_note:clean(body.review_note)})
        .eq("id",proposalId).eq("tenant_school_id",school).eq("status","pending").select("id,status").maybeSingle();
      if(error) throw error;
      if(!data) return reply({message:"پیشنهاد پیدا نشد یا قبلاً بررسی شده است."},409);
      return reply({ok:true,proposal:data,applied:false});
    }

    if (action === "list_weekly_schedule") {
      if (!manager) return reply({ message: "فقط مدیریت می‌تواند وضعیت برنامه هفتگی را مدیریت کند." }, 403);
      const { data, error } = await admin.from("weekly_schedule_entries")
        .select("id,class_name,weekday,period,subject,teacher_name,teacher_username,online_class_id,start_time,end_time,day_enabled,room,academic_year")
        .eq("tenant_school_id", school).order("weekday").order("period").limit(2000);
      if (error) throw error;
      return reply({ ok: true, entries: data ?? [] });
    }

    if (action === "set_weekly_schedule_enabled") {
      if (!manager) return reply({ message: "فقط مدیریت می‌تواند زنگ‌ها را فعال یا غیرفعال کند." }, 403);
      const enabled = body.enabled === true;
      const className = clean(body.class_name);
      const entryId = asInt(body.entry_id);
      let query = admin.from("weekly_schedule_entries").update({ day_enabled: enabled }).eq("tenant_school_id", school);
      if (entryId) query = query.eq("id", entryId);
      else if (className) query = query.eq("class_name", className);
      else if (body.all === true) { /* all rows in this school */ }
      else return reply({ message: "شناسه زنگ، نام کلاس یا گزینه همه کلاس‌ها الزامی است." }, 400);
      const { data, error } = await query.select("id,day_enabled");
      if (error) throw error;
      return reply({ ok: true, updated: data?.length ?? 0, enabled });
    }

    if (action === "import_weekly_schedule") {
      if (!manager) return reply({ message: "فقط مدیریت می‌تواند برنامه هفتگی را وارد کند." }, 403);
      const rows = boundedRows(body.rows);
      if (!rows || rows.length < 1) return reply({ message: "فایل برنامه هفتگی خالی یا بیش از ۱۰۰۰ ردیف است." }, 400);

      const days = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"];
      const key = (value: unknown) => norm(value).replace(/\s+/g, "");
      const canonicalDay = (value: unknown) => days.find(day => key(day) === key(value)) ?? "";
      const canonicalTime = (value: unknown) => {
        const match = norm(value).match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
        if (!match) return "";
        const hour = Number(match[1]), minute = Number(match[2]);
        if (hour > 23 || minute > 59) return "";
        return String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0");
      };

      const [accountsResult, membershipsResult, roomsResult, scheduleResult] = await Promise.all([
        admin.from("account_settings").select("username,display_name,role,auth_user_id")
          .eq("tenant_school_id", school).limit(1000),
        admin.from("school_memberships").select("auth_user_id,role")
          .eq("school_id", school).eq("is_active", true).limit(2000),
        admin.from("online_classes").select("id,title,subject,lesson,teacher,class_name,grade,status")
          .eq("tenant_school_id", school).limit(1000),
        admin.from("weekly_schedule_entries").select("id,class_name,weekday,period,subject,teacher_name,teacher_username,online_class_id,start_time,end_time,day_enabled")
          .eq("tenant_school_id", school).limit(2000),
      ]);
      if (accountsResult.error) throw accountsResult.error;
      if (membershipsResult.error) throw membershipsResult.error;
      if (roomsResult.error) throw roomsResult.error;
      if (scheduleResult.error) throw scheduleResult.error;

      // A few school staff hold both a deputy post and an explicitly active teacher membership.
      // Resolve against active memberships, not only the primary account_settings.role.
      const teacherAccounts = activeTeacherAccounts(accountsResult.data ?? [], membershipsResult.data ?? []);
      const resolveTeacher = (row: any) => resolveTeacherAccount(row, teacherAccounts);

      const classNameByKey = new Map<string, string>();
      for (const entry of [...(scheduleResult.data ?? []), ...(roomsResult.data ?? [])]) {
        const className = clean(entry.class_name);
        if (className && !classNameByKey.has(key(className))) classNameByKey.set(key(className), className);
      }
      const prepared = (rows as any[]).map((raw, index) => {
        const weekday = canonicalDay(raw.weekday ?? raw.day_of_week);
        const period = Number(norm(raw.period));
        const periodTimes: Record<number, [string, string]> = {
          1: ["13:30", "14:20"], 2: ["14:30", "15:20"], 3: ["15:30", "16:20"],
        };
        const configuredTimes = periodTimes[Number(norm(raw.period))];
        const startTime = canonicalTime(raw.start_time) || configuredTimes?.[0] || "";
        const endTime = canonicalTime(raw.end_time) || configuredTimes?.[1] || "";
        const teacherAccount = resolveTeacher(raw);
        return {
          rowNumber: Number(raw.source_row) || index + 2,
          class_name: classNameByKey.get(key(raw.class_name)) || clean(raw.class_name),
          weekday,
          period,
          subject: clean(raw.subject),
          teacher_name: clean(teacherAccount?.display_name) || clean(raw.teacher_name || raw.teacher),
          teacher_username: clean(teacherAccount?.username),
          grade: clean(raw.grade),
          room: clean(raw.room),
          academic_year: clean(raw.academic_year),
          start_time: startTime,
          end_time: endTime,
        };
      });

      const invalid = prepared.filter(row =>
        !row.class_name || !row.weekday || !Number.isInteger(row.period) || row.period < 1 || row.period > 6 ||
        !row.subject || !row.teacher_name || !row.teacher_username ||
        !row.start_time || !row.end_time ||
        Number(row.end_time.replace(":", "")) <= Number(row.start_time.replace(":", ""))
      );
      if (invalid.length) {
        const rowNumbers = invalid.slice(0, 12).map(row => row.rowNumber).join("، ");
        const unresolvedTeachers = [...new Set(invalid.filter(row => !row.teacher_username).map(row => row.teacher_name))].slice(0, 12).join("، ");
        return reply({
          message: "ردیف‌های " + rowNumbers + " ناقص یا نامعتبرند. کلاس، روز، شماره زنگ، درس و ساعت را بررسی کنید." +
            (unresolvedTeachers ? " حساب دبیر فعال یا تطبیق نام پیدا نشد: " + unresolvedTeachers : ""),
          invalid_rows: invalid.length,
          unresolved_teachers: unresolvedTeachers ? unresolvedTeachers.split("، ") : [],
        }, 400);
      }

      const teacherSlotKey = (className: unknown, weekday: unknown, period: unknown, subject: unknown, teacherUsername: unknown) =>
        [key(className), key(weekday), Number(period), key(subject), key(teacherUsername)].join("::");
      const seen = new Set<string>();
      for (const row of prepared) {
        const rowKey = teacherSlotKey(row.class_name, row.weekday, row.period, row.subject, row.teacher_username);
        if (seen.has(rowKey)) return reply({ message: "برای یک کلاس، روز، زنگ و دبیر یکسان ردیف تکراری وجود دارد: " + row.class_name + " · " + row.weekday + " · زنگ " + row.period }, 400);
        seen.add(rowKey);
      }

      const roomKey = (className: unknown, subject: unknown, teacherUsername: unknown) =>
        [key(className), key(subject), key(teacherUsername)].join("::");
      const roomByKey = new Map<string, any>();
      for (const room of roomsResult.data ?? []) {
        const account = resolveTeacher({ teacher: room.teacher });
        const teacherUsername = account?.username || room.teacher;
        const k = roomKey(room.class_name, room.subject || room.lesson || room.title, teacherUsername);
        if (!roomByKey.has(k)) roomByKey.set(k, room);
      }
      const existingBySlot = new Map<string, any>();
      for (const entry of scheduleResult.data ?? []) {
        const account = resolveTeacher({ teacher: entry.teacher_name });
        const teacherUsername = entry.teacher_username || account?.username || entry.teacher_name;
        const k = teacherSlotKey(entry.class_name, entry.weekday, entry.period, entry.subject, teacherUsername);
        if (!existingBySlot.has(k)) existingBySlot.set(k, entry);
        // Older import stored the parallel 8/1 Saturday bell as one combined subject.
        // Reuse that row for the first half (science); the second half is inserted separately.
        if (key(entry.class_name) === key("۸/۱") && key(entry.weekday) === key("شنبه") &&
            Number(entry.period) === 2 && key(entry.subject) === key("علوم / مطالعات")) {
          existingBySlot.set(teacherSlotKey(entry.class_name, entry.weekday, entry.period, "علوم", teacherUsername), entry);
        }
      }

      let inserted = 0, updated = 0, roomsCreated = 0;
      for (const row of prepared) {
        const k = roomKey(row.class_name, row.subject, row.teacher_username);
        const slotKey = teacherSlotKey(row.class_name, row.weekday, row.period, row.subject, row.teacher_username);
        const existing = existingBySlot.get(slotKey);
        let room = roomByKey.get(k);
        if (!room && existing?.online_class_id) {
          const linkedRoom = (roomsResult.data ?? []).find((item: any) => Number(item.id) === Number(existing.online_class_id));
          if (linkedRoom) {
            room = linkedRoom;
            if (key(room.subject || room.lesson || room.title) !== key(row.subject)) {
              const patch = {
                title: row.subject + " · " + row.class_name,
                subject: row.subject,
                lesson: row.subject,
                teacher: row.teacher_name,
                grade: row.grade,
                start_time: row.start_time,
                end_time: row.end_time,
                day_of_week: row.weekday,
              };
              const { error } = await admin.from("online_classes").update(patch)
                .eq("id", room.id).eq("tenant_school_id", school);
              if (error) throw error;
              room = { ...room, ...patch };
            }
            roomByKey.set(k, room);
          }
        }
        if (!room) {
          const { data, error } = await admin.from("online_classes").insert({
            title: row.subject + " · " + row.class_name,
            class_name: row.class_name,
            subject: row.subject,
            lesson: row.subject,
            teacher: row.teacher_name,
            grade: row.grade,
            start_time: row.start_time,
            end_time: row.end_time,
            day_of_week: row.weekday,
            status: "برنامه‌ریزی‌شده",
            tenant_school_id: school,
            activated_by: callerName,
            auto_activate: false,
            auto_close: false,
          }).select("id,title,subject,lesson,teacher,class_name,grade,status").single();
          if (error) throw error;
          room = data;
          roomByKey.set(k, room);
          roomsCreated++;
        } else if (clean(room.teacher) !== row.teacher_name) {
          const { error } = await admin.from("online_classes").update({ teacher: row.teacher_name })
            .eq("id", room.id).eq("tenant_school_id", school);
          if (error) throw error;
          room = { ...room, teacher: row.teacher_name };
          roomByKey.set(k, room);
        }

        const scheduleEntry = {
          class_name: row.class_name,
          weekday: row.weekday,
          period: row.period,
          subject: row.subject,
          teacher_name: row.teacher_name,
          teacher_username: row.teacher_username,
          room: row.room || null,
          academic_year: row.academic_year || null,
          online_class_id: room.id,
          start_time: row.start_time,
          end_time: row.end_time,
          day_enabled: existing?.day_enabled === true,
          tenant_school_id: school,
        };
        if (existing) {
          const { error } = await admin.from("weekly_schedule_entries").update(scheduleEntry)
            .eq("id", existing.id).eq("tenant_school_id", school);
          if (error) throw error;
          updated++;
          existingBySlot.set(slotKey, { ...scheduleEntry, id: existing.id });
        } else {
          const { data, error } = await admin.from("weekly_schedule_entries").insert(scheduleEntry).select("id").single();
          if (error) throw error;
          existingBySlot.set(slotKey, { ...scheduleEntry, id: data.id });
          inserted++;
        }
      }
      return reply({ ok: true, saved: inserted + updated, inserted, updated, rooms_created: roomsCreated });
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