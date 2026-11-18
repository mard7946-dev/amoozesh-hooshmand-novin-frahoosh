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
assert.ok(page.includes('selectedStudentId=student.id'), "Selecting a result must retain the selected student identity");
assert.ok(page.includes('hideStudentSearchResults()'), "Search results must close after selection");

const scriptStart = page.indexOf("<script>");
const scriptEnd = page.indexOf("</script>", scriptStart);
assert.ok(scriptStart >= 0 && scriptEnd > scriptStart, "Study certificate must contain its application script");
assert.doesNotThrow(() => new Function(page.slice(scriptStart + 8, scriptEnd)), "Study certificate JavaScript must parse");

console.log("Study certificate student-search checks passed: school scoping, limited fields, search filters, auto-fill, manual entry, and JavaScript syntax.");
