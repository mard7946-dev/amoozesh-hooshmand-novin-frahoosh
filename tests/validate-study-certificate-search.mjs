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

assert.ok(page.includes('const available=()=>!!(window.QRCode&&typeof window.QRCode.toDataURL==="function")'), "QR loader must verify the actual QRCode API");
assert.ok(page.includes('script.onload=()=>{finish();if(available())resolve(true);else{script.remove();next();}}'), "QR loader must try the second CDN when the first loads without exposing the API");
assert.ok(page.includes('script.onerror=()=>{finish();script.remove();next();}'), "QR loader must fall back after a CDN network error");
assert.ok(page.includes('setTimeout(()=>{finish();script.remove();next();},10000)'), "QR loader must recover from a stalled CDN request");

console.log("Study certificate student-search checks passed: school scoping, limited fields, search filters, auto-fill, manual entry, and JavaScript syntax.");
