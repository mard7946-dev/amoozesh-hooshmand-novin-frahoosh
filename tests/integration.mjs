import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const port = Number(process.env.E2E_PORT || 8091);
const base = `http://127.0.0.1:${port}`;
const managerPassword = "Manager-E2E-Password-2026";
const server = spawn(process.execPath, ["server/src/server.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(port),
    PGSSL: "disable",
    MANAGER_USERNAME: "e2e-manager",
    MANAGER_PASSWORD: managerPassword,
    MANAGER_DISPLAY_NAME: "مدیر آزمایشی",
    NATIONAL_ID_HMAC_SECRET: "e2e-secret-key-with-more-than-thirty-two-characters",
    ALLOWED_ORIGINS: ""
  },
  stdio: ["ignore", "pipe", "pipe"]
});
let serverOutput = "";
server.stdout.on("data", chunk => { serverOutput += chunk.toString(); });
server.stderr.on("data", chunk => { serverOutput += chunk.toString(); });

async function request(path, { token, method = "GET", body, expected = 200 } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {})
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  const data = await response.json().catch(() => ({}));
  assert.equal(response.status, expected, `${method} ${path}: expected ${expected}, got ${response.status}; ${JSON.stringify(data)}`);
  return data;
}

try {
  let healthy = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null) throw new Error("Server exited before ready:\n" + serverOutput);
    try {
      const response = await fetch(base + "/health");
      if (response.ok) { healthy = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.ok(healthy, "Server must start and connect to PostgreSQL");

  const managerLogin = await request("/api/auth/login", {
    method: "POST", expected: 200,
    body: { username: "e2e-manager", password: managerPassword }
  });
  const managerToken = managerLogin.token;
  assert.equal(managerLogin.user.role, "manager");
  assert.equal((await request("/api/auth/me", { token: managerToken })).user.username, "e2e-manager");

  const teacher = await request("/api/staff", {
    token: managerToken, method: "POST", expected: 201,
    body: { displayName: "دبیر آزمایشی", username: "e2e-teacher", role: "teacher", password: "Teacher-E2E-Password-1" }
  });
  const teacherLogin = await request("/api/auth/login", {
    method: "POST", expected: 200,
    body: { username: "e2e-teacher", password: "Teacher-E2E-Password-1" }
  });
  const teacherToken = teacherLogin.token;
  assert.equal(teacherLogin.user.role, "teacher");

  await request("/api/staff", {
    token: teacherToken, method: "POST", expected: 403,
    body: { displayName: "حساب غیرمجاز", username: "not-allowed", role: "teacher", password: "Not-Allowed-Password" }
  });

  await request("/api/schedule", {
    token: managerToken, method: "POST", expected: 201,
    body: { day: "monday", period: 1, gradeClass: "7/1", subject: "آزمون یکپارچه", teacherId: teacher.staff.id, startTime: "00:00", endTime: "23:59" }
  });
  const created = await request("/api/classes", {
    token: managerToken, method: "POST", expected: 201,
    body: { title: "کلاس آزمایشی", gradeClass: "7/1", teacherId: teacher.staff.id, day: "monday", period: 1 }
  });
  const classId = created.classroom.id;
  const roomCode = created.classroom.room_code;

  await request("/api/classes/" + encodeURIComponent(classId) + "/access", { token: managerToken, expected: 403 });
  const started = await request("/api/classes/" + encodeURIComponent(classId) + "/start", { token: managerToken, method: "POST", expected: 200 });
  assert.equal(started.classroom.status, "active");
  const managerAccess = await request("/api/classes/" + encodeURIComponent(classId) + "/access", { token: managerToken });
  assert.equal(managerAccess.classroom.roomCode, roomCode);
  const teacherAccess = await request("/api/classes/" + encodeURIComponent(classId) + "/access", { token: teacherToken });
  assert.equal(teacherAccess.classroom.roomCode, roomCode);
  await request("/api/classes/" + encodeURIComponent(classId) + "/access", { expected: 401 });

  await request("/api/auth/logout", { token: managerToken, method: "POST", expected: 200 });
  await request("/api/auth/me", { token: managerToken, expected: 401 });
  console.log("Database integration passed: manager/teacher login, role authorization, schedule, class lifecycle, room access, and session revocation.");
} catch (error) {
  console.error(error);
  console.error(serverOutput);
  process.exitCode = 1;
} finally {
  server.kill("SIGTERM");
  await new Promise(resolve => {
    if (server.exitCode !== null) return resolve();
    const timeout = setTimeout(resolve, 3000);
    server.once("exit", () => { clearTimeout(timeout); resolve(); });
  });
}
