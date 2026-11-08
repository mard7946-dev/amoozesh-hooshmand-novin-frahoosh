import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const landing = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const classroom = readFileSync(new URL("../classroom.html", import.meta.url), "utf8");
const classroomSchedule = readFileSync(new URL("../classroom/schedule.html", import.meta.url), "utf8");
const classroomManagement = readFileSync(new URL("../classroom/management.html", import.meta.url), "utf8");
const apiSource = readFileSync(new URL("../supabase/functions/classroom-management/index.ts", import.meta.url), "utf8");
const classroomAuthorize = readFileSync(new URL("../supabase/functions/classroom-authorize/index.ts", import.meta.url), "utf8");
const publishWorkflow = readFileSync(new URL("../.github/workflows/publish-six-icon-portal.yml", import.meta.url), "utf8");
const portal = readFileSync(new URL("../server/public/portal.html", import.meta.url), "utf8");
const rootPortal = readFileSync(new URL("../portal.html", import.meta.url), "utf8");
const server = readFileSync(new URL("../server/src/server.js", import.meta.url), "utf8");
const parentMeetings = readFileSync(new URL("../parent-meetings.html", import.meta.url), "utf8");
const parentMeetingsApi = readFileSync(new URL("../supabase/functions/parent-meetings/index.ts", import.meta.url), "utf8");
const parentMeetingMembershipMigration = readFileSync(new URL("../supabase/migrations/20261031150000_backfill_school_memberships_for_existing_accounts.sql", import.meta.url), "utf8");
const usersPage = readFileSync(new URL("../users.html", import.meta.url), "utf8");
const adminUsersApi = readFileSync(new URL("../supabase/functions/admin-manage-users/index.ts", import.meta.url), "utf8");

