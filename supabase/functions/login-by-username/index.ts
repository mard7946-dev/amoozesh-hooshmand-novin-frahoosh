import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const clean = (value: unknown) => String(value ?? "").replace(/[\u200c\u200f\u202a-\u202e]/g, "").trim();
function normalizeDigits(value: string) {
  return value
    .replace(/[۰-۹]/g, d => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
}
function usernameVariants(raw: string) {
  const value = normalizeDigits(clean(raw));
  const digits = value.replace(/\D/g, "");
  const variants = new Set<string>([value]);
  if (digits) variants.add(digits);
  if (digits.startsWith("0098") && digits.length === 14) variants.add("0" + digits.slice(4));
  if (digits.startsWith("98") && digits.length === 12) variants.add("0" + digits.slice(2));
  if (digits.startsWith("9") && digits.length === 10) variants.add("0" + digits);
  if (digits.startsWith("0") && digits.length === 11) variants.add(digits.slice(1));
  return [...variants].filter(Boolean);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return respond({ message: "درخواست نامعتبر است." }, 405);

  const body = await req.json().catch(() => ({}));
  const username = clean(body?.username);
  const password = String(body?.password ?? "");
  if (!username || !password || username.length > 160 || password.length > 1024) {
    return respond({ message: "نام کاربری و رمز عبور را کامل وارد کنید." }, 400);
  }

  const url = (Deno.env.get("SUPABASE_URL") ?? "").trim();
  // Support both the newer secret-key bundle and the legacy service-role env var.
  // Never log the key itself.
  const secretBundle = (Deno.env.get("SUPABASE_SECRET_KEYS") ?? "").trim();
  const legacyServiceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  let serviceKey = legacyServiceKey;
  if (secretBundle) {
    try {
      const parsed: unknown = JSON.parse(secretBundle);
      if (typeof parsed === "string") serviceKey = parsed.trim() || serviceKey;
      else if (parsed && typeof parsed === "object") {
        const bundle = parsed as Record<string, unknown>;
        const candidate = bundle.default ?? bundle.service_role ?? bundle.serviceRole ?? bundle.service_role_key;
        if (typeof candidate === "string" && candidate.trim()) serviceKey = candidate.trim();
      }
    } catch (_) {
      // A single key can be injected directly instead of as a JSON bundle.
      if (secretBundle.startsWith("sb_secret_") || secretBundle.startsWith("eyJ")) serviceKey = secretBundle;
    }
  }
  const anonKey = (Deno.env.get("SUPABASE_ANON_KEY") ?? req.headers.get("apikey") ?? "").trim();
  if (!url || !serviceKey || !anonKey) {
    console.error("login-by-username configuration missing", JSON.stringify({
      url: Boolean(url), serviceKey: Boolean(serviceKey), anonKey: Boolean(anonKey),
    }));
    return respond({ message: "سرویس ورود موقتاً در دسترس نیست." }, 503);
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const auth = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const variants = usernameVariants(username);
  const emails = new Set<string>();
  const addEmails = (rows: Array<{ email?: string | null }> | null) => {
    for (const row of rows ?? []) {
      const email = clean(row.email).toLowerCase();
      if (email && email.includes("@")) emails.add(email);
    }
  };

  try {
    // Resolve account usernames on the server; never expose account emails to the client.
    const byUsername = await admin.from("account_settings").select("email").in("username", variants).limit(10);
    if (byUsername.error) throw byUsername.error;
    addEmails(byUsername.data);

    // If the username is a mobile number, support teachers whose account username
    // is still their national code and whose phone is stored in the teachers table.
    if (!emails.size && /^\d{10,14}$/.test(normalizeDigits(username).replace(/\D/g, ""))) {
      const [byPhone, byMobile] = await Promise.all([
        admin.from("teachers").select("national_code").in("phone", variants).limit(10),
        admin.from("teachers").select("national_code").in("mobile", variants).limit(10),
      ]);
      // phone/mobile are legacy aliases. If one query fails because a deployment
      // has only one of those columns, retain the successful lookup instead of
      // failing the whole login attempt.
      if (byPhone.error && byMobile.error) throw byPhone.error;
      if (byPhone.error) console.warn("login-by-username optional phone lookup failed", JSON.stringify({ code: byPhone.error.code ?? null, message: byPhone.error.message ?? null }));
      if (byMobile.error) console.warn("login-by-username optional mobile lookup failed", JSON.stringify({ code: byMobile.error.code ?? null, message: byMobile.error.message ?? null }));
      const codes = [...new Set([...(byPhone.error ? [] : byPhone.data ?? []), ...(byMobile.error ? [] : byMobile.data ?? [])]
        .map((row: { national_code?: string | null }) => clean(row.national_code)).filter(Boolean))];
      if (codes.length) {
        const byCode = await admin.from("account_settings").select("email").in("national_code", codes).limit(10);
        if (byCode.error) throw byCode.error;
        addEmails(byCode.data);
      }
      if (!emails.size) {
        const byCode = await admin.from("account_settings").select("email").in("national_code", variants).limit(10);
        if (byCode.error) throw byCode.error;
        addEmails(byCode.data);
      }
    }
  } catch (error) {
    // Keep the client response generic, but expose the database/configuration
    // failure in Edge Function logs without recording credentials or PII.
    const detail = error && typeof error === "object"
      ? error as { code?: string; message?: string; details?: string; hint?: string }
      : { message: String(error ?? "unknown error") };
    console.error("login-by-username account lookup failed", JSON.stringify({
      code: detail.code ?? null,
      message: detail.message ?? "unknown error",
      details: detail.details ?? null,
      hint: detail.hint ?? null,
    }));
    return respond({ message: "بررسی حساب انجام نشد؛ کمی بعد دوباره تلاش کنید." }, 503);
  }

  // Avoid trying multiple accounts for one input, and never disclose whether a username exists.
  if (emails.size !== 1) {
    return respond({ message: "نام کاربری یا رمز عبور صحیح نیست؛ شماره را همان‌طور که مدیر ثبت کرده وارد کنید." }, 401);
  }
  const email = [...emails][0];
  const { data, error } = await auth.auth.signInWithPassword({ email, password });
  if (error || !data.session || !data.user) {
    return respond({ message: "نام کاربری یا رمز عبور صحیح نیست؛ شماره را همان‌طور که مدیر ثبت کرده وارد کنید." }, 401);
  }

  // Validate requested portal role against the user's school account and active membership.
  const requestedRole = clean(body?.role);
  const action = clean(body?.action);
  const newPassword = String(body?.new_password ?? "");
  if (requestedRole) {
    const allowedRoles: Record<string, string[]> = {
      manager: ["manager"], deputy: ["executive", "educational", "cultural"],
      teacher: ["teacher"], parent: ["parent"], student: ["student"], counselor: ["advisor"],
    };
    const expected = allowedRoles[requestedRole];
    if (!expected) return respond({ message: "نقش ورود معتبر نیست." }, 400);
    const { data: accountRows, error: accountError } = await admin
      .from("account_settings").select("role, tenant_school_id, national_code, username")
      .eq("email", email).eq("auth_user_id", data.user.id).limit(10);
    if (accountError) {
      console.error("login-by-username role lookup failed", JSON.stringify({ code: accountError.code ?? null }));
      return respond({ message: "بررسی سطح دسترسی انجام نشد؛ دوباره تلاش کنید." }, 503);
    }
    const eligible = (accountRows ?? []).filter((account: { role?: string | null; tenant_school_id?: string | null }) =>
      expected.includes(clean(account.role)) && Boolean(account.tenant_school_id));
    if (!eligible.length) return respond({ message: "این حساب اجازه ورود به پنل انتخاب‌شده را ندارد." }, 403);
    const schoolIds = [...new Set(eligible.map((account: { tenant_school_id?: string | null }) => account.tenant_school_id as string))];
    const { data: memberships, error: membershipError } = await admin
      .from("school_memberships").select("role, school_id")
      .eq("auth_user_id", data.user.id).eq("is_active", true).in("school_id", schoolIds).limit(10);
    if (membershipError) {
      console.error("login-by-username membership check failed", JSON.stringify({ code: membershipError.code ?? null }));
      return respond({ message: "بررسی عضویت مدرسه انجام نشد؛ دوباره تلاش کنید." }, 503);
    }
    if (!(memberships ?? []).some((membership: { role?: string | null }) => expected.includes(clean(membership.role)))) {
      return respond({ message: "عضویت فعال برای این پنل ثبت نشده است." }, 403);
    }
  }

  // Enforce the first-login password change at the authentication boundary.
  // This prevents clients from bypassing the portal wrapper and receiving a JWT.
  const account = await admin.from("account_settings")
    .select("role, tenant_school_id, national_code, username")
    .eq("email", email).eq("auth_user_id", data.user.id).maybeSingle();
  if (account.error) {
    console.error("login-by-username initial-password lookup failed", account.error.code);
    return respond({ message: "بررسی وضعیت امنیتی حساب انجام نشد؛ دوباره تلاش کنید." }, 503);
  }
  const mustChange = data.user.app_metadata?.must_change_password === true;
  if (mustChange) {
    if (clean(account.data?.role).toLowerCase() !== "parent" || requestedRole !== "parent") {
      return respond({ message: "برای ادامه، ابتدا باید رمز عبور اولیه حساب ولی تغییر کند." , must_change_password: true }, 428);
    }
    if (action !== "change_parent_initial_password") {
      return respond({ message: "برای نخستین ورود، ابتدا باید رمز عبور اولیه را تغییر دهید.", must_change_password: true }, 428);
    }
    const digits = (value: unknown) => String(value ?? "")
      .replace(/[۰-۹]/g, d => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
      .replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
    const nationalCode = digits(account.data?.national_code).trim();
    if (!/^\\d{10}$/.test(nationalCode) || digits(account.data?.username).trim() !== nationalCode) {
      return respond({ message: "کد ملی حساب ولی معتبر نیست؛ با مدیر مدرسه تماس بگیرید." }, 409);
    }
    if (newPassword.length < 10 || newPassword.length > 128 || newPassword === nationalCode) {
      return respond({ message: "رمز جدید باید حداقل ۱۰ نویسه داشته باشد و با کد ملی یکسان نباشد." }, 400);
    }
    const schoolCode = clean(body?.school_code).toUpperCase();
    if (!/^[A-Z0-9-]{3,40}$/.test(schoolCode)) {
      return respond({ message: "کد مدرسه معتبر نیست." }, 400);
    }
    const school = await admin.from("schools").select("school_code,status")
      .eq("id", account.data?.tenant_school_id).maybeSingle();
    if (school.error || !school.data || school.data.status !== "active" ||
        clean(school.data.school_code).toUpperCase() !== schoolCode) {
      return respond({ message: "کد مدرسه با حساب کاربری مطابقت ندارد." }, 403);
    }
    const nextAppMetadata = {
      ...(data.user.app_metadata ?? {}),
      must_change_password: false,
      password_changed_at: new Date().toISOString(),
    };
    const { error: updateError } = await admin.auth.admin.updateUserById(data.user.id, {
      password: newPassword,
      app_metadata: nextAppMetadata,
    });
    if (updateError) {
      console.error("login-by-username initial password update failed", updateError.message);
      return respond({ message: "ثبت رمز جدید انجام نشد؛ دوباره تلاش کنید." }, 500);
    }
    return respond({ password_changed: true, message: "رمز عبور با موفقیت تغییر کرد. اکنون با رمز جدید وارد شوید." });
  }
  if (action === "change_parent_initial_password") {
    return respond({ message: "برای این حساب تغییر رمز اولیه اجباری ثبت نشده است." }, 409);
  }
  return respond({ session: data.session, user: data.user });
});
