import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync("school-planning.html", "utf8");
const portal = readFileSync("portal.html", "utf8");
const migration = readFileSync("supabase/migrations/20261119110000_school_planning_center.sql", "utf8");
const edge = readFileSync("supabase/functions/school-planning/index.ts", "utf8");
const publish = readFileSync(".github/workflows/publish-six-icon-portal.yml", "utf8");

for (const label of ["برنامه روزانه", "تقویم ماهانه", "تقویم سالانه", "چشم‌انداز سه‌ساله", "نیروی انسانی", "هزینه و امکانات", "سنجش نتیجه", "منابع و مبانی"]) {
  assert.ok(page.includes(label), "Roadmap must expose " + label);
}
for (const evidence of ["دبیرستان سردار شهید حاجی‌زاده ۲", "۲۴۰ دانش‌آموز", "۱۴۰۵–۱۴۰۶", "۱۴۰۶–۱۴۰۷", "۱۴۰۷–۱۴۰۸", "خط پایه", "استعلام قیمت", "تعطیلات و مناسبت‌های رسمی"]) {
  assert.ok(page.includes(evidence), "Roadmap must include grounded school planning context: " + evidence);
}
for (const research of ["UNICEF", "World Bank", "آیین‌نامه اجرایی مدارس", "مدرسه تراز"]) {
  assert.ok(page.includes(research), "Roadmap must identify a research or policy basis: " + research);
}
assert.ok(page.includes("const daily=[") && page.includes("const months=[") && page.includes("const roadmap=["), "Daily, monthly, and multi-year plans must be pre-populated");
assert.ok(page.includes("const roles=[") && page.includes("const budget=[") && page.includes("const indicators=["), "Staffing, budget, and outcome indicators must be pre-populated");
assert.ok(page.includes("data-progress") && page.includes("saveProgress") && page.includes('record_type:"operational_plan"'), "Manager must be able to persist execution status for predefined actions");
assert.ok(page.includes('if(!token||role!=="manager"||!schoolId)'), "Roadmap must be restricted to an authenticated manager of a school");
assert.ok(!page.includes("ثبت مورد جدید") && !page.includes("buildRecommendations"), "The primary experience must not be an empty record-creation form or generic rule-based challenge generator");
const script = page.match(/<script>\s*([\s\S]*?)<\/script>/);
assert.ok(script, "Roadmap must contain its application script");
assert.doesNotThrow(() => new Function(script[1]), "Roadmap JavaScript must parse");

assert.ok(portal.includes("مرکز برنامه‌ریزی مدرسه"), "Manager portal must expose the planning center");
assert.ok(portal.includes("selectedRole.id==='manager'&&name==='مرکز برنامه‌ریزی مدرسه'"), "Planning center route must be limited to manager panel");
assert.ok(portal.includes("portalAuthUserRole!=='manager'") && portal.includes("school-planning.html?v=20261119-roadmap-2"), "Planning center route must validate manager and use the new page cache key");

assert.ok(migration.includes("create table if not exists public.school_planning_records"), "Planning progress persistence table must exist");
assert.ok(migration.includes("enable row level security") && migration.includes("revoke all on public.school_planning_records from anon, authenticated"), "Planning records must not be directly accessible to public or authenticated clients");
assert.ok(migration.includes("grant all on public.school_planning_records to service_role"), "Only trusted service role should access planning records directly");
assert.ok(edge.includes('from("account_settings")') && edge.includes('from("school_memberships")'), "Edge Function must verify account profile and active school membership");
assert.ok(edge.includes("managerRoles.has(role)") && edge.includes("managerRoles.has(normalize(item.role))"), "Edge Function must enforce manager-only access at both profile and membership boundaries");
assert.ok(edge.includes('.eq("school_id", schoolId)') && edge.includes('from("school_planning_records")'), "Every planning record operation must be scoped to the authenticated school");
assert.ok(edge.includes('from("students")') && edge.includes('.eq("tenant_school_id", schoolId)'), "Registered student count must be scoped to the manager's school");
assert.ok(publish.includes("'school-planning.html'") && publish.includes("school-planning.html") && publish.includes("test -s _site/school-planning.html"), "GitHub Pages workflow must package and verify the planning page");
console.log("School operating roadmap checks passed.");
