import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildRemoteTrackRequests,
  buildSfuDisplayName,
  buildSfuRoomKey,
  getSafeSfuError,
  normalizeSfuRole,
} from "../_shared/classroom-sfu.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
});
const clean = (value: unknown) => String(value ?? "").trim();
const PUBLISHABLE_KEY = "sb_publishable_esNNTGYl6aXb6FlINJxPKA_Dl6KuInP";

type SfuEnvironment = { appId: string; appSecret: string; baseUrl: string };
class SafeSfuException extends Error {
  status: number;
  safe: ReturnType<typeof getSafeSfuError>;
  constructor(status: number, body: unknown) {
    const safe = getSafeSfuError(status, body);
    super(safe.message);
    this.status = status;
    this.safe = safe;
  }
}

function getServiceKey(): string {
  let serviceKey = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const bundleRaw = clean(Deno.env.get("SUPABASE_SECRET_KEYS"));
  if (bundleRaw) {
    try {
      const bundle = JSON.parse(bundleRaw);
      const candidate = typeof bundle === "string"
        ? bundle
        : bundle.default ?? bundle.service_role ?? bundle.serviceRole ?? bundle.service_role_key;
      if (typeof candidate === "string" && candidate.trim()) serviceKey = candidate.trim();
    } catch {
      if (bundleRaw.startsWith("sb_secret_") || bundleRaw.startsWith("eyJ")) serviceKey = bundleRaw;
    }
  }
  return serviceKey;
}

function getSfuEnvironment(): SfuEnvironment | null {
  const appId = clean(Deno.env.get("CLOUDFLARE_SFU_APP_ID"));
  const appSecret = clean(Deno.env.get("CLOUDFLARE_SFU_APP_SECRET"));
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(appId) || appSecret.length < 32 || appSecret.length > 512 || /\s/.test(appSecret)) return null;
  return {
    appId,
    appSecret,
    baseUrl: "https://rtc.live.cloudflare.com/v1/apps/" + encodeURIComponent(appId),
  };
}

