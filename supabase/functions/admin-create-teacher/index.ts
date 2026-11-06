import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const text = (v: unknown) => String(v ?? "").trim();
const normRole = (v: unknown) => text(v).toLowerCase();

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return respond({ error: "فقط درخواست POST پذیرفته می‌شود." }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return respond({ error: "برای ایجاد حساب باید وارد شده باشید." }, 401);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const secretBundle = Deno.env.get("SUPABASE_SECRET_KEYS") ?? "";
  let serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  try { serviceKey = JSON.parse(secretBundle).default ?? serviceKey; } catch (_) {}
  if (!url || !serviceKey) return respond({ error: "تنظیمات امن سرویس ایجاد حساب کامل نیست." }, 500);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await admin.auth.getUser(authHeader.slice(7));
  if (authError || !authData.user) return respond({ error: "نشست ورود معتبر نیست؛ دوباره وارد شوید." }, 401);

  const { data: caller, error: callerError } = await admin
    .from("account_settings").select("role,tenant_school_id")
    .eq("auth_user_id", authData.user.id).maybeSingle();
  if (callerError) return respond({ error: "نقش کاربر جاری بررسی نشد." }, 500);
  if (!["manager", "مدیر", "principal", "administrator", "admin"].includes(normRole(caller?.role))) {
    return respond({ error: "فقط مدیر مدرسه اجازه ایجاد حساب دبیر را دارد." }, 403);
  }

  const tenantSchoolId = caller?.tenant_school_id;
  if (!tenantSchoolId) return respond({ error: "مدرسه برای حساب مدیریت مشخص نشده است؛ تنظیم tenant_school_id را بررسی کنید." }, 400);

  // Service-role writes must independently enforce the same school membership
  // and subscription boundary as the database policies.
  const { data: managerMembership, error: membershipError } = await admin
    .from("school_memberships").select("id")
    .eq("auth_user_id", authData.user.id)
    .eq("school_id", tenantSchoolId)
    .eq("role", "manager")
    .eq("is_active", true)
    .maybeSingle();
  if (membershipError) return respond({ error: "عضویت فعال مدیر بررسی نشد." }, 500);
  if (!managerMembership) return respond({ error: "عضویت فعال مدیریت این مدرسه تأیید نشد." }, 403);

  const { data: school, error: schoolError } = await admin
    .from("schools").select("status").eq("id", tenantSchoolId).maybeSingle();
  if (schoolError) return respond({ error: "وضعیت مدرسه بررسی نشد." }, 500);
  if (!school || school.status !== "active") return respond({ error: "وضعیت مدرسه فعال نیست." }, 403);

  const now = new Date();
  const nowIso = now.toISOString();
  const { data: subscriptions, error: subscriptionError } = await admin
    .from("school_subscriptions")
    .select("status,starts_at,ends_at,grace_days")
    .eq("school_id", tenantSchoolId)
    .in("status", ["active", "past_due"])
    .lte("starts_at", nowIso)
    .order("ends_at", { ascending: false })
    .limit(10);
  if (subscriptionError) return respond({ error: "اعتبار اشتراک مدرسه بررسی نشد." }, 500);
  const hasActiveSubscription = (subscriptions ?? []).some((item: any) => {
    const endAt = Date.parse(item.ends_at);
    const graceMs = Math.max(0, Number(item.grace_days) || 0) * 24 * 60 * 60 * 1000;
    return Number.isFinite(endAt) && now.getTime() <= endAt + graceMs;
  });
  if (!hasActiveSubscription) return respond({ error: "اشتراک فعال مدرسه برای ایجاد حساب دبیر لازم است." }, 403);

  const body = await req.json().catch(() => ({}));
  const firstName = text(body.first_name), lastName = text(body.last_name);
  const username = text(body.username).replace(/[۰-۹]/g, d => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  const nationalCode = text(body.national_code).replace(/[۰-۹]/g, d => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  const employeeCode = text(body.employee_code).replace(/[^0-9]/g, "");
  let phone = text(body.phone).replace(/[۰-۹]/g, d => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/\D/g, "");
  if (phone.startsWith("0098") && phone.length === 14) phone = "0" + phone.slice(4);
  else if (phone.startsWith("98") && phone.length === 12) phone = "0" + phone.slice(2);
  else if (phone.startsWith("9") && phone.length === 10) phone = "0" + phone;
  const email = (text(body.email) || (username + "@users.frahoosh.ir")).toLowerCase();
  const password = text(body.password), subject = text(body.subject);
  const displayName = [firstName, lastName].filter(Boolean).join(" ");
  if (!firstName || !lastName || !username) {
    return respond({ error: "نام، نام خانوادگی و نام کاربری دبیر الزامی است." }, 400);
  }
  if (!/^\d{8,12}$/.test(username)) return respond({ error: "نام کاربری باید عددی و بین ۸ تا ۱۲ رقم باشد." }, 400);
  if (nationalCode && !/^\d{10}$/.test(nationalCode)) return respond({ error: "کد ملی در صورت ورود باید ۱۰ رقم باشد." }, 400);
  if (phone && !/^09\d{9}$/.test(phone)) return respond({ error: "شماره همراه در صورت ورود باید با قالب 09123456789 باشد." }, 400);
  if (!/^\S+@\S+\.\S+$/.test(email)) return respond({ error: "ایمیل واردشده معتبر نیست." }, 400);
  if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/.test(password)) return respond({ error: "رمز موقت باید حداقل ۸ نویسه و شامل حرف بزرگ، حرف کوچک، عدد و نماد باشد." }, 400);

  const { data: usernameOwner, error: usernameError } = await admin
    .from("account_settings").select("username,national_code,role,auth_user_id")
    .eq("username", username).maybeSingle();
  if (usernameError) return respond({ error: "بررسی یکتایی نام کاربری ناموفق بود." }, 500);
  if (usernameOwner && usernameOwner.national_code !== nationalCode) return respond({ error: "این نام کاربری قبلاً به حساب دیگری اختصاص یافته است." }, 409);
  if (usernameOwner?.auth_user_id) return respond({ error: "برای این نام کاربری قبلاً حساب ورود ساخته شده است." }, 409);

  let existingByCode: { username: string; role: string | null; auth_user_id: string | null } | null = null;
  if (nationalCode) {
    const { data, error } = await admin.from("account_settings").select("username,role,auth_user_id").eq("national_code", nationalCode).maybeSingle();
    if (error) return respond({ error: "بررسی حساب قبلی ناموفق بود." }, 500);
    existingByCode = data;
  }
  if (existingByCode?.auth_user_id) return respond({ error: "برای این دبیر قبلاً حساب ورود ساخته شده است." }, 409);
  if (existingByCode && normRole(existingByCode.role) !== "teacher" && normRole(existingByCode.role) !== "دبیر") {
    return respond({ error: "این کد ملی به نقش دیگری متصل است؛ ابتدا اطلاعات آن حساب باید توسط مدیر بررسی شود." }, 409);
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { role: "teacher", display_name: displayName, ...(nationalCode ? { national_code: nationalCode } : {}), username, must_change_password: true }
  });
  if (createError || !created.user) {
    return respond({ error: createError?.message ?? "ساخت حساب احراز هویت ناموفق بود." }, 400);
  }

  const finalUsername = username;
  try {
    const teacherLookup = nationalCode
      ? await admin.from("teachers").select("id").eq("national_code", nationalCode).maybeSingle()
      : phone
        ? await admin.from("teachers").select("id").or(`phone.eq.${phone},mobile.eq.${phone}`).maybeSingle()
        : { data: null, error: null };
    const oldTeacher = teacherLookup.data;
    const teacherLookupError = teacherLookup.error;
    if (teacherLookupError) throw teacherLookupError;
    const teacherRow = {
      first_name: firstName, last_name: lastName, national_code: nationalCode || null,
      employee_code: employeeCode || null, email, phone, mobile: phone, subject: subject || null,
      tenant_school_id: tenantSchoolId, employment_status: "فعال"
    };
    const teacherWrite = oldTeacher
      ? await admin.from("teachers").update(teacherRow).eq("id", oldTeacher.id)
      : await admin.from("teachers").insert(teacherRow);
    if (teacherWrite.error) throw teacherWrite.error;

    const accountRow = { username: finalUsername, display_name: displayName, email, national_code: nationalCode || null,
      role: "teacher", auth_user_id: created.user.id, phone, tenant_school_id: tenantSchoolId, preferences: "{}" };
    const accountWrite = existingByCode
      ? await admin.from("account_settings").update(accountRow).eq("username", existingByCode.username)
      : usernameOwner
        ? await admin.from("account_settings").update(accountRow).eq("username", usernameOwner.username)
        : await admin.from("account_settings").insert(accountRow);
    if (accountWrite.error) throw accountWrite.error;

    return respond({ success: true, username: finalUsername, role: "teacher", message: "حساب دبیر ایجاد شد." }, 201);
  } catch (e) {
    await admin.auth.admin.deleteUser(created.user.id);
    return respond({ error: "ذخیره پروفایل دبیر ناموفق بود؛ حساب موقت حذف شد. " + text((e as Error)?.message) }, 500);
  }
});
