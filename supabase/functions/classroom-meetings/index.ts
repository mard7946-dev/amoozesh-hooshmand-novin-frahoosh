import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
});
const clean = (value: unknown) => String(value ?? "").replace(/[\u200c\u200f\u202a-\u202e]/g, "").trim();
const norm = (value: unknown) => clean(value).replace(/[يى]/g, "ی").replace(/ك/g, "ک").toLocaleLowerCase("fa");
const ACCOUNT_ID = "f8543e56a787c242f86ec4b0b69907b8";
const APP_ID = "409805e3-3e16-4698-8e01-2140f7273084";
const CF_BASE = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/realtime/kit/${APP_ID}`;

function serviceClient() {
  const url = clean(Deno.env.get("SUPABASE_URL"));
  let key = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const bundleRaw = clean(Deno.env.get("SUPABASE_SECRET_KEYS"));
  if (bundleRaw) {
    try {
      const bundle = JSON.parse(bundleRaw);
      const candidate = typeof bundle === "string" ? bundle : bundle.default ?? bundle.service_role ?? bundle.serviceRole ?? bundle.service_role_key;
      if (typeof candidate === "string" && candidate.trim()) key = candidate.trim();
    } catch {
      if (bundleRaw.startsWith("sb_secret_") || bundleRaw.startsWith("eyJ")) key = bundleRaw;
    }
  }
  if (!url || !key) throw new Error("اتصال امن پایگاه داده تنظیم نشده است.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
async function cloudflare(path: string, method = "GET", body?: unknown) {
  const apiToken = clean(Deno.env.get("CLOUDFLARE_REALTIME_API_TOKEN"));
  if (!apiToken) throw new Error("کلید امن سرویس صوت و تصویر تنظیم نشده است.");
  const response = await fetch(CF_BASE + path, {
    method,
    headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success === false) {
    console.error("RealtimeKit meeting API error", response.status, JSON.stringify(data?.errors ?? {}));
    throw new Error("ساخت یا مدیریت اتاق صوتی‌ـ‌تصویری انجام نشد.");
  }
  return data?.data ?? {};
}
function isManager(role: unknown) {
  const value = norm(role);
  return value === "manager" || value === "مدیر" || value === "مدیریت" || value.includes("مدیر مدرسه");
}
const allowedRoles = new Set(["manager", "deputy", "teacher", "student", "parent", "counselor"]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ message: "فقط درخواست POST پذیرفته می‌شود." }, 405);
  const bearer = clean(req.headers.get("authorization")).replace(/^Bearer\s+/i, "");
  if (!bearer) return reply({ message: "ابتدا وارد سامانه شوید." }, 401);

  try {
    const admin = serviceClient();
    const { data: authData, error: authError } = await admin.auth.getUser(bearer);
    if (authError || !authData.user) return reply({ message: "نشست معتبر نیست؛ دوباره وارد سامانه شوید." }, 401);
    const { data: profile, error: profileError } = await admin.from("account_settings")
      .select("username,display_name,role,auth_user_id,tenant_school_id")
      .eq("auth_user_id", authData.user.id).maybeSingle();
    if (profileError || !profile?.tenant_school_id) return reply({ message: "حساب کاربری به مدرسه متصل نیست." }, 403);
    if (!isManager(profile.role)) return reply({ message: "فقط مدیر مدرسه اجازه ساخت و مدیریت جلسه اختصاصی را دارد." }, 403);

    const body = await req.json().catch(() => ({}));
    const action = clean(body.action);
    const schoolId = profile.tenant_school_id;

    if (action === "list") {
      const { data, error } = await admin.from("classroom_ad_hoc_meetings")
        .select("id,title,description,audience_type,audience_roles,join_code,status,expires_at,created_at,ended_at")
        .eq("tenant_school_id", schoolId).order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return reply({ ok: true, meetings: data ?? [] });
    }

    if (action === "create") {
      const title = clean(body.title);
      const description = clean(body.description).slice(0, 1000);
      const audienceType = clean(body.audience_type);
      const roles = [...new Set((Array.isArray(body.audience_roles) ? body.audience_roles : [])
        .map((role: unknown) => norm(role)).filter((role: string) => allowedRoles.has(role)))];
      const duration = Number(body.duration_minutes);
      if (title.length < 2 || title.length > 140) return reply({ message: "عنوان جلسه باید بین ۲ تا ۱۴۰ نویسه باشد." }, 400);
      if (!Number.isInteger(duration) || duration < 15 || duration > 240) return reply({ message: "مدت جلسه باید بین ۱۵ تا ۲۴۰ دقیقه باشد." }, 400);
      if (!["all_school", "roles"].includes(audienceType)) return reply({ message: "مخاطبان جلسه معتبر نیستند." }, 400);
      if (audienceType === "roles" && !roles.length) return reply({ message: "حداقل یک گروه مخاطب انتخاب کنید." }, 400);
      const meeting = await cloudflare("/meetings", "POST", {
        title,
        persist_chat: false,
        record_on_start: false,
        live_stream_on_start: false,
        summarize_on_end: false,
        transcribe_on_end: false,
      });
      const cloudflareMeetingId = clean(meeting?.id);
      if (!cloudflareMeetingId) throw new Error("شناسه اتاق رسانه دریافت نشد.");
      const expiresAt = new Date(Date.now() + duration * 60_000).toISOString();
      const { data, error } = await admin.from("classroom_ad_hoc_meetings").insert({
        tenant_school_id: schoolId,
        created_by: authData.user.id,
        title,
        description,
        audience_type: audienceType,
        audience_roles: audienceType === "roles" ? roles : [],
        cloudflare_meeting_id: cloudflareMeetingId,
        expires_at: expiresAt,
        status: "active",
      }).select("id,title,description,audience_type,audience_roles,join_code,status,expires_at,created_at").single();
      if (error) {
        await cloudflare(`/meetings/${cloudflareMeetingId}`, "PATCH", { status: "INACTIVE" }).catch(() => {});
        throw error;
      }
      return reply({ ok: true, meeting: data });
    }

    if (action === "end") {
      const id = clean(body.meeting_id);
      if (!id) return reply({ message: "شناسه جلسه معتبر نیست." }, 400);
      const { data: meeting, error: lookupError } = await admin.from("classroom_ad_hoc_meetings")
        .select("id,cloudflare_meeting_id,status").eq("id", id).eq("tenant_school_id", schoolId).maybeSingle();
      if (lookupError) throw lookupError;
      if (!meeting) return reply({ message: "جلسه پیدا نشد." }, 404);
      if (meeting.status !== "active") return reply({ ok: true, already_ended: true });
      // Disable the RealtimeKit meeting first: this also removes active participants
      // and prevents valid-but-unexpired tokens from starting another session.
      await cloudflare(`/meetings/${clean(meeting.cloudflare_meeting_id)}`, "PATCH", { status: "INACTIVE" });
      const { error } = await admin.from("classroom_ad_hoc_meetings")
        .update({ status: "ended", ended_at: new Date().toISOString() })
        .eq("id", id).eq("tenant_school_id", schoolId).eq("status", "active");
      if (error) throw error;
      return reply({ ok: true });
    }

    return reply({ message: "عملیات جلسه معتبر نیست." }, 400);
  } catch (error) {
    console.error("classroom-meetings failed", String(error));
    return reply({ message: error instanceof Error ? error.message : "مدیریت جلسه انجام نشد." }, 503);
  }
});