async function sfuRequest(
  env: SfuEnvironment,
  path: string,
  method = "GET",
  body?: unknown,
): Promise<Record<string, any>> {
  const response = await fetch(env.baseUrl + path, {
    method,
    headers: {
      "Authorization": "Bearer " + env.appSecret,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(12000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.errorCode || data?.errorDescription || data?.success === false) {
    throw new SafeSfuException(response.ok ? 502 : response.status, data);
  }
  return data && typeof data === "object" ? data : {};
}

async function createSfuSession(env: SfuEnvironment): Promise<string> {
  const data = await sfuRequest(env, "/sessions/new", "POST");
  const sessionId = clean(data.sessionId ?? data.data?.sessionId);
  if (!sessionId) throw new SafeSfuException(502, { errorCode: "missing_session_id" });
  return sessionId;
}

async function closeSfuTracks(
  env: SfuEnvironment,
  sessionId: string,
  mids: string[],
): Promise<void> {
  const uniqueMids = [...new Set(mids.map(clean).filter(Boolean))];
  if (!uniqueMids.length) return;
  const result = await sfuRequest(
    env,
    "/sessions/" + encodeURIComponent(sessionId) + "/tracks/close",
    "PUT",
    { tracks: uniqueMids.map(mid => ({ mid })), force: true },
  );
  const closeResults = Array.isArray(result.tracks) ? result.tracks : [];
  const failed = closeResults.some((item: any) =>
    (item?.errorCode && item.errorCode !== "close_track_error")
    || (!item?.errorCode && item?.errorDescription)
  );
  if (failed) throw new SafeSfuException(502, { errorCode: "track_cleanup_incomplete" });
}

function midsFrom(items: unknown): string[] {
  return Array.isArray(items)
    ? [...new Set(items.map((item: any) => clean(item?.mid)).filter(Boolean))]
    : [];
}

async function closeSfuSession(
  env: SfuEnvironment,
  sessionId: string | null | undefined,
  knownMids: unknown,
): Promise<void> {
  const id = clean(sessionId);
  if (!id) return;
  const retainedMids = midsFrom(knownMids);
  let session: Record<string, any>;
  try {
    session = await sfuRequest(env, "/sessions/" + encodeURIComponent(id));
  } catch (error) {
    if (error instanceof SafeSfuException && (error.status === 404 || error.status === 410)) {
      await closeSfuTracks(env, id, retainedMids);
      return;
    }
    if (retainedMids.length) await closeSfuTracks(env, id, retainedMids).catch(() => {});
    throw error;
  }
  const inspectedMids = midsFrom(session.tracks);
  await closeSfuTracks(env, id, [...retainedMids, ...inspectedMids]);
}

async function authenticate(req: Request, url: string, serviceKey: string) {
  const bearer = clean(req.headers.get("authorization")).replace(/^Bearer\s+/i, "");
  if (!bearer) throw Object.assign(new Error("ابتدا وارد سامانه شوید."), { status: 401 });
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.auth.getUser(bearer);
  if (error || !data.user) throw Object.assign(new Error("نشست معتبر نیست؛ دوباره وارد سامانه شوید."), { status: 401 });
  return { admin, user: data.user, bearer };
}

async function getProfile(admin: any, userId: string) {
  const { data, error } = await admin.from("account_settings")
    .select("display_name,username,role,tenant_school_id")
    .eq("auth_user_id", userId).maybeSingle();
  if (error || !data?.tenant_school_id) throw Object.assign(
    new Error("حساب کاربری به مدرسه مشخصی متصل نیست."),
    { status: 403 },
  );
  return data;
}

async function authorizeScheduledRoom(
  url: string,
  bearer: string,
  body: Record<string, any>,
  accountProfile: any,
): Promise<{ roomKey: string; schoolId: string; room: any; profile: any; role: string; roomId: number; scheduleEntryId: number }> {
  const roomId = Number(body.room_id);
  const scheduleEntryId = Number(body.schedule_entry_id);
  if (!Number.isInteger(roomId) || roomId < 1 || !Number.isInteger(scheduleEntryId) || scheduleEntryId < 1) {
    throw Object.assign(new Error("کلاس و زنگ انتخاب‌شده معتبر نیستند."), { status: 400 });
  }
  const response = await fetch(url + "/functions/v1/classroom-authorize", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": PUBLISHABLE_KEY,
      "Authorization": "Bearer " + bearer,
    },
    body: JSON.stringify({
      room_id: roomId,
      schedule_entry_id: scheduleEntryId,
      active_role: clean(body.active_role),
    }),
    signal: AbortSignal.timeout(12000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.ok || !data?.room || !data?.profile) {
    throw Object.assign(
      new Error(clean(data?.message) || "مجوز ورود به این زنگ تأیید نشد."),
      { status: response.status || 403 },
    );
  }
  const profile = data.profile;
  const role = normalizeSfuRole(profile.active_role || profile.role);
  const schoolId = clean(accountProfile?.tenant_school_id);
  if (!schoolId) throw Object.assign(new Error("مدرسهٔ حساب کاربری مشخص نیست."), { status: 403 });
  return {
    roomKey: buildSfuRoomKey({ schoolId, onlineClassId: roomId, scheduleEntryId }),
    schoolId,
    room: data.room,
    profile,
    role,
    roomId,
    scheduleEntryId,
  };
}

async function authorizeAdHocRoom(
  admin: any,
  userId: string,
  body: Record<string, any>,
  profile: any,
): Promise<{ roomKey: string; schoolId: string; room: any; role: string; meetingId: string }> {
  const meetingId = clean(body.meeting_id);
  const joinCode = clean(body.join_code);
  if (!meetingId || !joinCode) throw Object.assign(new Error("لینک دعوت جلسه کامل نیست."), { status: 400 });
  const { data: meeting, error } = await admin.from("classroom_ad_hoc_meetings")
    .select("id,title,description,created_by,tenant_school_id,audience_type,audience_roles,join_code,status,expires_at")
    .eq("id", meetingId).eq("join_code", joinCode)
    .eq("tenant_school_id", profile.tenant_school_id).maybeSingle();
  if (error) throw error;
  if (!meeting) throw Object.assign(new Error("لینک جلسه معتبر نیست یا به مدرسه دیگری تعلق ندارد."), { status: 403 });
  if (meeting.status !== "active" || new Date(meeting.expires_at).getTime() <= Date.now()) {
    throw Object.assign(new Error("این جلسه پایان یافته یا مهلت ورود آن تمام شده است."), { status: 410 });
  }
  const { data: memberships, error: membershipError } = await admin.from("school_memberships")
    .select("role").eq("school_id", profile.tenant_school_id)
    .eq("auth_user_id", userId).eq("is_active", true);
  if (membershipError) throw membershipError;
  const activeRoles = new Set((memberships ?? []).map((item: any) => normalizeSfuRole(item.role)));
  const role = normalizeSfuRole(body.active_role || profile.role);
  const isCreator = meeting.created_by === userId;
  if (!activeRoles.has(role) && !(isCreator && role === "manager" && normalizeSfuRole(profile.role) === "manager")) {
    throw Object.assign(new Error("سمت فعال این حساب در مدرسه تأیید نشد."), { status: 403 });
  }
  const audienceRoles = Array.isArray(meeting.audience_roles)
    ? meeting.audience_roles.map(normalizeSfuRole)
    : [];
  const audienceAllowed = meeting.audience_type === "all_school"
    ? activeRoles.size > 0
    : audienceRoles.includes(role);
  if (!audienceAllowed && !isCreator) {
    throw Object.assign(new Error("این جلسه برای گروه کاربری شما دعوت نشده است."), { status: 403 });
  }
  return {
    roomKey: buildSfuRoomKey({ schoolId: clean(profile.tenant_school_id), meetingId }),
    schoolId: clean(profile.tenant_school_id),
    room: { id: meeting.id, title: meeting.title, subject: "جلسه اختصاصی", class_name: "", teacher: profile.display_name || profile.username || "مدیریت مدرسه" },
    role,
    meetingId,
  };
}

async function requireParticipant(admin: any, userId: string, roomKey: string, generation: number) {
  const { data, error } = await admin.from("classroom_sfu_participants")
    .select("id,tenant_school_id,room_key,online_class_id,schedule_entry_id,ad_hoc_meeting_id,auth_user_id,role,display_name,generation,publisher_session_id,subscriber_session_id,publications,subscriptions,status,publisher_mutation_id,publisher_mutation_started_at,subscriber_mutation_id,subscriber_mutation_started_at")
    .eq("room_key", roomKey).eq("auth_user_id", userId).eq("status", "active").maybeSingle();
  if (error) throw error;
  if (!data) throw Object.assign(new Error("عضویت فعال شما در این کلاس پیدا نشد؛ دوباره وارد کلاس شوید."), { status: 403 });
  if (Number(data.generation) !== generation) {
    throw Object.assign(new Error("نشست کلاس تغییر کرده است؛ دوباره وارد کلاس شوید."), { status: 409 });
  }
  const { data: membership, error: membershipError } = await admin.from("school_memberships")
    .select("role").eq("school_id", data.tenant_school_id)
    .eq("auth_user_id", userId).eq("is_active", true);
  if (membershipError) throw membershipError;
  const activeRoles = new Set((membership ?? []).map((item: any) => normalizeSfuRole(item.role)));
  if (!activeRoles.has(normalizeSfuRole(data.role))) {
    throw Object.assign(new Error("سمت فعال شما در مدرسه دیگر تأیید نمی‌شود."), { status: 403 });
  }
  return data;
}

async function pruneStaleParticipants(admin: any, env: SfuEnvironment, roomKey: string, selfId: string) {
  const cutoff = new Date(Date.now() - 90_000).toISOString();
  const { data, error } = await admin.from("classroom_sfu_participants")
    .select("id,publisher_session_id,subscriber_session_id,publications,subscriptions,publisher_mutation_id,publisher_mutation_started_at,subscriber_mutation_id,subscriber_mutation_started_at")
    .eq("room_key", roomKey).eq("status", "active").neq("id", selfId)
    .lt("last_seen_at", cutoff).limit(30);
  if (error) throw error;
  for (const stale of data ?? []) {
    if (
      mutationLockIsActive(stale.publisher_mutation_id, stale.publisher_mutation_started_at)
      || mutationLockIsActive(stale.subscriber_mutation_id, stale.subscriber_mutation_started_at)
    ) continue;
    try {
      await closeSfuSession(env, stale.publisher_session_id, stale.publications);
      await closeSfuSession(env, stale.subscriber_session_id, stale.subscriptions);
      const { error: updateError } = await admin.from("classroom_sfu_participants")
        .update({
          status: "left",
          publications: [],
          subscriptions: [],
          publisher_mutation_id: null,
          publisher_mutation_started_at: null,
          subscriber_mutation_id: null,
          subscriber_mutation_started_at: null,
          left_at: new Date().toISOString(),
        })
        .eq("id", stale.id).eq("status", "active");
      if (updateError) throw updateError;
    } catch (error) {
      const code = error instanceof SafeSfuException ? error.safe.code : "cleanup_failed";
      console.warn("classroom-sfu stale participant cleanup pending", code);
    }
  }
}

async function claimMutationLock(
  admin: any,
  participantId: string,
  generation: number,
  sessionKind: "publisher" | "subscriber",
  mutationId: string,
): Promise<void> {
  if (!/^[A-Za-z0-9_-]{8,96}$/.test(mutationId)) {
    throw Object.assign(new Error("شناسهٔ عملیات رسانه معتبر نیست."), { status: 400 });
  }
  const { data, error } = await admin.rpc("claim_classroom_sfu_session_mutation", {
    p_participant_id: participantId,
    p_generation: generation,
    p_session_kind: sessionKind,
    p_mutation_id: mutationId,
  });
  if (error) throw error;
  if (data !== true) {
    throw Object.assign(new Error("عملیات دیگری روی همین مسیر رسانه در حال انجام است؛ چند لحظه صبر کنید."), { status: 409 });
  }
}

async function releaseMutationLock(
  admin: any,
  participantId: string,
  generation: number,
  sessionKind: "publisher" | "subscriber",
  mutationId: string,
): Promise<boolean> {
  const { data, error } = await admin.rpc("release_classroom_sfu_session_mutation", {
    p_participant_id: participantId,
    p_generation: generation,
    p_session_kind: sessionKind,
    p_mutation_id: mutationId,
  });
  if (error) throw error;
  return data === true;
}

function mutationLockIsActive(id: unknown, startedAt: unknown): boolean {
  const timestamp = Date.parse(clean(startedAt));
  return Boolean(clean(id)) && Number.isFinite(timestamp) && Date.now() - timestamp < 45_000;
}

async function getRoomSnapshot(admin: any, roomKey: string, selfId: string) {
  const { data, error } = await admin.from("classroom_sfu_participants")
    .select("id,display_name,role,publisher_session_id,publications,status,joined_at")
    .eq("room_key", roomKey).eq("status", "active")
    .order("joined_at", { ascending: true }).limit(100);
  if (error) throw error;
  return {
    participants: (data ?? []).map((item: any) => ({
      id: item.id,
      displayName: clean(item.display_name) || "شرکت‌کننده",
      role: normalizeSfuRole(item.role),
      isSelf: item.id === selfId,
      publications: (Array.isArray(item.publications) ? item.publications : [])
        .filter((publication: any) => ["audio", "video"].includes(publication?.kind))
        .map((publication: any) => ({
          kind: publication.kind,
          trackName: publication.trackName,
          sessionId: item.publisher_session_id,
          key: item.id + ":" + publication.kind + ":" + item.publisher_session_id,
        })),
    })),
  };
}

async function pruneStaleSubscriptions(
  admin: any,
  env: SfuEnvironment,
  participant: any,
  snapshot: any,
): Promise<void> {
  const activeKeys = new Set(
    snapshot.participants.flatMap((item: any) =>
      item.isSelf ? [] : item.publications.map((publication: any) => publication.key)
    ),
  );
  const existing = Array.isArray(participant.subscriptions) ? participant.subscriptions : [];
  const stale = existing.filter((item: any) => !activeKeys.has(clean(item?.key)));
  if (!stale.length) return;
  await closeSfuTracks(env, participant.subscriber_session_id, midsFrom(stale));
  const retained = existing.filter((item: any) => activeKeys.has(clean(item?.key)));
  const { error } = await admin.from("classroom_sfu_participants")
    .update({ subscriptions: retained, last_seen_at: new Date().toISOString() })
    .eq("id", participant.id).eq("generation", participant.generation).eq("status", "active");
  if (error) throw error;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ ok: false, message: "فقط درخواست POST پذیرفته می‌شود." }, 405);

  const url = clean(Deno.env.get("SUPABASE_URL"));
  const serviceKey = getServiceKey();
  if (!url || !serviceKey) return reply({ ok: false, message: "اتصال امن پایگاه داده تنظیم نشده است." }, 503);
  const sfuEnv = getSfuEnvironment();
  if (!sfuEnv) return reply({
    ok: false,
    message: "برنامهٔ Cloudflare Realtime SFU هنوز در تنظیمات امن سرور ثبت نشده است.",
  }, 503);

  try {
    const { admin, user, bearer } = await authenticate(req, url, serviceKey);
    const rawBody = await req.text();
    if (rawBody.length > 1_100_000) return reply({ ok: false, message: "اندازهٔ درخواست رسانه بیش از حد مجاز است." }, 413);
    const body = JSON.parse(rawBody || "{}");
    const action = clean(body.action);
    if (!["join", "snapshot", "publish", "complete_publish", "subscribe", "renegotiate", "leave"].includes(action)) {
      return reply({ ok: false, message: "عملیات کلاس معتبر نیست." }, 400);
    }

    if (action === "join") {
      const profile = await getProfile(admin, user.id);
      let admission: any;
      if (clean(body.meeting_id)) {
        admission = await authorizeAdHocRoom(admin, user.id, body, profile);
      } else {
        admission = await authorizeScheduledRoom(url, bearer, body, profile);
        if (admission.schoolId !== clean(profile.tenant_school_id)) {
          return reply({ ok: false, message: "کلاس انتخاب‌شده متعلق به مدرسهٔ حساب شما نیست." }, 403);
        }
      }

      const { data: oldParticipant, error: oldError } = await admin.from("classroom_sfu_participants")
        .select("publisher_session_id,subscriber_session_id,publications,subscriptions,publisher_mutation_id,publisher_mutation_started_at,subscriber_mutation_id,subscriber_mutation_started_at")
        .eq("room_key", admission.roomKey).eq("auth_user_id", user.id).maybeSingle();
      if (oldError) throw oldError;
      if (
        mutationLockIsActive(oldParticipant?.publisher_mutation_id, oldParticipant?.publisher_mutation_started_at)
        || mutationLockIsActive(oldParticipant?.subscriber_mutation_id, oldParticipant?.subscriber_mutation_started_at)
      ) throw Object.assign(new Error("نشست قبلی هنوز در حال مذاکرهٔ رسانه است؛ کمی صبر کنید و دوباره وارد شوید."), { status: 409 });
      await closeSfuSession(sfuEnv, oldParticipant?.publisher_session_id, oldParticipant?.publications);
      await closeSfuSession(sfuEnv, oldParticipant?.subscriber_session_id, oldParticipant?.subscriptions);

      const displayName = buildSfuDisplayName(admission.role, user.id, profile.display_name, profile.username);
      const { data: claimRows, error: claimError } = await admin.rpc("claim_classroom_sfu_participant", {
        p_room_key: admission.roomKey,
        p_tenant_school_id: admission.schoolId,
        p_online_class_id: admission.roomId ?? null,
        p_schedule_entry_id: admission.scheduleEntryId ?? null,
        p_ad_hoc_meeting_id: admission.meetingId ?? null,
        p_auth_user_id: user.id,
        p_role: admission.role,
        p_display_name: displayName,
      });
      if (claimError || !Array.isArray(claimRows) || !claimRows[0]?.participant_id) {
        throw claimError || new Error("عضویت کلاس ثبت نشد.");
      }
      const participantId = clean(claimRows[0].participant_id);
      const generation = Number(claimRows[0].generation);
      let publisherSessionId = "";
      let subscriberSessionId = "";
      try {
        publisherSessionId = await createSfuSession(sfuEnv);
        subscriberSessionId = await createSfuSession(sfuEnv);
        const { data: activated, error: activateError } = await admin.from("classroom_sfu_participants")
          .update({
            publisher_session_id: publisherSessionId,
            subscriber_session_id: subscriberSessionId,
            status: "active",
            last_seen_at: new Date().toISOString(),
          })
          .eq("id", participantId).eq("generation", generation)
          .select("id").maybeSingle();
        if (activateError || !activated) throw activateError || new Error("نشست جایگزین شد؛ دوباره وارد کلاس شوید.");
      } catch (error) {
        await closeSfuSession(sfuEnv, publisherSessionId, []).catch(() => {});
        await closeSfuSession(sfuEnv, subscriberSessionId, []).catch(() => {});
        await admin.from("classroom_sfu_participants")
          .update({ status: "left", left_at: new Date().toISOString() })
          .eq("id", participantId).eq("generation", generation);
        throw error;
      }
      const snapshot = await getRoomSnapshot(admin, admission.roomKey, participantId);
      return reply({
        ok: true,
        room: admission.room,
        room_key: admission.roomKey,
        participant_id: participantId,
        generation,
        publisher_session_id: publisherSessionId,
        subscriber_session_id: subscriberSessionId,
        snapshot,
      });
    }

    const roomKey = clean(body.room_key);
    const generation = Number(body.generation);
    if (!roomKey || !Number.isInteger(generation) || generation < 1) {
      return reply({ ok: false, message: "شناسهٔ نشست کلاس معتبر نیست." }, 400);
    }
    const participant = await requireParticipant(admin, user.id, roomKey, generation);

    if (action === "snapshot") {
      await admin.from("classroom_sfu_participants")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("id", participant.id).eq("generation", generation);
      await pruneStaleParticipants(admin, sfuEnv, roomKey, participant.id);
      const snapshot = await getRoomSnapshot(admin, roomKey, participant.id);
      await pruneStaleSubscriptions(admin, sfuEnv, participant, snapshot);
      return reply({ ok: true, snapshot });
    }

    if (action === "publish") {
      const sessionDescription = body.sessionDescription;
      const requestedTracks = Array.isArray(body.tracks) ? body.tracks : [];
      const mutationId = clean(body.mutation_id);
      if (
        !sessionDescription || sessionDescription.type !== "offer"
        || typeof sessionDescription.sdp !== "string" || sessionDescription.sdp.length < 1
        || sessionDescription.sdp.length > 1_000_000
        || requestedTracks.length < 1 || requestedTracks.length > 2
        || !/^[A-Za-z0-9_-]{8,96}$/.test(mutationId)
      ) return reply({ ok: false, message: "اطلاعات انتشار صدا و تصویر معتبر نیست." }, 400);
      const tracks = requestedTracks.map((item: any) => ({
        kind: clean(item.kind),
        mid: clean(item.mid),
      }));
      if (
        tracks.some((item: any) => !["audio", "video"].includes(item.kind) || !item.mid)
        || new Set(tracks.map((item: any) => item.kind)).size !== tracks.length
      ) return reply({ ok: false, message: "مسیرهای صوت و تصویر معتبر نیستند." }, 400);

      await claimMutationLock(admin, participant.id, generation, "publisher", mutationId);
      let keepLock = false;
      try {
        let result: Record<string, any>;
        try {
          result = await sfuRequest(
            sfuEnv,
            "/sessions/" + encodeURIComponent(participant.publisher_session_id) + "/tracks/new",
            "POST",
            {
              sessionDescription,
              tracks: tracks.map((item: any) => ({
                location: "local",
                mid: item.mid,
                trackName: item.kind,
              })),
            },
          );
          keepLock = true;
        } catch (error) {
          if (!(error instanceof SafeSfuException) || error.safe.retryable) keepLock = true;
          throw error;
        }
        if (!result.sessionDescription) throw new SafeSfuException(502, { errorCode: "missing_sdp_answer" });
        const trackResults = Array.isArray(result.tracks) ? result.tracks : [];
        const failedMids = trackResults
          .filter((item: any) => item?.errorCode || item?.errorDescription)
          .map((item: any) => clean(item?.mid))
          .filter(Boolean);
        await closeSfuTracks(sfuEnv, participant.publisher_session_id, failedMids);
        const publications = trackResults.filter((item: any) =>
          !item?.errorCode && !item?.errorDescription && clean(item?.mid)
        ).map((item: any) => {
          const match = tracks.find((track: any) => track.kind === clean(item.trackName))
            ?? tracks[trackResults.indexOf(item)];
          return match ? { kind: match.kind, trackName: match.kind, mid: clean(item.mid) } : null;
        }).filter(Boolean);
        if (!publications.length) throw new SafeSfuException(502, { errorCode: "publish_failed" });
        const existingPublications = Array.isArray(participant.publications) ? participant.publications : [];
        const mergedPublications = [
          ...existingPublications.filter((item: any) => !publications.some((next: any) => next.kind === item?.kind)),
          ...publications,
        ];
        const { error: updateError } = await admin.from("classroom_sfu_participants")
          .update({ publications: mergedPublications, last_seen_at: new Date().toISOString() })
          .eq("id", participant.id).eq("generation", generation).eq("status", "active");
        if (updateError) throw updateError;
        return reply({
          ok: true,
          mutation_id: mutationId,
          sessionDescription: result.sessionDescription,
          tracks: publications,
          partial: publications.length !== tracks.length,
        });
      } finally {
        if (!keepLock) {
          await releaseMutationLock(admin, participant.id, generation, "publisher", mutationId).catch(() => {});
        }
      }
    }

    if (action === "complete_publish") {
      const mutationId = clean(body.mutation_id);
      if (!/^[A-Za-z0-9_-]{8,96}$/.test(mutationId)) {
        return reply({ ok: false, message: "شناسهٔ تکمیل انتشار رسانه معتبر نیست." }, 400);
      }
      const released = await releaseMutationLock(admin, participant.id, generation, "publisher", mutationId);
      if (!released) return reply({ ok: false, message: "نشست انتشار تغییر کرده است؛ برای ادامه دوباره وارد کلاس شوید." }, 409);
      return reply({ ok: true });
    }

    if (action === "subscribe") {
      const snapshot = await getRoomSnapshot(admin, roomKey, participant.id);
      const requestedKeys = new Set(
        (Array.isArray(body.track_keys) ? body.track_keys : [])
          .map((value: unknown) => clean(value))
          .filter(Boolean)
          .slice(0, 100),
      );
      if (!requestedKeys.size) {
        return reply({ ok: true, requiresImmediateRenegotiation: false, subscriptions: [] });
      }
      const publications = snapshot.participants.flatMap((item: any) =>
        item.publications.map((publication: any) => ({
          participantId: item.id,
          sessionId: publication.sessionId,
          trackName: publication.trackName,
          kind: publication.kind,
          key: item.id + ":" + publication.kind + ":" + publication.sessionId,
        }))
      ).filter((publication: any) => requestedKeys.has(publication.key));
      const requests = buildRemoteTrackRequests(publications, participant.id);
      if (!requests.length) {
        return reply({ ok: true, requiresImmediateRenegotiation: false, subscriptions: [] });
      }
      const mutationId = clean(body.mutation_id);
      if (!/^[A-Za-z0-9_-]{8,96}$/.test(mutationId)) {
        return reply({ ok: false, message: "شناسهٔ عملیات دریافت رسانه معتبر نیست." }, 400);
      }
      await claimMutationLock(admin, participant.id, generation, "subscriber", mutationId);
      let keepLock = false;
      try {
        let result: Record<string, any>;
        try {
          result = await sfuRequest(
            sfuEnv,
            "/sessions/" + encodeURIComponent(participant.subscriber_session_id) + "/tracks/new",
            "POST",
            { tracks: requests },
          );
          keepLock = result.requiresImmediateRenegotiation === true;
        } catch (error) {
          if (!(error instanceof SafeSfuException) || error.safe.retryable) keepLock = true;
          throw error;
        }
        const trackResults = Array.isArray(result.tracks) ? result.tracks : [];
        const failedMids = trackResults
          .filter((item: any) => item?.errorCode || item?.errorDescription)
          .map((item: any) => clean(item?.mid))
          .filter(Boolean);
        await closeSfuTracks(sfuEnv, participant.subscriber_session_id, failedMids);
        const subscriptions = trackResults.map((item: any, index: number) => ({ item, index }))
          .filter(({ item }: any) => !item?.errorCode && !item?.errorDescription && clean(item?.mid))
          .map(({ item, index }: any) => {
            const request = requests.find((candidate: any) =>
              candidate.sessionId === clean(item.sessionId) && candidate.trackName === clean(item.trackName)
            ) ?? requests[index];
            const publication = publications.find((candidate: any) =>
              candidate.sessionId === request?.sessionId && candidate.trackName === request?.trackName
            );
            return publication ? {
              mid: clean(item.mid),
              participantId: publication.participantId,
              kind: publication.kind,
              trackName: publication.trackName,
              key: publication.key,
            } : null;
          }).filter(Boolean);
        if (keepLock && !result.sessionDescription) {
          throw new SafeSfuException(502, { errorCode: "missing_sdp_offer" });
        }
        if (subscriptions.length) {
          const existingSubscriptions = Array.isArray(participant.subscriptions) ? participant.subscriptions : [];
          const mergedSubscriptions = [
            ...existingSubscriptions.filter((item: any) =>
              !subscriptions.some((next: any) => next.key === item?.key)
            ),
            ...subscriptions,
          ];
          const { error: updateError } = await admin.from("classroom_sfu_participants")
            .update({ subscriptions: mergedSubscriptions, last_seen_at: new Date().toISOString() })
            .eq("id", participant.id).eq("generation", generation).eq("status", "active");
          if (updateError) {
            await closeSfuSession(sfuEnv, participant.subscriber_session_id, trackResults);
            throw updateError;
          }
        }
        return reply({
          ok: true,
          mutation_id: mutationId,
          requiresImmediateRenegotiation: result.requiresImmediateRenegotiation === true,
          ...(result.sessionDescription ? { sessionDescription: result.sessionDescription } : {}),
          subscriptions,
          partial: subscriptions.length !== requests.length,
        });
      } finally {
        if (!keepLock) {
          await releaseMutationLock(admin, participant.id, generation, "subscriber", mutationId).catch(() => {});
        }
      }
    }

    if (action === "renegotiate") {
      const sessionDescription = body.sessionDescription;
      const mutationId = clean(body.mutation_id);
      if (
        !sessionDescription || sessionDescription.type !== "answer"
        || typeof sessionDescription.sdp !== "string" || sessionDescription.sdp.length < 1
        || sessionDescription.sdp.length > 1_000_000
        || !/^[A-Za-z0-9_-]{8,96}$/.test(mutationId)
      ) return reply({ ok: false, message: "پاسخ مذاکرهٔ رسانه معتبر نیست." }, 400);
      if (
        clean(participant.subscriber_mutation_id) !== mutationId
        || !mutationLockIsActive(participant.subscriber_mutation_id, participant.subscriber_mutation_started_at)
      ) return reply({ ok: false, message: "نشست دریافت رسانه منقضی شده است؛ دوباره وارد کلاس شوید." }, 409);
      await sfuRequest(
        sfuEnv,
        "/sessions/" + encodeURIComponent(participant.subscriber_session_id) + "/renegotiate",
        "PUT",
        { sessionDescription },
      );
      const released = await releaseMutationLock(admin, participant.id, generation, "subscriber", mutationId);
      if (!released) return reply({ ok: false, message: "نسل نشست رسانه تغییر کرده است؛ دوباره وارد کلاس شوید." }, 409);
      return reply({ ok: true });
    }

    if (action === "leave") {
      if (
        mutationLockIsActive(participant.publisher_mutation_id, participant.publisher_mutation_started_at)
        || mutationLockIsActive(participant.subscriber_mutation_id, participant.subscriber_mutation_started_at)
      ) return reply({ ok: false, message: "عملیات رسانه هنوز در حال تکمیل است؛ چند لحظه صبر کنید و دوباره خروج را بزنید." }, 409);
      await closeSfuSession(sfuEnv, participant.publisher_session_id, participant.publications);
      await closeSfuSession(sfuEnv, participant.subscriber_session_id, participant.subscriptions);
      const { error: leaveError } = await admin.from("classroom_sfu_participants")
        .update({
          status: "left",
          publications: [],
          subscriptions: [],
          publisher_mutation_id: null,
          publisher_mutation_started_at: null,
          subscriber_mutation_id: null,
          subscriber_mutation_started_at: null,
          left_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
        })
        .eq("id", participant.id).eq("generation", generation);
      if (leaveError) throw leaveError;
      return reply({ ok: true });
    }

    return reply({ ok: false, message: "عملیات کلاس پشتیبانی نمی‌شود." }, 400);
  } catch (error) {
    if (error instanceof SafeSfuException) {
      console.error("classroom-sfu provider failure", error.safe.code);
      return reply({ ok: false, code: error.safe.code, retryable: error.safe.retryable, message: error.safe.message }, error.status);
    }
    const status = Number((error as any)?.status) || 500;
    const message = status >= 500
      ? "عملیات کلاس انجام نشد؛ وضعیت اتصال و مجوزها را بررسی کنید."
      : clean((error as any)?.message) || "درخواست کلاس معتبر نیست.";
    console.error("classroom-sfu request failed", status, clean((error as any)?.message).slice(0, 100));
    return reply({ ok: false, message }, status);
  }
});
