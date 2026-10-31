import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const landing = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const classroom = readFileSync(new URL("../classroom.html", import.meta.url), "utf8");
const classroomBoard = readFileSync(new URL("../classroom/index.html", import.meta.url), "utf8");
const classroomSchedule = readFileSync(new URL("../classroom/schedule.html", import.meta.url), "utf8");
const classroomAuthorize = readFileSync(new URL("../supabase/functions/classroom-authorize/index.ts", import.meta.url), "utf8");
const portal = readFileSync(new URL("../server/public/portal.html", import.meta.url), "utf8");
const rootPortal = readFileSync(new URL("../portal.html", import.meta.url), "utf8");
const server = readFileSync(new URL("../server/src/server.js", import.meta.url), "utf8");
const parentMeetings = readFileSync(new URL("../parent-meetings.html", import.meta.url), "utf8");
const parentMeetingsApi = readFileSync(new URL("../supabase/functions/parent-meetings/index.ts", import.meta.url), "utf8");
const parentMeetingMembershipMigration = readFileSync(new URL("../supabase/migrations/20261031150000_backfill_school_memberships_for_existing_accounts.sql", import.meta.url), "utf8");

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
assert.ok(rootPortal.includes("classroom/schedule.html") && rootPortal.includes("classroomEntry"), "Teacher and student classroom entry must open the separate schedule page");
assert.ok(classroomSchedule.includes("برنامه هفتگی و روزانه کلاس‌ها") && classroomSchedule.includes("ورود به تخته"), "Separate schedule page must show weekly/daily classes and a board-entry action");
assert.ok(classroomSchedule.includes("join.disabled=!lesson.is_active"), "Only activated bells may be entered from the schedule");
assert.ok(classroomSchedule.includes("schedule_entry_id:lesson.schedule_entry_id"), "Schedule entry identity must be passed for server-side authorization");
assert.ok(classroomBoard.includes("authorize(requestedRoom,scheduleEntryId)") && classroomBoard.includes("location.replace('schedule.html')"), "The board must require a selected schedule entry for teacher/student accounts");
assert.ok(classroomAuthorize.includes("weekly_schedule_entries") && classroomAuthorize.includes("day_enabled") && classroomAuthorize.includes("is_active"), "Authorization must return each user's enabled weekly schedule and active bell state");
assert.ok(classroomAuthorize.includes("schedule_entry_id") && classroomAuthorize.includes("این زنگ هنوز توسط مدیریت فعال نشده است"), "Server must reject entry to a non-activated scheduled bell");
for (const [name, html] of [["classroom/index.html", classroomBoard], ["classroom/schedule.html", classroomSchedule]]) {
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m => m[1]).filter(s => s.trim());
  for (const source of scripts) assert.doesNotThrow(() => new Function(source), name + " has invalid JS syntax");
}
const mediaStart=classroomBoard.indexOf("async function startOffer(remote)");
const mediaEnd=classroomBoard.indexOf("async function boot()",mediaStart);
let mediaHash=2166136261;
for(const char of classroomBoard.slice(mediaStart,mediaEnd)){mediaHash^=char.charCodeAt(0);mediaHash=Math.imul(mediaHash,16777619);}
assert.equal((mediaHash>>>0).toString(16),"f45d5e9b","WebRTC, realtime, board media session, and peer connection logic must remain byte-for-byte unchanged");
const mediaControlsStart=classroomBoard.indexOf("async function enableTrack(kind)");
const mediaControlsEnd=classroomBoard.indexOf("async function leave()",mediaControlsStart);
let mediaControlsHash=2166136261;
for(const char of classroomBoard.slice(mediaControlsStart,mediaControlsEnd)){mediaControlsHash^=char.charCodeAt(0);mediaControlsHash=Math.imul(mediaControlsHash,16777619);}
assert.equal((mediaControlsHash>>>0).toString(16),"78755cd0","Microphone, camera, screen sharing, and media teardown controls must remain byte-for-byte unchanged");
assert.ok(portal.includes("import/excel"), "Portal should support Excel import");
assert.ok(portal.includes("/schedule/today"), "Portal should show daily schedule");
assert.ok(server.includes("api/auth/student-login"), "Backend should support student identity login");
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
for (const [name, html] of [["index.html", landing], ["classroom.html", classroom], ["portal.html", portal]]) {
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m => m[1]).filter(s => s.trim());
  for (const source of scripts) assert.doesNotThrow(() => new Function(source), name + " has invalid JS syntax");
}
console.log("Static checks passed: classroom controls, portal workflows, student privacy hashing, and page script syntax.");
