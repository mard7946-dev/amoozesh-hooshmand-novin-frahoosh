import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync("classroom/management.html", "utf8");
const service = readFileSync("supabase/functions/classroom-management/index.ts", "utf8");
const student = readFileSync("student-module.html", "utf8");
const parent = readFileSync("parent-management.html", "utf8");
const review = readFileSync("academic-review.html", "utf8");

assert.ok(page.includes('id="duplicateOverlay"') && page.includes('role="dialog"') && page.includes("backdrop-filter:blur"), "duplicate warning must be a centered blocking modal with a dimmed background");
assert.ok(page.includes("تأیید و ثبت مجدد") && page.includes("عدم تأیید"), "duplicate modal must offer explicit confirm and cancel actions");
assert.ok(page.includes("submitWithDuplicateConfirmation('attendance'") && page.includes("submitWithDuplicateConfirmation('grades'"), "attendance and grade submissions must use duplicate confirmation");
assert.ok(page.includes("submitWithDuplicateConfirmation('create_assignment'") && page.includes("submitWithDuplicateConfirmation('discipline'"), "homework and discipline submissions must use duplicate confirmation");

for (const action of ["attendance", "grades", "create_assignment", "discipline"]) {
  const start = service.indexOf('if (action === "' + action + '")');
  assert.ok(start >= 0, action + " handler exists");
  const end = service.indexOf('\n    if (action === "', start + 1);
  const handler = service.slice(start, end < 0 ? service.length : end);
  assert.ok(handler.includes("body.allow_duplicate !== true") && handler.includes("duplicate: true"), action + " handler must detect duplicates and require explicit override");
}
assert.ok(service.includes('approval_status: "approved"'), "new attendance records must be immediately visible");
assert.ok(service.includes('manager_released: 1'), "new grades must be immediately published");
assert.ok(service.includes('status: "approved"'), "new discipline and praise records must be immediately visible");
assert.ok(service.includes("attendance: [], grades: [], discipline: []"), "routine records must not enter the manager/deputy approval queue");
assert.ok(student.includes("const needsManagerRelease=(_x)=>false"), "student portal must not hide any teacher grade pending manager release");
assert.ok(parent.includes("function needsManagerRelease(_x){return false}"), "parent portal must not hide any teacher grade pending manager release");
assert.ok(student.includes("'ثبت‌شده'") && parent.includes("'ثبت‌شده'"), "student and parent portals must show routine records as registered, not awaiting approval");
assert.ok(review.includes("نیازی به تأیید مدیر یا معاون ندارند"), "academic review page must explain direct publication");

for (const [name, html] of [["teacher", page], ["student", student], ["parent", parent], ["review", review]]) {
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x => x[1]).filter(x => x.trim());
  for (const [i, script] of scripts.entries()) assert.doesNotThrow(() => new Function(script), name + " inline script " + i + " must parse");
}
console.log("Teacher duplicate confirmation and direct publication checks passed.");
