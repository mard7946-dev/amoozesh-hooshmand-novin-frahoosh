import { createClient } from "npm:@supabase/supabase-js@2";
import { createLiveKitRoom, createLiveKitParticipantToken, deleteLiveKitRoom } from "../_shared/livekit.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
});
const clean = (value: unknown) => String(value ?? "").trim();
const norm = (value: unknown) => clean(value).toLocaleLowerCase("fa")
  .replace(/[يى]/g, "ی").replace(/ك/g, "ک");

const PUBLISHABLE_KEY = "sb_publishable_esNNTGYl6aXb6FlINJxPKA_Dl6KuInP";


Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ message: "فقط درخواست POST پذیرفته می‌شود." }, 405);

  const bearer = clean(req.headers.get("authorization")).replace(/^Bearer\s+/i, "");
  if (!bearer) return reply({ message: "ابتدا وارد سامانه شوید." }, 401);

  const url = clean(Deno.env.get("SUPABASE_URL"));
  let serviceKey = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const bundleRaw = clean(Deno.env.get("SUPABASE_SECRET_KEYS"));
  if (bundleRaw) {
    try {
      const bundle = JSON.parse(bundleRaw);
      const candidate = typeof bundle === "string" ? bundle : bundle.default ?? bundle.service_role ?? bundle.serviceRole ?? bundle.service_role_key;
      if (typeof candidate === "string" && candidate.trim()) serviceKey = candidate.trim();
    } catch {
      if (bundleRaw.startsWith("sb_secret_") || bundleRaw.startsWith("eyJ")) serviceKey = bundleRaw;
    }
  }
  if (!url || !serviceKey) return reply({ message: "اتصال امن پایگاه داده تنظیم نشده است." }, 503);
  try {
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await admin.auth.getUser(bearer);
    if (authError || !authData.user) return reply({ message: "نشست معتبر نیست؛ دوباره وارد سامانه شوید." }, 401);

    const body = await req.json().catch(() => ({}));
    const adHocMeetingId = clean(body?.meeting_id);
    if (adHocMeetingId) {
      const joinCode = clean(body?.join_code);
      if (!joinCode) return reply({ message: "لینک دعوت کامل نیست." }, 400);
      const { data: adHocProfile, error: adHocProfileError } = await admin.from("account_settings")
        .select("display_name,username,role,tenant_school_id")
        .eq("auth_user_id", authData.user.id).maybeSingle();
      if (adHocProfileError || !adHocProfile?.tenant_school_id) return reply({ message: "حساب کاربری به مدرسه متصل نیست." }, 403);
      const { data: adHocMeeting, error: adHocMeetingError } = await admin.from("classroom_ad_hoc_meetings")
        .select("id,title,description,created_by,tenant_school_id,audience_type,audience_roles,join_code,cloudflare_meeting_id,status,expires_at")
        .eq("id", adHocMeetingId).eq("join_code", joinCode)
        .eq("tenant_school_id", adHocProfile.tenant_school_id).maybeSingle();
      if (adHocMeetingError) throw adHocMeetingError;
      if (!adHocMeeting) return reply({ message: "لینک جلسه معتبر نیست یا به مدرسه دیگری تعلق دارد." }, 403);
      if (adHocMeeting.status !== "active" || new Date(adHocMeeting.expires_at).getTime() <= Date.now()) {
        return reply({ message: "این جلسه پایان یافته یا مهلت ورود آن تمام شده است." }, 410);
      }
      const { data: memberships, error: membershipError } = await admin.from("school_memberships")
        .select("role").eq("school_id", adHocProfile.tenant_school_id)
        .eq("auth_user_id", authData.user.id).eq("is_active", true);
      if (membershipError) throw membershipError;
      const roleKey = (value: unknown) => {
        const role = norm(value);
        if (role === "manager" || role.includes("مدیر")) return "manager";
        if (role === "teacher" || role.includes("دبیر") || role.includes("معلم")) return "teacher";
        if (role === "student" || role.includes("دانشآموز") || role.includes("دانش آموز")) return "student";
        if (role === "parent" || role.includes("ولی") || role.includes("والد")) return "parent";
        if (role === "counselor" || role.includes("مشاور")) return "counselor";
        if (role === "deputy" || role.includes("معاون") || role.endsWith("_deputy") || ["educational","executive","cultural","advisor"].includes(role)) return "deputy";
        return role;
      };
      const activeRoles = new Set((memberships ?? []).map((item: any) => roleKey(item.role)));
      const requestedRole = roleKey(body?.active_role || adHocProfile.role);
      const isCreator = adHocMeeting.created_by === authData.user.id;
      if (!activeRoles.has(requestedRole)) {
        return reply({ message: "سمت فعال این حساب در مدرسه تأیید نشد." }, 403);
      }
      const isAudienceAllowed = adHocMeeting.audience_type === "all_school"
        ? activeRoles.size > 0
        : (Array.isArray(adHocMeeting.audience_roles) && adHocMeeting.audience_roles.map(roleKey).includes(requestedRole));
      if (!isAudienceAllowed && !isCreator) return reply({ message: "این جلسه برای گروه کاربری شما دعوت نشده است." }, 403);

      const liveKitRoomName = clean(adHocMeeting.cloudflare_meeting_id);
      if (!liveKitRoomName.startsWith("frahoosh-")) {
        return reply({ message: "این جلسه پیش از انتقال سرویس ساخته شده است؛ لطفاً مدیر جلسهٔ جدیدی ایجاد کند." }, 409);
      }
      const isHost = isCreator && requestedRole === "manager";
      const canShareScreen = requestedRole === "manager" || requestedRole === "teacher";
      const isStudent = requestedRole === "student";
      const displayName = isStudent ? `دانش‌آموز-${authData.user.id.slice(-4)}`
        : (clean(adHocProfile.display_name) || clean(adHocProfile.username) || "کاربر فراهوش");
      const remainingSeconds = Math.floor((new Date(adHocMeeting.expires_at).getTime() - Date.now()) / 1000);
      const credentials = await createLiveKitParticipantToken(
        liveKitRoomName,
        authData.user.id,
        displayName,
        { host: isHost, screenShare: canShareScreen, role: requestedRole, ttlSeconds: Math.min(3600, remainingSeconds) },
      );
      return reply({
        ok: true,
        ...credentials,
        expires_on: credentials.expires_at,
        room: { id: adHocMeeting.id, title: adHocMeeting.title, subject: "جلسه اختصاصی", class_name: "", teacher: adHocProfile.display_name || adHocProfile.username || "مدیریت مدرسه" },
      });
    }
    const roomId = Number(body?.room_id);
    const scheduleEntryId = Number(body?.schedule_entry_id ?? 0);
    if (!Number.isInteger(roomId) || roomId < 1) return reply({ message: "شناسه کلاس معتبر نیست." }, 400);

    // Reuse the existing classroom authorization path so membership, school,
    // teacher assignment, student class and active bell are checked centrally.
    const authResponse = await fetch(`${url}/functions/v1/classroom-authorize`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": PUBLISHABLE_KEY,
        "Authorization": `Bearer ${bearer}`,
      },
      body: JSON.stringify({
        room_id: roomId,
        ...(scheduleEntryId > 0 ? { schedule_entry_id: scheduleEntryId } : {}),
        ...(body?.active_role ? { active_role: clean(body.active_role) } : {}),
      }),
    });
    const authorization = await authResponse.json().catch(() => ({}));
    if (!authResponse.ok || !authorization?.ok || !authorization?.room) {
      return reply({ message: authorization?.message || "مجوز ورود به این زنگ تأیید نشد." }, authResponse.status || 403);
    }

    const { data: profile, error: profileError } = await admin.from("account_settings")
      .select("display_name,username,role,tenant_school_id")
      .eq("auth_user_id", authData.user.id).maybeSingle();
    if (profileError || !profile?.tenant_school_id) return reply({ message: "حساب کاربری به مدرسه متصل نیست." }, 403);

    const role = norm(authorization.profile?.role || profile.role);
    const isTeacher = ["teacher", "دبیر", "معلم"].includes(role);
    const isManager = ["manager", "مدیر", "مدیریت"].includes(role);
    const isStudent = ["student", "دانش‌آموز", "دانش آموز"].includes(role);
    const room = authorization.room;

    let liveKitRoomName = "";
    const { data: registry, error: registryError } = await admin.from("classroom_realtime_meetings")
      .select("cloudflare_meeting_id")
      .eq("tenant_school_id", profile.tenant_school_id)
      .eq("online_class_id", roomId).maybeSingle();
    if (registryError) throw registryError;
    liveKitRoomName = clean(registry?.cloudflare_meeting_id);

    if (!liveKitRoomName) {
      liveKitRoomName = `frahoosh-${String(profile.tenant_school_id).replace(/-/g, "")}-class-${roomId}`;
      await createLiveKitRoom(liveKitRoomName);
      const { error: insertError } = await admin.from("classroom_realtime_meetings").insert({
        tenant_school_id: profile.tenant_school_id,
        online_class_id: roomId,
        // Legacy column name retained for compatibility; it now stores an opaque LiveKit room name.
        cloudflare_meeting_id: liveKitRoomName,
        created_by: authData.user.id,
      });
      if (insertError) {
        const { data: winner, error: winnerError } = await admin.from("classroom_realtime_meetings")
          .select("cloudflare_meeting_id")
          .eq("tenant_school_id", profile.tenant_school_id)
          .eq("online_class_id", roomId).maybeSingle();
        if (winnerError || !winner?.cloudflare_meeting_id) {
          await deleteLiveKitRoom(liveKitRoomName).catch(() => {});
          throw insertError;
        }
        if (winner.cloudflare_meeting_id !== liveKitRoomName) {
          await deleteLiveKitRoom(liveKitRoomName).catch(() => {});
        }
        liveKitRoomName = winner.cloudflare_meeting_id;
      }
    } else if (!liveKitRoomName.startsWith("frahoosh-")) {
      // Existing registry rows can contain legacy RealtimeKit IDs. Rotate the
      // stored room name atomically so the first post-migration join is usable.
      const previousRoomName = liveKitRoomName;
      const candidateRoomName = `frahoosh-${String(profile.tenant_school_id).replace(/-/g, "")}-${crypto.randomUUID().replace(/-/g, "")}`;
      await createLiveKitRoom(candidateRoomName);
      const { data: updated, error: updateError } = await admin.from("classroom_realtime_meetings")
        .update({ cloudflare_meeting_id: candidateRoomName })
        .eq("tenant_school_id", profile.tenant_school_id)
        .eq("online_class_id", roomId)
        .eq("cloudflare_meeting_id", previousRoomName)
        .select("cloudflare_meeting_id").maybeSingle();
      if (updateError) {
        await deleteLiveKitRoom(candidateRoomName).catch(() => {});
        throw updateError;
      }
      if (updated?.cloudflare_meeting_id) {
        liveKitRoomName = updated.cloudflare_meeting_id;
      } else {
        const { data: winner, error: winnerError } = await admin.from("classroom_realtime_meetings")
          .select("cloudflare_meeting_id")
          .eq("tenant_school_id", profile.tenant_school_id)
          .eq("online_class_id", roomId).maybeSingle();
        if (winnerError || !winner?.cloudflare_meeting_id) {
          await deleteLiveKitRoom(candidateRoomName).catch(() => {});
          throw new Error("شناسه اتاق کلاس پس از انتقال قابل بازیابی نیست.");
        }
        if (winner.cloudflare_meeting_id !== candidateRoomName) {
          await deleteLiveKitRoom(candidateRoomName).catch(() => {});
        }
        liveKitRoomName = winner.cloudflare_meeting_id;
      }
    }

    const displayName = isStudent ? `دانش‌آموز-${authData.user.id.slice(-4)}` : (clean(profile.display_name) || clean(profile.username) || "کاربر فراهوش");
    const credentials = await createLiveKitParticipantToken(
      liveKitRoomName,
      authData.user.id,
      displayName,
      { host: isTeacher || isManager, screenShare: isTeacher || isManager, role, ttlSeconds: 3600 },
    );

    return reply({
      ok: true,
      ...credentials,
      expires_on: credentials.expires_at,
      room: {
        id: room.id,
        title: room.title,
        subject: room.subject,
        class_name: room.class_name,
        teacher: room.teacher,
      },
    });
  } catch (error) {
    console.error("classroom-realtime-token failed", String(error));
    return reply({
      message: String(error).includes("تنظیمات امن سرویس کلاس آنلاین")
        ? "تنظیمات امن سرویس جایگزین کلاس آنلاین در سرور ثبت نشده است."
        : "اتصال امن به سرویس صوت و تصویر انجام نشد؛ تنظیمات سرور را بررسی کنید.",
    }, 503);
  }
});
