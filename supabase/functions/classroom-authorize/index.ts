import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
});
const clean = (v: unknown) => String(v ?? "").replace(/[\u200c\u200f\u202a-\u202e]/g, "").trim();
const norm = (v: unknown) => clean(v).toLocaleLowerCase("fa").replace(/[يى]/g, "ی").replace(/ك/g, "ک");

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ message: "درخواست نامعتبر است." }, 405);

  const authorization = req.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return reply({ message: "ابتدا از پنل فراهوش وارد شوید." }, 401);

  const url = (Deno.env.get("SUPABASE_URL") ?? "").trim();
  let serviceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  const bundleRaw = (Deno.env.get("SUPABASE_SECRET_KEYS") ?? "").trim();
  if (bundleRaw) {
    try {
      const bundle = JSON.parse(bundleRaw);
      const candidate = typeof bundle === "string" ? bundle : bundle.default ?? bundle.service_role ?? bundle.serviceRole ?? bundle.service_role_key;
      if (typeof candidate === "string" && candidate.trim()) serviceKey = candidate.trim();
    } catch {
      if (bundleRaw.startsWith("sb_secret_") || bundleRaw.startsWith("eyJ")) serviceKey = bundleRaw;
    }
  }
  if (!url || !serviceKey) return reply({ message: "سرویس بررسی مجوز کلاس پیکربندی نشده است." }, 503);

  try {
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return reply({ message: "نشست معتبر نیست؛ دوباره وارد پنل شوید." }, 401);

    const { data: profile, error: profileError } = await admin.from("account_settings")
      .select("username,national_code,display_name,role,auth_user_id,tenant_school_id")
      .eq("auth_user_id", authData.user.id).maybeSingle();
    if (profileError || !profile || !profile.tenant_school_id)
      return reply({ message: "پروفایل یا مدرسهٔ متصل به این حساب پیدا نشد." }, 403);

    const role = norm(profile.role);
    const managerRoles = ["manager", "مدیر", "مدیر مدرسه"];
    const deputyRoles = ["executive", "educational", "cultural", "pastoral", "advisor", "counselor", "deputy",
      "executive_deputy", "educational_deputy", "pastoral_deputy", "معاون اجرایی", "معاون آموزشی", "معاون پرورشی", "معاونت"];
    const isManager = managerRoles.includes(role);
    const isDeputy = deputyRoles.includes(role);
    const isTeacher = ["teacher", "دبیر", "معلم"].includes(role);
    const isStudent = role === "student" || role === "دانش‌آموز";
    if (!isManager && !isDeputy && !isTeacher && !isStudent)
      return reply({ message: "این نقش اجازهٔ ورود به کلاس آنلاین را ندارد." }, 403);

    const { data: membership, error: membershipError } = await admin.from("school_memberships")
      .select("id,role,is_active").eq("school_id", profile.tenant_school_id)
      .eq("auth_user_id", authData.user.id).eq("is_active", true).maybeSingle();
    if (membershipError || !membership)
      return reply({ message: "عضویت فعال این حساب در مدرسه تأیید نشد." }, 403);

    let studentClass = "";
    if (isStudent) {
      const { data: student, error } = await admin.from("students").select("class_name,grade")
        .eq("national_code", profile.national_code).eq("tenant_school_id", profile.tenant_school_id).maybeSingle();
      if (error || !student?.class_name) return reply({ message: "کلاس ثبت‌شدهٔ دانش‌آموز پیدا نشد." }, 403);
      studentClass = clean(student.class_name);
    }

    const body = await req.json().catch(() => ({}));
    const roomId = Number(body?.room_id || 0);
    let query = admin.from("online_classes")
      .select("id,title,subject,grade,class_name,teacher,status,start_at,end_at,tenant_school_id")
      .eq("tenant_school_id", profile.tenant_school_id).eq("status", "active").order("id", { ascending: false }).limit(100);
    if (roomId > 0) query = query.eq("id", roomId);
    if (isStudent) query = query.eq("class_name", studentClass);
    const { data: rows, error: roomsError } = await query;
    if (roomsError) {
      console.error("classroom room lookup failed", JSON.stringify({ code: roomsError.code, message: roomsError.message }));
      return reply({ message: "فهرست کلاس‌ها از پایگاه داده دریافت نشد." }, 503);
    }

    const teacherName = norm(profile.display_name);
    const username = norm(profile.username);
    const collaboratorIds = new Set<number>();
    if (isTeacher) {
      let teacherQuery = await admin.from("teachers").select("id")
        .eq("tenant_school_id", profile.tenant_school_id)
        .eq("national_code", clean(profile.national_code)).limit(1).maybeSingle();
      if (!teacherQuery.data && profile.username) {
        teacherQuery = await admin.from("teachers").select("id")
          .eq("tenant_school_id", profile.tenant_school_id)
          .eq("employee_code", clean(profile.username)).limit(1).maybeSingle();
      }
      if (teacherQuery.data?.id) {
        const { data: links } = await admin.from("online_class_teachers").select("class_id")
          .eq("tenant_school_id", profile.tenant_school_id).eq("teacher_id", teacherQuery.data.id);
        for (const link of links ?? []) collaboratorIds.add(Number(link.class_id));
      }
    }
    const allowed = (rows ?? []).filter((row: any) => {
      if (isTeacher) {
        const assigned = norm(row.teacher);
        return (!!assigned && (assigned === teacherName || assigned === username)) || collaboratorIds.has(Number(row.id));
      }
      return isManager || isDeputy || isStudent;
    });
    if (roomId > 0 && !allowed.length)
      return reply({ message: "این اتاق فعال نیست یا مجوز ورود به آن برای حساب شما ثبت نشده است." }, 403);

    return reply({
      ok: true,
      profile: {
        username: clean(profile.username),
        display_name: clean(profile.display_name) || clean(profile.username),
        role: clean(profile.role),
        class_name: studentClass,
      },
      rooms: allowed.map((row: any) => ({
        id: row.id, title: clean(row.title) || clean(row.subject) || "کلاس آنلاین",
        subject: clean(row.subject), grade: clean(row.grade), class_name: clean(row.class_name),
        teacher: clean(row.teacher), status: clean(row.status),
      })),
      room: roomId > 0 ? {
        id: allowed[0].id, title: clean(allowed[0].title) || clean(allowed[0].subject) || "کلاس آنلاین",
        subject: clean(allowed[0].subject), grade: clean(allowed[0].grade),
        class_name: clean(allowed[0].class_name), teacher: clean(allowed[0].teacher),
      } : null,
    });
  } catch (error) {
    console.error("classroom-authorize failed", String(error));
    return reply({ message: "بررسی نشست و مجوز کلاس انجام نشد؛ کمی بعد دوباره تلاش کنید." }, 503);
  }
});