import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const clean = (value: unknown, max = 200) => String(value ?? "").trim().slice(0, max);

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
  if (!url || !serviceKey) return reply({ message: "تنظیمات امن سرویس کامل نیست." }, 503);

  try {
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
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
          .select("id,name,slug,school_code,status,created_at,updated_at")
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
      const { data, error } = await admin.rpc("frahoosh_platform_create_school", {
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
      const { data, error } = await admin.rpc("frahoosh_platform_set_school_status", {
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
      const { data, error } = await admin.rpc("frahoosh_platform_set_subscription", {
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

    return reply({ message: "عملیات درخواستی شناخته نشد." }, 400);
  } catch (error) {
    console.error("platform-management failed", String(error));
    return reply({ message: "ارتباط با مدیریت کل فراهوش برقرار نشد." }, 500);
  }
});
