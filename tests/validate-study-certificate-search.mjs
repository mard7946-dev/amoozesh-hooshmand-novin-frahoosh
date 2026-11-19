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
  'student.birth_certificate_no',
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

console.log("Study certificate student-search checks passed: school scoping, limited fields, search filters, auto-fill, manual entry, and JavaScript syntax.");
