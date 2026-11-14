import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const clean = (value: unknown) => String(value ?? "").replace(/[\u200c\u200f\u202a-\u202e]/g, "").trim();
const normalize = (value: unknown) => clean(value)
  .replace(/[۰-۹]/g, d => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
  .replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
  .replace(/ي/g, "ی")
  .replace(/ك/g, "ک")
  .toUpperCase();

function getServiceKey(): string {
  let key = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  const raw = (Deno.env.get("SUPABASE_SECRET_KEYS") ?? "").trim();
  if (!raw) return key;
  try {
    const bundle = JSON.parse(raw);
    const candidate = typeof bundle === "string" ? bundle :
      bundle.default ?? bundle.service_role ?? bundle.serviceRole ?? bundle.service_role_key;
    if (typeof candidate === "string" && candidate.trim()) key = candidate.trim();
  } catch {
    if (raw.startsWith("sb_secret_") || raw.startsWith("eyJ")) key = raw;
  }
  return key;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ message: "درخواست نامعتبر است." }, 405);

  const body = await req.json().catch(() => ({}));
  const username = clean(body?.username);
  const schoolCode = normalize(body?.school_code);
  if (!username || username.length > 160 || !/^[A-Z0-9-]{3,40}$/.test(schoolCode)) {
    return reply({ message: "اگر اطلاعات حساب معتبر باشد، پیوند بازیابی به ایمیل تأییدشده مدیر ارسال می‌شود." });
  }

  const url = (Deno.env.get("SUPABASE_URL") ?? "").trim();
  const anonKey = (Deno.env.get("SUPABASE_ANON_KEY") ?? req.headers.get("apikey") ?? "").trim();
  const serviceKey = getServiceKey();
  if (!url || !anonKey || !serviceKey) {
    console.error("manager recovery configuration missing", JSON.stringify({
      url: Boolean(url), anonKey: Boolean(anonKey), serviceKey: Boolean(serviceKey),
    }));
    return reply({ message: "سرویس بازیابی موقتاً در دسترس نیست؛ کمی بعد دوباره تلاش کنید." }, 503);
  }

  try {
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: school, error: schoolError } = await admin.from("schools")
      .select("id,school_code,status,owner_auth_user_id")
      .eq("school_code", schoolCode)
      .eq("status", "active")
      .maybeSingle();
    if (schoolError) throw schoolError;
    if (!school || normalize(school.school_code) !== schoolCode || !school.owner_auth_user_id) {
      return reply({ message: "اگر اطلاعات حساب معتبر باشد، پیوند بازیابی به ایمیل تأییدشده مدیر ارسال می‌شود." });
    }

    const { data: accounts, error: accountError } = await admin.from("account_settings")
      .select("username,email,auth_user_id,tenant_school_id,role")
      .eq("username", username)
      .eq("tenant_school_id", school.id)
      .eq("role", "manager")
      .limit(2);
    if (accountError) throw accountError;

    // A generic response prevents username and school-code enumeration.
    if (!accounts || accounts.length !== 1) {
      return reply({ message: "اگر اطلاعات حساب معتبر باشد، پیوند بازیابی به ایمیل تأییدشده مدیر ارسال می‌شود." });
    }
    const account = accounts[0];
    const email = clean(account.email).toLowerCase();
    if (!email.includes("@") || !account.auth_user_id ||
        account.tenant_school_id !== school.id ||
        school.owner_auth_user_id !== account.auth_user_id) {
      return reply({ message: "اگر اطلاعات حساب معتبر باشد، پیوند بازیابی به ایمیل تأییدشده مدیر ارسال می‌شود." });
    }

    const { data: membership, error: membershipError } = await admin.from("school_memberships")
      .select("id")
      .eq("school_id", school.id)
      .eq("auth_user_id", account.auth_user_id)
      .eq("role", "manager")
      .eq("is_active", true)
      .maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership) {
      return reply({ message: "اگر اطلاعات حساب معتبر باشد، پیوند بازیابی به ایمیل تأییدشده مدیر ارسال می‌شود." });
    }

    const { data: authResult, error: authError } = await admin.auth.admin.getUserById(account.auth_user_id);
    if (authError) throw authError;
    const authUser = authResult.user;
    if (!authUser || clean(authUser.email).toLowerCase() !== email || !authUser.email_confirmed_at) {
      return reply({ message: "اگر اطلاعات حساب معتبر باشد، پیوند بازیابی به ایمیل تأییدشده مدیر ارسال می‌شود." });
    }

    const redirectTo = "https://mard7946-dev.github.io/amoozesh-hooshmand-novin-frahoosh/portal.html?step=recover&role=manager";
    const recovery = await fetch(url + "/auth/v1/recover?redirect_to=" + encodeURIComponent(redirectTo), {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: anonKey },
      body: JSON.stringify({ email }),
    });
    if (!recovery.ok) {
      const details = await recovery.json().catch(() => ({}));
      console.error("manager recovery email request failed", JSON.stringify({
        status: recovery.status,
        code: details.code ?? null,
        error: details.error ?? details.msg ?? null,
      }));
      // Do not disclose account existence or email delivery configuration to callers.
    }
    return reply({ message: "اگر اطلاعات حساب معتبر باشد، پیوند بازیابی به ایمیل تأییدشده مدیر ارسال می‌شود." });
  } catch (error) {
    const detail = error && typeof error === "object" ? error as { code?: string; message?: string } : {};
    console.error("manager password recovery lookup failed", JSON.stringify({
      code: detail.code ?? null, message: detail.message ?? String(error),
    }));
    return reply({ message: "سرویس بازیابی موقتاً در دسترس نیست؛ کمی بعد دوباره تلاش کنید." }, 503);
  }
});
