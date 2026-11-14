import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const html = readFileSync("portal.html", "utf8");
assert.ok(html.includes("async function restorePanelOrShowEntry()") && html.includes("openAuthenticatedPanel(panelRole,savedRole"), "Returning to step=panel must restore the authenticated user's role-specific panel");
assert.ok(html.includes("supabaseUrl+'/auth/v1/user'") && html.includes("sessionStorage.getItem('frahoosh_novin_access_token')"), "Panel restoration must validate the saved Supabase session before rendering the panel");
assert.ok(html.includes("educational_deputy:'deputy'") && html.includes("executive_deputy:'deputy'") && html.includes("pastoral_deputy:'deputy'"), "All deputy account roles must return to the shared deputy portal");

assert.ok(html.includes("/functions/v1/school-portal-login"), "Portal must use the school-code aware portal login function");
assert.ok(html.includes('id="schoolCodeRow"') && html.includes('id="schoolCode"'), "Portal must collect a school code for every role");
assert.ok(html.includes("school_code:document.getElementById('schoolCode').value.trim()"), "Portal must submit the selected school code");
const schoolLogin = readFileSync("supabase/functions/school-portal-login/index.ts", "utf8");
assert.ok(schoolLogin.includes("body?.school_code") && schoolLogin.includes("profile.tenant_school_id"), "School login must resolve the authenticated account's school");
assert.ok(schoolLogin.includes('normalize(school.school_code) !== normalize(schoolCode)'), "School login must reject a mismatched school code");
assert.ok(schoolLogin.includes('.eq("tenant_school_id", school.id)'), "Student lookup must be restricted to the selected school");
assert.ok(schoolLogin.includes("hasActiveSubscription"), "School login must require an active school subscription");
const schoolNameWithZwnj = "دبیرستان سردار شهید حاجی\u200cزاده ۲";
const schoolNameForDisplay = schoolNameWithZwnj.replace(/[\u200f\u202a-\u202e]/g, "").trim();
assert.equal(schoolNameForDisplay, schoolNameWithZwnj, "School login display name must preserve the Persian ZWNJ in حاجی‌زاده");
assert.ok(schoolLogin.includes('school_name: String(school.name ?? "").replace(/[\\u200f\\u202a-\\u202e]/g, "").trim()'), "School login must preserve the stored Persian school-name formatting");
const schoolNameNormalizerSource = html.match(/function normalizeSchoolDisplayName\(value\)\{[\s\S]*?\}/)?.[0];
assert.ok(schoolNameNormalizerSource, "Portal must normalize known school-name variants before display");
const normalizeSchoolDisplayName = new Function(schoolNameNormalizerSource + "; return normalizeSchoolDisplayName;")();
assert.equal(normalizeSchoolDisplayName("دبیرستان سردار شهید حاجیزاده ۲"), schoolNameWithZwnj, "Login must restore the ZWNJ and exact canonical school name when profile metadata is compacted");
assert.equal(normalizeSchoolDisplayName("دبیرستان سردار شهید حاجی‌زاده ۲"), schoolNameWithZwnj, "Canonical school name must remain unchanged");
assert.equal(normalizeSchoolDisplayName("مدرسه نمونه"), "مدرسه نمونه", "Other school names must not be rewritten");
assert.ok(html.includes("normalizeSchoolDisplayName(schoolName)"), "Fresh login must display the normalized school name");
assert.ok(html.includes("normalizeSchoolDisplayName(user.user_metadata?.school_name)"), "Restored sessions must display the normalized school name too");
const usernameLogin = readFileSync("supabase/functions/login-by-username/index.ts", "utf8");
assert.ok(usernameLogin.includes("must_change_password"), "Username login must enforce the server-side first-login password gate");
assert.ok(usernameLogin.includes("change_parent_initial_password") && usernameLogin.includes("password_changed: true"), "Username login must change the initial parent password without returning a session");
assert.ok(usernameLogin.includes("school_code") && usernameLogin.includes("account.data?.national_code"), "Initial parent password change must validate school and national-code account identity");
assert.ok(schoolLogin.includes("loginResponse.status === 428") && schoolLogin.includes("login.password_changed === true"), "School portal login must relay the auth-boundary first-login gate");
const parentAdmin = readFileSync("supabase/functions/admin-manage-users/index.ts", "utf8");
assert.ok(parentAdmin.includes("temporaryPassword = group.parentCode") && parentAdmin.includes("must_change_password: true"), "New parent accounts must use national code as temporary password and set a forced-reset flag");
assert.ok(parentAdmin.includes("action === \"reset_parent_password\"") && parentAdmin.includes("must_change_password: true"), "Manager must be able to reset a parent password and re-enable forced reset");
assert.ok(parentAdmin.includes('action === "reset_student_accounts"') && parentAdmin.includes('"RESET_ALL_STUDENTS"'), "Manager-only bulk student reset must require explicit confirmation");
assert.ok(parentAdmin.includes('eq("tenant_school_id", schoolId)') && parentAdmin.includes('must_change_password: true'), "Student accounts must be limited to the current school and forced to change their temporary password");
assert.ok(usernameLogin.includes("change_student_initial_password") && usernameLogin.includes('accountRole === "student"'), "Student first login must be forced through a server-side password change");
assert.ok(usernameLogin.includes("change_manager_initial_password") && usernameLogin.includes('accountRole === "manager"') && usernameLogin.includes("owner_auth_user_id"), "Manager first login must validate school ownership before changing the initial password");
assert.ok(schoolLogin.includes('"change_student_initial_password"'), "School portal login must relay the student password-change completion response");
assert.ok(html.includes("change_student_initial_password") && html.includes("change_manager_initial_password") && html.includes("requestedRole"), "Student and manager portals must show and submit first-login password changes");
assert.ok(html.includes('selectedRole.id==="manager"?"login-by-username":"school-portal-login"'), "Manager first-password changes must use the same direct authentication endpoint that validates and changes the manager initial password; parent/student flows remain on the school portal wrapper");
assert.ok(usernameLogin.includes('action !== "change_manager_initial_password"') && usernameLogin.includes('password_changed: true'), "Manager initial-password changes must be completed by the authentication boundary and return an explicit success response");
const usersPage = readFileSync("users.html", "utf8");
assert.ok(usersPage.includes('id="resetAllStudentAccounts"') && usersPage.includes('action:"reset_student_accounts"'), "Manager user page must expose the confirmed bulk student reset control");

