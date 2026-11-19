import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync("school-planning.html", "utf8");
const portal = readFileSync("portal.html", "utf8");
const migration = readFileSync("supabase/migrations/20261119110000_school_planning_center.sql", "utf8");
const edge = readFileSync("supabase/functions/school-planning/index.ts", "utf8");
const publish = readFileSync(".github/workflows/publish-six-icon-portal.yml", "utf8");

for (const label of ["برنامه سالانه", "تقویم اجرایی", "مدرسه تراز", "برنامه عملیاتی", "چالش روزانه"]) {
  assert.ok(page.includes(label), "Planning center must expose " + label);
}
for (const type of ["annual_plan", "calendar_event", "balanced_assessment", "operational_plan", "daily_challenge"]) {
  assert.ok(page.includes(type), "Planning center must define fields for " + type);
}
assert.ok(page.includes("const academicYear=\"۱۴۰۵–۱۴۰۶\""), "Planning center must use the selected academic year");
assert.ok(page.includes("جمعیت مبنای برنامه‌ریزی") && page.includes("registered_students_count"), "The declared 240-student planning baseline must be compared with the live registered count");
assert.ok(page.includes("buildRecommendations") && page.includes("با استفاده از زمان و امکانات موجود مدرسه"), "Daily challenge suggestions must prioritize feasible low-cost actions");
assert.ok(page.includes("نه از یک مدل هوش مصنوعی متصل به اینترنت"), "The UI must disclose that challenge suggestions are rule-based, not a live AI response");
assert.ok(page.includes("هیچ نام یا مشخصات فردی وارد نکنید"), "The challenge form must warn against entering student identifiers");
const script = page.match(/<script>\s*([\s\S]*?)<\/script>/);
assert.ok(script, "Planning center must contain its application script");
assert.doesNotThrow(() => new Function(script[1]), "Planning center JavaScript must parse");
const start = script[1].indexOf("function buildRecommendations(d){");
const end = script[1].indexOf("function showRecommendations(list){", start);
assert.ok(start >= 0 && end > start, "Challenge recommendation function must be extractable for deterministic tests");
const build = new Function(script[1].slice(start, end) + "; return buildRecommendations;")();
const attendance = build({category:"غیبت و بی‌نظمی حضور",facts:"افزایش غیبت دوشنبه‌ها",limits:"هزینه محدود",resources:"معاون اجرایی"});
assert.equal(attendance.length, 3, "Challenge analysis must return staged actions");
assert.ok(attendance[0].phase.includes("امروز"), "First challenge action must be immediate");
assert.ok(attendance.every(x => x.owner && x.measure && x.action.includes("هزینه")), "Every suggested action must include an owner, a measurable follow-up, and low-cost framing");
assert.ok(attendance.every(x => x.action.includes("افزایش غیبت دوشنبه‌ها") && x.action.includes("معاون اجرایی")), "Challenge suggestions must explicitly use the manager-entered facts and available school capacity");
const learning = build({category:"افت یادگیری",facts:"ضعف در یک مبحث"});
assert.ok(learning.some(x => x.measure.includes("سنجش")), "Learning challenge must include a before/after measurement");

assert.ok(portal.includes("مرکز برنامه‌ریزی مدرسه"), "Manager portal must expose the planning center");
assert.ok(portal.includes("selectedRole.id==='manager'&&name==='مرکز برنامه‌ریزی مدرسه'"), "Planning center route must be limited to manager panel");
assert.ok(portal.includes("portalAuthUserRole!=='manager'") && portal.includes("school-planning.html?v=20261119-planning-1"), "Planning center route must validate the authenticated manager and open the new page");

assert.ok(migration.includes("create table if not exists public.school_planning_records"), "Planning records table migration must exist");
assert.ok(migration.includes("enable row level security") && migration.includes("revoke all on public.school_planning_records from anon, authenticated"), "Planning records must not be directly accessible to public or authenticated clients");
assert.ok(migration.includes("grant all on public.school_planning_records to service_role"), "Only the trusted service role should access planning records directly");
assert.ok(edge.includes('from("account_settings")') && edge.includes('from("school_memberships")'), "Edge Function must verify account profile and active school membership");
assert.ok(edge.includes("managerRoles.has(role)") && edge.includes("managerRoles.has(normalize(item.role))"), "Edge Function must enforce manager-only access at both profile and membership boundaries");
assert.ok(edge.includes('.eq("school_id", schoolId)') && edge.includes('.eq("school_id", schoolId)'), "Every planning record operation must be scoped to the authenticated school");
assert.ok(edge.includes('from("students")') && edge.includes('.eq("tenant_school_id", schoolId)'), "Registered student count must be scoped to the manager's school");
assert.ok(publish.includes("'school-planning.html'") && publish.includes("school-planning.html") && publish.includes("test -s _site/school-planning.html"), "GitHub Pages workflow must package and verify the new page");
console.log("Manager school planning center checks passed.");
