import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const classroomApi = readFileSync("supabase/functions/classroom-management/index.ts", "utf8");
const parentApi = readFileSync("supabase/functions/parent-management/index.ts", "utf8");
const studentPage = readFileSync("student-module.html", "utf8");
const parentPage = readFileSync("parent-management.html", "utf8");

const gradeInsertStart = classroomApi.indexOf('if (action === "grades")');
const gradeInsertEnd = classroomApi.indexOf('if (action === "create_assignment")', gradeInsertStart);
assert.ok(gradeInsertStart >= 0 && gradeInsertEnd > gradeInsertStart, "Teacher grade insertion action must exist");
const gradeInsert = classroomApi.slice(gradeInsertStart, gradeInsertEnd);
assert.match(gradeInsert, /manager_released:\s*1/, "New teacher-entered grades must be visible immediately");
assert.doesNotMatch(gradeInsert, /manager_released:\s*0/, "New teacher-entered grades must not wait for manual manager release");

const studentSummaryStart = classroomApi.indexOf('if (action === "student_academic_summary")');
assert.ok(studentSummaryStart >= 0, "Student academic summary action must exist");
assert.match(classroomApi.slice(studentSummaryStart), /\.eq\("manager_released",1\)/, "Student endpoint must retain a server-side visibility filter");

assert.match(parentApi, /\.eq\("manager_released",1\)/, "Parent endpoint must retain a server-side visibility filter");
assert.match(studentPage, /نمره‌های ثبت‌شده/, "Student page must describe grades as recorded, not manager-published");
assert.match(parentPage, /نمره‌های ثبت‌شده توسط دبیر بلافاصله برای ولی قابل مشاهده هستند/, "Parent page must explain immediate visibility");

const reviewStart = classroomApi.indexOf('if (action === "academic_review_list")');
const reviewEnd = classroomApi.indexOf('if (action === "academic_review")', reviewStart);
assert.ok(reviewStart >= 0 && reviewEnd > reviewStart, "Academic review queue must exist");
assert.match(classroomApi.slice(reviewStart, reviewEnd), /manager_released\.eq\.0,manager_released\.is\.null/, "The management review queue must not treat immediately released grades as pending");

for (const [name, source] of [["student module", studentPage], ["parent module", parentPage]]) {
  const scripts = [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m => m[1]).filter(Boolean);
  for (const script of scripts) assert.doesNotThrow(() => new Function(script), name + " inline JavaScript must parse");
}

console.log("Grade visibility checks passed: immediate release, student/parent server-side filtering, and management review separation.");
