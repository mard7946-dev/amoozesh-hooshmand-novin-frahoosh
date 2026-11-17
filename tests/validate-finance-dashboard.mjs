import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const finance = readFileSync(new URL("../finance.html", import.meta.url), "utf8");
const workflow = readFileSync(new URL("../.github/workflows/validate.yml", import.meta.url), "utf8");

assert.ok(finance.includes("مدیریت آموزش و پرورش شهرستان قدس"), "Finance page and generated documents must use the requested authority letterhead.");
assert.ok(finance.includes('id="schoolName"'), "Finance page must display the resolved school name.");
assert.ok(finance.includes("tenant_school_id&order=last_name.asc"), "Student lookup must include the active tenant school id.");
assert.ok(finance.includes("schools?select=id,name&id=eq."), "School name must be loaded by the active tenant school id, not hardcoded.");
assert.ok(finance.includes("function financeLetterhead()") && finance.includes("printDocument(title,content)"), "All generic finance printouts must include the official letterhead.");
assert.ok(finance.includes("escapeHtml(schoolName)"), "School names in printed documents must be HTML escaped.");
assert.ok(finance.includes("finance_create_voucher_draft") && finance.includes("finance_post_voucher"), "Atomic voucher creation and server-side posting must remain connected.");
assert.ok(finance.includes("finance_close_year"), "Year-end reporting must remain connected to its server-side validation.");
assert.ok(finance.includes("id=\"exportSchoolCsv\"") && finance.includes("function csvField(value)"), "School financial reports must export Excel-compatible UTF-8 CSV with formula-injection protection.");
assert.ok(finance.includes("catch(_schoolLookupError)"), "A school-name lookup failure must not disable the finance dashboard.");
assert.ok(finance.includes("['manager','accountant'].includes(ROLE)"), "Finance UI must remain restricted to manager and accountant roles.");
assert.ok(!finance.includes("گزارش مالی دبیرستان سردار شهید حاجی زاده ۲") && !finance.includes("نام مدرسه:</strong> دبیرستان سردار شهید حاجی زاده ۲"), "Financial documents must not hardcode one school's name.");
assert.ok(!finance.includes("فراهوش · حسابداری دوطرفه") && !finance.includes("فراهوش · سند حسابداری") && !finance.includes("پنل مالی فراهوش"), "Financial documents must not display the Frahoosh brand.");
assert.ok(workflow.includes("node tests/validate-finance-dashboard.mjs"), "Finance dashboard checks must run in CI.");

const scripts = [...finance.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .filter(match => !/\btype\s*=\s*["']module["']/i.test(match[1] || ""))
  .map(match => match[2])
  .filter(source => source.trim());
for (const source of scripts) assert.doesNotThrow(() => new Function(source), "Finance page must contain valid JavaScript.");
console.log("Finance dashboard checks passed: tenant-specific school letterhead, financial document branding, role gating, and JavaScript syntax.");
