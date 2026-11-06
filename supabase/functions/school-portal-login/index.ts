import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const clean = (value: unknown) =>
  String(value ?? "").replace(/[\u200c\u200f\u202a-\u202e]/g, "").trim();
const normalize = (value: unknown) => clean(value)
  .replace(/[۰-۹]/g, d => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
  .replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
  .replace(/ي/g, "ی")
  .replace(/ك/g, "ک")
  .toLowerCase();

function roleAllowed(actual: string, expected: string) {
  const a = normalize(actual), e = normalize(expected);
  const manager = ["manager", "مدیر", "مدیر مدرسه"];
  const teacher = ["teacher", "دبیر", "معلم"];
  const student = ["student", "دانش آموز", "دانش‌آموز"];
  const parent = ["parent", "guardian", "ولی", "والد", "والدین", "سرپرست"];
  const counselor = ["counselor", "advisor", "cultural", "مشاور", "مشاوره", "پرورشی"];
  const deputy = ["executive", "educational", "deputy", "executive_deputy", "educational_deputy", "cultural", "معاون اجرایی", "معاون آموزشی", "معاونت"];
  if (e === "manager") return manager.includes(a);
  if (e === "deputy") return deputy.includes(a);
  if (e === "teacher") return teacher.includes(a);
  if (e === "student") return student.includes(a);
  if (e === "parent") return parent.includes(a);
  if (e === "counselor") return counselor.includes(a);
  return false;
}

function getServiceKey(): string {
  let key = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  const bundleRaw = (Deno.env.get("SUPABASE_SECRET_KEYS") ?? "").trim();
  if (!bundleRaw) return key;
  try {
    const bundle = JSON.parse(bundleRaw);
    const candidate = typeof bundle === "string"
      ? bundle
      : bundle.default ?? bundle.service_role ?? bundle.serviceRole ?? bundle.service_role_key;
    if (typeof candidate === "string" && candidate.trim()) key = candidate.trim();
  } catch {
    if (bundleRaw.startsWith("sb_secret_") || bundleRaw.startsWith("eyJ")) key = bundleRaw;
  }
  return key;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ message: "درخواست نامعتبر است." }, 405);

  const body = await req.json().catch(() => ({}));
  const username = clean(body?.username);
  const password = String(body?.password ?? "");
  const expectedRole = clean(body?.role);
  const schoolCode = clean(body?.school_code).toUpperCase();

  if (!username || !password || !schoolCode ||
      !["manager", "deputy", "teacher", "student", "parent", "counselor"].includes(expectedRole)) {
    return reply({ message: "کد مدرسه، نام کاربری، رمز عبور و نقش را کامل وارد کنید." }, 400);
  }
  if (!/^[A-Z0-9-]{3,40}$/.test(schoolCode)) {
    return reply({ message: "کد مدرسه معتبر نیست." }, 400);
  }

  const url = (Deno.env.get("SUPABASE_URL") ?? "").trim();
  const anonKey = (Deno.env.get("SUPABASE_ANON_KEY") ?? req.headers.get("apikey") ?? "").trim();
  const serviceKey = getServiceKey();
  if (!url || !anonKey || !serviceKey) {
    return reply({ message: "سرویس احراز هویت موقتاً در دسترس نیست." }, 503);
  }

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

    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: profile, error: profileError } = await admin.from("account_settings")
      .select("username,national_code,display_name,role,auth_user_id,tenant_school_id")
      .eq("auth_user_id", login.user.id)
      .maybeSingle();

    if (profileError || !profile?.tenant_school_id) {
      console.error("school portal profile lookup failed", JSON.stringify({
        code: profileError?.code ?? null,
        message: profileError?.message ?? null,
      }));
      return reply({ message: "حساب کاربری به مدرسه مشخصی متصل نیست؛ با مدیر سامانه تماس بگیرید." }, 403);
    }
    const { data: memberships, error: membershipError } = await admin.from("school_memberships")
      .select("role").eq("school_id", profile.tenant_school_id).eq("auth_user_id", login.user.id).eq("is_active", true);
    if (membershipError) {
      console.error("school portal membership lookup failed", membershipError.message);
      return reply({ message: "بررسی سمت‌های فعال حساب انجام نشد؛ کمی بعد دوباره تلاش کنید." }, 503);
    }
    if (!memberships?.length) {
      return reply({ message: "عضویت فعال این حساب در مدرسه تأیید نشد." }, 403);
    }
    const membershipRoles = new Set((memberships ?? []).map((item: any) => normalize(item.role)));
    if (!roleAllowed(profile.role, expectedRole) && !membershipRoles.has(normalize(expectedRole))) {
      return reply({ message: "این حساب مجوز ورود به بخش انتخاب‌شده را ندارد." }, 403);
    }
    const availableRoles: string[] = [];
    if (roleAllowed(profile.role, "deputy")) availableRoles.push("deputy");
    if (roleAllowed(profile.role, "teacher") || membershipRoles.has("teacher")) availableRoles.push("teacher");

    const { data: school, error: schoolError } = await admin.from("schools")
      .select("id,name,school_code,status")
      .eq("id", profile.tenant_school_id)
      .maybeSingle();

    if (schoolError || !school || school.status !== "active") {
      return reply({ message: "مدرسه انتخاب‌شده فعال نیست یا حساب به آن متصل نشده است." }, 403);
    }
    if (normalize(school.school_code) !== normalize(schoolCode)) {
      return reply({ message: "کد مدرسه با حساب کاربری واردشده مطابقت ندارد." }, 403);
    }

    const { data: subscriptions, error: subscriptionError } = await admin.from("school_subscriptions")
      .select("status,starts_at,ends_at,grace_days")
      .eq("school_id", school.id)
      .in("status", ["active", "past_due"])
      .limit(100);

    if (subscriptionError) {
      console.error("school subscription lookup failed", subscriptionError.message);
      return reply({ message: "بررسی وضعیت اشتراک مدرسه انجام نشد؛ کمی بعد دوباره تلاش کنید." }, 503);
    }
    const now = Date.now();
    const hasActiveSubscription = (subscriptions ?? []).some(subscription => {
      const startsAt = Date.parse(subscription.starts_at);
      const endsAt = Date.parse(subscription.ends_at);
      const graceMs = Math.max(0, Number(subscription.grace_days) || 0) * 86400000;
      return Number.isFinite(startsAt) && Number.isFinite(endsAt) &&
        now >= startsAt && now <= endsAt + graceMs;
    });
    if (!hasActiveSubscription) {
      return reply({ message: "اشتراک این مدرسه فعال نیست؛ برای تمدید با پشتیبانی فراهوش تماس بگیرید." }, 403);
    }

    let className = "";
    if (expectedRole === "student") {
      const { data: student, error: studentError } = await admin.from("students")
        .select("class_name")
        .eq("national_code", profile.national_code)
        .eq("tenant_school_id", school.id)
        .maybeSingle();
      if (studentError || !student?.class_name) {
        console.error("school portal student lookup failed", JSON.stringify({
          code: studentError?.code ?? null,
          message: studentError?.message ?? null,
        }));
        return reply({ message: "کلاس ثبت‌شده برای این دانش‌آموز در مدرسه انتخاب‌شده پیدا نشد." }, 403);
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
        school_id: school.id,
        school_name: clean(school.name),
        available_roles: availableRoles,
      },
    });
  } catch (error) {
    console.error("school-portal-login failed", String(error));
    return reply({ message: "ارتباط با سرویس ورود فراهوش برقرار نشد؛ کمی بعد دوباره تلاش کنید." }, 503);
  }
});