for (const file of ["supabase/functions/parent-management/index.ts", "supabase/functions/parent-meetings/index.ts", "supabase/functions/family-education/index.ts"]) {
  const source = readFileSync(file, "utf8");
  assert.ok(source.includes("must_change_password"), file + " must block parent services during forced password reset");
}
const parentGateMigration = readFileSync("supabase/migrations/20261107133000_enforce_parent_first_login_password_change.sql", "utf8");
assert.ok(parentGateMigration.includes("auth.users") && parentGateMigration.includes("raw_app_meta_data"), "RLS must check the current server-side Auth metadata, including already-issued tokens");
assert.ok(parentGateMigration.includes("account_settings_authenticated_select") && parentGateMigration.includes("frahoosh_current_parent_matches"), "RLS must block both direct profile joins and helper-based parent access");
assert.ok(html.includes("sb_publishable_"), "Portal must use a public Supabase publishable key");
assert.ok(!html.includes("frahoosh-live-classroom-edge.mard7946.workers.dev"), "Portal must not call the legacy classroom Worker");
assert.ok(!html.includes("sso-ticket"), "Portal must not request legacy classroom SSO tickets");
assert.ok(!html.includes("new URL('classroom.html'"), "Portal must not bypass the new classroom's authenticated room access");
assert.ok(html.includes("data.profile.available_roles.includes('teacher')"), "Dual-role deputy accounts must be offered the teacher choice after deputy login");
assert.ok(html.includes("openAuthenticatedPanel('deputy','deputy')") && html.includes("openAuthenticatedPanel('teacher','teacher')"), "Deputy and teacher choices must activate separate session roles");
assert.ok(html.includes("sessionStorage.setItem('frahoosh_novin_role',effectiveRole)"), "The selected role must be stored for the authenticated session");
const classroomAuthorize = readFileSync("supabase/functions/classroom-authorize/index.ts", "utf8");
assert.ok(classroomAuthorize.includes('.from("school_memberships")') && classroomAuthorize.includes("hasTeacherMembership"), "Classroom authorization must verify an active teacher membership on the server");
assert.ok(classroomAuthorize.includes('requestedRole === "teacher"') && classroomAuthorize.includes('role = "teacher"'), "Classroom authorization must honor a validated secondary teacher role");
assert.ok(classroomAuthorize.includes("teacher_id,teacher_name,teacher_username") && classroomAuthorize.includes("Number(entry.teacher_id) === teacherId"), "Teacher timetable lookup must use the linked teacher record ID");
const classroomManagement = readFileSync("supabase/functions/classroom-management/index.ts", "utf8");
assert.ok(classroomManagement.includes('.from("school_memberships")') && classroomManagement.includes("body.active_role"), "Classroom management must validate the selected role against active memberships");
assert.ok(classroomManagement.includes('requestedRole === "teacher" && role !== "teacher"'), "Classroom management must reject an unverified secondary teacher role");
const returnHelper = readFileSync("panel-return.js", "utf8");
assert.ok(returnHelper.includes("frahoosh_novin_role") && returnHelper.includes("portal.html"), "Shared return helper must preserve the signed-in role and resolve the portal path");
const schedulePage = readFileSync("classroom/schedule.html", "utf8");
assert.ok(schedulePage.includes("active_role:activeRole"), "Weekly schedule requests must carry the selected role");
const classroomPage = readFileSync("classroom/index.html", "utf8");
assert.ok(classroomPage.includes("active_role:activeRole") && classroomPage.includes("schedule_entry_id:scheduleEntryId"), "Room authorization must carry selected role and exact schedule entry");
assert.ok(schedulePage.includes("frahooshReturnToPanel(activeRole||'teacher')"), "Weekly schedule back button must return to the selected user's portal panel");
assert.ok(classroomPage.includes("frahooshReturnToPanel(profile?.role||'teacher')"), "Leaving an online class must return to the user panel without clearing the authenticated session");
const classroomManagementPage = readFileSync("classroom/management.html", "utf8");
assert.ok(classroomManagementPage.includes("active_role:role"), "Classroom management requests must carry the selected role");


