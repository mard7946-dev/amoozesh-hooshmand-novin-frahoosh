import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const portal = readFileSync(new URL("../portal.html", import.meta.url), "utf8");
const classroom = readFileSync(new URL("../classroom/index.html", import.meta.url), "utf8");
const tools = readFileSync(new URL("../portal-classroom-tools-v2.js", import.meta.url), "utf8");
const manage = readFileSync(new URL("../supabase/functions/classroom-manage-v2/index.ts", import.meta.url), "utf8");
const authorize = readFileSync(new URL("../supabase/functions/classroom-authorize/index.ts", import.meta.url), "utf8");

for (const role of ["manager", "deputy", "teacher", "parent", "student", "counselor"]) {
  assert.ok(portal.includes("id:'" + role + "'"), "Missing portal role: " + role);
}
assert.ok(portal.includes("login-by-username"), "Staff login must keep the existing username login function");
assert.ok(portal.includes("classroom-login"), "Student login must use the existing role-checked classroom login function");
assert.ok(portal.includes("portal-classroom-tools-v2.js"), "Portal must load the classroom tools bundle");
assert.ok(tools.includes("classroom-manage-v2"), "Portal tools must call the role-checked classroom API");
for (const action of ["import", "create-class", "assign-collaborator", "attendance", "grades", "student-records"]) {
  assert.ok(tools.includes("'" + action + "'"), "Missing classroom tool action: " + action);
}
assert.ok(manage.includes("if(!ctx.isManager)") && manage.includes("if(ctx.isStudent)throw"), "Management and student write restrictions must be enforced on the server");
assert.ok(manage.includes("tenant_school_id") && manage.includes("auth.getUser(token)"), "Classroom API must verify the user session and school tenant");
assert.ok(authorize.includes("collaboratorIds.has(Number(row.id))"), "Assigned class collaborators must be authorized to enter their class");
assert.ok(classroom.includes("classroom-authorize") && classroom.includes("leave"), "Classroom must authorize entry and provide a leave control");
console.log("Active portal validation passed: login wiring, role panels, Excel import, attendance, grades, student records, and collaborator authorization.");
