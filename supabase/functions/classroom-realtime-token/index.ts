import { createClient } from "npm:@supabase/supabase-js@2";

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

const ACCOUNT_ID = "f8543e56a787c242f86ec4b0b69907b8";
const APP_ID = "409805e3-3e16-4698-8e01-2140f7273084";
const CF_BASE = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/realtime/kit/${APP_ID}`;
const PUBLISHABLE_KEY = "sb_publishable_esNNTGYl6aXb6FlINJxPKA_Dl6KuInP";

async function cloudflare(path: string, method = "GET", body?: unknown) {
  const apiToken = clean(Deno.env.get("CLOUDFLARE_REALTIME_API_TOKEN"));
  if (!apiToken) throw new Error("RealtimeKit server credential is not configured.");
  const response = await fetch(CF_BASE + path, {
    method,
    headers: {
      "Authorization": `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success === false) {
    console.error("RealtimeKit API error", response.status, JSON.stringify(data?.errors ?? data?.error ?? {}));
    throw new Error("سرویس رسانه کلاس آنلاین پاسخ معتبر نداد.");
  }
  return data?.data ?? {};
}

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
  if (!clean(Deno.env.get("CLOUDFLARE_REALTIME_API_TOKEN"))) {
    return reply({ message: "راه‌اندازی امن سرویس صوت و تصویر هنوز کامل نشده است؛ مدیر سامانه باید کلید محدود RealtimeKit را در اسرار Edge Function ثبت کند." }, 503);
  }

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
        if (role === "student" || role.includes("دانش‌آموز") || role.includes("دانش آموز")) return "student";
        if (role === "parent" || role.includes("ولی") || role.includes("والد")) return "parent";
        if (role === "counselor" || role.includes("مشاور")) return "counselor";
        if (role === "deputy" || role.includes("معاون") || ["educational","executive","cultural","advisor"].includes(role)) return "deputy";
        return role;
      };
      const activeRoles = new Set((memberships ?? []).map((item: any) => roleKey(item.role)));
      const requestedRole = roleKey(body?.active_role || adHocProfile.role);
      const isCreator = adHocMeeting.created_by === authData.user.id;
      if (!activeRoles.has(requestedRole) && !(isCreator && requestedRole === "manager" && roleKey(adHocProfile.role) === "manager")) {
        return reply({ message: "سمت فعال این حساب در مدرسه تأیید نشد." }, 403);
      }
      const isAudienceAllowed = adHocMeeting.audience_type === "all_school"
        ? activeRoles.size > 0
        : (Array.isArray(adHocMeeting.audience_roles) && adHocMeeting.audience_roles.map(roleKey).includes(requestedRole));
      if (!isAudienceAllowed && !isCreator) return reply({ message: "این جلسه برای گروه کاربری شما دعوت نشده است." }, 403);

      const cloudMeetingId = clean(adHocMeeting.cloudflare_meeting_id);
      if (!cloudMeetingId) return reply({ message: "اتاق رسانه این جلسه آماده نیست." }, 503);
      const isHost = isCreator && requestedRole === "manager";
      const presetName = isHost ? "group_call_host" : "group_call_guest";
      const participantsData = await cloudflare(`/meetings/${cloudMeetingId}/participants?limit=1000`);
      const participants = Array.isArray(participantsData) ? participantsData : participantsData?.data ?? [];
      let participant = participants.find((item: any) => item.custom_participant_id === authData.user.id);
      const isStudent = requestedRole === "student";
      const displayName = isStudent ? `دانش‌آموز-${authData.user.id.slice(-4)}`
        : (clean(adHocProfile.display_name) || clean(adHocProfile.username) || "کاربر فراهوش");
      const expiresOn = new Date(Math.min(Date.now() + 60 * 60 * 1000, new Date(adHocMeeting.expires_at).getTime())).toISOString();
      let participantToken = "";
      if (participant && participant.preset_name !== presetName) {
        await cloudflare(`/meetings/${cloudMeetingId}/participants/${participant.id}`, "DELETE");
        participant = null;
      }
      if (participant) {
        const refreshed = await cloudflare(`/meetings/${cloudMeetingId}/participants/${participant.id}/token`, "POST", { expires_on: expiresOn });
        participantToken = clean(refreshed?.token);
      } else {
        const created = await cloudflare(`/meetings/${cloudMeetingId}/participants`, "POST", {
          name: displayName,
          preset_name: presetName,
          custom_participant_id: authData.user.id,
          token: { expires_on: expiresOn },
        });
        participantToken = clean(created?.token);
      }
      if (!participantToken) throw new Error("توکن ورود به جلسه دریافت نشد.");
      return reply({
        ok: true,
        token: participantToken,
        expires_on: expiresOn,
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
    const presetName = isTeacher || isManager ? "group_call_host" : "group_call_guest";
    const room = authorization.room;

    let meetingId = "";
    const { data: registry, error: registryError } = await admin.from("classroom_realtime_meetings")
      .select("cloudflare_meeting_id")
      .eq("tenant_school_id", profile.tenant_school_id)
      .eq("online_class_id", roomId).maybeSingle();
    if (registryError) throw registryError;
    meetingId = clean(registry?.cloudflare_meeting_id);

    if (!meetingId) {
      const meeting = await cloudflare("/meetings", "POST", {
        title: [clean(room.subject), clean(room.class_name)].filter(Boolean).join(" · ") || "کلاس آنلاین فراهوش نوین",
        persist_chat: false,
        record_on_start: false,
        live_stream_on_start: false,
        summarize_on_end: false,
        transcribe_on_end: false,
      });
      meetingId = clean(meeting?.id);
      if (!meetingId) throw new Error("شناسه اتاق رسانه دریافت نشد.");
      const { error: insertError } = await admin.from("classroom_realtime_meetings").insert({
        tenant_school_id: profile.tenant_school_id,
        online_class_id: roomId,
        cloudflare_meeting_id: meetingId,
        created_by: authData.user.id,
      });
      if (insertError) {
        const { data: winner, error: winnerError } = await admin.from("classroom_realtime_meetings")
          .select("cloudflare_meeting_id")
          .eq("tenant_school_id", profile.tenant_school_id)
          .eq("online_class_id", roomId).maybeSingle();
        if (winnerError || !winner?.cloudflare_meeting_id) throw insertError;
        // Concurrent first joins may create an unused meeting; deactivate our orphan.
        if (winner.cloudflare_meeting_id !== meetingId) {
          await cloudflare(`/meetings/${meetingId}`, "PATCH", { status: "INACTIVE" }).catch(() => {});
        }
        meetingId = winner.cloudflare_meeting_id;
      }
    }

    const participantsData = await cloudflare(`/meetings/${meetingId}/participants?limit=1000`);
    const participants = Array.isArray(participantsData) ? participantsData : participantsData?.data ?? [];
    let participant = participants.find((item: any) => item.custom_participant_id === authData.user.id);
    const displayName = isStudent ? `دانش‌آموز-${authData.user.id.slice(-4)}` : (clean(profile.display_name) || clean(profile.username) || "کاربر فراهوش");
    const expiresOn = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    let participantToken = "";

    if (participant && participant.preset_name !== presetName) {
      await cloudflare(`/meetings/${meetingId}/participants/${participant.id}`, "DELETE");
      participant = null;
    }
    if (participant) {
      const refreshed = await cloudflare(`/meetings/${meetingId}/participants/${participant.id}/token`, "POST", {
        expires_on: expiresOn,
      });
      participantToken = clean(refreshed?.token);
    } else {
      const created = await cloudflare(`/meetings/${meetingId}/participants`, "POST", {
        name: displayName,
        preset_name: presetName,
        custom_participant_id: authData.user.id,
        token: { expires_on: expiresOn },
      });
      participantToken = clean(created?.token);
    }
    if (!participantToken) throw new Error("توکن ورود به کلاس دریافت نشد.");

    return reply({
      ok: true,
      token: participantToken,
      expires_on: expiresOn,
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
      message: String(error).includes("RealtimeKit server credential")
        ? "کلید امن سرویس رسانه تنظیم نشده است."
        : "اتصال امن به سرویس صوت و تصویر انجام نشد؛ تنظیمات سرور را بررسی کنید.",
    }, 503);
  }
});
