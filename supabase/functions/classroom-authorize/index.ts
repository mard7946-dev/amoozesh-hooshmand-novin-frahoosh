import { createClient } from "npm:@supabase/supabase-js@2";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const clean = (v: unknown) => String(v ?? "").replace(/[\u200c\u200f\u202a-\u202e]/g, "").trim();

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
      .select("username,national_code,display_name,role,auth_user_id")
      .eq("auth_user_id", authData.user.id).maybeSingle();
    if (profileError || !profile) {
      console.error("classroom-authorize profile lookup failed", JSON.stringify({ code: profileError?.code ?? null, message: profileError?.message ?? null }));
      return reply({ message: "مجوز نقش این حساب تأیید نشد." }, 403);
    }
    let className = "";
    if (clean(profile.role).toLowerCase() === "student") {
      const { data: student, error } = await admin.from("students").select("class_name")
        .eq("national_code", profile.national_code).maybeSingle();
      if (error || !student?.class_name) return reply({ message: "کلاس ثبت‌شده دانش‌آموز پیدا نشد." }, 403);
      className = clean(student.class_name);
    }
    return reply({ ok: true, profile: {
      username: clean(profile.username),
      display_name: clean(profile.display_name) || clean(profile.username),
      role: clean(profile.role),
      class_name: className,
    } });
  } catch (error) {
    console.error("classroom-authorize failed", String(error));
    return reply({ message: "بررسی نشست انجام نشد؛ کمی بعد دوباره تلاش کنید." }, 503);
  }
});