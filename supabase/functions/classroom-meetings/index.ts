import { createClient } from "npm:@supabase/supabase-js@2";
import { createLiveKitRoom, deleteLiveKitRoom } from "../_shared/livekit.ts";

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
    const { data: classroomFlag, error: classroomFlagError } = await admin.from("platform_feature_flags")
      .select("enabled").eq("flag_key", "classroom_online_enabled").maybeSingle();
    if (classroomFlagError) return reply({ message: "وضعیت سراسری کلاس آنلاین بررسی نشد." }, 503);
    if (classroomFlag?.enabled !== true) {
      return reply({ message: "این سرویس با خرید سرور بیرونی فعال خواهد شد.", service_disabled: true }, 403);
    }
    if (!isManager(profile.role)) return reply({ message: "فقط مدیر مدرسه اجازه ساخت و مدیریت جلسه اختصاصی را دارد." }, 403);
    const { data: managerMemberships, error: managerMembershipError } = await admin.from("school_memberships")
      .select("role").eq("school_id", profile.tenant_school_id)
      .eq("auth_user_id", authData.user.id).eq("is_active", true);
    if (managerMembershipError) throw managerMembershipError;
    if (!(managerMemberships ?? []).some((membership: any) => isManager(membership.role))) {
      return reply({ message: "عضویت فعال مدیر در این مدرسه تأیید نشد." }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const action = clean(body.action);
    const schoolId = profile.tenant_school_id;

    if (action === "guest_link") {
      const meetingId = clean(body.meeting_id);
      if (!meetingId) return reply({ message: "شناسه جلسه معتبر نیست." }, 400);
      const { data: meeting, error: meetingError } = await admin.from("classroom_ad_hoc_meetings")
        .select("id,status,expires_at,tenant_school_id").eq("id", meetingId).eq("tenant_school_id", schoolId).maybeSingle();
      if (meetingError) throw meetingError;
      if (!meeting || meeting.status !== "active") {
        return reply({ message: "برای این جلسه فعال امکان ساخت لینک مهمان وجود ندارد." }, 409);
      }
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const rawToken = btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawToken)));
      const tokenHash = [...digest].map(byte => byte.toString(16).padStart(2, "0")).join("");
      // Guest links are reusable and remain valid for 30 days unless the manager revokes them.
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString();
      const { data: invite, error: insertError } = await admin.from("classroom_guest_invites").insert({
        meeting_id: meeting.id, tenant_school_id: schoolId, token_hash: tokenHash,
        max_uses: 10, use_count: 0, expires_at: expiresAt, created_by: authData.user.id,
      }).select("id").single();
      if (insertError) throw insertError;
      return reply({ ok: true, invite_id: invite.id, guest_token: rawToken, expires_at: expiresAt, max_uses: 10, single_use: false });
    }

    if (action === "list_guest_invites") {
      const meetingId = clean(body.meeting_id);
      if (!meetingId) return reply({ message: "شناسه جلسه معتبر نیست." }, 400);
      const { data: meeting, error: meetingError } = await admin.from("classroom_ad_hoc_meetings")
        .select("id").eq("id", meetingId).eq("tenant_school_id", schoolId).maybeSingle();
      if (meetingError) throw meetingError;
      if (!meeting) return reply({ message: "جلسه پیدا نشد." }, 404);
      const { data, error } = await admin.from("classroom_guest_invites")
        .select("id,expires_at,max_uses,use_count,revoked_at,created_at")
        .eq("meeting_id", meetingId).eq("tenant_school_id", schoolId)
        .order("created_at", { ascending: false }).limit(30);
      if (error) throw error;
      return reply({ ok: true, invites: data ?? [] });
    }

    if (action === "revoke_guest_invite") {
      const meetingId = clean(body.meeting_id);
      const inviteId = clean(body.invite_id);
      if (!meetingId || !inviteId) return reply({ message: "شناسه لینک مهمان معتبر نیست." }, 400);
      const { data: revoked, error } = await admin.from("classroom_guest_invites")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", inviteId).eq("meeting_id", meetingId)
        .eq("tenant_school_id", schoolId).is("revoked_at", null)
        .select("id").maybeSingle();
      if (error) throw error;
      if (!revoked) return reply({ message: "لینک مهمان پیدا نشد یا قبلاً منقضی شده است." }, 404);
      return reply({ ok: true, revoked: true });
    }

    if (action === "list") {
      const { data, error } = await admin.from("classroom_ad_hoc_meetings")
        .select("id,title,description,audience_type,audience_roles,join_code,status,expires_at,created_at,ended_at")
        .eq("tenant_school_id", schoolId).order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return reply({ ok: true, meetings: data ?? [] });
    }

    if (action === "delete_expired") {
      const id = clean(body.meeting_id);
      if (!id) return reply({ message: "شناسه جلسه معتبر نیست." }, 400);
      const { data: meeting, error: lookupError } = await admin.from("classroom_ad_hoc_meetings")
        .select("id,cloudflare_meeting_id,status,expires_at")
        .eq("id", id).eq("tenant_school_id", schoolId).maybeSingle();
      if (lookupError) throw lookupError;
      if (!meeting) return reply({ message: "جلسه پیدا نشد یا قبلاً حذف شده است." }, 404);
      const expired = new Date(meeting.expires_at).getTime() <= Date.now();
      if (meeting.status === "active" && !expired) {
        return reply({ message: "جلسه هنوز فعال است؛ ابتدا باید جلسه را پایان دهید یا تا زمان انقضا صبر کنید." }, 409);
      }
      const storedRoomName = clean(meeting.cloudflare_meeting_id);
      if (meeting.status === "active" && expired && storedRoomName.startsWith("frahoosh-")) {
        await deleteLiveKitRoom(storedRoomName).catch((error) => {
          console.warn("expired classroom room cleanup failed", String(error));
        });
      }
      const { error: deleteError } = await admin.from("classroom_ad_hoc_meetings")
        .delete().eq("id", id).eq("tenant_school_id", schoolId);
      if (deleteError) throw deleteError;
      return reply({ ok: true, deleted: true });
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
      const liveKitRoomName = `frahoosh-${schoolId.replace(/-/g, "")}-${crypto.randomUUID().replace(/-/g, "")}`;
      await createLiveKitRoom(liveKitRoomName);
      const expiresAt = new Date(Date.now() + duration * 60_000).toISOString();
      const { data, error } = await admin.from("classroom_ad_hoc_meetings").insert({
        tenant_school_id: schoolId,
        created_by: authData.user.id,
        title,
        description,
        audience_type: audienceType,
        audience_roles: audienceType === "roles" ? roles : [],
        // Legacy column name retained for compatibility; it now stores an opaque LiveKit room name.
        cloudflare_meeting_id: liveKitRoomName,
        expires_at: expiresAt,
        status: "active",
      }).select("id,title,description,audience_type,audience_roles,join_code,status,expires_at,created_at").single();
      if (error) {
        await deleteLiveKitRoom(liveKitRoomName).catch(() => {});
        throw error;
      }
      // Reserve the first host seat for the manager who created the meeting.
      const { error: hostSeatError } = await admin.from("classroom_meeting_host_slots").insert({
        meeting_id: data.id,
        tenant_school_id: schoolId,
        auth_user_id: authData.user.id,
      });
      if (hostSeatError) {
        await admin.from("classroom_ad_hoc_meetings").delete().eq("id", data.id).eq("tenant_school_id", schoolId);
        await deleteLiveKitRoom(liveKitRoomName).catch(() => {});
        throw hostSeatError;
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
      // Delete the LiveKit room first: this disconnects active participants
      // and prevents valid-but-unexpired tokens from starting another session.
      const storedRoomName = clean(meeting.cloudflare_meeting_id);
      // Older active rows may still point at a RealtimeKit meeting ID. They are
      // not valid LiveKit room names, so end the legacy record without calling LiveKit.
      if (storedRoomName.startsWith("frahoosh-")) await deleteLiveKitRoom(storedRoomName);
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
