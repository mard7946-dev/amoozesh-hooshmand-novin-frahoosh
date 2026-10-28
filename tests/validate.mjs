import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const landing = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const classroom = readFileSync(new URL("../classroom.html", import.meta.url), "utf8");
const portal = readFileSync(new URL("../server/public/portal.html", import.meta.url), "utf8");
const server = readFileSync(new URL("../server/src/server.js", import.meta.url), "utf8");

assert.ok(["manager","deputy","teacher","parent","student","counselor"].every(role => landing.includes(`href="portal.html?step=login&role=${role}"`)), "Landing must route all six roles through the current authenticated portal login");
assert.ok(!landing.includes('href="./classroom.html?role=teacher"') && !landing.includes('href="./classroom.html?role=student"'), "Landing must not expose direct unauthenticated classroom entry");
assert.ok(!landing.includes("supabase"), "Landing must not depend on Supabase");
assert.ok(!/service[_-]?role|sb_secret_/i.test(classroom), "Classroom must not expose privileged Supabase credentials");
for (const id of ["board", "create", "join", "mic", "camera", "end-class", "period-minutes", "page-next", "quiz-publish", "attendance-export", "chat-send"]) {
  assert.ok(classroom.includes('id="' + id + '"'), "Missing classroom control: " + id);
}
assert.ok(classroom.includes("Math.max(50") && classroom.includes("60*1000"), "Class should enforce a 50-minute minimum/default duration");
assert.ok(classroom.includes("startClassClock(data.endsAt)"), "Student timer should use shared deadline");
assert.ok(classroom.includes("peerjs@1.5.4"), "Classroom should pin PeerJS client version");
assert.ok(classroom.includes('id="student-permissions"'), "Teacher should have student permission controls");
assert.ok(classroom.includes("!studentPermissions.board"), "Students without permission must not draw on the board");
assert.ok(classroom.includes("studentPermissions[kind==='audio'?'audio':'video']"), "Student audio/video must be permission-gated");
assert.ok(classroom.includes("data.type==='permissions'"), "Teacher permission updates should reach connected students");
assert.ok(portal.includes("import/excel"), "Portal should support Excel import");
assert.ok(portal.includes("/schedule/today"), "Portal should show daily schedule");
assert.ok(server.includes("api/auth/student-login"), "Backend should support student identity login");
assert.ok(server.includes("app.get('/api/auth/me', auth"), "Backend should provide authenticated session identity");
assert.ok(server.includes("app.get('/api/classes/:id/access', auth"), "Backend should validate access to a specific classroom");
assert.ok(classroom.includes("authorizeClassroomEntry()") && classroom.includes("/api/classes/'+encodeURIComponent(bootClassId)+'/access"), "Classroom must validate session and room access before connecting");
assert.ok(server.includes("app.get('/api/rtc-config', auth"), "RTC config must require an authenticated session");
assert.ok(server.includes("RTC_ICE_SERVERS_JSON"), "Server must accept ICE/TURN configuration from environment, not source code");
assert.ok(classroom.includes("fetch('/api/rtc-config'") && classroom.includes("config:{iceServers"), "PeerJS must load server-provided ICE servers");
assert.ok(server.includes("NATIONAL_ID_HMAC_SECRET"), "Backend should hash national IDs with a server secret");
assert.ok(server.includes("allow('manager','educational_deputy','teacher','pastoral_deputy')"), "Management and teaching staff should be authorized to start classes");
assert.ok(server.includes("if (['teacher','pastoral_deputy'].includes(req.user.role))"), "Teaching staff should remain restricted to their scheduled lesson period");
assert.ok(server.includes("app.post('/api/staff', auth, allow('manager')"), "Only managers may create staff accounts");
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
