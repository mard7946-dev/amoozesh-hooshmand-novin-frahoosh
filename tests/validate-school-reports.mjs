import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const window = {};
vm.runInNewContext(readFileSync("reports-utils.js", "utf8"), { window });
const kind = window.FrahooshReportUtils.attendanceKind;

assert.equal(kind("حاضر"), "present");
assert.equal(kind("present"), "present");
assert.equal(kind("غایب"), "absent");
assert.equal(kind("غیرموجه"), "absent");
assert.equal(kind("absent"), "absent");
assert.equal(kind("تأخیر"), "late");
assert.equal(kind("تاخیر"), "late");
assert.equal(kind("late"), "late");
assert.equal(kind("موجه"), "excused");
assert.equal(kind("excused"), "excused");
assert.equal(kind("نامشخص"), "other");

const page = readFileSync("reports.html", "utf8");
assert.match(page, /reports-utils\.js/);
for (const id of ["presentCount", "absenceCount", "lateCount", "excusedCount"]) {
  assert.match(page, new RegExp('id="' + id + '"'));
}
assert.match(page, /attendanceKind\(x\.status\)==="late"/);
console.log("School report attendance classification checks passed.");
