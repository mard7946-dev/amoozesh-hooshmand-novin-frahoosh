import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync("study-certificate.html", "utf8");
for (const marker of [
  'id="studentSearch"',
  'id="studentSearchResults"',
  'role="listbox"',
  'id="studentSearchStatus"',
  'tenant_school_id:"eq."+schoolId',
  'Authorization:"Bearer "+token',
  'first_name.ilike.*',
  'last_name.ilike.*',
  'national_code.ilike.*',
  'student_code.ilike.*',
  'student.father_name',
  'student.birth_date',
  'limit:"12"',
  'پس از انتخاب خودکار تکمیل می‌شود؛ ورود دستی هم ممکن است'
]) assert.ok(page.includes(marker), "Study certificate student search is missing: " + marker);

assert.ok(!page.includes("select=id,*"), "Student search must request only the required student fields");
assert.ok(page.includes('tenant_school_id:"eq."+schoolId'), "Student search must be scoped to the current school");
assert.ok(page.includes('function safeSearchTerm'), "Search input must be sanitized before building PostgREST filters");
assert.ok(page.includes('function chooseStudent(student)') && page.includes('$("student").value=fullName'), "Selecting a result must fill the student identity fields");
assert.ok(page.includes('hideStudentSearchResults()'), "Search results must close after selection");

const scriptStart = page.indexOf("<script>");
const scriptEnd = page.indexOf("</script>", scriptStart);
assert.ok(scriptStart >= 0 && scriptEnd > scriptStart, "Study certificate must contain its application script");
assert.doesNotThrow(() => new Function(page.slice(scriptStart + 8, scriptEnd)), "Study certificate JavaScript must parse");

const qrLibrary = readFileSync("assets/qrcode.js", "utf8");
assert.ok(page.includes('<script src="assets/qrcode.js"></script>'), "Certificate must load the QR library from the same-origin repository asset");
assert.ok(page.includes('function createQrDataUrl(payload)'), "Certificate must generate QR data locally");
assert.ok(page.includes('new QRCodeLib(host,{text:payload'), "Certificate must pass the current certificate payload to the local QR encoder");
assert.ok(page.includes('image.src.startsWith("data:image/")'), "Certificate must use the generated local data URL");
assert.ok(page.includes('correctLevel:QRCodeLib.CorrectLevel.M'), "Certificate QR must use a defined error-correction level");
assert.ok(!page.includes("cdn.jsdelivr.net/npm/qrcode") && !page.includes("cdnjs.cloudflare.com/ajax/libs/qrcode"), "Certificate QR generation must not depend on external CDNs");
assert.ok(qrLibrary.includes("Licensed under the MIT license"), "Vendored QR library must retain its MIT license notice");
assert.ok(!page.includes("qrLoadPromise") && !page.includes("loadQrLibrary"), "Certificate must not retain the CDN loader path");

const publishWorkflow = readFileSync(".github/workflows/publish-six-icon-portal.yml", "utf8");
assert.ok(publishWorkflow.includes("assets/qrcode.js _site/assets/"), "GitHub Pages packaging must copy the local QR library into the deployed assets directory");
assert.ok(publishWorkflow.includes("test -s _site/assets/qrcode.js"), "GitHub Pages deployment must fail if the local QR library is missing from the site artifact");


for (const marker of [
  '.photo{position:absolute;top:6%;',
  '.serial{position:absolute;top:20.5%;left:10%;',
  '.r1{top:24.6%;',
  '.r2{top:30.2%;',
  '.r3{top:35.8%;',
  '.bodyline{top:42.1%;',
  '.purpose{top:49.8%;',
  '.issued{top:60.2%;',
  '.disclaimer{position:absolute;top:70.9%;',
  'بدین وسیله گواهی میشود:',
  '.r1 .student-field{position:absolute;right:.5%;width:13%;text-align:right}',
  '.r1 .national-field{position:absolute;left:55.6%;width:11%;text-align:right}',
  '.r1 .father-field{position:absolute;left:27.8%;width:6%;text-align:right}',
  '.r2 .birth-field{position:absolute;left:55.6%;width:11%;text-align:right}',
  '.r2 .year-field{position:absolute;left:20.4%;width:13.1%;text-align:right}',
  '.r3 .school-field{position:absolute;right:.5%;width:17.5%;text-align:right}',
  '.r3 .grade-field{position:absolute;left:59.7%;width:6.9%;text-align:right}',
  '@page{size:A4 portrait;margin:3mm}',
  '.certificate{width:204mm;height:135.2mm;aspect-ratio:auto;',
  'فرزند: <b id="vFather">',
  'تاریخ تولد: <b id="vBirth">',
  'سال تحصیلی: <b id="vYear">',
  'این گواهی طبق تقاضای مورخ :',
  'فقط به منظور ارائه به: <b id="vDestination">',
  'صادر گردیده و فاقد هرگونه ارزش دیگری می باشد.',
  '<div class="date-label">تاریخ <b id="vRequestDate">',
  'id="vQr"'
]) assert.ok(page.includes(marker), "Printed certificate layout/content is missing: " + marker);
assert.ok(!page.includes('id="issueDate"') && !page.includes('vIssueDate'), "The printed sample has only one date field");
assert.ok(!page.includes('id="identity"') && !page.includes('vIdentity') && !page.includes("شماره شناسنامه"), "Identity certificate number must not appear in the form or printed certificate");
assert.ok(!page.includes('id="serial" value="۱"'), "Certificate number must be entered by the executive deputy, not prefilled");
assert.ok(!page.includes('id="grade" value="هشتم"'), "Student grade must be entered or selected, not prefilled with sample data");

console.log("Study certificate student-search checks passed: school scoping, limited fields, search filters, auto-fill, manual entry, and JavaScript syntax.");
