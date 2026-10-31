import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const clean = (value: unknown, max = 200) => String(value ?? "").trim().slice(0, max);
const normalizeDigits = (value: string) => value
  .replace(/[۰-۹]/g, d => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
  .replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));

function getServiceKey(): string {
  let key = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  const bundle = (Deno.env.get("SUPABASE_SECRET_KEYS") ?? "").trim();
  if (!bundle) return key;
  try {
    const parsed = JSON.parse(bundle);
    const candidate = typeof parsed === "string"
      ? parsed
      : parsed.default ?? parsed.service_role ?? parsed.serviceRole ?? parsed.service_role_key;
    if (typeof candidate === "string" && candidate.trim()) key = candidate.trim();
  } catch {
    if (bundle.startsWith("sb_secret_") || bundle.startsWith("eyJ")) key = bundle;
  }
  return key;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ message: "درخواست نامعتبر است." }, 405);

  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return reply({ message: "ابتدا وارد سامانه شوید." }, 401);

  const url = (Deno.env.get("SUPABASE_URL") ?? "").trim();
  const serviceKey = getServiceKey();
  const anonKey = (Deno.env.get("SUPABASE_ANON_KEY") ?? req.headers.get("apikey") ?? "").trim();
  if (!url || !serviceKey || !anonKey) return reply({ message: "تنظیمات امن سرویس کامل نیست." }, 503);

  try {
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: auth, error: authError } = await admin.auth.getUser(authorization.slice(7));
    if (authError || !auth.user) return reply({ message: "نشست ورود معتبر نیست؛ دوباره وارد شوید." }, 401);

    const { data: platformAdmin, error: platformAdminError } = await admin
      .from("platform_admins")
      .select("auth_user_id")
      .eq("auth_user_id", auth.user.id)
      .maybeSingle();
    if (platformAdminError || !platformAdmin) {
      return reply({ message: "این حساب دسترسی مدیریت کل فراهوش را ندارد." }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const action = clean(body?.action, 40);

    if (action === "overview") {
      const [schoolsResult, subscriptionsResult, plansResult, membershipsResult, auditResult] = await Promise.all([
        admin.from("schools")
          .select("id,name,slug,school_code,status,owner_auth_user_id,created_at,updated_at")
          .order("created_at", { ascending: false }).limit(500),
        admin.from("school_subscriptions")
          .select("id,school_id,plan_id,status,starts_at,ends_at,grace_days,student_min,student_limit,price_irr,created_at")
          .order("created_at", { ascending: false }).limit(2000),
        admin.from("subscription_plans")
          .select("id,plan_code,name,duration_months,student_min,student_limit,price_irr,is_active")
          .order("duration_months", { ascending: true }).order("student_limit", { ascending: true }),
        admin.from("school_memberships")
          .select("school_id,auth_user_id,role,is_active").eq("is_active", true).limit(10000),
        admin.from("platform_audit_logs")
          .select("id,actor_auth_user_id,action,school_id,details,created_at")
          .order("created_at", { ascending: false }).limit(50),
      ]);
      const failed = [schoolsResult, subscriptionsResult, plansResult, membershipsResult, auditResult].find(x => x.error);
      if (failed) return reply({ message: "دریافت اطلاعات مدیریت کل ناموفق بود." }, 500);

      const schools = schoolsResult.data ?? [];
      const plans = plansResult.data ?? [];
      const subscriptions = subscriptionsResult.data ?? [];
      const memberships = membershipsResult.data ?? [];
      const schoolStats = new Map<string, { active_members: number; roles: Record<string, number> }>();
      for (const member of memberships) {
        const current = schoolStats.get(member.school_id) ?? { active_members: 0, roles: {} };
        current.active_members += 1;
        current.roles[member.role] = (current.roles[member.role] ?? 0) + 1;
        schoolStats.set(member.school_id, current);
      }
      const latestSubscriptions = new Map<string, typeof subscriptions[number]>();
      for (const subscription of subscriptions) {
        if (!latestSubscriptions.has(subscription.school_id)) latestSubscriptions.set(subscription.school_id, subscription);
      }
      return reply({
        success: true,
        metrics: {
          schools_total: schools.length,
          schools_active: schools.filter(x => x.status === "active").length,
          schools_suspended: schools.filter(x => x.status === "suspended").length,
          active_memberships: memberships.length,
        },
        schools: schools.map(school => ({
          ...school,
          active_members: schoolStats.get(school.id)?.active_members ?? 0,
          roles: schoolStats.get(school.id)?.roles ?? {},
          subscription: latestSubscriptions.get(school.id) ?? null,
        })),
        plans,
        audit: auditResult.data ?? [],
      });
    }

    if (action === "create_school") {
      const name = clean(body?.name, 180);
      const slug = clean(body?.slug, 80).toLowerCase();
      const schoolCode = clean(body?.school_code, 40).toUpperCase();
      const planId = clean(body?.plan_id, 80);
      const graceDays = Number.isInteger(body?.grace_days) ? body.grace_days : 7;
      if (!name || !slug || !schoolCode || !planId) {
        return reply({ message: "نام مدرسه، شناسه لاتین، کد مدرسه و طرح اشتراک الزامی است." }, 400);
      }
      const { data, error } = await userClient.rpc("frahoosh_platform_create_school", {
        p_name: name,
        p_slug: slug,
        p_school_code: schoolCode,
        p_plan_id: planId,
        p_grace_days: graceDays,
      });
      if (error) {
        console.error("platform create school failed", error.message);
        return reply({ message: error.message || "ثبت مدرسه انجام نشد." }, 400);
      }
      return reply({ success: true, result: data }, 201);
    }

    if (action === "set_school_status") {
      const schoolId = clean(body?.school_id, 80);
      const status = clean(body?.status, 20);
      if (!schoolId || !["active", "suspended", "archived"].includes(status)) {
        return reply({ message: "مدرسه یا وضعیت انتخاب‌شده معتبر نیست." }, 400);
      }
      const { data, error } = await userClient.rpc("frahoosh_platform_set_school_status", {
        p_school_id: schoolId,
        p_status: status,
      });
      if (error) {
        console.error("platform status update failed", error.message);
        return reply({ message: error.message || "تغییر وضعیت مدرسه انجام نشد." }, 400);
      }
      return reply({ success: true, school: data });
    }

    if (action === "set_subscription") {
      const schoolId = clean(body?.school_id, 80);
      const planId = clean(body?.plan_id, 80);
      const status = clean(body?.status || "active", 20);
      const graceDays = Number.isInteger(body?.grace_days) ? body.grace_days : 7;
      if (!schoolId || !planId) return reply({ message: "مدرسه و طرح اشتراک را انتخاب کنید." }, 400);
      const { data, error } = await userClient.rpc("frahoosh_platform_set_subscription", {
        p_school_id: schoolId,
        p_plan_id: planId,
        p_status: status,
        p_grace_days: graceDays,
      });
      if (error) {
        console.error("platform subscription update failed", error.message);
        return reply({ message: error.message || "ثبت اشتراک انجام نشد." }, 400);
      }
      return reply({ success: true, subscription: data });
    }

    if (action === "invite_school_manager") {
      const schoolId = clean(body?.school_id, 80);
      const email = clean(body?.email, 254).toLowerCase();
      const username = clean(body?.username, 40);
      const displayName = clean(body?.display_name, 120);
      let phone = normalizeDigits(clean(body?.phone, 20)).replace(/\D/g, "");
      const nationalCode = normalizeDigits(clean(body?.national_code, 20)).replace(/\D/g, "");
      if (phone.startsWith("0098") && phone.length === 14) phone = "0" + phone.slice(4);
      else if (phone.startsWith("98") && phone.length === 12) phone = "0" + phone.slice(2);
      else if (phone.startsWith("9") && phone.length === 10) phone = "0" + phone;
      const origin = req.headers.get("origin") ?? "";
      const allowedOrigins = new Set(["https://frahoosh.ir", "https://www.frahoosh.ir"]);
      if (!allowedOrigins.has(origin)) {
        return reply({ message: "دامنه فراهوش برای ارسال دعوت‌نامه تأیید نشده است." }, 400);
      }
      if (!schoolId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
          !/^[A-Za-z0-9._-]{4,40}$/.test(username) || displayName.length < 3) {
        return reply({ message: "شناسه مدرسه، ایمیل معتبر، نام کاربری و نام مدیر را کامل وارد کنید." }, 400);
      }
      if (phone && !/^09\d{9}$/.test(phone)) {
        return reply({ message: "شماره همراه باید با قالب 09123456789 وارد شود." }, 400);
      }
      if (nationalCode && !/^\d{10}$/.test(nationalCode)) {
        return reply({ message: "کد ملی باید ۱۰ رقم باشد." }, 400);
      }

      const { data: school, error: schoolError } = await admin.from("schools")
        .select("id,name,status,owner_auth_user_id").eq("id", schoolId).maybeSingle();
      if (schoolError || !school) return reply({ message: "مدرسه انتخاب‌شده پیدا نشد." }, 404);
      if (school.status !== "active") return reply({ message: "ابتدا وضعیت مدرسه را فعال کنید." }, 409);
      if (school.owner_auth_user_id) return reply({ message: "برای این مدرسه قبلاً مدیر اصلی ثبت شده است." }, 409);

      const { data: existingUsername, error: usernameError } = await admin.from("account_settings")
        .select("username").eq("username", username).maybeSingle();
      if (usernameError) return reply({ message: "بررسی نام کاربری ناموفق بود." }, 500);
      if (existingUsername) return reply({ message: "این نام کاربری قبلاً استفاده شده است." }, 409);
      const { data: existingEmail, error: emailError } = await admin.from("account_settings")
        .select("username").ilike("email", email).limit(1);
      if (emailError) return reply({ message: "بررسی ایمیل ناموفق بود." }, 500);
      if (existingEmail?.length) return reply({ message: "این ایمیل قبلاً به یک حساب فراهوش متصل شده است." }, 409);

      const redirectTo = origin + "/portal.html?step=accept-invite&role=manager";
      const { data: invitation, error: invitationError } = await admin.auth.admin.inviteUserByEmail(email, {
        data: { display_name: displayName, role: "manager", username, school_id: schoolId },
        redirectTo,
      });
      if (invitationError || !invitation.user) {
        console.error("platform manager invitation failed", invitationError?.message ?? "missing user");
        return reply({ message: "ارسال دعوت‌نامه مدیر مدرسه ناموفق بود؛ تنظیمات ایمیل و نشانی بازگشت Supabase را بررسی کنید." }, 400);
      }

      const { data: attached, error: attachError } = await admin.rpc("frahoosh_platform_attach_school_manager", {
        p_school_id: schoolId,
        p_auth_user_id: invitation.user.id,
        p_username: username,
        p_display_name: displayName,
        p_email: email,
        p_phone: phone || null,
        p_national_code: nationalCode || null,
        p_actor_auth_user_id: auth.user.id,
      });
      if (attachError) {
        const { error: cleanupError } = await admin.auth.admin.deleteUser(invitation.user.id);
        console.error("platform manager attachment failed", JSON.stringify({
          code: attachError.code ?? null,
          cleanup_failed: Boolean(cleanupError),
        }));
        return reply({ message: "دعوت‌نامه ایجاد شد اما اتصال حساب به مدرسه کامل نشد؛ حساب موقت پاک‌سازی شد و عملیات را دوباره بررسی کنید." }, 500);
      }
      return reply({
        success: true,
        message: "دعوت‌نامه مدیر مدرسه ارسال و عضویت مدیریتی ثبت شد.",
        manager: attached,
      }, 201);
    }

    return reply({ message: "عملیات درخواستی شناخته نشد." }, 400);
  } catch (error) {
    console.error("platform-management failed", String(error));
    return reply({ message: "ارتباط با مدیریت کل فراهوش برقرار نشد." }, 500);
  }
});