const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1]).filter(source => source.trim());
assert.ok(scripts.length > 0, "Portal must contain its interactive script");
for (const source of scripts) {
  assert.doesNotThrow(() => new Function(source), "Portal script must have valid JavaScript syntax");
}
for (const role of ["manager", "deputy", "teacher", "parent", "student", "counselor"]) {
  assert.ok(html.includes("id:'" + role + "'"), "Missing portal role: " + role);
}
const platformAdminPage = readFileSync("platform-admin.html", "utf8");
assert.ok(platformAdminPage.includes('id="platformLoginForm"'), "Platform admin page must provide its own login form");
assert.ok(platformAdminPage.includes('/functions/v1/login-by-username'), "Platform admin page must authenticate directly without depending on a school portal tab");
assert.ok(platformAdminPage.includes('body:JSON.stringify({username:$("platformUsername").value.trim(),password:$("platformPassword").value})'), "Platform admin login must authenticate credentials without forcing a school-manager role");
assert.ok(platformAdminPage.includes('sessionStorage.setItem("frahoosh_novin_access_token",token)'), "Platform admin login must retain the token in the same origin session");
assert.ok(platformAdminPage.includes('platformLogin").hidden=true'), "Platform admin page must hide the login form only after successful authorization");
const platformFunction = readFileSync("supabase/functions/platform-management/index.ts", "utf8");
assert.ok(platformFunction.includes('.from("platform_admins")') && platformFunction.includes('.eq("auth_user_id", auth.user.id)'), "Platform management API must independently enforce platform-admin membership");
const platformScripts = [...platformAdminPage.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match => match[1]).filter(source => source.trim());
assert.ok(platformScripts.length > 0, "Platform admin page must contain its interactive script");
for (const source of platformScripts) assert.doesNotThrow(() => new Function(source), "Platform admin script must have valid JavaScript syntax");
console.log("Platform admin checks passed: direct login, token handling, server-side allowlist, and JavaScript syntax.");

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


