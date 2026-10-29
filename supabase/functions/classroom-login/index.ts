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
  .replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).toLowerCase();

function roleAllowed(actual: string, expected: string) {
  const a = norm(actual), e = norm(expected);
  const manager = ["manager", "مدیر", "مدیر مدرسه"];
  const teacher = ["teacher", "دبیر", "معلم"];
  const student = ["student", "دانش آموز"];
  const parent = ["parent", "guardian", "ولی", "والد", "والدین", "سرپرست"];
  const counselor = ["counselor", "advisor", "cultural", "مشاور", "مشاوره", "پرورشی"];
  const deputyAliases = ["executive", "educational", "deputy", "executive_deputy", "educational_deputy", "معاون اجرایی", "معاون آموزشی", "معاونت"];
  if (e === "manager") return manager.includes(a);
  if (e === "deputy") return deputyAliases.includes(a);
  if (e === "teacher") return teacher.includes(a);
  if (e === "student") return student.includes(a);
  if (e === "parent") return parent.includes(a);
  if (e === "counselor") return counselor.includes(a);
  return false;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ message: "درخواست نامعتبر است." }, 405);
  const body = await req.json().catch(() => ({}));
  const username = clean(body?.username), password = String(body?.password ?? ""), expectedRole = clean(body?.role);
  if (!username || !password || !["manager", "deputy", "teacher", "student", "parent", "counselor"].includes(expectedRole)) {
    return reply({ message: "نام کاربری، رمز عبور و نقش را کامل وارد کنید." }, 400);
  }
  const url = (Deno.env.get("SUPABASE_URL") ?? "").trim();
  const anonKey = (Deno.env.get("SUPABASE_ANON_KEY") ?? req.headers.get("apikey") ?? "").trim();
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
  if (!url || !anonKey || !serviceKey) return reply({ message: "سرویس احراز هویت موقتاً در دسترس نیست." }, 503);

  try {
    const loginResponse = await fetch(url + "/functions/v1/login-by-username", {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": anonKey },
      body: JSON.stringify({ username, password }),
    });
    const login = await loginResponse.json().catch(() => ({}));
    if (!loginResponse.ok || !login.session?.access_token || !login.user?.id) {
      return reply({ message: login.message || "نام کاربری یا رمز عبور صحیح نیست." }, 401);
    }

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: profile, error: profileError } = await admin.from("account_settings")
      .select("username,national_code,display_name,role,auth_user_id")
      .eq("auth_user_id", login.user.id).maybeSingle();
    if (profileError || !profile) {
      console.error("classroom-login profile lookup failed", JSON.stringify({ code: profileError?.code ?? null, message: profileError?.message ?? null }));
      return reply({ message: "حساب وارد شد اما مجوز نقش از سرور تأیید نشد." }, 503);
    }
    if (!roleAllowed(profile.role, expectedRole)) {
      return reply({ message: "این حساب مجوز ورود به بخش انتخاب‌شده را ندارد." }, 403);
    }

    let className = "";
    if (expectedRole === "student") {
      const { data: student, error: studentError } = await admin.from("students")
        .select("class_name").eq("national_code", profile.national_code).maybeSingle();
      if (studentError || !student?.class_name) {
        console.error("classroom-login student class lookup failed", JSON.stringify({ code: studentError?.code ?? null, message: studentError?.message ?? null }));
        return reply({ message: "کلاس ثبت‌شده برای این دانش‌آموز پیدا نشد؛ مدیریت باید پرونده کلاس را تکمیل کند." }, 403);
      }
      className = clean(student.class_name);
    }
    return reply({
      session: login.session,
      user: { id: login.user.id },
      profile: {
        username: clean(profile.username),
        display_name: clean(profile.display_name) || clean(profile.username),
        role: clean(profile.role),
        class_name: className,
      },
    });
  } catch (error) {
    console.error("classroom-login failed", String(error));
    return reply({ message: "ارتباط با سرویس احراز هویت برقرار نشد؛ کمی بعد دوباره تلاش کنید." }, 503);
  }
});