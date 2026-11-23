import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const classroom = readFileSync("supabase/functions/classroom-management/index.ts", "utf8");
const parentApi = readFileSync("supabase/functions/parent-management/index.ts", "utf8");
const studentPage = readFileSync("student-module.html", "utf8");
const parentPage = readFileSync("parent-management.html", "utf8");

function inlineScripts(html) {
  return [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(match => match[1])
    .filter(script => script.trim());
}
for (const [name, html] of [["student", studentPage], ["parent", parentPage]]) {
  for (const [index, script] of inlineScripts(html).entries()) {
    assert.doesNotThrow(() => new Function(script), name + " inline script " + index + " parses");
  }
}

assert.ok(classroom.includes("membershipRoles.has(norm(value))"), "student access requires active school membership");
const studentSummary = classroom.slice(
  classroom.indexOf('if (action === "student_academic_summary") {'),
  classroom.indexOf('if (action === "discipline_review") {')
);
assert.ok(studentSummary.includes('from("attendance")'), "student attendance is loaded");
assert.ok(studentSummary.includes('from("discipline_records")'), "student discipline and praise records are loaded");
assert.ok(studentSummary.includes('from("assignments")'), "class and student assignments are loaded");
assert.ok(studentSummary.includes('from("assignment_submissions")'), "student submission status is loaded");
assert.ok(studentSummary.includes("manager_released"), "grade release state is returned");
assert.ok(studentSummary.includes('from("school_report_cards")'), "student midterm report cards are loaded");
assert.ok(studentSummary.includes('.eq("school_id", school).eq("student_id", student.id)'), "student report cards are restricted to the authenticated student's school and id");
assert.ok(studentSummary.includes("report_cards:"), "student API returns midterm report cards");
assert.ok(!studentSummary.includes('.eq("manager_released", 1)'), "unreleased grades are not hidden from the student");
assert.ok(studentSummary.includes('eq("tenant_school_id", school)'), "student queries are school-scoped");
assert.ok(studentSummary.includes('eq("student_id", student.id)'), "student-specific queries are ownership-scoped");

const parentDisciplineLine = parentApi.split("\n").find(line => line.includes('from("discipline_records")'));
const parentGradeLine = parentApi.split("\n").find(line => line.includes('from("student_grades")'));
const parentAttendanceLine = parentApi.split("\n").find(line => line.includes('from("attendance")'));
assert.ok(parentDisciplineLine && !parentDisciplineLine.includes('.eq("status","approved")'), "pending family-visible discipline records are included");
assert.ok(parentGradeLine && !parentGradeLine.includes('.eq("manager_released",1)'), "unreleased family-visible grades are included");
assert.ok(parentApi.includes('from("school_report_cards")'), "parent API loads saved midterm report cards");
assert.ok(parentApi.includes('.eq("school_id",school).in("student_id",studentIds)'), "parent report cards are restricted to linked children in the current school");
assert.ok(parentApi.includes("reportCards:reportCards.data??[]"), "parent API returns linked midterm report cards");
assert.ok(parentAttendanceLine && !parentAttendanceLine.includes('.eq("approval_status","approved")'), "pending attendance records are included");
assert.ok(parentApi.includes("assignmentSubmissions:assignmentSubmissions.data??[]"), "parent API returns child-scoped submission statuses");

for (const moduleName of ["غیبت", "نمره", "انضباط", "تکلیف"]) {
  assert.ok(studentPage.includes("selected==='" + moduleName + "'"), "student page renders " + moduleName);
}
assert.ok(parentPage.includes("assignmentSubmissions||[]"), "parent page renders assignment submission status");
assert.ok(parentPage.includes("Number(x.manager_released)===1"), "parent page preserves manager release rules for ordinary continuous/final grade entries");
assert.ok(studentPage.includes("data.report_cards"), "student page renders midterm report cards");
assert.ok(studentPage.includes("کارنامه میان‌ترم"), "student page labels midterm report cards");
assert.ok(parentPage.includes("reportCardsTable"), "parent page renders midterm report cards");
assert.ok(parentPage.includes("filt(d.reportCards||[])"), "parent page shows only the currently selected child's report cards");

console.log("Student and parent portal activation checks passed.");