const financePage = readFileSync("finance.html", "utf8");
const financeScripts = financePage.split("<script>").slice(1).map(part => part.split("</script>")[0]).filter(source => source.trim());
assert.ok(financeScripts.length > 0, "Finance page must contain its operational script");
for (const source of financeScripts) assert.doesNotThrow(() => new Function(source), "Finance script must have valid JavaScript syntax");
assert.ok(financePage.includes("async function apiAll(path,pageSize=1000)") && !financePage.includes("finance_vouchers?select=*&order=created_at.desc&limit=500"), "Finance reports must page through the complete ledger instead of silently truncating at fixed limits");
assert.ok(financePage.includes("rpc/finance_create_voucher_draft") && financePage.includes("p_lines:lines.map"), "Voucher header and journal lines must be created through one atomic server transaction");
assert.ok(financePage.includes("rpc/finance_post_voucher"), "Final posting must use the server-side balance validation RPC");
assert.ok(financePage.includes("file.name.replace(/[^A-Za-z0-9._-]/g,'_')"), "Finance attachment names must be normalized before using them in private storage paths");
assert.ok(financePage.includes("پیش‌نویس شماره ") && financePage.includes("ثبت قطعی انجام نشد"), "The UI must distinguish a saved draft from a failed final posting");
const financeMigration = readFileSync("supabase/migrations/20261107150000_atomic_finance_voucher_creation.sql", "utf8");
assert.ok(financeMigration.includes("finance_create_voucher_draft") && financeMigration.includes("security invoker"), "Atomic voucher creation must execute with the authenticated user's RLS permissions");
assert.ok(financeMigration.includes("frahoosh_current_school_id") && financeMigration.includes("frahoosh_current_role"), "Atomic voucher creation must enforce school and accounting role scope");
assert.ok(financeMigration.includes("v_debit <> v_credit") && financeMigration.includes("finance_voucher_lines"), "Atomic voucher creation must validate balance and persist all journal lines in one transaction");
assert.ok(financeMigration.includes("students s") && financeMigration.includes("s.tenant_school_id=v_school"), "Student-linked lines must validate the student belongs to the authenticated school");

const bulletinPage = readFileSync("bulletin.html", "utf8");
const userAdminPage = readFileSync("users.html", "utf8");
const counselingPage = readFileSync("counseling.html", "utf8");
const examPage = readFileSync("exam-center.html", "utf8");
assert.ok(financePage.includes("frahooshReturnToPanel('manager')"), "Finance back button must return to the manager panel");
assert.ok(bulletinPage.includes("frahooshReturnToPanel(role||'manager')"), "Bulletin back button must preserve the signed-in role");
assert.ok(userAdminPage.includes("frahooshReturnToPanel('manager')"), "User administration back button must return to the manager panel");
assert.ok(counselingPage.includes("frahooshReturnToPanel('counselor')"), "Counseling back button must preserve the signed-in role");
assert.ok(examPage.includes("frahooshReturnToPanel('teacher')"), "Exam center back button must preserve the signed-in role");
const parentPage = readFileSync("parent-management.html", "utf8");
const parentFunction = readFileSync("supabase/functions/parent-management/index.ts", "utf8");
assert.ok(html.includes("const parentTabs={") && html.includes("'درخواست انجمن اولیا و مربیان':'associations'"), "Parent menu entries must route to their matching operational tabs");
assert.ok(html.includes("location.href='parent-meetings.html?v=20261030-2'"), "Parent meetings must route to the operational request form with cache refresh");
assert.ok(html.includes("'درخواست انجمن اولیا و مربیان':'associations'"), "Parent association menu must route to its request form");
assert.ok(html.includes("'آموزش خانواده':'family'") && html.includes("parent-management.html?tab=family"), "Parent and manager portals must open the family education tab");

