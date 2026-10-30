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
const reportScripts = [...reports.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match => match[1]).filter(source => source.trim());
assert.ok(reportScripts.length > 0, "Reports page must contain its interactive script");
for (const source of reportScripts) assert.doesNotThrow(() => new Function(source), "Reports page script must have valid JavaScript syntax");
console.log("Reports checks passed: protected API, attendance/grades/discipline, exports, read-only behavior, and JavaScript syntax.");


const parentPage = readFileSync("parent-management.html", "utf8");
const parentFunction = readFileSync("supabase/functions/parent-management/index.ts", "utf8");
assert.ok(html.includes("const parentTabs={") && html.includes("'درخواست انجمن اولیا و مربیان':'associations'"), "Parent menu entries must route to their matching operational tabs");
assert.ok(html.includes("location.href='parent-meetings.html?v=20261030-2'"), "Parent meetings must route to the operational request form with cache refresh");
assert.ok(html.includes("'درخواست انجمن اولیا و مربیان':'associations'"), "Parent association menu must route to its request form");

assert.ok(parentPage.includes("new URLSearchParams(location.search).get('tab')||'files'"), "Parent management must read the requested tab from the URL");
assert.ok(parentPage.includes("activateTab(requestedTab)"), "Parent management must activate the requested tab on load");
assert.ok(parentPage.includes("Boolean(s.class_name)&&x.class_name===s.class_name"), "Class-level assignments must be scoped to the selected child's class");
assert.ok(parentPage.includes("d.schedule.filter(x=>x.class_name===s.class_name)"), "Weekly schedule must be scoped to the selected child's class");
assert.ok(parentPage.includes("Boolean(s&&s.grade)&&x.grade===s.grade"), "Exams must be scoped to the selected child's grade");
assert.ok(parentPage.includes("Boolean(s)&&+x.student_id===+s.id"), "Payments must be scoped to the selected child");
assert.ok(parentFunction.includes('.eq("parent_username",clean(c.username)).limit(1000)'), "Parent-child lookup must support more than two children");
assert.ok(parentFunction.includes("const safeAssignments=") && parentFunction.includes("assignments:safeAssignments"), "The Edge Function must filter class-level assignments to linked child classes");
const parentScripts = [...parentPage.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match => match[1]).filter(source => source.trim());
assert.ok(parentScripts.length > 0, "Parent management page must contain its operational script");
for (const source of parentScripts) assert.doesNotThrow(() => new Function(source), "Parent management script must have valid JavaScript syntax");
console.log("Parent panel checks passed: routes, tab selection, selected-child scoping, multi-child links, assignment privacy, and JavaScript syntax.");

const meetingPage = readFileSync("parent-meetings.html", "utf8");
assert.ok(meetingPage.includes("call('context')"), "Meeting form must use authenticated server context");
assert.ok(meetingPage.includes('id="parentForm"'), "Meeting request form must remain present");
assert.ok(parentPage.includes('id="associationRequestForm"'), "Parent portal must provide an association request form");
assert.ok(parentPage.includes("create_association") && parentPage.includes("associationRequests"), "Parent portal must submit and display association requests");
assert.ok(parentFunction.includes('action==="create_association"') && parentFunction.includes('parent_association_requests'), "Parent API must securely persist association requests");
assert.ok(parentFunction.includes('action==="review_association"'), "Manager must be able to review association requests");


const publishWorkflow = readFileSync(".github/workflows/publish-six-icon-portal.yml", "utf8");
assert.ok(publishWorkflow.includes("- 'directory.html'"), "Changes to directory.html must trigger GitHub Pages deployment");
assert.ok(publishWorkflow.includes("bulletin.html directory.html _site/"), "GitHub Pages artifact must include directory.html");
assert.ok(readFileSync("directory.html", "utf8").includes("دبیران و کارکنان"), "Staff directory page must exist in the repository");
console.log("Staff directory deployment checks passed: trigger, published artifact, and page source.");


const counselorPage = readFileSync("counseling.html", "utf8");
assert.ok(html.includes("location.href='counseling.html?tab='"), "Counselor page must open on the portal origin so sessionStorage is shared");
assert.ok(!html.includes("raw.githack.com/mard7946-dev/amoozesh-hooshmand-novin-frahoosh/main/counseling.html"), "Counselor route must not cross origins and lose the session token");
assert.ok(counselorPage.includes('name="event_weekday"') && counselorPage.includes('name="event_date_shamsi"') && counselorPage.includes('name="title"'), "Counselor invitation form must collect weekday, date, and subject");
assert.ok(counselorPage.includes("approval_status") && counselorPage.includes("در انتظار تأیید مدیر"), "Counselor must see that invitations await manager approval");
const counselorScripts = [...counselorPage.matchAll(/<script(?:\\s[^>]*)?>([\\s\\S]*?)<\\/script>/gi)].map(match => match[1]).filter(source => source.trim());
for (const source of counselorScripts) assert.doesNotThrow(() => new Function(source), "Counselor page script must have valid JavaScript syntax");
assert.ok(parentPage.includes("data-family-review") && parentPage.includes("action:'review'"), "Manager must be able to approve or reject family invitations");
assert.ok(parentPage.includes("تأیید و انتشار برای اولیا"), "Manager approval must publish the invitation for parents");
const familyFunction = readFileSync("supabase/functions/family-education/index.ts", "utf8");
assert.ok(familyFunction.includes('action === "review"') && familyFunction.includes('approval_status: status'), "Family education API must persist manager approval");
assert.ok(familyFunction.includes('.eq("approval_status", "approved")'), "Parents must only receive manager-approved invitations");
const familyMigration = readFileSync("supabase/migrations/20261030140000_family_invitation_manager_approval.sql", "utf8");
assert.ok(familyMigration.includes("approval_status") && familyMigration.includes("event_weekday"), "Family invitation migration must add approval and weekday fields");
assert.ok(publishWorkflow.includes("- 'counseling.html'") && publishWorkflow.includes("directory.html counseling.html _site/"), "GitHub Pages must publish the counselor page");
console.log("Counselor invitations checks passed: same-origin session, weekday/date/subject, manager approval, parent visibility, and publication.");
