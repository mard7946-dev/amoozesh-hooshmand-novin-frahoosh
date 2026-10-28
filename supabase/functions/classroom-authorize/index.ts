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
  .replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).toLocaleLowerCase("fa");

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ message: "درخواست نامعتبر است." }, 405);
  const authorization = req.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return reply({ message: "برای ورود به کلاس باید ابتدا وارد سامانه شوید." }, 401);
  const url = (Deno.env.get("SUPABASE_URL") ?? "").trim();
  let serviceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  const bundleRaw = (Deno.env.get("SUPABASE_SECRET_KEYS") ?? "").trim();
  if (bundleRaw) {
    try {
      const bundle = JSON.parse(bundleRaw);
      const candidate = typeof bundle === "string" ? bundle : bundle.default ?? bundle.service_role ?? bundle.serviceRole ?? bundle.service_role_key;
      if (typeof candidate === "string" && candidate.trim()) serviceKey = candidate.trim();
    } catch (_) {
      if (bundleRaw.startsWith("sb_secret_") || bundleRaw.startsWith("eyJ")) serviceKey = bundleRaw;
    }
  }
  if (!url || !serviceKey) return reply({ message: "سرویس بررسی نشست موقتاً در دسترس نیست." }, 503);
  try {
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return reply({ message: "نشست معتبر نیست؛ دوباره وارد سامانه شوید." }, 401);
    const { data: profile, error: profileError } = await admin.from("account_settings")
      .select("username,national_code,display_name,role,auth_user_id,tenant_school_id")
      .eq("auth_user_id", authData.user.id).maybeSingle();
    if (profileError || !profile) {
      console.error("classroom-authorize profile lookup failed", JSON.stringify({ code: profileError?.code ?? null, message: profileError?.message ?? null }));
      return reply({ message: "مجوز نقش این حساب تأیید نشد." }, 403);
    }

    const role = norm(profile.role);
    const name = clean(profile.display_name) || clean(profile.username);
    let className = "";
    if (role === "student") {
      let studentQuery = admin.from("students").select("class_name")
        .eq("national_code", profile.national_code);
      if (profile.tenant_school_id) studentQuery = studentQuery.eq("tenant_school_id", profile.tenant_school_id);
      const { data: student, error } = await studentQuery.maybeSingle();
      if (error || !student?.class_name) return reply({ message: "کلاس ثبت‌شده دانش‌آموز پیدا نشد." }, 403);
      className = clean(student.class_name);
    }

    let classesQuery = admin.from("online_classes")
      .select("id,title,subject,lesson,teacher,grade,class_name,start_time,end_time,status,start_at,end_at,join_url,meeting_url,tenant_school_id")
      .order("start_time", { ascending: true });
    if (profile.tenant_school_id) classesQuery = classesQuery.eq("tenant_school_id", profile.tenant_school_id);
    if (role === "student") {
      classesQuery = classesQuery.eq("class_name", className);
    } else if (role === "teacher") {
      classesQuery = classesQuery.or("teacher.eq." + name.replace(/[(),]/g, "") + ",teacher.eq." + clean(profile.username).replace(/[(),]/g, ""));
    } else if (!["manager", "educational", "executive", "cultural", "advisor", "counselor", "deputy"].includes(role)) {
      return reply({ message: "این نقش اجازهٔ ورود به کلاس آنلاین را ندارد." }, 403);
    }

    const { data: rows, error: classesError } = await classesQuery.limit(100);
    if (classesError) {
      console.error("classroom-authorize classes lookup failed", JSON.stringify({ code: classesError.code, message: classesError.message }));
      return reply({ message: "فهرست کلاس‌های آنلاین از پایگاه داده دریافت نشد." }, 503);
    }
    const rooms = (rows ?? []).map((row: any) => ({
      id: row.id,
      title: clean(row.title) || clean(row.lesson) || clean(row.subject) || "کلاس آنلاین",
      subject: clean(row.subject) || clean(row.lesson),
      class_name: clean(row.class_name),
      teacher: clean(row.teacher),
      start_time: clean(row.start_time),
      end_time: clean(row.end_time),
      status: clean(row.status),
      join_url: clean(row.join_url) || clean(row.meeting_url),
    }));
    const requestedId = Number((await req.clone().json().catch(() => ({})))?.room_id ?? 0);
    if (requestedId) {
      const room = rooms.find((item: any) => Number(item.id) === requestedId);
      if (!room) return reply({ message: "این کلاس در فهرست کلاس‌های مجاز شما نیست." }, 403);
      return reply({ ok: true, profile: {
        username: clean(profile.username), display_name: name, role: clean(profile.role), class_name: className,
      }, room });
    }
    return reply({ ok: true, profile: {
      username: clean(profile.username), display_name: name, role: clean(profile.role), class_name: className,
    }, rooms });
  } catch (error) {
    console.error("classroom-authorize failed", String(error));
    return reply({ message: "بررسی نشست انجام نشد؛ کمی بعد دوباره تلاش کنید." }, 503);
  }
});
