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
console.log("Weekly schedule matrix import checks passed.");
