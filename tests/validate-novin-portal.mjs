import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const html = readFileSync("portal.html", "utf8");
assert.ok(html.includes("/functions/v1/classroom-login"), "Portal must use the current Supabase classroom login function");
assert.ok(html.includes("sb_publishable_"), "Portal must use a public Supabase publishable key");
assert.ok(!html.includes("frahoosh-live-classroom-edge.mard7946.workers.dev"), "Portal must not call the legacy classroom Worker");
assert.ok(!html.includes("sso-ticket"), "Portal must not request legacy classroom SSO tickets");
assert.ok(!html.includes("new URL('classroom.html'"), "Portal must not bypass the new classroom's authenticated room access");

const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1]).filter(source => source.trim());
assert.ok(scripts.length > 0, "Portal must contain its interactive script");
for (const source of scripts) {
  assert.doesNotThrow(() => new Function(source), "Portal script must have valid JavaScript syntax");
}
for (const role of ["manager", "deputy", "teacher", "parent", "student", "counselor"]) {
  assert.ok(html.includes("id:'" + role + "'"), "Missing portal role: " + role);
}
console.log("Novin portal checks passed: JavaScript syntax, six roles, Supabase auth, no legacy classroom dependency.");

const settings = readFileSync("settings.html", "utf8");
assert.ok(html.includes("location.href='settings.html'"), "Manager settings tile must open the operational settings page");
assert.ok(settings.includes("/functions/v1/school-settings"), "Settings page must use the protected Supabase settings function");
assert.ok(settings.includes('role!=="manager"'), "Settings page must block non-manager roles");
assert.ok(settings.includes("مدیریت سرور بیرونی"), "Settings page must include external server management");
assert.ok(!settings.includes("service_role"), "Settings page must not expose a service-role key");
const settingsScripts = [...settings.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1]).filter(source => source.trim());
assert.ok(settingsScripts.length > 0, "Settings page must contain its interactive script");
for (const source of settingsScripts) {
  assert.doesNotThrow(() => new Function(source), "Settings page script must have valid JavaScript syntax");
}
console.log("Settings checks passed: manager-only routing, protected API, external server registry, and JavaScript syntax.");

const reports = readFileSync("reports.html", "utf8");
assert.ok(html.includes("location.href='reports.html?role='"), "Manager/deputy report tile must open the operational reports page");
assert.ok(reports.includes("/functions/v1/school-reports"), "Reports page must use the protected reports API");
assert.ok(reports.includes("حضور و غیاب") && reports.includes("نمرات ثبت‌شده") && reports.includes("گزارش انضباطی"), "Reports page must include attendance, grades, and discipline reports");
assert.ok(reports.includes("خروجی Excel (CSV)") && reports.includes("چاپ / ذخیره PDF"), "Reports page must provide spreadsheet and PDF print exports");
assert.ok(reports.includes("frahoosh_novin_access_token"), "Reports page must use the authenticated session token");
assert.ok(!reports.includes(".insert(") && !reports.includes(".update(") && !reports.includes(".delete("), "Reports page must remain read-only");
const reportScripts = [...reports.matchAll(/<script(?:\\s[^>]*)?>([\\s\\S]*?)<\\/script>/gi)].map(match => match[1]).filter(source => source.trim());
assert.ok(reportScripts.length > 0, "Reports page must contain its interactive script");
for (const source of reportScripts) assert.doesNotThrow(() => new Function(source), "Reports page script must have valid JavaScript syntax");
console.log("Reports checks passed: protected API, attendance/grades/discipline, exports, read-only behavior, and JavaScript syntax.");
