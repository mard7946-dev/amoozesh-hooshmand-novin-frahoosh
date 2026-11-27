import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const migration = readFileSync("supabase/migrations/20261126210000_per_school_online_class_control.sql", "utf8");
assert.match(migration, /online_class_enabled boolean not null default false/i);
assert.match(migration, /ss\.plan_id is null[\s\S]*then false/i);
assert.match(migration, /frahoosh_platform_set_school_classroom_enabled/);
assert.match(migration, /private\.frahoosh_is_platform_admin\(\)/);
assert.match(migration, /classroom\.school_toggled/);
assert.match(migration, /revoke all on function[\s\S]*from public, anon/i);

const authorize = readFileSync("supabase/functions/classroom-authorize/index.ts", "utf8");
assert.match(authorize, /select\("online_class_enabled"\)/);
assert.match(authorize, /canEnterOnlineClass\(/);
assert.match(authorize, /Timetable and staff-register access remains available/i);

const token = readFileSync("supabase/functions/classroom-realtime-token/index.ts", "utf8");
assert.match(token, /guestSchool\.online_class_enabled !== true/);
assert.match(token, /adHocSchool\.online_class_enabled !== true/);

const meetings = readFileSync("supabase/functions/classroom-meetings/index.ts", "utf8");
assert.match(meetings, /schoolFeatureResult\.data\.online_class_enabled !== true/);

const platformApi = readFileSync("supabase/functions/platform-management/index.ts", "utf8");
assert.match(platformApi, /set_school_classroom/);
assert.match(platformApi, /p_school_id: schoolId/);

const platformUi = readFileSync("platform-admin.html", "utf8");
assert.match(platformUi, /set_school_classroom/);
assert.match(platformUi, /پیش‌فرض مدارس جدید/);
assert.match(platformUi, /کلید اصلی و اضطراری سرویس/);

console.log("Per-school online classroom control validation passed.");
