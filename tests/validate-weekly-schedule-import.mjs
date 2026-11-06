import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync("classroom/weekly-schedule-import.js", "utf8");
const sandbox = {};
vm.runInNewContext(source, sandbox);
const parse = sandbox.frahooshParseWeeklyScheduleMatrix;
assert.equal(typeof parse, "function", "weekly schedule matrix parser must be exposed");

const matrix = [
  ["برنامه هفتگی — سال تحصیلی ۱۴۰۶-۱۴۰۵"],
  ["کلاس / روز", "شنبه", "", "", "یکشنبه", "", ""],
  ["", "زنگ ۱", "زنگ ۲", "زنگ ۳", "زنگ ۱", "زنگ ۲", "زنگ ۳"],
  ["۷/۱", "زبان\nفهیم راد", "قرآن\nقاسمی", "علوم — ایازیان\nمطالعات — کریمی", "ریاضی\nبهمنی", "", ""],
  ["۸/۲", "دینی\nموسوی", "", "", "", "هنر — صفی", "تفکر — کلهر"]
];
const result = parse(matrix);
assert.ok(result, "class-by-weekday workbook should be recognized");
assert.equal(result.class_count, 2);
assert.equal(result.rows.length, 7, "each lesson line should become an independent timetable row");
assert.equal(result.skipped.length, 0);
assert.equal(result.rows[0].weekday, "شنبه");
assert.equal(result.rows[0].period, 1);
assert.equal(result.rows[0].class_name, "۷/۱");
assert.equal(result.rows[0].grade, "هفتم");
assert.equal(result.rows[0].academic_year, "1406-1405");
assert.deepEqual(
  result.rows.filter(row => row.class_name === "۷/۱" && row.period === 3).map(row => [row.subject, row.teacher]),
  [["علوم", "ایازیان"], ["مطالعات", "کریمی"]],
  "parallel lessons in one cell must be split into separate rows"
);
assert.equal(result.rows.find(row => row.teacher === "کلهر").weekday, "یکشنبه");
assert.equal(result.rows.find(row => row.teacher === "کلهر").period, 3);

const management = readFileSync("classroom/management.html", "utf8");
assert.ok(management.includes('id="managerClassAdmin"'), "class creation and class-level schedule tools must be grouped as manager controls");
assert.ok(management.includes("$('managerClassAdmin').hidden=role==='teacher'"), "teacher must not see class creation, class listing administration, or per-class schedule selector");
assert.ok(management.includes("$('teacherSchedulePanel').hidden=role!=='teacher'"), "daily/weekly schedule view must be reserved for teacher role");
assert.ok(management.includes("window.frahooshParseWeeklyScheduleMatrix?.(matrix)"), "Excel upload must detect the wide-format schedule workbook");
assert.ok(management.includes("for(const sheetName of wb.SheetNames)"), "Excel upload must search all sheets, including when the first sheet is only instructions");
for (const match of management.matchAll(/<script(?:\\s[^>]*)?>([\\s\\S]*?)<\\/script>/gi)) {
  if (match[1].trim()) assert.doesNotThrow(() => new Function(match[1]), "classroom management inline script must be syntactically valid");
}

console.log("Weekly schedule matrix import and teacher-view checks passed.");
