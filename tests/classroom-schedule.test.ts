import { getTehranClock, isScheduleSlotActive } from "../supabase/functions/_shared/classroom-schedule.ts";

Deno.test("schedule slot is active at its start boundary", () => {
  if (!isScheduleSlotActive("چهارشنبه", "08:00", "08:45", { weekday: "چهارشنبه", time: "08:00" })) throw new Error("Start boundary should be active");
});
Deno.test("schedule slot is inactive at its end boundary", () => {
  if (isScheduleSlotActive("چهارشنبه", "08:00", "08:45", { weekday: "چهارشنبه", time: "08:45" })) throw new Error("End boundary should be inactive");
});
Deno.test("schedule slot is inactive on a different weekday", () => {
  if (isScheduleSlotActive("چهارشنبه", "08:00", "08:45", { weekday: "پنجشنبه", time: "08:15" })) throw new Error("Wrong weekday must be inactive");
});
Deno.test("supports Persian digits in schedule times", () => {
  if (!isScheduleSlotActive("شنبه", "۰۸:۰۰", "۰۸:۴۵", { weekday: "شنبه", time: "08:20" })) throw new Error("Persian time digits should be normalized");
});
Deno.test("Tehran clock returns a Persian weekday and HH:mm time", () => {
  const clock = getTehranClock(new Date("2026-11-04T04:30:00.000Z"));
  if (!["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"].includes(clock.weekday)) throw new Error("Unexpected Tehran weekday");
  if (!/^\d{2}:\d{2}$/.test(clock.time)) throw new Error("Unexpected Tehran time");
});
