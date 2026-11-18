import { generateWeeklyTimetable, validateWeeklyTimetable, type Slot } from "../supabase/functions/weekly-timetable-planner/validation.ts";

const makeSlot = (class_name: string, weekday: string, period: number, even: any, odd: any): Slot =>
  ({ class_name, weekday, period, even, odd });
const science = { subject: "علوم", teacher_id: 11, teacher_name: "دبیر علوم" };
const studies = { subject: "مطالعات", teacher_id: 12, teacher_name: "دبیر مطالعات" };

Deno.test("supports swapping two subjects between even and odd weeks in the same day", () => {
  const result = validateWeeklyTimetable({
    slots: [
      makeSlot("هفتم الف", "سه‌شنبه", 1, science, studies),
      makeSlot("هفتم الف", "سه‌شنبه", 2, studies, science),
    ],
    requirements: [
      { class_name: "هفتم الف", subject: "علوم", teacher_id: 11, teacher_name: "دبیر علوم", weekly_periods: 1 },
      { class_name: "هفتم الف", subject: "مطالعات", teacher_id: 12, teacher_name: "دبیر مطالعات", weekly_periods: 1 },
    ],
    teacher_workdays: [
      { teacher_id: 11, teacher_name: "دبیر علوم", weekdays: ["سه‌شنبه"] },
      { teacher_id: 12, teacher_name: "دبیر مطالعات", weekdays: ["سه‌شنبه"] },
    ],
  });
  if (!result.valid) throw new Error(result.errors.join("\n"));
});

Deno.test("detects a teacher assigned to two classes in the same even-week period", () => {
  const result = validateWeeklyTimetable({
    slots: [
      makeSlot("هفتم الف", "شنبه", 1, science, science),
      makeSlot("هفتم ب", "شنبه", 1, science, science),
    ],
    requirements: [],
    teacher_workdays: [{ teacher_id: 11, teacher_name: "دبیر علوم", weekdays: ["شنبه"] }],
  });
  if (!result.errors.some(error => error.includes("تداخل دبیر") && error.includes("زوج"))) throw new Error("Expected an even-week teacher conflict.");
});

Deno.test("checks teacher workdays independently for each assignment", () => {
  const result = validateWeeklyTimetable({
    slots: [makeSlot("هفتم الف", "دوشنبه", 1, science, null)],
    requirements: [],
    teacher_workdays: [{ teacher_id: 11, teacher_name: "دبیر علوم", weekdays: ["شنبه"] }],
  });
  if (!result.errors.some(error => error.includes("روز کاری ندارد"))) throw new Error("Expected a non-working-day error.");
});

Deno.test("validates required lesson counts for both week patterns", () => {
  const result = validateWeeklyTimetable({
    slots: [makeSlot("هفتم الف", "شنبه", 1, science, null)],
    requirements: [{ class_name: "هفتم الف", subject: "علوم", teacher_id: 11, teacher_name: "دبیر علوم", weekly_periods: 1 }],
    teacher_workdays: [{ teacher_id: 11, teacher_name: "دبیر علوم", weekdays: ["شنبه"] }],
  });
  if (!result.errors.some(error => error.includes("هفته فرد"))) throw new Error("Expected odd-week count validation.");
});

Deno.test("automatic suggestion spreads lessons across workdays and preserves weekly counts", () => {
  const generated = generateWeeklyTimetable({
    requirements: [
      { class_name: "هفتم الف", subject: "علوم", teacher_id: 11, teacher_name: "دبیر علوم", weekly_periods: 2 },
      { class_name: "هفتم الف", subject: "مطالعات", teacher_id: 12, teacher_name: "دبیر مطالعات", weekly_periods: 2 },
    ],
    teacher_workdays: [
      { teacher_id: 11, teacher_name: "دبیر علوم", weekdays: ["شنبه", "دوشنبه", "چهارشنبه"] },
      { teacher_id: 12, teacher_name: "دبیر مطالعات", weekdays: ["شنبه", "دوشنبه", "چهارشنبه"] },
    ],
  });
  if (generated.errors.length) throw new Error(generated.errors.join("\\n"));
  const check = validateWeeklyTimetable({
    slots: generated.slots,
    requirements: [
      { class_name: "هفتم الف", subject: "علوم", teacher_id: 11, teacher_name: "دبیر علوم", weekly_periods: 2 },
      { class_name: "هفتم الف", subject: "مطالعات", teacher_id: 12, teacher_name: "دبیر مطالعات", weekly_periods: 2 },
    ],
    teacher_workdays: [
      { teacher_id: 11, teacher_name: "دبیر علوم", weekdays: ["شنبه", "دوشنبه", "چهارشنبه"] },
      { teacher_id: 12, teacher_name: "دبیر مطالعات", weekdays: ["شنبه", "دوشنبه", "چهارشنبه"] },
    ],
  });
  if (!check.valid) throw new Error(check.errors.join("\\n"));
});
