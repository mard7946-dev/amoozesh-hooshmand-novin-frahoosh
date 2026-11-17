import { createClient } from "npm:@supabase/supabase-js@2";
import { generateWeeklyTimetable, validateWeeklyTimetable, WEEKDAYS, type Slot, type Requirement, type TeacherWorkdays } from "./validation.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
});
const clean = (value: unknown) => String(value ?? "").replace(/[\u200c\u200f\u202a-\u202e]/g, "").trim();
const digits = (value: string) => value.replace(/[۰-۹]/g, d => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
const norm = (value: unknown) => clean(value).replace(/\s+/g, "").toLocaleLowerCase("fa");
const managerRoles = ["manager", "مدیر", "مدیریت", "executive", "educational", "deputy", "معاون", "معاون اجرایی", "معاون آموزشی"];
const isManagerRole = (role: unknown) => managerRoles.some(item => norm(role).includes(norm(item)));

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ message: "فقط درخواست POST پذیرفته می‌شود." }, 405);
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return reply({ message: "ابتدا وارد سامانه شوید." }, 401);
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
  if (!url || !serviceKey) return reply({ message: "اتصال امن پایگاه داده تنظیم نشده است." }, 503);
  try {
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return reply({ message: "نشست معتبر نیست؛ دوباره وارد شوید." }, 401);
    const { data: profile, error: profileError } = await admin.from("account_settings")
      .select("username,display_name,role,auth_user_id,tenant_school_id")
      .eq("auth_user_id", authData.user.id).maybeSingle();
    if (profileError || !profile?.tenant_school_id) return reply({ message: "مدرسه یا نقش حساب تأیید نشد." }, 403);
    const { data: memberships, error: membershipError } = await admin.from("school_memberships")
      .select("role").eq("school_id", profile.tenant_school_id)
      .eq("auth_user_id", authData.user.id).eq("is_active", true);
    if (membershipError) throw membershipError;
    const requestedRole = clean((await req.clone().json().catch(() => ({}))).active_role);
    const membershipRoles = (memberships ?? []).map((row: any) => clean(row.role));
    const roleCandidates = [clean(profile.role), ...membershipRoles];
    const selectedRole = requestedRole && roleCandidates.some(role => norm(role) === norm(requestedRole))
      ? requestedRole : clean(profile.role);
    if (!isManagerRole(selectedRole)) return reply({ message: "فقط مدیر و معاون آموزشی/اجرایی مجاز به تدوین برنامه هفتگی هستند." }, 403);
    const body = await req.json().catch(() => null);
    if (!body || typeof body.action !== "string") return reply({ message: "درخواست ناقص است." }, 400);
    const schoolId = profile.tenant_school_id;
    const callerId = authData.user.id;
    const callerName = clean(profile.display_name) || clean(profile.username) || "مدیریت";
    const action = clean(body.action);
    const verifyRequirements = async (requirements: Requirement[]) => {
      const teacherIds = [...new Set(requirements.map(row => Number(row.teacher_id)).filter(id => Number.isInteger(id) && id > 0))];
      if (!requirements.length) return true;
      if (!teacherIds.length) return false;
      const { data: activeAssignments, error } = await admin.from("teacher_classes")
        .select("teacher_id,teacher_name,subject,class_name")
        .eq("tenant_school_id", schoolId).eq("active", 1).in("teacher_id", teacherIds).limit(2000);
      if (error) throw error;
      const allowed = new Set((activeAssignments ?? []).map((row: any) =>
        [norm(row.class_name), norm(row.subject), Number(row.teacher_id)].join("|")
      ));
      return requirements.every(row =>
        allowed.has([norm(row.class_name), norm(row.subject), Number(row.teacher_id)].join("|"))
      );
    };

    if (action === "bootstrap") {
      const [teachersResult, assignmentsResult, plansResult] = await Promise.all([
        admin.from("teachers").select("id,first_name,last_name,subject,lessons,grades,employment_status")
          .eq("tenant_school_id", schoolId).order("last_name").limit(500),
        admin.from("teacher_classes").select("id,teacher_id,teacher_name,subject,grade,class_name,active")
          .eq("tenant_school_id", schoolId).eq("active", 1).order("class_name").limit(2000),
        admin.from("school_weekly_timetable_plans").select("id,academic_year,title,status,updated_at,published_at")
          .eq("school_id", schoolId).order("updated_at", { ascending: false }).limit(50),
      ]);
      const failed = [teachersResult, assignmentsResult, plansResult].find((result: any) => result.error);
      if (failed) throw failed.error;
      const teachers = (teachersResult.data ?? []).map((row: any) => ({
        id: row.id, name: [clean(row.first_name), clean(row.last_name)].filter(Boolean).join(" "),
        subject: clean(row.subject), lessons: clean(row.lessons), grades: clean(row.grades),
        employment_status: clean(row.employment_status),
      }));
      return reply({ ok: true, weekdays: WEEKDAYS, teachers, assignments: assignmentsResult.data ?? [], plans: plansResult.data ?? [] });
    }

    if (action === "get_plan") {
      const planId = clean(body.plan_id);
      if (!planId) return reply({ message: "شناسه برنامه مشخص نیست." }, 400);
      const { data, error } = await admin.from("school_weekly_timetable_plans")
        .select("id,school_id,academic_year,title,status,requirements,teacher_workdays,slots,validation,updated_at,published_at")
        .eq("school_id", schoolId).eq("id", planId).maybeSingle();
      if (error) throw error;
      if (!data) return reply({ message: "برنامه پیدا نشد." }, 404);
      return reply({ ok: true, plan: data });
    }

    if (action === "generate") {
      const requirements = Array.isArray(body.requirements) ? body.requirements as Requirement[] : [];
      const teacherWorkdays = Array.isArray(body.teacher_workdays) ? body.teacher_workdays as TeacherWorkdays[] : [];
      if (!requirements.length) return reply({ message: "ابتدا نیاز هفتگی درس‌ها را ثبت کنید." }, 400);
      if (!await verifyRequirements(requirements)) return reply({ message: "یکی از تخصیص‌های درس/دبیر/کلاس در فهرست فعال همین مدرسه وجود ندارد." }, 400);
      const generated = generateWeeklyTimetable({ requirements, teacher_workdays: teacherWorkdays });
      return reply({ ok: generated.errors.length === 0, slots: generated.slots, errors: generated.errors, warnings: generated.warnings });
    }

    if (action === "validate" || action === "save_draft" || action === "publish") {
      const academicYear = digits(clean(body.academic_year));
      const title = clean(body.title) || "برنامه اصلی";
      const requirements = Array.isArray(body.requirements) ? body.requirements as Requirement[] : [];
      const teacherWorkdays = Array.isArray(body.teacher_workdays) ? body.teacher_workdays as TeacherWorkdays[] : [];
      const slots = Array.isArray(body.slots) ? body.slots as Slot[] : [];
      if (!/^\d{4}-\d{4}$/.test(academicYear)) return reply({ message: "سال تحصیلی را با قالب ۱۴۰۶-۱۴۰۵ وارد کنید." }, 400);
      if (requirements.length > 1000 || teacherWorkdays.length > 500 || slots.length > 500) {
        return reply({ message: "حجم اطلاعات برنامه از حد مجاز بیشتر است." }, 413);
      }
      const validation = validateWeeklyTimetable({ slots, requirements, teacher_workdays: teacherWorkdays });
      if (action === "validate") return reply({ ok: true, validation });
      if (action === "publish" && (!requirements.length || !slots.length || !validation.valid || validation.warnings.length)) {
        return reply({ ok: false, validation, message: validation.errors[0] || validation.warnings[0] || "برنامه آماده انتشار نیست." }, 409);
      }
      const planId = clean(body.plan_id);
      const patch = {
        academic_year: academicYear, title, requirements, teacher_workdays: teacherWorkdays, slots,
        validation, updated_by: callerId, updated_at: new Date().toISOString(),
      };
      if (planId) {
        const { data: existing, error: existingError } = await admin.from("school_weekly_timetable_plans")
          .select("id,status").eq("school_id", schoolId).eq("id", planId).maybeSingle();
        if (existingError) throw existingError;
        if (!existing) return reply({ message: "برنامه برای این مدرسه پیدا نشد." }, 404);
        if (existing.status !== "draft") return reply({ message: "برنامه منتشرشده قابل ویرایش نیست؛ ابتدا نسخه جدید بسازید." }, 409);
        const update = action === "publish"
          ? { ...patch, status: "published", published_by: callerId, published_at: new Date().toISOString() }
          : patch;
        const { data, error } = await admin.from("school_weekly_timetable_plans").update(update)
          .eq("school_id", schoolId).eq("id", planId).eq("status", "draft")
          .select("id,academic_year,title,status,validation,published_at").single();
        if (error) throw error;
        return reply({ ok: true, plan: data, validation });
      }
      if (action === "publish") return reply({ message: "ابتدا پیش‌نویس را ذخیره کنید و سپس آن را منتشر کنید." }, 400);
      const { data, error } = await admin.from("school_weekly_timetable_plans").insert({
        school_id: schoolId, ...patch, created_by: callerId,
      }).select("id,academic_year,title,status,validation,updated_at").single();
      if (error) throw error;
      return reply({ ok: true, plan: data, validation });
    }

    if (action === "delete_draft") {
      const planId = clean(body.plan_id);
      if (!planId) return reply({ message: "شناسه برنامه مشخص نیست." }, 400);
      const { data, error } = await admin.from("school_weekly_timetable_plans").delete()
        .eq("school_id", schoolId).eq("id", planId).eq("status", "draft").select("id").maybeSingle();
      if (error) throw error;
      if (!data) return reply({ message: "فقط پیش‌نویس همین مدرسه قابل حذف است." }, 409);
      return reply({ ok: true, deleted: true });
    }
    return reply({ message: "عملیات درخواستی پشتیبانی نمی‌شود." }, 400);
  } catch (error) {
    const detail = error && typeof error === "object" ? String((error as any).message ?? (error as any).details ?? error) : String(error);
    console.error("weekly-timetable-planner error", detail);
    return reply({ message: "عملیات برنامه هفتگی انجام نشد.", detail: detail.slice(0, 350) }, 500);
  }
});
