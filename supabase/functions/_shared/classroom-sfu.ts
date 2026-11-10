export type SfuTrackKind = "audio" | "video";

export type SfuPublicationInput = {
  participantId: string;
  sessionId: string;
  trackName: string;
  kind: SfuTrackKind | string;
};

export type SfuRemoteTrackRequest = {
  location: "remote";
  sessionId: string;
  trackName: string;
};

const clean = (value: unknown): string => String(value ?? "").trim();

const normalizePersian = (value: unknown): string => clean(value)
  .toLocaleLowerCase("fa")
  .replace(/[يى]/g, "ی")
  .replace(/ك/g, "ک")
  .replace(/[\u200c\u200f\u202a-\u202e]/g, "")
  .replace(/\s+/g, "");

export function normalizeSfuRole(value: unknown): string {
  const role = normalizePersian(value);
  if (role === "manager" || role.includes("مدیر")) return "manager";
  if (role === "teacher" || role.includes("دبیر") || role.includes("معلم")) return "teacher";
  if (role === "student" || role.includes("دانشآموز")) return "student";
  if (role === "parent" || role.includes("ولی") || role.includes("والد")) return "parent";
  if (role === "counselor" || role.includes("مشاور")) return "counselor";
  if (
    role === "deputy" || role.includes("معاون") || role.endsWith("_deputy")
    || ["educational", "executive", "cultural", "advisor"].includes(role)
  ) return "deputy";
  return role;
}

export function buildRemoteTrackRequests(
  publications: readonly SfuPublicationInput[],
  excludedParticipantId: string,
): SfuRemoteTrackRequest[] {
  const excluded = clean(excludedParticipantId);
  const seen = new Set<string>();
  const result: SfuRemoteTrackRequest[] = [];

  for (const publication of publications) {
    const participantId = clean(publication?.participantId);
    const sessionId = clean(publication?.sessionId);
    const trackName = clean(publication?.trackName);
    const kind = clean(publication?.kind);
    if (!participantId || participantId === excluded || !sessionId) continue;
    if (kind !== "audio" && kind !== "video") continue;
    if (trackName !== kind) continue;

    const key = sessionId + "\u0000" + trackName;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ location: "remote", sessionId, trackName });
  }

  return result;
}

export function getSafeSfuError(
  status: number,
  body: unknown,
): { code: string; retryable: boolean; message: string } {
  const source = body && typeof body === "object"
    ? body as Record<string, unknown>
    : {};
  const rawCode = clean(source.errorCode);
  const safeCode = /^[a-z0-9_]{1,64}$/i.test(rawCode)
    ? rawCode
    : "http_" + String(status);

  const retryable = status === 408 || status === 425 || status === 429 || status >= 500;
  let message = "ارتباط با سرویس رسانه انجام نشد.";
  if (status === 401 || status === 403 || safeCode === "unauthorized") {
    message = "اعتبار سرویس رسانه تأیید نشد؛ تنظیمات امن سرور باید بررسی شود.";
  } else if (status === 404 || safeCode === "not_found") {
    message = "برنامه یا نشست رسانه پیدا نشد؛ وضعیت اتصال باید دوباره بررسی شود.";
  } else if (status === 429) {
    message = "تعداد درخواست‌ها زیاد است؛ چند لحظه بعد دوباره تلاش کنید.";
  } else if (status >= 500 || status === 408 || status === 425) {
    message = "سرویس رسانه موقتاً پاسخ‌گو نیست؛ اتصال را دوباره امتحان کنید.";
  } else if (status >= 400) {
    message = "درخواست اتصال رسانه معتبر نبود؛ اطلاعات نشست را دوباره بررسی کنید.";
  }

  return { code: safeCode, retryable, message };
}

export function buildSfuRoomKey(input: {
  schoolId: string;
  onlineClassId?: number | null;
  scheduleEntryId?: number | null;
  meetingId?: string | null;
}): string {
  const schoolId = clean(input.schoolId);
  if (!schoolId || schoolId.length > 100) {
    throw new Error("A valid school identifier is required.");
  }
  const hasAnyClassField = input.onlineClassId !== undefined && input.onlineClassId !== null
    || input.scheduleEntryId !== undefined && input.scheduleEntryId !== null;
  const hasClass = Number.isInteger(input.onlineClassId) && Number(input.onlineClassId) > 0
    && Number.isInteger(input.scheduleEntryId) && Number(input.scheduleEntryId) > 0;
  const hasMeeting = Boolean(clean(input.meetingId));
  if ((hasAnyClassField && !hasClass) || hasClass === hasMeeting) {
    throw new Error("Provide exactly one valid class slot or meeting identifier.");
  }
  const key = hasClass
    ? "school:" + schoolId + ":class:" + input.onlineClassId + ":" + input.scheduleEntryId
    : "school:" + schoolId + ":meeting:" + clean(input.meetingId);
  if (key.length > 180) throw new Error("Room identifier is too long.");
  return key;
}

export function buildSfuDisplayName(
  role: unknown,
  userId: unknown,
  displayName: unknown,
  username: unknown,
): string {
  if (normalizeSfuRole(role) === "student") {
    const suffix = clean(userId).replace(/[^a-z0-9]/gi, "").slice(-4) || "عضو";
    return "دانش‌آموز-" + suffix;
  }
  return clean(displayName) || clean(username) || "کاربر فراهوش";
}
