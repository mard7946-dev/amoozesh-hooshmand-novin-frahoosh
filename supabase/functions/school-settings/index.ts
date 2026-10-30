import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const clean = (value: unknown, max = 2000) => String(value ?? "").trim().slice(0, max);
const managerRoles = new Set(["manager", "مدیر", "مدیریت", "principal", "administrator", "admin"]);

function safeHttpsUrl(value: unknown, required = false): string {
  const raw = clean(value, 1000);
  if (!raw) {
    if (required) throw new Error("آدرس سرور الزامی است.");
    return "";
  }
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new Error("آدرس سرور معتبر نیست."); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) {
    throw new Error("آدرس سرور باید HTTPS باشد و نباید نام کاربری، رمز یا بخش اضافی داشته باشد.");
  }
  if (["localhost", "127.0.0.1", "::1"].includes(parsed.hostname.toLowerCase())) {
    throw new Error("آدرس محلی برای سرور بیرونی قابل ثبت نیست.");
  }
  return parsed.origin + parsed.pathname.replace(/\/$/, "");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ message: "درخواست نامعتبر است." }, 405);

  const bearer = req.headers.get("Authorization") ?? "";
  if (!bearer.startsWith("Bearer ")) return reply({ message: "ابتدا وارد سامانه شوید." }, 401);

  const url = (Deno.env.get("SUPABASE_URL") ?? "").trim();
  let serviceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  const bundleRaw = (Deno.env.get("SUPABASE_SECRET_KEYS") ?? "").trim();
  if (bundleRaw) {
    try {
      const parsed = JSON.parse(bundleRaw);
      const candidate = typeof parsed === "string" ? parsed : parsed.default ?? parsed.service_role ?? parsed.serviceRole ?? parsed.service_role_key;
      if (typeof candidate === "string" && candidate.trim()) serviceKey = candidate.trim();
    } catch {
      if (bundleRaw.startsWith("sb_secret_") || bundleRaw.startsWith("eyJ")) serviceKey = bundleRaw;
    }
  }
  if (!url || !serviceKey) return reply({ message: "تنظیمات امن سرویس کامل نیست." }, 503);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error: authError } = await admin.auth.getUser(bearer.slice(7));
  if (authError || !auth.user) return reply({ message: "نشست ورود معتبر نیست؛ دوباره وارد شوید." }, 401);

  const { data: caller, error: callerError } = await admin.from("account_settings")
    .select("auth_user_id,role,tenant_school_id")
    .eq("auth_user_id", auth.user.id).maybeSingle();
  if (callerError || !caller || !managerRoles.has(clean(caller.role).toLowerCase())) {
    return reply({ message: "فقط مدیر مدرسه اجازه تغییر تنظیمات سامانه را دارد." }, 403);
  }
  const schoolId = clean(caller.tenant_school_id);
  if (!schoolId) return reply({ message: "شناسه مدرسه برای حساب مدیر ثبت نشده است." }, 409);
  const { data: membership, error: membershipError } = await admin.from("school_memberships")
    .select("id").eq("auth_user_id", auth.user.id).eq("school_id", schoolId)
    .eq("role", "manager").eq("is_active", true).maybeSingle();
  if (membershipError || !membership) return reply({ message: "عضویت فعال مدیر برای این مدرسه تأیید نشد." }, 403);

  const body = await req.json().catch(() => ({}));
  const action = clean(body.action || "get", 40);

  if (action === "get") {
    const [schoolResult, settingsResult, serversResult] = await Promise.all([
      admin.from("schools").select("id,name,school_code,slug,status").eq("id", schoolId).maybeSingle(),
      admin.from("school_settings").select("*").eq("school_id", schoolId).maybeSingle(),
      admin.from("school_server_connections").select("id,label,provider,supabase_url,publishable_key,api_base_url,environment,notes,is_primary,created_at,updated_at").eq("school_id", schoolId).order("updated_at", { ascending: false }),
    ]);
    if (schoolResult.error || !schoolResult.data) return reply({ message: "اطلاعات مدرسه دریافت نشد." }, 500);
    if (settingsResult.error || serversResult.error) return reply({ message: "تنظیمات مدرسه دریافت نشد." }, 500);
    return reply({ school: schoolResult.data, settings: settingsResult.data ?? {}, servers: serversResult.data ?? [] });
  }

  if (action === "save_school") {
    const schoolName = clean(body.school_name, 180);
    const schoolCode = clean(body.school_code, 40);
    const academicYear = clean(body.academic_year, 30);
    const calendar = clean(body.calendar || "persian", 20);
    if (!schoolName || !schoolCode || !academicYear) return reply({ message: "نام مدرسه، کد مدرسه و سال تحصیلی الزامی است." }, 400);
    if (!["persian", "gregorian"].includes(calendar)) return reply({ message: "نوع تقویم معتبر نیست." }, 400);
    const schoolWrite = await admin.from("schools").update({ name: schoolName, school_code: schoolCode, updated_at: new Date().toISOString() }).eq("id", schoolId);
    if (schoolWrite.error) return reply({ message: "اطلاعات اصلی مدرسه ذخیره نشد." }, 500);
    const payload = {
      school_id: schoolId, academic_year: academicYear,
      address: clean(body.address, 500), phone: clean(body.phone, 60),
      email: clean(body.email, 180), logo_url: safeHttpsUrl(body.logo_url),
      calendar, language: "fa-IR",
      term_settings: body.term_settings && typeof body.term_settings === "object" && !Array.isArray(body.term_settings) ? body.term_settings : {},
      updated_by: auth.user.id, updated_at: new Date().toISOString(),
    };
    const saved = await admin.from("school_settings").upsert(payload, { onConflict: "school_id" }).select("*").single();
    if (saved.error) return reply({ message: "تنظیمات تکمیلی مدرسه ذخیره نشد." }, 500);
    return reply({ success: true, settings: saved.data, school: { id: schoolId, name: schoolName, school_code: schoolCode } });
  }

  if (action === "save_server") {
    const id = clean(body.id, 80);
    const label = clean(body.label, 100);
    const provider = clean(body.provider || "custom", 20);
    const environment = clean(body.environment || "production", 20);
    if (label.length < 2) return reply({ message: "عنوان سرور باید حداقل دو نویسه باشد." }, 400);
    if (!["supabase", "custom", "other"].includes(provider) || !["production", "staging", "development"].includes(environment)) {
      return reply({ message: "نوع سرور یا محیط انتخاب‌شده معتبر نیست." }, 400);
    }
    let supabaseUrl = "", apiBaseUrl = "";
    try {
      supabaseUrl = safeHttpsUrl(body.supabase_url, provider === "supabase");
      apiBaseUrl = safeHttpsUrl(body.api_base_url, provider !== "supabase");
    } catch (error) { return reply({ message: error instanceof Error ? error.message : "آدرس سرور معتبر نیست." }, 400); }
    const publishableKey = clean(body.publishable_key, 300);
    if (publishableKey && !(publishableKey.startsWith("sb_publishable_") || publishableKey.startsWith("eyJ"))) {
      return reply({ message: "کلید عمومی باید Publishable یا anon key باشد؛ کلید محرمانه سرور را وارد نکنید." }, 400);
    }
    const payload = {
      school_id: schoolId, label, provider, supabase_url: supabaseUrl,
      publishable_key: publishableKey, api_base_url: apiBaseUrl, environment,
      notes: clean(body.notes, 1000), is_primary: body.is_primary === true,
      updated_by: auth.user.id, updated_at: new Date().toISOString(),
    };
    if (payload.is_primary) {
      const clearPrimary = await admin.from("school_server_connections").update({ is_primary: false }).eq("school_id", schoolId);
      if (clearPrimary.error) return reply({ message: "انتخاب سرور اصلی قبلی به‌روزرسانی نشد." }, 500);
    }
    const write = id
      ? await admin.from("school_server_connections").update(payload).eq("id", id).eq("school_id", schoolId).select("id,label,provider,supabase_url,publishable_key,api_base_url,environment,notes,is_primary,updated_at").maybeSingle()
      : await admin.from("school_server_connections").insert({ ...payload, created_by: auth.user.id }).select("id,label,provider,supabase_url,publishable_key,api_base_url,environment,notes,is_primary,created_at,updated_at").single();
    if (write.error || !write.data) return reply({ message: "اطلاعات سرور ذخیره نشد." }, 500);
    return reply({ success: true, server: write.data });
  }

  if (action === "delete_server") {
    const id = clean(body.id, 80);
    if (!id) return reply({ message: "شناسه سرور مشخص نیست." }, 400);
    const removed = await admin.from("school_server_connections").delete().eq("id", id).eq("school_id", schoolId);
    if (removed.error) return reply({ message: "حذف سرور انجام نشد." }, 500);
    return reply({ success: true });
  }

  return reply({ message: "عملیات درخواستی شناخته نشد." }, 400);
});
