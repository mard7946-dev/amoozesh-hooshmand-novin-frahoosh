import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const clean = (value: unknown, max = 180) => String(value ?? "").trim().slice(0, max);
const managerRoles = new Set(["manager", "مدیر", "مدیریت"]);
const executiveRoles = new Set(["executive", "executive_deputy", "معاون اجرایی", "معاونت اجرایی", "معاون اجرایی مدرسه"]);

async function fetchAll(admin: any, table: string, columns: string, schoolId: string) {
  const rows: Record<string, unknown>[] = [];
  const pageSize = 1000;
  for (let offset = 0; offset < 10000; offset += pageSize) {
    const { data, error } = await admin.from(table).select(columns)
      .eq("tenant_school_id", schoolId).range(offset, offset + pageSize - 1);
    if (error) throw new Error("دریافت اطلاعات " + table + " ناموفق بود.");
    const page = (data ?? []) as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
  throw new Error("حجم اطلاعات مدرسه بیش از حد مجاز این گزارش است.");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ message: "درخواست نامعتبر است." }, 405);
  const bearer = req.headers.get("Authorization") ?? "";
  if (!bearer.startsWith("Bearer ")) return reply({ message: "ابتدا وارد سامانه شوید." }, 401);

  const url = (Deno.env.get("SUPABASE_URL") ?? "").trim();
  let serviceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  const bundle = (Deno.env.get("SUPABASE_SECRET_KEYS") ?? "").trim();
  if (bundle) {
    try {
      const parsed = JSON.parse(bundle);
      const value = typeof parsed === "string" ? parsed : parsed.default ?? parsed.service_role ?? parsed.serviceRole ?? parsed.service_role_key;
      if (typeof value === "string" && value.trim()) serviceKey = value.trim();
    } catch {
      if (bundle.startsWith("sb_secret_") || bundle.startsWith("eyJ")) serviceKey = bundle;
    }
  }
  if (!url || !serviceKey) return reply({ message: "تنظیمات امن سرویس کامل نیست." }, 503);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const { data: auth, error: authError } = await admin.auth.getUser(bearer.slice(7));
    if (authError || !auth.user) return reply({ message: "نشست ورود معتبر نیست؛ دوباره وارد شوید." }, 401);

    const { data: account, error: accountError } = await admin.from("account_settings")
      .select("auth_user_id,role,tenant_school_id").eq("auth_user_id", auth.user.id).maybeSingle();
    if (accountError || !account) return reply({ message: "حساب مدرسه پیدا نشد." }, 403);
    const accountRole = clean(account.role).toLowerCase();
    const schoolId = clean(account.tenant_school_id, 80);
    if (!schoolId) return reply({ message: "شناسه مدرسه برای حساب شما ثبت نشده است." }, 409);
    if (!managerRoles.has(accountRole) && !executiveRoles.has(accountRole))
      return reply({ message: "این بخش فقط برای مدیر و معاون اجرایی فعال است." }, 403);

    const { data: membership, error: membershipError } = await admin.from("school_memberships")
      .select("id,role").eq("auth_user_id", auth.user.id).eq("school_id", schoolId)
      .eq("is_active", true).limit(1).maybeSingle();
    if (membershipError || !membership) return reply({ message: "عضویت فعال شما در این مدرسه تأیید نشد." }, 403);
    const membershipRole = clean(membership.role).toLowerCase();
    if (!managerRoles.has(membershipRole) && !executiveRoles.has(membershipRole))
      return reply({ message: "نقش عضویت شما اجازه مشاهده تحلیل آموزشی را ندارد." }, 403);

    const body = await req.json().catch(() => ({}));
    if (clean(body.action || "get", 20) !== "get")
      return reply({ message: "عملیات درخواستی پشتیبانی نمی‌شود." }, 400);

    const [school, students, grades, assignments] = await Promise.all([
      admin.from("schools").select("id,name").eq("id", schoolId).maybeSingle(),
      fetchAll(admin, "students", "id,first_name,last_name,student_code,grade,class_name", schoolId),
      fetchAll(admin, "student_grades", "id,student_id,teacher_id,subject,class_name,assessment_type,assessment_title,score,coefficient,grade_date,grade_date_shamsi,description,term,created_at,manager_released", schoolId),
      fetchAll(admin, "teacher_classes", "id,teacher_id,teacher_name,subject,grade,class_name,active", schoolId)
    ]);
    if (!school.data) return reply({ message: "اطلاعات مدرسه پیدا نشد." }, 404);

    const publishedGrades = grades.filter((row: any) => Number(row.manager_released) === 1);
    const activeAssignments = assignments.filter((row: any) => Number(row.active) === 1 || row.active === true);
    return reply({
      school: school.data,
      students: students,
      grades: publishedGrades,
      assignments: activeAssignments,
      metadata: {
        studentsCount: students.length,
        publishedGradesCount: publishedGrades.length,
        activeAssignmentsCount: activeAssignments.length,
        gradeYearFieldAvailable: false
      }
    });
  } catch (error) {
    return reply({ message: error instanceof Error ? error.message : "دریافت تحلیل آموزشی ناموفق بود." }, 500);
  }
});
