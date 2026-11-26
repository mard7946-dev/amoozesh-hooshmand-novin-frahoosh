import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../counseling.html", import.meta.url), "utf8");
const start = html.indexOf("function applyGuidancePriorities(arr){");
const end = html.indexOf("\nfunction clampScore", start);
assert.ok(start >= 0 && end > start, "Guidance priority engine must exist in counseling.html");

const context = {
  students: [],
  guidanceCohort: [],
  guidanceCohortError: "",
  selected: null,
  norm: value => String(value ?? "").trim(),
  $: () => ({ textContent: "" })
};
vm.runInNewContext(
  html.slice(start, end) + "\nglobalThis.applyGuidancePriorities = applyGuidancePriorities;",
  context
);

function runPriority({ capacity = 2, currentScore = 75, saved = [95, 85], technical = false } = {}) {
  context.students = [1, 2, 3].map(id => ({ id, grade: "نهم" }));
  context.selected = { id: 3 };
  const key = technical ? "fanni_industry" : "math";
  context.guidanceCohort = saved.map((score, index) => ({
    student_id: index + 1,
    recommendation_scores: {
      [key]: {
        complete: true,
        total_points: score,
        academic_points: score * 0.35
      }
    }
  }));
  const track = {
    key,
    capacity,
    thresholds: technical ? null : { math: 99 },
    complete: true,
    total: currentScore,
    academic: currentScore * 0.35
  };
  return context.applyGuidancePriorities([track])[0].priority;
}

assert.equal(runPriority(), 'ب', "The 20% reserve should produce priority B based on total guidance score");
assert.equal(runPriority({ capacity: 1 }), '—', "Candidates beyond capacity plus reserve must receive a dash");
assert.equal(runPriority({ technical: true }), 'ب', "Technical fields must rank by entered guidance score without a separate threshold");
assert.equal(runPriority({ saved: [95] }), 'الف', "Ranking should proceed among students with complete entered scores and show the comparison cohort");
assert.equal(runPriority({ saved: [] }), 'الف', "The currently calculated student's score must be included before it is saved");
console.log("Guidance priority ranking checks passed.");

assert.ok(!html.includes("بررسی نشده"), "Guidance source must never show an unreviewed status");
assert.ok(!html.includes("رتبه درصدی"), "Holland table must not include a percentile-rank column");
assert.ok(!html.includes("آزمون ثبت نشده"), "Holland table must not show an unregistered-test placeholder");

assert.ok(html.includes("ذخیره موقت نمرات / ذخیره ویرایش"), "Guidance form must expose a clear save-and-edit action");
assert.ok(html.includes("فیلدهای خالی ذخیره می‌شوند و صفر محسوب نمی‌شوند"), "Partial grade entry must be explicitly supported without treating blanks as zero");
assert.ok(html.includes("پس از امتحانات دی‌ماه تکمیل شود"), "Grade 9 entry must be clearly deferrable until after the December exams");
assert.ok(html.includes("if(guidance)await api('counseling_guidance','PATCH',payload") && html.includes("else await api('counseling_guidance','POST',payload)"), "Saving again must update the existing guidance record rather than create a duplicate");
