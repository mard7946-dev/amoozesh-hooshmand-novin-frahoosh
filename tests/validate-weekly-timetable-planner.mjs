import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const page = readFileSync("weekly-timetable-planner.html", "utf8");
const migration = readFileSync("supabase/migrations/20261118120000_school_weekly_timetable_planner.sql", "utf8");
const api = readFileSync("supabase/functions/weekly-timetable-planner/index.ts", "utf8");
const validation = readFileSync("supabase/functions/weekly-timetable-planner/validation.ts", "utf8");
const management = readFileSync("classroom/management.html", "utf8");

for (const id of ["academicYear", "assignmentSelect", "requiredPeriods", "workdaysEditor", "classSelect", "slotGrid", "teacherSelect", "teacherScheduleTable", "generate", "validate", "saveDraft", "publish", "print"]) {
  assert.ok(page.includes('id="' + id + '"'), "planner page must include " + id);
}
assert.ok(page.includes('data-week="even"') && page.includes('data-week="odd"'), "each timetable cell must have independent even/odd assignments");
assert.ok(page.includes("چینش خودکار و متعادل"), "planner must expose automatic suggestions");
assert.ok(api.includes("برنامه منتشرشده قابل ویرایش نیست"), "published plans must be immutable");
assert.ok(page.includes('apikey":"sb_publishable_'), "planner API calls must include the Supabase publishable key");
assert.ok(management.includes("../weekly-timetable-planner.html"), "manager class panel must link to the planner");
assert.ok(migration.includes("enable row level security") && migration.includes("revoke all") && migration.includes("grant all"), "planner data must be RLS-protected and service-role-only");
assert.ok(migration.includes("school_id") && migration.includes("auth.users"), "plans must be school-scoped and audited");
assert.ok(!/alter\\s+table\\s+public\\.weekly_schedule_entries|drop\\s+table\\s+public\\.weekly_schedule_entries/i.test(migration), "migration must not alter or drop the live online-class schedule table");
assert.ok(api.includes("auth.getUser(token)") && api.includes("school_memberships") && api.includes("school_id"), "planner API must authenticate and scope every plan to the current school");
assert.ok(api.includes('action === "publish"') && api.includes('action === "generate"'), "planner API must support publishing and automatic suggestions");
assert.ok(validation.includes("week === \"even\"") && validation.includes("week === \"odd\""), "validation must inspect both week patterns");

const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
assert.equal(scripts.length, 1, "planner page should have one application script");
assert.doesNotThrow(() => new Function(scripts[0]), "planner page JavaScript must parse");
console.log("Weekly timetable planner structure and isolation checks passed.");
