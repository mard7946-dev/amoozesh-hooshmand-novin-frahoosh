import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
const clean = (v: unknown) => String(v ?? "").trim();
const managerRoles = ["manager", "مدیر", "مدیریت", "principal", "administrator", "admin"];
const counselorRoles = ["counselor", "advisor", "مشاور"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ message: "درخواست نامعتبر است." }, 405);
  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return reply({ message: "ابتدا وارد سامانه شوید." }, 401);

  const url = (Deno.env.get("SUPABASE_URL") ?? "").trim();
  let serviceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  const secretKeys = (Deno.env.get("SUPABASE_SECRET_KEYS") ?? "").trim();
  if (secretKeys) {
    try {
      const parsed = JSON.parse(secretKeys);
      const value = typeof parsed === "string" ? parsed : parsed.default ?? parsed.service_role ?? parsed.serviceRole ?? parsed.service_role_key;
      if (typeof value === "string" && value.trim()) serviceKey = value.trim();
    } catch {
      if (secretKeys.startsWith("sb_secret_") || secretKeys.startsWith("eyJ")) serviceKey = secretKeys;
    }
  }
  if (!url || !serviceKey) return reply({ message: "تنظیمات امن سرویس کامل نیست." }, 503);

  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await db.auth.getUser(authorization.slice(7));
  if (authError || !authData.user) return reply({ message: "نشست ورود معتبر نیست." }, 401);

  const { data: profile, error: profileError } = await db.from("account_settings")
    .select("username,display_name,role,tenant_school_id,auth_user_id")
    .eq("auth_user_id", authData.user.id).maybeSingle();
  if (profileError || !profile?.tenant_school_id) return reply({ message: "پروفایل مدرسه پیدا نشد." }, 403);

  const role = clean(profile.role).toLowerCase();
  const school = profile.tenant_school_id;
  const isManager = managerRoles.includes(role);
  const isCounselor = counselorRoles.includes(role);
  const { data: membership, error: membershipError } = await db.from("school_memberships")
    .select("id").eq("auth_user_id", authData.user.id).eq("school_id", school).eq("is_active", true).maybeSingle();
  if (membershipError || !membership) return reply({ message: "عضویت فعال مدرسه تأیید نشد." }, 403);

  const input = await req.json().catch(() => ({}));
  const action = clean(input.action || "list");
  const actorName = clean(profile.display_name || profile.username || "کاربر");

  if (action === "create") {
    if (!isManager && !isCounselor) return reply({ message: "فقط مشاور یا مدیر می‌تواند دعوت‌نامه ایجاد کند." }, 403);
    const studentId = Number(input.student_id);
    const title = clean(input.title);
    const description = clean(input.description).slice(0, 3000);
    const weekday = clean(input.event_weekday);
    const date = clean(input.event_date_shamsi);
    const time = clean(input.event_time);
    const venue = clean(input.venue);
    if (!Number.isInteger(studentId) || !title || !date || !weekday) {
      return reply({ message: "دانش‌آموز، موضوع، روز و تاریخ دعوت‌نامه الزامی است." }, 400);
    }
    if (!/^[0-9۰-۹]{4}[\/.-][0-9۰-۹]{1,2}[\/.-][0-9۰-۹]{1,2}$/.test(date)) {
      return reply({ message: "تاریخ را به صورت شمسی مانند ۱۴۰۵/۰۹/۱۵ وارد کنید." }, 400);
    }
    const { data: student, error: studentError } = await db.from("students")
      .select("id,first_name,last_name").eq("tenant_school_id", school).eq("id", studentId).maybeSingle();
    if (studentError || !student) return reply({ message: "دانش‌آموز پیدا نشد." }, 404);

    const { data: links, error: linksError } = await db.from("parent_children")
      .select("parent_username").eq("tenant_school_id", school).eq("student_id", studentId);
    if (linksError) return reply({ message: "ارتباط اولیا و دانش‌آموز دریافت نشد." }, 500);
    const usernames = [...new Set((links ?? []).map((row) => clean(row.parent_username)).filter(Boolean))];
    if (!usernames.length) return reply({ message: "برای این دانش‌آموز ولی متصل ثبت نشده است." }, 409);

    const { data: parents, error: parentsError } = await db.from("account_settings")
      .select("username,auth_user_id").eq("tenant_school_id", school).in("username", usernames).eq("role", "parent");
    if (parentsError) return reply({ message: "حساب‌های اولیا دریافت نشد." }, 500);
    const userIds = new Map((parents ?? []).map((row) => [row.username, row.auth_user_id]));
    const rows = usernames.map((username) => ({
      tenant_school_id: school,
      student_id: student.id,
      student_name: [student.first_name, student.last_name].filter(Boolean).join(" "),
      parent_username: username,
      parent_user_id: userIds.get(username) || null,
      title,
      description,
      event_weekday: weekday,
      event_date_shamsi: date,
      event_time: time,
      venue,
      status: "pending",
      approval_status: "pending",
      invited_by: authData.user.id,
      invited_by_name: actorName,
    }));
    const { data: created, error: insertError } = await db.from("family_education_invitations")
      .insert(rows).select("id,parent_username,approval_status");
    if (insertError) return reply({ message: "ثبت درخواست دعوت‌نامه انجام نشد.", detail: insertError.message }, 500);
    return reply({ ok: true, created: created ?? [], count: (created ?? []).length, approval_status: "pending" });
  }

  if (action === "list") {
    let query = db.from("family_education_invitations")
      .select("id,student_id,student_name,parent_username,title,description,event_weekday,event_date_shamsi,event_time,venue,status,approval_status,manager_note,parent_note,invited_by_name,invited_at,responded_at,manager_reviewed_at")
      .eq("tenant_school_id", school).order("id", { ascending: false }).limit(1000);
    if (!isManager && !isCounselor) {
      if (role !== "parent") return reply({ message: "دسترسی مجاز نیست." }, 403);
      query = query.eq("parent_username", profile.username).eq("approval_status", "approved");
    }
    const { data, error } = await query;
    if (error) return reply({ message: "دریافت دعوت‌نامه‌ها ناموفق بود." }, 500);
    return reply({ ok: true, invitations: data ?? [], role });
  }

  if (action === "review") {
    if (!isManager) return reply({ message: "فقط مدیر مدرسه اجازه تأیید یا رد دعوت‌نامه را دارد." }, 403);
    const id = Number(input.id);
    const status = clean(input.status);
    const note = clean(input.manager_note).slice(0, 1000);
    if (!Number.isInteger(id) || !["approved", "rejected"].includes(status)) {
      return reply({ message: "نتیجه بررسی معتبر نیست." }, 400);
    }
    const { data: row, error: rowError } = await db.from("family_education_invitations")
      .select("id").eq("id", id).eq("tenant_school_id", school).eq("approval_status", "pending").maybeSingle();
    if (rowError || !row) return reply({ message: "درخواست پیدا نشد یا قبلاً بررسی شده است." }, 404);
    const { error: updateError } = await db.from("family_education_invitations").update({
      approval_status: status,
      manager_note: note,
      manager_reviewed_by: authData.user.id,
      manager_reviewed_at: new Date().toISOString(),
    }).eq("id", id).eq("tenant_school_id", school);
    if (updateError) return reply({ message: "ثبت نتیجه بررسی مدیر ناموفق بود." }, 500);
    return reply({ ok: true, approval_status: status });
  }

  if (action === "respond") {
    if (role !== "parent") return reply({ message: "فقط ولی می‌تواند پاسخ دهد." }, 403);
    const id = Number(input.id);
    const status = clean(input.status);
    const note = clean(input.parent_note).slice(0, 1000);
    if (!Number.isInteger(id) || !["accepted", "declined"].includes(status)) {
      return reply({ message: "پاسخ معتبر نیست." }, 400);
    }
    const { data: row, error: rowError } = await db.from("family_education_invitations")
      .select("id").eq("id", id).eq("tenant_school_id", school)
      .eq("parent_username", profile.username).eq("approval_status", "approved").maybeSingle();
    if (rowError || !row) return reply({ message: "این دعوت‌نامه منتشرشده متعلق به حساب شما نیست." }, 403);
    const { error: updateError } = await db.from("family_education_invitations").update({
      status,
      parent_note: note,
      responded_at: new Date().toISOString(),
    }).eq("id", id).eq("tenant_school_id", school).eq("parent_username", profile.username);
    if (updateError) return reply({ message: "ثبت پاسخ انجام نشد." }, 500);
    return reply({ ok: true, status });
  }

  return reply({ message: "عملیات ناشناخته است." }, 400);
});