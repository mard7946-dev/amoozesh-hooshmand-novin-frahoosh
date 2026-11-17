export const WEEKDAYS = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه"] as const;
export type WeekType = "even" | "odd";
export type Assignment = { subject: string; teacher_id: number | null; teacher_name: string };
export type Slot = { class_name: string; weekday: string; period: number; even: Assignment | null; odd: Assignment | null };
export type Requirement = { class_name: string; subject: string; teacher_id: number; teacher_name: string; weekly_periods: number };
export type TeacherWorkdays = { teacher_id: number; teacher_name: string; weekdays: string[] };

const clean = (v: unknown) => String(v ?? "").replace(/[\u200c\u200f\u202a-\u202e]/g, "").trim();
const key = (v: unknown) => clean(v).replace(/\s+/g, "").toLocaleLowerCase("fa");

export function validateWeeklyTimetable(input: {
  slots: Slot[];
  requirements: Requirement[];
  teacher_workdays: TeacherWorkdays[];
}) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seenCells = new Set<string>();
  const assignmentsByWeek: Record<WeekType, Map<string, string>> = {
    even: new Map(), odd: new Map(),
  };
  const counts: Record<WeekType, Map<string, number>> = {
    even: new Map(), odd: new Map(),
  };
  const classPeriods = new Map<string, Set<string>>();
  const workdays = new Map<number, Set<string>>();
  for (const row of input.teacher_workdays ?? []) {
    const id = Number(row.teacher_id);
    if (!Number.isInteger(id) || id <= 0) { errors.push("شناسه دبیر در روزهای کاری معتبر نیست."); continue; }
    const days = new Set((row.weekdays ?? []).map(key));
    if ([...days].some(day => !WEEKDAYS.some(valid => key(valid) === day))) errors.push(`روز کاری نامعتبر برای دبیر ${clean(row.teacher_name)}.`);
    workdays.set(id, days);
  }
  const requirements = new Map<string, Requirement>();
  for (const row of input.requirements ?? []) {
    const className = clean(row.class_name), subject = clean(row.subject), teacherId = Number(row.teacher_id);
    const required = Number(row.weekly_periods);
    if (!className || !subject || !Number.isInteger(teacherId) || teacherId <= 0 || !Number.isInteger(required) || required < 1 || required > 15) {
      errors.push("یکی از نیازهای هفتگی درس، کلاس، دبیر یا تعداد زنگ معتبر نیست."); continue;
    }
    const k = [key(className), key(subject), teacherId].join("|");
    if (requirements.has(k)) errors.push(`نیاز تکراری برای ${className} / ${subject} ثبت شده است.`);
    requirements.set(k, row);
  }
  for (const slot of input.slots ?? []) {
    const className = clean(slot.class_name), weekday = clean(slot.weekday), period = Number(slot.period);
    if (!className || !WEEKDAYS.some(day => key(day) === key(weekday)) || !Number.isInteger(period) || period < 1 || period > 3) {
      errors.push("هر خانه باید کلاس، یکی از روزهای شنبه تا چهارشنبه و زنگ ۱ تا ۳ معتبر داشته باشد."); continue;
    }
    const cellKey = [key(className), key(weekday), period].join("|");
    if (seenCells.has(cellKey)) errors.push(`خانه تکراری در برنامه کلاس ${className}، ${weekday}، زنگ ${period}.`);
    seenCells.add(cellKey);
    const classKey = key(className);
    if (!classPeriods.has(classKey)) classPeriods.set(classKey, new Set());
    classPeriods.get(classKey)!.add(cellKey);
    for (const week of ["even", "odd"] as const) {
      const assignment = slot[week];
      if (!assignment) continue;
      const subject = clean(assignment.subject), teacherId = Number(assignment.teacher_id);
      if (!subject || !Number.isInteger(teacherId) || teacherId <= 0) {
        errors.push(`تخصیص ناقص در ${className}، ${weekday}، زنگ ${period}، هفته ${week === "even" ? "زوج" : "فرد"}.`);
        continue;
      }
      const teacherDayKey = [teacherId, key(weekday)].join("|");
      const available = workdays.get(teacherId);
      if (available && !available.has(key(weekday))) {
        errors.push(`دبیر ${clean(assignment.teacher_name)} در روز ${weekday} روز کاری ندارد.`);
      } else if (!available) {
        warnings.push(`روزهای کاری دبیر ${clean(assignment.teacher_name)} هنوز ثبت نشده است.`);
      }
      const conflictKey = [teacherId, key(weekday), period].join("|");
      const existing = assignmentsByWeek[week].get(conflictKey);
      if (existing) errors.push(`تداخل دبیر ${clean(assignment.teacher_name)} در هفته ${week === "even" ? "زوج" : "فرد"}، ${weekday}، زنگ ${period}: ${existing} و ${className}.`);
      else assignmentsByWeek[week].set(conflictKey, className);
      const countKey = [key(className), key(subject), teacherId].join("|");
      counts[week].set(countKey, (counts[week].get(countKey) ?? 0) + 1);
      if (!requirements.has(countKey)) warnings.push(`نیاز تعداد زنگ برای ${className} / ${subject} / ${clean(assignment.teacher_name)} تعریف نشده است.`);
    }
  }
  for (const [className, cells] of classPeriods) {
    if (cells.size > 15) errors.push(`ظرفیت ۱۵ زنگ هفتگی کلاس ${className} رعایت نشده است.`);
  }
  for (const [k, requirement] of requirements) {
    for (const week of ["even", "odd"] as const) {
      const actual = counts[week].get(k) ?? 0;
      if (actual !== Number(requirement.weekly_periods)) {
        errors.push(`تعداد زنگ ${requirement.class_name} / ${requirement.subject} در هفته ${week === "even" ? "زوج" : "فرد"}: نیاز ${requirement.weekly_periods}، ثبت‌شده ${actual}.`);
      }
    }
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}