assert.ok(parentPage.includes("new URLSearchParams(location.search).get('tab')||'files'"), "Parent management must read the requested tab from the URL");
assert.ok(parentPage.includes("activateTab(requestedTab)"), "Parent management must activate the requested tab on load");
assert.ok(parentPage.includes("Boolean(s.class_name)&&x.class_name===s.class_name"), "Class-level assignments must be scoped to the selected child's class");
assert.ok(parentPage.includes("d.schedule.filter(x=>x.class_name===s.class_name)"), "Weekly schedule must be scoped to the selected child's class");
assert.ok(parentPage.includes("Boolean(s&&s.grade)&&x.grade===s.grade"), "Exams must be scoped to the selected child's grade");
assert.ok(parentPage.includes("Boolean(s)&&+x.student_id===+s.id"), "Payments must be scoped to the selected child");
assert.ok(parentFunction.includes('.in("parent_username",parentIdentityKeys).limit(1000)'), "Parent-child lookup must support more than two children");
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
assert.ok(publishWorkflow.includes("bulletin.html directory.html counseling.html exam-center.html exam-entry-cards.html _site/"), "GitHub Pages artifact must include directory.html");
assert.ok(readFileSync("directory.html", "utf8").includes("دبیران و کارکنان"), "Staff directory page must exist in the repository");
const directory = readFileSync("directory.html", "utf8");
assert.ok(directory.includes("/rest/v1/teacher_classes?"), "Directory must read teacher assignments from Supabase REST");
assert.ok(directory.includes("tenant_school_id=eq.'+SCHOOL_ID") && directory.includes("&active=eq.1"), "Teacher assignments must be restricted to the active school and active rows");
assert.ok(directory.includes("'Authorization':'Bearer '+token") && directory.includes("'apikey':SUPABASE_KEY"), "Teacher assignment requests must use the signed-in user's token and public key");
assert.ok(directory.includes("assignmentMap.get(Number(p.id))"), "Teacher assignments must be joined to profiles by teacher ID");
assert.ok(directory.includes("const classKey=p=>String(p.grade||'پایه ثبت نشده').trim()+'::'"), "Student classes must be grouped by both grade and class name");
const directoryScripts = [...directory.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match => match[1]).filter(source => source.trim());
assert.ok(directoryScripts.length > 0, "Directory must contain its interactive script");
for (const source of directoryScripts) assert.doesNotThrow(() => new Function(source), "Directory script must have valid JavaScript syntax");
console.log("Staff directory deployment checks passed: trigger, published artifact, and page source.");


const parentInvitationsPage = readFileSync("parent-invitations.html", "utf8");
assert.ok(html.includes("دعوت‌نامه‌های من") && html.includes("parent-invitations.html?v="), "Parent portal must expose a separate invitation inbox");
assert.ok(publishWorkflow.includes("- 'parent-invitations.html'") && publishWorkflow.includes("parent-invitations.html"), "GitHub Pages must trigger on and publish the standalone parent invitation page");
assert.ok(parentPage.includes("دعوت‌نامه‌ها در صفحه مستقل «دعوت‌نامه‌های من»") && parentPage.includes("const rows=role==='manager'?(d.familyInvitations||[]):[]"), "Parent family education tab must not render invitations");
assert.ok(parentInvitationsPage.includes("action:'list'") && parentInvitationsPage.includes("action:'respond'") && parentInvitationsPage.includes("approval_status==='approved'"), "Standalone parent invitation page must list only approved invitations and submit parent responses");
const parentInvitationsScripts = parentInvitationsPage.split("<script>").slice(1).map(part => part.split("</script>")[0]).filter(source => source.trim());
assert.ok(parentInvitationsScripts.length > 0, "Standalone parent invitation page must contain its operational script");
for (const source of parentInvitationsScripts) assert.doesNotThrow(() => new Function(source), "Standalone parent invitation script must have valid JavaScript syntax");

const invitationReviewPage = readFileSync("family-invitations-review.html", "utf8");
const invitationReviewWorkflow = readFileSync(".github/workflows/publish-six-icon-portal.yml", "utf8");
assert.ok(html.includes("تأیید دعوت‌نامه‌های اولیا") && html.includes("family-invitations-review.html?v="), "Manager portal must expose and route to parent invitation approvals");
assert.ok(invitationReviewWorkflow.includes("- 'family-invitations-review.html'") && invitationReviewWorkflow.includes("family-invitations-review.html") && invitationReviewWorkflow.includes("_site/"), "GitHub Pages must trigger on and publish the manager invitation review page");
assert.ok(invitationReviewPage.includes("action:'review'") && invitationReviewPage.includes("batch_id,status,manager_note"), "Manager review page must submit batch-level approval decisions");
assert.ok(invitationReviewPage.includes("role!=='manager'") && invitationReviewPage.includes("data-filter"), "Manager review page must enforce the manager session and provide status filters");
const invitationReviewScripts = invitationReviewPage.split("<script>").slice(1).map(part => part.split("</script>")[0]).filter(source => source.trim());
assert.ok(invitationReviewScripts.length > 0, "Manager invitation review page must contain its application script");
for (const source of invitationReviewScripts) assert.doesNotThrow(() => new Function(source), "Manager invitation review script must have valid JavaScript syntax");