assert.ok(["manager","deputy","teacher","parent","student","counselor"].every(role => landing.includes(`href="portal.html?step=login&role=${role}"`)), "Landing must route all six roles through the current authenticated portal login");
assert.ok(!landing.includes('href="./classroom.html?role=teacher"') && !landing.includes('href="./classroom.html?role=student"'), "Landing must not expose direct unauthenticated classroom entry");
assert.ok(!landing.includes("supabase"), "Landing must not depend on Supabase");
assert.ok(!/service[_-]?role|sb_secret_/i.test(classroom), "Classroom must not expose privileged Supabase credentials");
for (const id of ["board", "mic", "camera", "share", "hand", "leave", "leaveTop", "chatForm", "chatInput", "people", "participantCount", "roomName", "roomInfo"]) {
  assert.ok(classroom.includes('id="' + id + '"'), "Missing current classroom control: " + id);
}
assert.ok(classroom.includes("async function authorize(roomId)"), "Classroom must verify entry with the authorization function");
assert.ok(classroom.includes("classroom-authorize"), "Classroom must call the server-side classroom authorization endpoint");
assert.ok(classroom.includes("if(!token)"), "Classroom must reject entry without an authenticated session");
assert.ok(classroom.includes("if(!response.ok||!data.ok)"), "Classroom must reject unsuccessful authorization responses");
assert.ok(classroom.includes("navigator.mediaDevices.getUserMedia"), "Classroom must request explicit local microphone/camera permission");
assert.ok(classroom.includes("صدا، تصویر زنده و گفت‌وگوی چندکاربره هنوز"), "Classroom must not claim live media is connected when it is not");
assert.ok(portal.includes("import/excel"), "Portal should support Excel import");
assert.ok(portal.includes("/schedule/today"), "Portal should show daily schedule");
assert.ok(server.includes("api/auth/student-login"), "Backend should support student identity login");
assert.ok(usersPage.includes('id="parentExcel"') && usersPage.includes('id="parentTemplate"') && usersPage.includes('id="importParents"'), "Users page must provide parent Excel upload and downloadable template");
assert.ok(usersPage.includes('action:"import_parents"'), "Parent Excel upload must call the protected bulk-import action");
assert.ok(usersPage.includes("کد ملی ولی") && usersPage.includes("کد ملی دانش‌آموز"), "Parent template must identify guardian and child by national code");
assert.ok(usersPage.includes("نام کاربری ولی") && usersPage.includes("رمز اولیه"), "Import results must show credentials for newly created parent accounts");
assert.ok(adminUsersApi.includes('action === "import_parents"'), "Admin API must implement the bulk parent import action");
assert.ok(adminUsersApi.includes('parent_children').toString() && adminUsersApi.includes('onConflict: "parent_username,student_id"'), "Bulk import must create idempotent parent-child links");
assert.ok(adminUsersApi.includes('school_memberships') && adminUsersApi.includes('role: "parent"'), "Bulk import must activate parent school membership");
assert.ok(adminUsersApi.includes('admin.auth.admin.createUser'), "Bulk import must create real Supabase Auth accounts");
assert.ok(adminUsersApi.includes('tenant_school_id: schoolId'), "Bulk import must scope accounts and links to the manager school");
assert.ok(parentMeetings.includes("ثبت و ارسال برای معاون"), "Parent meeting form must let parents submit a request for deputy review");
assert.ok(rootPortal.includes("parent-meetings.html?v=20261031-meetings-2"), "Parent meeting navigation must bypass stale cached meeting pages");
assert.ok(rootPortal.includes("تأیید ملاقات اولیا") && rootPortal.includes("درخواست‌های ملاقات") && rootPortal.includes("parent-meetings.html?v=20261031-meetings-3"), "Manager and teacher must have navigation to their meeting approval/response queues");
assert.ok(parentMeetings.includes("role==='teacher'&&m.recipient_user_id&&m.status==='awaiting_recipient'"), "Only the selected teacher should see the final response controls");
assert.ok(parentMeetings.includes("علت رد درخواست را وارد کنید (الزامی)"), "Teacher rejection must require a reason in the UI");
assert.ok(parentMeetingsApi.includes('patch.status="pending_manager"') && parentMeetingsApi.includes('patch.manager_approval="pending"'), "Deputy approval must route the request to the manager before the teacher");
assert.ok(parentMeetingsApi.includes('response==="rejected"&&!responseNote'), "The API must reject a teacher rejection without a reason");
assert.ok(parentMeetingsApi.includes('clean(recipient.role).toLowerCase()!=="teacher"'), "Meeting requests must target a teacher account only");
assert.ok(parentMeetingMembershipMigration.toLowerCase().includes("on conflict (school_id, auth_user_id, role) do nothing"), "Membership backfill must preserve existing membership states");
assert.ok(server.includes("app.get('/api/auth/me', auth"), "Backend should provide authenticated session identity");
assert.ok(server.includes("app.get('/api/classes/:id/access', auth"), "Backend should validate access to a specific classroom");
assert.ok(classroom.includes("authorize(roomId)") && classroom.includes("classroom-authorize"), "Classroom must validate session and room access before entering");
assert.ok(server.includes("app.get('/api/rtc-config', auth"), "RTC config must require an authenticated session");
assert.ok(server.includes("RTC_ICE_SERVERS_JSON"), "Server must accept ICE/TURN configuration from environment, not source code");
assert.ok(classroom.includes("صدا، تصویر زنده و گفت‌وگوی چندکاربره هنوز"), "Classroom must clearly disclose that real-time media is not yet connected");
assert.ok(server.includes("NATIONAL_ID_HMAC_SECRET"), "Backend should hash national IDs with a server secret");
assert.ok(server.includes("allow('manager','educational_deputy','teacher','pastoral_deputy')"), "Management and teaching staff should be authorized to start classes");
assert.ok(server.includes("if (['teacher','pastoral_deputy'].includes(req.user.role))"), "Teaching staff should remain restricted to their scheduled lesson period");
assert.ok(server.includes("app.post('/api/staff', auth, allow('manager')"), "Only managers may create staff accounts");
assert.ok(server.includes("app.post('/api/classes', auth, allow('manager')"), "Only managers may create classrooms");
assert.ok(portal.includes("const canManageClasses=user.role==='manager'"), "Only managers should see classroom creation controls");
assert.ok(portal.includes("chosen==='manager'&&user.role!=='manager'"), "Deputies, teachers, and students must not impersonate manager role in portal");
assert.ok(server.includes("app.post('/api/account/credentials', auth, allow('manager')"), "Only the manager may change manager credentials");
assert.ok(portal.includes("credentialsForm") && portal.includes("api('/account/credentials'"), "Portal should allow manager credential rotation");
assert.ok(portal.includes("password:$('password').value"), "Login must preserve mixed-character passwords");
assert.ok(!portal.includes('id="password" type="password" inputmode="numeric"'), "Password input must not force a numeric mobile keyboard");
assert.ok(server.includes("DELETE FROM classroom_sessions WHERE token_hash=$1"), "Logout must revoke the server-side session");
assert.ok(server.includes("educational_deputy") && server.includes("executive_deputy") && server.includes("pastoral_deputy"), "Backend should support school deputy roles");
assert.ok(server.includes("password.length < 8") && server.includes("hashPassword(password)"), "Staff passwords must be validated and securely hashed");
assert.ok(portal.includes("staffForm") && portal.includes("api('/staff'"), "Manager portal should create staff accounts");
assert.ok(portal.includes("managerOnlyTools") && portal.includes("staffTools"), "Staff administration tools should be manager-only");
for (const [name, html] of [["index.html", landing], ["classroom.html", classroom], ["classroom/schedule.html", classroomSchedule], ["classroom/management.html", classroomManagement], ["portal.html", portal], ["root portal.html", rootPortal], ["users.html", usersPage]]) {
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m => m[1]).filter(s => s.trim());
  for (const source of scripts) assert.doesNotThrow(() => new Function(source), name + " has invalid JS syntax");
}

