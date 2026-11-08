export function timeToMinutes(value: unknown): number {
  const match = /^(\\d{1,2}):(\\d{2})/.exec(String(value ?? "").trim());
  if (!match) return -1;
  const hour = Number(match[1]), minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? hour * 60 + minute : -1;
}

export function bellPosition(value: unknown, bellStart: number, bellEnd: number): number | null {
  const minute = timeToMinutes(value);
  if (bellStart < 0 || bellEnd <= bellStart || minute < bellStart || minute >= bellEnd) return null;
  return (minute - bellStart) / (bellEnd - bellStart);
}

export function sessionCheckpointMinutes(
  sessionStart: unknown,
  sessionEnd: unknown,
  firstPosition: number,
  secondPosition: number,
): [number, number] | null {
  const start = timeToMinutes(sessionStart), end = timeToMinutes(sessionEnd);
  if (start < 0 || end <= start || !Number.isFinite(firstPosition) || !Number.isFinite(secondPosition) ||
      firstPosition < 0 || firstPosition >= 1 || secondPosition < 0 || secondPosition >= 1 ||
      firstPosition === secondPosition) return null;
  return [
    Math.round(start + (end - start) * firstPosition),
    Math.round(start + (end - start) * secondPosition),
  ];
}

export function formatMinutes(value: number): string {
  const normalized = Math.max(0, Math.min(1439, Math.round(value)));
  return String(Math.floor(normalized / 60)).padStart(2, "0") + ":" + String(normalized % 60).padStart(2, "0");
}