const counselorPage = readFileSync("counseling.html", "utf8");
assert.ok(html.includes("location.href='counseling.html?tab='"), "Counselor page must open on the portal origin so sessionStorage is shared");
assert.ok(!html.includes("raw.githack.com/mard7946-dev/amoozesh-hooshmand-novin-frahoosh/main/counseling.html"), "Counselor route must not cross origins and lose the session token");
assert.ok(counselorPage.includes('name="event_weekday"') && counselorPage.includes('name="event_date_shamsi"') && counselorPage.includes('name="title"'), "Counselor invitation form must collect weekday, date, and subject");
assert.ok(counselorPage.includes("approval_status") && counselorPage.includes("در انتظار تأیید مدیر"), "Counselor must see that invitations await manager approval");
const counselorScripts = [...counselorPage.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match => match[1]).filter(source => source.trim());
for (const source of counselorScripts) assert.doesNotThrow(() => new Function(source), "Counselor page script must have valid JavaScript syntax");
assert.ok(parentPage.includes("data-family-review") && parentPage.includes("action:'review'"), "Manager must be able to approve or reject family invitations");
assert.ok(parentPage.includes("تأیید و انتشار برای اولیا"), "Manager approval must publish the invitation for parents");
const familyFunction = readFileSync("supabase/functions/family-education/index.ts", "utf8");
assert.ok(familyFunction.includes('action === "review"') && familyFunction.includes('approval_status: status'), "Family education API must persist manager approval");
assert.ok(familyFunction.includes('.eq("approval_status", "approved")'), "Parents must only receive manager-approved invitations");
const familyMigration = readFileSync("supabase/migrations/20261030140000_family_invitation_manager_approval.sql", "utf8");
assert.ok(familyMigration.includes("approval_status") && familyMigration.includes("event_weekday"), "Family invitation migration must add approval and weekday fields");
assert.ok(familyFunction.includes("student_id: studentRecord?.id ?? null") && familyFunction.includes(".eq(\"role\", \"parent\")"), "Counselor invitation must support sending to every parent account without selecting a student");
const audienceMigration = readFileSync("supabase/migrations/20261030143000_family_invitation_schoolwide_audience.sql", "utf8");
assert.ok(audienceMigration.includes("alter column student_id drop not null"), "School-wide invitations must not require a single student");
const batchMigration = readFileSync("supabase/migrations/20261030150000_family_invitation_batch_approval.sql", "utf8");
assert.ok(batchMigration.includes("invitation_batch_id") && parentPage.includes("recipient_count") && parentPage.includes("batch_id:batchId"), "Manager must approve one grouped invitation for all parent recipients");
assert.ok(familyFunction.includes("invitation_batch_id: invitationBatchId"), "Every recipient copy must share one approval batch");

assert.ok(parentPage.includes('id="familySendForm"') && parentPage.includes('id="familyAudience"'), "Manager family education tab must provide a real group invitation form and audience selector");
assert.ok(parentPage.includes('id="familyClass"') && parentPage.includes("اولیای یک کلاس مشخص"), "Manager must be able to select a specific class for parent invitations");
assert.ok(parentPage.includes("action:'create',audience,class_name:audience==='class'?className:null"), "Family education form must submit the selected audience and class to the protected API");
assert.ok(parentPage.includes("دعوت‌نامه برای '+x.count+' شناسه ولی ثبت شد"), "Family education UI must report the actual recipient count");
assert.ok(familyFunction.includes('audience === "all"') && familyFunction.includes('audience === "class"'), "Family education API must support school-wide and class-wide audiences");
assert.ok(familyFunction.includes('.eq("class_name", className)') && familyFunction.includes('.in("student_id", studentIds)'), "Class-wide invitations must resolve only parents linked to students in the selected class");
assert.ok(familyFunction.includes('.eq("is_active", true)') && familyFunction.includes('.eq("role", "parent")'), "Bulk invitations must only target active parent memberships");
assert.ok(familyFunction.includes('studentName = "اولیای کلاس " + className'), "Class-wide invitations must preserve the selected class as the audience label");
assert.ok(familyFunction.includes('approval_status: isManager ? "approved" : "pending"') && familyFunction.includes("manager_reviewed_by: isManager ? authData.user.id : null"), "Manager-created invitations must publish immediately while counselor invitations remain pending review");
assert.ok(parentPage.includes("x.approval_status==='approved'?'دعوت‌نامه برای '"), "Manager UI must confirm immediate publication separately from counselor approval");
assert.ok(publishWorkflow.includes("- 'counseling.html'") && publishWorkflow.includes("directory.html counseling.html exam-center.html exam-entry-cards.html _site/"), "GitHub Pages must publish the counselor page");
console.log("Counselor invitations checks passed: same-origin session, weekday/date/subject, manager approval, parent visibility, and publication.");

