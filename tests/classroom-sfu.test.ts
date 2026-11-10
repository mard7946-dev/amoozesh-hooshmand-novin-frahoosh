import {
  buildRemoteTrackRequests,
  buildSfuRoomKey,
  getSafeSfuError,
  normalizeSfuRole,
} from "../supabase/functions/_shared/classroom-sfu.ts";

Deno.test("normalizes Persian and English school roles", () => {
  if (normalizeSfuRole("دبیر") !== "teacher") throw new Error("دبیر باید teacher شود");
  if (normalizeSfuRole("معاون آموزشی") !== "deputy") throw new Error("معاون باید deputy شود");
  if (normalizeSfuRole("دانش‌آموز") !== "student") throw new Error("دانش‌آموز باید student شود");
  if (normalizeSfuRole("manager") !== "manager") throw new Error("manager باید حفظ شود");
});

Deno.test("builds unique remote track requests and excludes the current participant", () => {
  const result = buildRemoteTrackRequests([
    { participantId: "self", sessionId: "s-self", trackName: "audio", kind: "audio" },
    { participantId: "other", sessionId: "s-other", trackName: "audio", kind: "audio" },
    { participantId: "other", sessionId: "s-other", trackName: "video", kind: "video" },
    { participantId: "other", sessionId: "s-other", trackName: "audio", kind: "audio" },
    { participantId: "broken", sessionId: "", trackName: "audio", kind: "audio" },
    { participantId: "broken", sessionId: "s-broken", trackName: "screen", kind: "screen" },
  ], "self");
  if (result.length !== 2) throw new Error("فقط دو track معتبر و یکتا باید باقی بماند");
  if (result[0].sessionId !== "s-other" || result[0].trackName !== "audio") {
    throw new Error("ترتیب و مشخصات track صوتی معتبر نیست");
  }
  if (result[1].trackName !== "video") throw new Error("track تصویری معتبر پیدا نشد");
});

Deno.test("sanitizes Cloudflare errors and classifies retryable statuses", () => {
  const retryable = getSafeSfuError(503, {
    errorCode: "upstream_unavailable",
    errorDescription: "private provider detail must not be returned",
  });
  if (!retryable.retryable) throw new Error("خطای 503 باید قابل تلاش مجدد باشد");
  if (retryable.message.includes("private provider detail")) throw new Error("جزئیات ارائه‌دهنده نباید افشا شود");

  const invalid = getSafeSfuError(400, {
    errorCode: "invalid_params",
    errorDescription: "private provider detail must not be returned",
  });
  if (invalid.retryable) throw new Error("خطای 400 نباید قابل تلاش مجدد تلقی شود");
  if (!invalid.message || invalid.message.includes("private provider detail")) {
    throw new Error("پیام امن خطای 400 تولید نشد");
  }
});

Deno.test("builds school-scoped keys for scheduled classes and ad-hoc meetings", () => {
  const scheduled = buildSfuRoomKey({
    schoolId: "school-123",
    onlineClassId: 17,
    scheduleEntryId: 42,
  });
  if (scheduled !== "school:school-123:class:17:42") {
    throw new Error("کلید کلاس باید مدرسه و زنگ را در بر بگیرد");
  }
  const meeting = buildSfuRoomKey({
    schoolId: "school-123",
    meetingId: "meeting-456",
  });
  if (meeting !== "school:school-123:meeting:meeting-456") {
    throw new Error("کلید جلسه باید مدرسه و شناسه جلسه را در بر بگیرد");
  }
});

Deno.test("rejects ambiguous or incomplete SFU room identity", () => {
  let rejected = false;
  try {
    buildSfuRoomKey({ schoolId: "", onlineClassId: 1, scheduleEntryId: 2 });
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("شناسه مدرسه خالی باید رد شود");

  rejected = false;
  try {
    buildSfuRoomKey({
      schoolId: "school-123",
      onlineClassId: 1,
      scheduleEntryId: 2,
      meetingId: "meeting-456",
    });
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("ترکیب هم‌زمان کلاس و جلسه باید رد شود");

  rejected = false;
  try {
    buildSfuRoomKey({
      schoolId: "school-123",
      onlineClassId: 1,
      meetingId: "meeting-456",
    });
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("شناسه ناقص کلاس همراه با جلسه باید رد شود");
});
