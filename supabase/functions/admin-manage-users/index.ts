import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const clean = (v: unknown) => String(v ?? "").trim();
const managerRoles = ["manager", "مدیر", "مدیریت", "principal", "administrator", "admin"];
const assignableRoles = ["teacher", "student", "parent", "executive", "educational", "cultural", "advisor"];

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
    } catch (_) {
      if (bundleRaw.startsWith("sb_secret_") || bundleRaw.startsWith("eyJ")) serviceKey = bundleRaw;
    }
  }
  if (!url || !serviceKey) return reply({ message: "تنظیمات امن سرویس کامل نیست." }, 503);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error: authError } = await admin.auth.getUser(bearer.slice(7));
  if (authError || !auth.user) return reply({ message: "نشست ورود معتبر نیست؛ دوباره وارد شوید." }, 401);

  const { data: caller, error: callerError } = await admin.from("account_settings")
    .select("auth_user_id,role,tenant_school_id").eq("auth_user_id", auth.user.id).maybeSingle();
  if (callerError || !caller) return reply({ message: "حساب مدیریت پیدا نشد." }, 403);
  if (!managerRoles.includes(clean(caller.role).toLowerCase())) return reply({ message: "فقط مدیر سامانه اجازه مدیریت کاربران این مدرسه را دارد." }, 403);
  const schoolId = clean(caller.tenant_school_id);
  if (!schoolId) return reply({ message: "شناسه مدرسه برای حساب مدیر ثبت نشده است." }, 409);
  const { data: managerMembership, error: managerMembershipError } = await admin.from("school_memberships")
    .select("id").eq("auth_user_id", auth.user.id).eq("school_id", schoolId).eq("role", "manager").eq("is_active", true).maybeSingle();
  if (managerMembershipError || !managerMembership) return reply({ message: "عضویت فعال مدیر برای این مدرسه تأیید نشد." }, 403);

  const body = await req.json().catch(() => ({}));
  const action = clean(body.action || "list");
  if (action === "list") {
    const { data: accounts, error } = await admin.from("account_settings")
      .select("username,display_name,role,auth_user_id,national_code,phone,tenant_school_id")
      .eq("tenant_school_id", schoolId).order("display_name", { ascending: true }).limit(500);
    if (error) {
      console.error("admin-manage-users list failed", error.code);
      return reply({ message: "فهرست کاربران دریافت نشد." }, 500);
    }
    const ids = (accounts ?? []).map((x: { auth_user_id?: string | null }) => x.auth_user_id).filter(Boolean);
    let memberships: Array<{ auth_user_id: string; role: string; is_active: boolean }> = [];
    if (ids.length) {
      const { data, error: membershipError } = await admin.from("school_memberships")
        .select("auth_user_id,role,is_active").eq("school_id", schoolId).in("auth_user_id", ids).limit(1000);
      if (membershipError) {
        console.error("admin-manage-users memberships failed", membershipError.code);
        return reply({ message: "وضعیت عضویت کاربران دریافت نشد." }, 500);
      }
      memberships = data ?? [];
    }
    const activeById = new Map(memberships.map((m) => [m.auth_user_id, m.is_active]));
    return reply({ users: (accounts ?? []).map((a: Record<string, unknown>) => ({
      username: a.username, display_name: a.display_name, role: a.role,
      auth_user_id: a.auth_user_id, national_code: a.national_code, phone: a.phone,
      is_active: a.auth_user_id ? (activeById.get(String(a.auth_user_id)) ?? false) : false,
    })) });
  }

  const targetId = clean(body.auth_user_id);
  if (!targetId || targetId === auth.user.id) return reply({ message: "حساب هدف نامعتبر است." }, 400);
  const { data: target, error: targetError } = await admin.from("account_settings")
    .select("auth_user_id,role,tenant_school_id,username").eq("auth_user_id", targetId).maybeSingle();
  if (targetError || !target) return reply({ message: "کاربر هدف پیدا نشد." }, 404);
  if (clean(target.tenant_school_id) !== schoolId) return reply({ message: "امکان تغییر کاربران مدرسه دیگر وجود ندارد." }, 403);
  if (managerRoles.includes(clean(target.role).toLowerCase())) return reply({ message: "تغییر یا غیرفعال‌سازی حساب مدیریتی از این بخش مجاز نیست." }, 403);

  if (action === "set_role") {
    const role = clean(body.role);
    if (!assignableRoles.includes(role)) return reply({ message: "نقش انتخاب‌شده مجاز نیست." }, 400);
    const { error: accountUpdateError } = await admin.from("account_settings")
      .update({ role, updated_at: new Date().toISOString() }).eq("auth_user_id", targetId).eq("tenant_school_id", schoolId);
    if (accountUpdateError) {
      console.error("admin-manage-users role update failed", accountUpdateError.code);
      return reply({ message: "نقش کاربر ذخیره نشد." }, 500);
    }
    const { data: membership, error: membershipReadError } = await admin.from("school_memberships")
      .select("id").eq("auth_user_id", targetId).eq("school_id", schoolId).maybeSingle();
    if (membershipReadError) return reply({ message: "نقش ذخیره شد، اما همگام‌سازی عضویت کامل نشد؛ بررسی لازم است." }, 500);
    const membershipWrite = membership
      ? await admin.from("school_memberships").update({ role, updated_at: new Date().toISOString() }).eq("id", membership.id)
      : await admin.from("school_memberships").insert({ auth_user_id: targetId, school_id: schoolId, role, is_active: true });
    if (membershipWrite.error) {
      console.error("admin-manage-users membership role update failed", membershipWrite.error.code);
      return reply({ message: "نقش حساب تغییر کرد اما عضویت همگام نشد؛ لطفاً وضعیت را بررسی کنید." }, 500);
    }
    return reply({ success: true, message: "نقش کاربر ذخیره شد." });
  }

  if (action === "set_active") {
    const isActive = body.is_active === true;
    const { data: membership, error: membershipReadError } = await admin.from("school_memberships")
      .select("id").eq("auth_user_id", targetId).eq("school_id", schoolId).maybeSingle();
    if (membershipReadError) return reply({ message: "وضعیت عضویت بررسی نشد." }, 500);
    if (membership) {
      const { error } = await admin.from("school_memberships")
        .update({ is_active: isActive, updated_at: new Date().toISOString() }).eq("id", membership.id);
      if (error) return reply({ message: "وضعیت کاربر ذخیره نشد." }, 500);
    } else {
      const role = clean(target.role);
      if (!assignableRoles.includes(role)) return reply({ message: "نقش این کاربر نیازمند بررسی مدیر سامانه است." }, 409);
      const { error } = await admin.from("school_memberships")
        .insert({ auth_user_id: targetId, school_id: schoolId, role, is_active: isActive });
      if (error) return reply({ message: "وضعیت عضویت ذخیره نشد." }, 500);
    }
    return reply({ success: true, message: isActive ? "دسترسی کاربر فعال شد." : "دسترسی کاربر در این مدرسه غیرفعال شد." });
  }
  return reply({ message: "عملیات پشتیبانی نمی‌شود." }, 400);
});