const examsPage = readFileSync("exam-center.html", "utf8");
assert.ok(html.includes("آزمون‌های مستقل") && html.includes("location.href='exam-center.html?v=20261030-1'"), "Teacher and student portals must route to the independent exam center");
assert.ok(publishWorkflow.includes("- 'exam-center.html'") && publishWorkflow.includes("counseling.html exam-center.html exam-entry-cards.html _site/"), "GitHub Pages must publish the independent exam center");
assert.ok(examsPage.includes("functions/v1/assessment-center"), "Independent exam page must use its dedicated backend function");
for (const feature of ["جای خالی", "تستی / چهارگزینه‌ای", "صحیح و غلط", "پاسخ کوتاه", "پاسخ تشریحی", "ترتیب سؤال", "زمان اختصاصی سؤال", "نمایش گروهی"]) {
  assert.ok(examsPage.includes(feature), "Independent exam center missing feature: " + feature);
}
assert.ok(examsPage.includes("data-symbol") && examsPage.includes("data-shape"), "Question editor must provide math symbols and geometric shapes");
assert.ok(examsPage.includes("functions/v1/assessment-center") && examsPage.includes("create_exam"), "Independent exam page must call its dedicated create action");
const examScripts = examsPage.split("<script>").slice(1).map(part => part.split("</script>")[0]).filter(source => source.trim());
assert.ok(examScripts.length > 0, "Independent exam page must contain its application script");
for (const source of examScripts) assert.doesNotThrow(() => new Function(source), "Independent exam page script must have valid JavaScript syntax");
const assessmentFunction = readFileSync("supabase/functions/assessment-center/index.ts", "utf8");
assert.ok(assessmentFunction.includes('action === "create_exam"') && assessmentFunction.includes('action === "start_exam"') && assessmentFunction.includes('action === "submit_exam"'), "Assessment API must support authoring, starting, and submitting exams");
assert.ok(assessmentFunction.includes('.eq("teacher_id", teacher.id)') && assessmentFunction.includes("classAllowed"), "Assessment API must restrict teachers to their own assigned classes");
assert.ok(assessmentFunction.includes('.from("school_memberships")') && assessmentFunction.includes('.eq("is_active", true)') && assessmentFunction.includes("expectedMembershipRoles"), "Assessment API must require an active membership with the matching school role");
const classroomLoginFunction = readFileSync("supabase/functions/classroom-login/index.ts", "utf8");
assert.ok(classroomLoginFunction.includes('.from("school_memberships")') && classroomLoginFunction.includes('.eq("is_active", true)'), "Legacy classroom login must reject users without an active school membership");
assert.ok(classroomLoginFunction.includes('.eq("tenant_school_id", profile.tenant_school_id)'), "Classroom student lookup must remain scoped to the authenticated user's school");

const assessmentMigration = readFileSync("supabase/migrations/20261030160000_independent_assessment_builder.sql", "utf8");
for (const table of ["assessment_exams", "assessment_questions", "assessment_attempts", "assessment_answers"]) {
  assert.ok(assessmentMigration.includes("public." + table), "Assessment migration missing table: " + table);
}
assert.ok(assessmentMigration.includes("enable row level security") && assessmentMigration.includes("to service_role"), "Assessment tables must be RLS-protected and server-only");
console.log("Independent assessment checks passed: separate teacher/student routing, dedicated schema/API, question types, math/geometry tools, timing and JavaScript syntax.");


const homePage = readFileSync("index.html", "utf8");
const aboutPage = readFileSync("about.html", "utf8");
assert.ok(homePage.includes('href="about.html"') && homePage.includes("درباره برنامه فراهوش"), "Home page must link to the About page");
assert.ok(aboutPage.includes("حسن مردانه جهان‌تیغ") && aboutPage.includes("۱۴۰۵"), "About page must identify the creator and production year");
assert.ok(aboutPage.includes("build-info.json") && aboutPage.includes("commit") && aboutPage.includes("built_at"), "About page must display the generated release/build identifier and build date");
const aboutScripts = [...aboutPage.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match => match[1]).filter(source => source.trim());
assert.ok(aboutScripts.length > 0, "About page must contain its dynamic version script");
for (const source of aboutScripts) assert.doesNotThrow(() => new Function(source), "About page script must have valid JavaScript syntax");
assert.ok(publishWorkflow.includes("- 'about.html'") && publishWorkflow.includes("- 'finance.html'"), "About and finance page changes must trigger GitHub Pages deployment");
assert.ok(publishWorkflow.includes("cp finance.html about.html _site/"), "GitHub Pages artifact must include the finance and About pages");
assert.ok(publishWorkflow.includes("build-info.json"), "GitHub Pages build must generate real release metadata");
assert.ok(readFileSync("finance.html", "utf8").includes("دفتر مالی و حسابداری مدرسه"), "Finance page must remain present in the source repository");
console.log("About and finance deployment checks passed: home route, creator/year, generated build metadata, artifact inclusion, and JavaScript syntax.");


