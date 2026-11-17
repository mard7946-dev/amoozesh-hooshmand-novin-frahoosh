import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync("teacher-assistant.html", "utf8");
const portal = readFileSync("portal.html", "utf8");
const endpoint = readFileSync("supabase/functions/classroom-management/index.ts", "utf8");
const publish = readFileSync(".github/workflows/publish-six-icon-portal.yml", "utf8");

assert.ok(endpoint.includes('action === "teacher_assistant_summary"'), "Classroom service must expose the teacher assistant summary action");
const start = endpoint.indexOf('action === "teacher_assistant_summary"');
const end = endpoint.indexOf('return reply({ message: "عملیات درخواستی پشتیبانی نمی‌شود." }', start);
const handler = endpoint.slice(start, end);
assert.ok(handler.includes("if (!teacher || !teacherRecordId)"), "Only a verified teacher with a linked staff record may use the assistant");
assert.ok(handler.includes('.eq("tenant_school_id", school)') && handler.includes('.eq("teacher_id", teacherRecordId)'), "Teacher assignments must be scoped to the active school and exact teacher record");
assert.ok(handler.includes('.eq("active", 1)'), "Only active teacher-class assignments may be summarized");
for (const table of ['"students"', '"attendance"', '"student_grades"', '"assignments"', '"assignment_submissions"', '"discipline_records"']) {
  assert.ok(handler.includes('.from(' + table + ')'), "Assistant summary must use existing operational data: " + table);
}
assert.ok(handler.includes('.eq("actor_username", clean(profile.username))'), "Discipline summary must be limited to records created by the signed-in teacher");
assert.ok(handler.includes("attendance_records_30d") && handler.includes("pending_submissions") && handler.includes("grade_average"), "Summary must expose attendance, assignment, and grade indicators");
assert.ok(!handler.includes("first_name,last_name") && !handler.includes("national_code"), "Assistant summary must not return student identities or national codes");

assert.ok(page.includes("frahoosh_novin_access_token") && page.includes('role!=="teacher"'), "Page must require the authenticated teacher session");
assert.ok(page.includes("teacher_assistant_summary") && page.includes("/functions/v1/classroom-management"), "Page must use the authenticated existing school service");
assert.ok(!page.includes("/rest/v1/") && !page.includes("createClient("), "Browser must not read school tables directly");
assert.ok(page.includes("classroom/management.html?tab=attendance") && page.includes("classroom/management.html?tab=grades") && page.includes("classroom/management.html?tab=assignments"), "Assistant must link to the existing operational teacher workflows");
assert.ok(page.includes("frahooshReturnToPanel"), "Assistant must return to the signed-in teacher panel");

const scriptStart = page.indexOf('<script>', page.indexOf('panel-return.js'));
const scriptEnd = page.indexOf("</script>", scriptStart);
assert.ok(scriptStart >= 0 && scriptEnd > scriptStart, "Teacher assistant must contain its application script");
assert.doesNotThrow(() => new Function(page.slice(scriptStart + 8, scriptEnd)), "Teacher assistant JavaScript must parse");

assert.ok(portal.includes("دستیار هوشمند دبیر") && portal.includes("teacher-assistant.html"), "Teacher panel must expose and route to the assistant");
assert.ok(portal.includes("portalAuthUserRole!=='teacher'"), "Portal route must validate the active teacher role");
assert.ok(publish.includes("'teacher-assistant.html'") && publish.includes("teacher-assistant.html school-library.html"), "GitHub Pages workflow must trigger and include the assistant in the published artifact");

console.log("Smart teacher assistant checks passed: teacher-only access, school and assignment scope, operational data summaries, privacy, navigation, and Pages packaging.");