assert.ok(rootPortal.includes("classroom/schedule.html"), "The deployed portal should route teachers and students through the weekly schedule before the room");
assert.ok(classroomSchedule.includes("Asia/Tehran"), "Weekly schedule must use Iran local time");
assert.ok(classroomSchedule.includes("data.schedule"), "Weekly schedule must render server-authorized schedule entries");
assert.ok(classroomSchedule.includes("!lesson.id"), "Unlinked schedule slots must not expose a room-entry action");
assert.ok(classroomSchedule.includes("schedule_entry_id"), "Room entry must be tied to the exact schedule slot");
assert.ok(publishWorkflow.includes("cp classroom/schedule.html _site/classroom/schedule.html"), "Pages workflow must publish the weekly schedule page");


assert.ok(classroomManagement.includes('value="import_weekly_schedule"'), "Management must offer a separate full weekly schedule import");
assert.ok(classroomManagement.includes("normalizeExcelClock"), "Weekly schedule import must normalize Excel time cells");
assert.ok(classroomManagement.includes("import_timetable"), "Existing teacher-to-class Excel import must remain available");
assert.ok(apiSource.includes('action === "import_weekly_schedule"'), "Backend must persist weekly schedule entries separately");
assert.ok(apiSource.includes('action === "list_weekly_schedule"'), "Manager must be able to list all schedule entries for approval");
assert.ok(apiSource.includes('action === "set_weekly_schedule_enabled"'), "Manager must control individual, class-wide, and school-wide schedule activation");
assert.ok(apiSource.includes('day_enabled: existing?.day_enabled === true'), "New schedule rows must remain disabled until the manager activates them");
assert.ok(classroomManagement.includes('id="activation"') && classroomManagement.includes('فعال‌سازی همه کلاس‌ها'), "Manager UI must provide schedule activation controls");
assert.ok(classroomManagement.includes('data-entry-toggle') && classroomManagement.includes('data-class-enable'), "Manager UI must allow per-slot and per-class activation");
assert.ok(apiSource.includes('from("weekly_schedule_entries")'), "Weekly schedule importer must write the weekly schedule table");


assert.ok(classroomAuthorize.includes('entry.day_enabled === true'), "Disabled schedule periods must remain visible but not be enterable");
assert.ok(classroomAuthorize.includes("isScheduleSlotActive"), "Server must enforce the active bell time window");
assert.ok(classroomAuthorize.includes('schedule_entry_id'), "Room entry must be tied to an exact weekly schedule row");


const verificationFunction = readFileSync(new URL("../supabase/functions/classroom-verification/index.ts", import.meta.url), "utf8");
const verificationMigration = readFileSync(new URL("../supabase/migrations/20261108220000_classroom_verification_by_period.sql", import.meta.url), "utf8");
const verificationUi = readFileSync(new URL("../classroom/management.html", import.meta.url), "utf8");
assert.ok(verificationFunction.includes('classroom_verification_period_settings') && verificationFunction.includes('eq("period",Number(entry.period))'), "Student checks must read one school-scoped setting shared by the assigned bell");
assert.ok(verificationFunction.includes('sessionCheckpointMinutes'), "Both checks must scale to the exact session window, including parallel half-bell sessions");
assert.ok(verificationFunction.includes('eq("period",period)') && verificationFunction.includes('onConflict:"tenant_school_id,period"'), "Manager saves must target a single setting per school and bell");
assert.ok(verificationUi.includes("ذخیره برای همه کلاس‌ها") && verificationUi.includes("data-verification-period"), "Manager UI must save one row per bell rather than one row per weekly session");
assert.ok(verificationMigration.includes("primary key (tenant_school_id, period)") && verificationMigration.includes("check1_position") && verificationMigration.includes("check2_position"), "Migration must persist two shared positions per school bell");

console.log("Static checks passed: classroom controls, portal workflows, bulk parent Excel import, school-scoped links, and page script syntax.");
