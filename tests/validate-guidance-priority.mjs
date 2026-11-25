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

function runPriority({ capacity = 2, currentScore = 75, currentThreshold = 15, saved = [95, 85], technical = false } = {}) {
  context.students = [1, 2, 3].map(id => ({ id, grade: "نهم" }));
  context.selected = { id: 3 };
  const key = technical ? "fanni_industry" : "math";
  context.guidanceCohort = saved.map((score, index) => ({
    student_id: index + 1,
    recommendation_scores: {
      [key]: {
        complete: true,
        total_points: score,
        academic_points: score * 0.35,
        thresholds: technical ? [] : [{ subject: "math", min: 14, actual: 15 }]
      }
    }
  }));
  const track = {
    key,
    capacity,
    thresholds: technical ? null : { math: 14 },
    complete: true,
    total: currentScore,
    academic: currentScore * 0.35,
    thresholdValues: technical ? [] : [{ subject: "math", min: 14, actual: currentThreshold }]
  };
  return context.applyGuidancePriorities([track])[0].priority;
}

assert.match(runPriority(), /^ب · رتبه 3 از 3$/, "The 20% reserve should produce priority B");
assert.match(runPriority({ capacity: 1 }), /^— · خارج از ظرفیت/, "Candidates beyond capacity plus reserve must receive a dash");
assert.match(runPriority({ currentThreshold: 10 }), /حدنصاب آزمایشی احراز نشده/, "A candidate below the configured experimental threshold must not receive A/B");
assert.match(runPriority({ saved: [95] }), /اطلاعات کامل 2 از 3/, "Incomplete cohort coverage must suppress ranking");
assert.match(runPriority({ technical: true }), /ملاک ورود این زمینه هنوز تعریف نشده/, "Technical fields without entry criteria must not receive fabricated priorities");

console.log("Guidance priority ranking checks passed.");
