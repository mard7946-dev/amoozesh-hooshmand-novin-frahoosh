import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const directory = readFileSync(new URL("../directory.html", import.meta.url), "utf8");
const adminApi = readFileSync(new URL("../supabase/functions/admin-manage-users/index.ts", import.meta.url), "utf8");
const portal = readFileSync(new URL("../portal.html", import.meta.url), "utf8");
const schoolLogin = readFileSync(new URL("../supabase/functions/school-portal-login/index.ts", import.meta.url), "utf8");
const usernameLogin = readFileSync(new URL("../supabase/functions/login-by-username/index.ts", import.meta.url), "utf8");

assert.ok(directory.includes('id="teacherEntryTools"') && directory.includes('id="saveTeacherProfile"'), "Staff directory must expose individual teacher profile creation");
assert.ok(directory.includes('id="teacherExcelFile"') && directory.includes('id="importTeacherExcel"') && directory.includes('id="downloadTeacherTemplate"'), "Staff directory must expose teacher-only Excel import and a template");
assert.ok(directory.includes("action:'save_teacher_profile'") && directory.includes("action:'import_teacher_profiles'"), "Teacher entry UI must use dedicated protected API actions");
assert.ok(directory.includes("teacherEntryTools').hidden=!(view==='staff'"), "Teacher entry tools must only appear for a manager in the staff directory");
assert.ok(directory.includes("rows.length>1000") && directory.includes("XLSX.utils.sheet_to_json"), "Excel import must parse a bounded workbook");
assert.ok(adminApi.includes('action === "save_teacher_profile" || action === "import_teacher_profiles"'), "Admin API must implement individual and bulk teacher profile actions");
assert.ok(adminApi.includes('.eq("tenant_school_id", schoolId).eq("national_code", nationalCode)'), "Teacher profile matching must be scoped to the current school and national code");
assert.ok(adminApi.includes("matches?.[0]") && adminApi.includes('from("teachers").update(teacherRow)'), "Existing teacher profiles must be updated instead of duplicated");
assert.ok(adminApi.includes('from("teachers").insert(teacherRow)'), "New teacher profiles must be inserted into the real teachers table");
assert.ok(adminApi.includes("managerMembership") && adminApi.includes('eq("is_active", true)'), "Manager membership must remain required");
assert.ok(portal.includes("change_teacher_initial_password") && portal.includes("requestedRole==='teacher'"), "Teacher first-login password flow must be exposed in the portal");
assert.ok(schoolLogin.includes('"change_teacher_initial_password"'), "Portal login wrapper must return teacher password-change results");
assert.ok(usernameLogin.includes('accountRole === "teacher" && requestedRole === "teacher"') && usernameLogin.includes('action !== "change_teacher_initial_password"'), "Authentication boundary must enforce teacher first-login password change");
assert.ok(usernameLogin.includes('.eq("role", "teacher").eq("is_active", true)'), "Teacher password change must require an active school membership");

for (const [name, html] of [["directory.html", directory], ["portal.html", portal]]) {
  const scripts = [...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .filter(match => !/\btype\s*=\s*["']module["']/i.test(match[1] || ""))
    .map(match => match[2]).filter(source => source.trim());
  for (const source of scripts) assert.doesNotThrow(() => new Function(source), name + " inline JavaScript must parse");
}
console.log("Teacher directory checks passed: individual create, teacher-only Excel import, school-scoped upsert, and first-login password flow.");
