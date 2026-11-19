import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
const clean = (value: unknown, max = 2000) => String(value ?? "").trim().slice(0, max);
const normalize = (value: unknown) => clean(value, 100)
  .replace(/[\u200c\u200f\u202a-\u202e]/g, "")
  .replace(/ي/g, "ی").replace(/ك/g, "ک").toLowerCase();
const managerRoles = new Set(["manager", "مدیر", "مدیر مدرسه", "مدیریت", "school_manager"]);
const recordTypes = new Set(["annual_plan", "calendar_event", "balanced_assessment", "operational_plan", "daily_challenge"]);
const statuses = new Set(["draft", "active", "in_progress", "completed", "needs_review", "archived", "cancelled"]);

function getServiceKey(): string {
  let key = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  const bundleRaw = (Deno.env.get("SUPABASE_SECRET_KEYS") ?? "").trim();
  if (!bundleRaw) return key;
  try {
    const bundle = JSON.parse(bundleRaw);
    const candidate = typeof bundle === "string" ? bundle :
      bundle.default ?? bundle.service_role ?? bundle.serviceRole ?? bundle.service_role_key;
    if (typeof candidate === "string" && candidate.trim()) key = candidate.trim();
  } catch {
    if (bundleRaw.startsWith("sb_secret_") || bundleRaw.startsWith("eyJ")) key = bundleRaw;
  }
  return key;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ message: "درخواست نامعتبر است." }, 405);

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return reply({ message: "ابتدا وارد سامانه شوید." }, 401);
  const url = (Deno.env.get("SUPABASE_URL") ?? "").trim();
  const serviceKey = getServiceKey();
  if (!url || !serviceKey) return reply({ message: "تنظیمات امن سرویس برنامه‌ریزی کامل نیست." }, 503);

  try {
    const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: auth, error: authError } = await db.auth.getUser(token);
    if (authError || !auth.user) return reply({ message: "نشست ورود معتبر نیست؛ دوباره وارد شوید." }, 401);

    const { data: profile, error: profileError } = await db.from("account_settings")
      .select("role,tenant_school_id").eq("auth_user_id", auth.user.id).maybeSingle();
    const role = normalize(profile?.role);
    if (profileError || !profile?.tenant_school_id || !managerRoles.has(role)) {
      return reply({ message: "مرکز برنامه‌ریزی فقط برای مدیر مدرسه فعال است." }, 403);
    }
    const schoolId = String(profile.tenant_school_id);
    const { data: memberships, error: membershipError } = await db.from("school_memberships")
      .select("role").eq("school_id", schoolId).eq("auth_user_id", auth.user.id).eq("is_active", true);
    if (membershipError) return reply({ message: "بررسی عضویت فعال مدیر ناموفق بود." }, 503);
    if (!(memberships || []).some((item) => managerRoles.has(normalize(item.role)))) {
      return reply({ message: "عضویت فعال مدیریتی شما در این مدرسه تأیید نشد." }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const action = clean(body?.action, 30);
    if (action === "list") {
      const { data, error } = await db.from("school_planning_records")
        .select("id,academic_year,record_type,title,summary,details,status,created_at,updated_at")
        .eq("school_id", schoolId).eq("academic_year", clean(body?.academic_year, 24) || "۱۴۰۵–۱۴۰۶")
        .neq("status", "archived").order("updated_at", { ascending: false }).limit(250);
      if (error) throw error;
      const { count: registeredStudents, error: countError } = await db.from("students")
        .select("id", { count: "exact", head: true }).eq("tenant_school_id", schoolId);
      if (countError) throw countError;
      return reply({ ok: true, items: data || [], school_id: schoolId, registered_students_count: registeredStudents ?? 0 });
    }

    if (action === "create" || action === "update") {
      const recordType = clean(body?.record_type, 40);
      const title = clean(body?.title, 180);
      const summary = clean(body?.summary, 2000);
      const status = clean(body?.status, 30) || "draft";
      const details = body?.details && typeof body.details === "object" && !Array.isArray(body.details) ? body.details : {};
      if (!recordTypes.has(recordType) || title.length < 2 || !statuses.has(status)) {
        return reply({ message: "نوع برنامه، عنوان یا وضعیت معتبر نیست." }, 400);
      }
      if (JSON.stringify(details).length > 30000) return reply({ message: "جزئیات ثبت‌شده بیش از حد مجاز است." }, 413);
      const payload = {
        academic_year: clean(body?.academic_year, 24) || "۱۴۰۵–۱۴۰۶",
        record_type: recordType,
        title,
        summary,
        details,
        status,
        updated_by: auth.user.id,
        updated_at: new Date().toISOString(),
      };
      if (action === "create") {
        const { data, error } = await db.from("school_planning_records")
          .insert({ ...payload, school_id: schoolId, created_by: auth.user.id })
          .select("id,academic_year,record_type,title,summary,details,status,created_at,updated_at").single();
        if (error) throw error;
        return reply({ ok: true, item: data, message: "مورد برنامه‌ریزی ذخیره شد." });
      }
      const id = clean(body?.id, 80);
      if (!id) return reply({ message: "شناسه مورد برای ویرایش الزامی است." }, 400);
      const { data, error } = await db.from("school_planning_records")
        .update(payload).eq("id", id).eq("school_id", schoolId)
        .select("id,academic_year,record_type,title,summary,details,status,created_at,updated_at").maybeSingle();
      if (error) throw error;
      if (!data) return reply({ message: "مورد برنامه‌ریزی پیدا نشد." }, 404);
      return reply({ ok: true, item: data, message: "تغییرات ذخیره شد." });
    }

    if (action === "archive") {
      const id = clean(body?.id, 80);
      if (!id) return reply({ message: "شناسه مورد برای بایگانی الزامی است." }, 400);
      const { data, error } = await db.from("school_planning_records")
        .update({ status: "archived", updated_by: auth.user.id, updated_at: new Date().toISOString() })
        .eq("id", id).eq("school_id", schoolId).select("id").maybeSingle();
      if (error) throw error;
      if (!data) return reply({ message: "مورد برنامه‌ریزی پیدا نشد." }, 404);
      return reply({ ok: true, message: "مورد به بایگانی منتقل شد." });
    }

    return reply({ message: "عملیات درخواستی پشتیبانی نمی‌شود." }, 400);
  } catch (error) {
    console.error("school-planning error", error);
    return reply({ message: "ذخیره یا دریافت برنامه‌ها انجام نشد؛ وضعیت جدول و سرویس را بررسی کنید." }, 500);
  }
});
