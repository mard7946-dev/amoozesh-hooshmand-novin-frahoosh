import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const migration = readFileSync("supabase/migrations/20261031180000_commercial_platform_management.sql", "utf8");
for (const marker of [
  "platform_audit_logs",
  "schools_school_code_ci_uidx",
  "private.frahoosh_is_platform_admin()",
  "frahoosh_platform_create_school",
  "frahoosh_platform_set_school_status",
  "frahoosh_platform_set_subscription",
  "revoke all on function",
  "grant execute"
]) assert.ok(migration.includes(marker), "Commercial migration missing security/management marker: " + marker);
assert.ok(!/grant\s+execute\s+on\s+function[^;]+\s+to\s+anon/i.test(migration), "Platform RPCs must never be executable by anon");
assert.ok(migration.includes("security definer") && migration.includes("set search_path = ''"), "Privileged SQL functions must pin an empty search_path");
assert.ok(migration.includes("school.created") && migration.includes("school.status_changed") && migration.includes("subscription.created"), "All privileged school and subscription changes must be audited");

const fn = readFileSync("supabase/functions/platform-management/index.ts", "utf8");
for (const marker of [
  "admin.auth.getUser",
  'from("platform_admins")',
  'action === "overview"',
  'action === "create_school"',
  'action === "set_school_status"',
  'action === "set_subscription"',
  'rpc("frahoosh_platform_create_school"',
  'rpc("frahoosh_platform_set_school_status"',
  'rpc("frahoosh_platform_set_subscription"'
]) assert.ok(fn.includes(marker), "Platform management API missing marker: " + marker);
assert.ok(!fn.includes("SUPABASE_ANON_KEY"), "Platform management API must not depend on a client-supplied admin identity");
assert.ok(fn.includes("auth.user.id"), "Platform admin access must be bound to the authenticated user");
assert.ok(fn.includes("userClient.rpc"), "Privileged SQL RPCs must receive the authenticated caller JWT, not the service-role identity.");

const page = readFileSync("platform-admin.html", "utf8");
assert.ok(page.includes("/functions/v1/platform-management"), "Platform admin UI must call its protected Edge Function");
assert.ok(page.includes("frahoosh_novin_access_token"), "Platform admin UI must reuse the authenticated session token");
assert.ok(!page.includes("service_role") && !page.includes("sb_secret_"), "No service-role or secret key may appear in the browser");
for (const feature of ["ثبت مدرسه جدید", "مدارس ثبت‌شده", "گزارش فعالیت مدیر کل", "ثبت اشتراک جدید", "تعلیق"]) {
  assert.ok(page.includes(feature), "Platform admin UI missing feature: " + feature);
}
const scripts = [...page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(x => x[1]).filter(x => x.trim());
assert.ok(scripts.length, "Platform admin page must contain application JavaScript");
for (const script of scripts) assert.doesNotThrow(() => new Function(script), "Platform admin JavaScript must parse");

const publish = readFileSync(".github/workflows/publish-six-icon-portal.yml", "utf8");
assert.ok(publish.includes("'platform-admin.html'"), "Changes to platform-admin.html must trigger Pages deployment");
assert.ok(publish.includes("platform-admin.html"), "Pages artifact must include the platform admin page");

console.log("Commercial platform checks passed: privileged API, audited SQL RPCs, school/subscription UI, secret-free browser code, and deployment packaging.");
