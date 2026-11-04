const clean = (value: unknown) => String(value ?? "").replace(/[\u200c\u200f\u202a-\u202e]/g, "").trim();
const digits = (value: string) => value
  .replace(/[۰-۹]/g, d => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
  .replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));

export function getTehranClock(now: Date = new Date()): { weekday: string; time: string } {
  return {
    weekday: clean(new Intl.DateTimeFormat("fa-IR", {
      timeZone: "Asia/Tehran",
      weekday: "long",
    }).format(now)),
    time: new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Tehran",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(now),
  };
}

function minutes(value: unknown): number | null {
  const normalized = digits(clean(value));
  const match = normalized.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;
  const hour = Number(match[1]), minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

export function isScheduleSlotActive(
  weekday: unknown,
  startTime: unknown,
  endTime: unknown,
  clock: { weekday: string; time: string } = getTehranClock(),
): boolean {
  if (clean(weekday) !== clean(clock.weekday)) return false;
  const start = minutes(startTime), end = minutes(endTime), current = minutes(clock.time);
  if (start === null || end === null || current === null || end <= start) return false;
  return current >= start && current < end;
}