const teacherClassroomPage = readFileSync("classroom/management.html", "utf8");
assert.ok(teacherClassroomPage.includes('id="teacherDailyButton"') && teacherClassroomPage.includes('id="teacherWeeklyButton"'), "Teacher class home must expose separate daily and weekly schedule actions");
assert.ok(teacherClassroomPage.includes("classroom-authorize") && teacherClassroomPage.includes("active_role:'teacher'"), "Teacher schedule must be loaded from the authenticated classroom authorization endpoint");
assert.ok(teacherClassroomPage.includes("entry.is_active===true") && teacherClassroomPage.includes("entry.day_enabled!==true"), "Daily entry must be enabled only when server authorization confirms the active time slot and management activation");
assert.ok(teacherClassroomPage.includes("schedule_entry_id") && teacherClassroomPage.includes("room_id"), "Daily entry must pass the exact room and schedule entry to classroom authorization");
assert.ok(teacherClassroomPage.includes("function renderTeacherWeekly()") && teacherClassroomPage.includes("teacherWeekdays.map(day=>"), "Weekly view must display the full school week by weekday");
const teacherPageScripts = [...teacherClassroomPage.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]).filter(source => source.trim());
assert.ok(teacherPageScripts.length > 0, "Teacher classroom page must contain its operational script");
for (const source of teacherPageScripts) assert.doesNotThrow(() => new Function(source), "Teacher classroom page script must have valid JavaScript syntax");
console.log("Teacher classroom schedule checks passed: daily/weekly views, server-authorized active slots, exact room routing, and JavaScript syntax.");


const academicReviewPage = readFileSync("academic-review.html", "utf8");
const classroomManagementFunction = readFileSync("supabase/functions/classroom-management/index.ts", "utf8");
const parentManagementFunction = readFileSync("supabase/functions/parent-management/index.ts", "utf8");
assert.ok(academicReviewPage.includes("academic_review_list") && academicReviewPage.includes("academic_review"), "Academic review page must load and submit real review actions");
assert.ok(academicReviewPage.includes("attendance") && academicReviewPage.includes("grade") && academicReviewPage.includes("discipline"), "Academic review page must expose all three review queues");
assert.ok(classroomManagementFunction.includes('action === "academic_review_list"') && classroomManagementFunction.includes('action === "academic_review"'), "Classroom API must implement authenticated academic review list and decision actions");
assert.ok(classroomManagementFunction.includes('eq("approval_status","pending")') && classroomManagementFunction.includes('or("manager_released.eq.0,manager_released.is.null")') && classroomManagementFunction.includes('eq("status","pending")'), "Review queues must include only pending attendance, unpublished grades, and pending discipline");
assert.ok(parentManagementFunction.includes('eq("approval_status","approved")') && parentManagementFunction.includes('eq("manager_released",1)') && parentManagementFunction.includes('eq("status","approved")'), "Parent API must return only approved attendance, released grades, and approved discipline");
assert.ok(parentManagementFunction.includes('eq("status","active")'), "Parent API must return only active assignments");
assert.ok(html.includes("academic-review.html") && html.includes("بررسی اطلاعات آموزشی"), "Manager and deputy portals must route to the academic review page");
assert.ok(publishWorkflow.includes("'academic-review.html'") && publishWorkflow.includes("academic-review.html"), "Academic review page must trigger and enter GitHub Pages deployment");
for (const source of [...academicReviewPage.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]).filter(Boolean)) {
  assert.doesNotThrow(() => new Function(source), "Academic review page script must have valid JavaScript syntax");
}
console.log("Academic review checks passed: manager/deputy approval, server-side parent publication filters, and deployed review page.");
