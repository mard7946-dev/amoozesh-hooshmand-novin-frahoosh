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
    const requestedAudience = clean(input.audience);
    const studentId = Number(input.student_id);
    const hasStudent = Number.isInteger(studentId) && studentId > 0;
    const audience = requestedAudience || (hasStudent ? "student" : "all");
    const className = clean(input.class_name);
    const title = clean(input.title);
    const description = clean(input.description).slice(0, 3000);
    const weekday = clean(input.event_weekday);
    const date = clean(input.event_date_shamsi);
    const time = clean(input.event_time);
    const venue = clean(input.venue);
    if (!["all", "class", "student"].includes(audience)) {
      return reply({ message: "نوع گیرنده معتبر نیست." }, 400);
    }
    if (audience === "student" && !hasStudent) return reply({ message: "دانش‌آموز انتخاب‌شده معتبر نیست." }, 400);
    if (audience === "class" && !className) return reply({ message: "برای ارسال کلاسی، کلاس را انتخاب کنید." }, 400);
    if (!title || !date || !weekday) {
      return reply({ message: "موضوع، روز و تاریخ دعوت‌نامه الزامی است." }, 400);
    }
    if (!/^[0-9۰-۹]{4}[\\/.-][0-9۰-۹]{1,2}[\\/.-][0-9۰-۹]{1,2}$/.test(date)) {
      return reply({ message: "تاریخ را به صورت شمسی مانند ۱۴۰۵/۰۹/۱۵ وارد کنید." }, 400);
    }

    let studentName = audience === "all" ? "همه اولیا" : "";
    let usernames: string[] = [];
    let studentRecord: { id: number; first_name: string | null; last_name: string | null } | null = null;
    if (audience === "student") {
      const { data: student, error: studentError } = await db.from("students")
        .select("id,first_name,last_name").eq("tenant_school_id", school).eq("id", studentId).maybeSingle();
      if (studentError || !student) return reply({ message: "دانش‌آموز پیدا نشد." }, 404);
      studentRecord = student;
      studentName = [student.first_name, student.last_name].filter(Boolean).join(" ");
      const { data: links, error: linksError } = await db.from("parent_children")
        .select("parent_username").eq("tenant_school_id", school).eq("student_id", studentId).limit(5000);
      if (linksError) return reply({ message: "ارتباط اولیا و دانش‌آموز دریافت نشد." }, 500);
      usernames = [...new Set((links ?? []).map((row) => clean(row.parent_username)).filter(Boolean))];
    } else if (audience === "class") {
      const { data: classStudents, error: classError } = await db.from("students")
        .select("id").eq("tenant_school_id", school).eq("class_name", className).limit(2000);
      if (classError) return reply({ message: "فهرست دانش‌آموزان کلاس دریافت نشد." }, 500);
      const studentIds = (classStudents ?? []).map((row) => Number(row.id)).filter((id) => Number.isInteger(id) && id > 0);
      if (!studentIds.length) return reply({ message: "در این کلاس دانش‌آموزی پیدا نشد." }, 404);
      const { data: links, error: linksError } = await db.from("parent_children")
        .select("parent_username").eq("tenant_school_id", school).in("student_id", studentIds).limit(10000);
      if (linksError) return reply({ message: "ارتباط اولیای این کلاس دریافت نشد." }, 500);
      usernames = [...new Set((links ?? []).map((row) => clean(row.parent_username)).filter(Boolean))];
      studentName = "اولیای کلاس " + className;
    }

    let parentQuery = db.from("account_settings")
      .select("username,auth_user_id").eq("tenant_school_id", school).eq("role", "parent").limit(2000);
    if (audience !== "all") {
      if (!usernames.length) return reply({ message: "برای این مخاطب هیچ حساب ولی متصل‌شده‌ای پیدا نشد." }, 409);
      parentQuery = parentQuery.in("username", usernames);
    }
    const { data: parents, error: parentsError } = await parentQuery;
    if (parentsError) return reply({ message: "حساب‌های اولیا دریافت نشد." }, 500);
    const authUserIds = [...new Set((parents ?? []).map((row) => clean(row.auth_user_id)).filter(Boolean))];
    if (!authUserIds.length) return reply({ message: "هیچ حساب ولی معتبری برای دریافت دعوت‌نامه پیدا نشد." }, 409);
    const { data: memberships, error: membershipsError } = await db.from("school_memberships")
      .select("auth_user_id").eq("school_id", school).eq("role", "parent").eq("is_active", true)
      .in("auth_user_id", authUserIds).limit(3000);
    if (membershipsError) return reply({ message: "وضعیت عضویت اولیا بررسی نشد." }, 500);
    const activeParentIds = new Set((memberships ?? []).map((row) => clean(row.auth_user_id)));
    const activeParents = (parents ?? []).filter((row) => activeParentIds.has(clean(row.auth_user_id)));
    usernames = [...new Set(activeParents.map((row) => clean(row.username)).filter(Boolean))];
    if (!usernames.length) return reply({ message: "هیچ حساب ولی فعالی برای دریافت دعوت‌نامه پیدا نشد." }, 409);

    const userIds = new Map(activeParents.map((row) => [row.username, row.auth_user_id]));
    const invitationBatchId = crypto.randomUUID();
    const rows = usernames.map((username) => ({
      invitation_batch_id: invitationBatchId,
      tenant_school_id: school,
      student_id: studentRecord?.id ?? null,
      student_name: studentName || "همه اولیا",
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
    if (insertError) return reply({ message: "ثبت دعوت‌نامه گروهی انجام نشد." }, 500);
    return reply({
      ok: true,
      created: created ?? [],
      count: (created ?? []).length,
      audience,
      class_name: audience === "class" ? className : null,
      approval_status: "pending",
    });
  }

  if (action === "list") {
    let query = db.from("family_education_invitations")
      .select("id,invitation_batch_id,student_id,student_name,parent_username,title,description,event_weekday,event_date_shamsi,event_time,venue,status,approval_status,manager_note,parent_note,invited_by_name,invited_at,responded_at,manager_reviewed_at")
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
    const batchId = clean(input.batch_id);
    const id = Number(input.id);
    const status = clean(input.status);
    const note = clean(input.manager_note).slice(0, 1000);
    if ((!batchId && !Number.isInteger(id)) || !["approved", "rejected"].includes(status)) {
      return reply({ message: "نتیجه بررسی معتبر نیست." }, 400);
    }
    let lookup = db.from("family_education_invitations").select("id")
      .eq("tenant_school_id", school).eq("approval_status", "pending");
    lookup = batchId ? lookup.eq("invitation_batch_id", batchId) : lookup.eq("id", id);
    const { data: rows, error: rowError } = await lookup;
    if (rowError || !rows?.length) return reply({ message: "درخواست پیدا نشد یا قبلاً بررسی شده است." }, 404);
    let update = db.from("family_education_invitations").update({
      approval_status: status,
      manager_note: note,
      manager_reviewed_by: authData.user.id,
      manager_reviewed_at: new Date().toISOString(),
    }).eq("tenant_school_id", school).eq("approval_status", "pending");
    update = batchId ? update.eq("invitation_batch_id", batchId) : update.eq("id", id);
    const { error: updateError } = await update;
    if (updateError) return reply({ message: "ثبت نتیجه بررسی مدیر ناموفق بود." }, 500);
    return reply({ ok: true, approval_status: status, reviewed_count: rows.length });
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