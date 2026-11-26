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

function runPriority({ capacity = 2, currentScore = 75, saved = [95, 85], technical = false, thresholdPassed = true } = {}) {
  context.students = [1, 2, 3].map(id => ({ id, grade: "نهم" }));
  context.selected = { id: 3 };
  const key = technical ? "fanni_industry" : "math";
  context.guidanceCohort = saved.map((score, index) => ({
    student_id: index + 1,
    recommendation_scores: {
      [key]: {
        score_model_version: "guidance-v3",
        complete: true,
        total_points: score,
        academic_points: score * 0.35,
        threshold_complete: true,
        threshold_passed: true
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
    thresholdKnown: !technical,
    thresholdComplete: true,
    thresholdPassed
  };
  return context.applyGuidancePriorities([track])[0].priority;
}

assert.equal(runPriority(), 'ب', "A score in the middle band should receive B");
assert.equal(runPriority({ capacity: 1 }), 'ج', "A candidate beyond the B reserve but within the C reserve should receive C");
assert.equal(runPriority({ currentScore: 90, saved: [95], capacity: 2 }), 'الف', "A high score within capacity should receive A");
assert.equal(runPriority({ currentScore: 72, saved: [95, 85], capacity: 2 }), 'ج', "A score in the third band should receive C");
assert.equal(runPriority({ currentScore: 62, saved: [95, 85], capacity: 2 }), '—', "A score below the minimum local band should receive a dash");
assert.equal(runPriority({ thresholdPassed: false }), '—', "A student who has not met the subject threshold must not receive a priority");
assert.equal(runPriority({ technical: true }), '—', "A field without a configured subject threshold must not receive a fabricated priority");
assert.equal(runPriority({ saved: [], currentScore: 90 }), 'الف', "The currently calculated student's score must be included before it is saved");
 assert.equal(runPriority({ saved: [{bad:true}], currentScore: 75 }), 'ب', "Invalid legacy rows must not displace the selected student's valid band");
console.log("Guidance priority ranking checks passed.");

assert.ok(!html.includes("بررسی نشده"), "Guidance source must never show an unreviewed status");
assert.ok(!html.includes("رتبه درصدی"), "Holland table must not include a percentile-rank column");
assert.ok(!html.includes("آزمون ثبت نشده"), "Holland table must not show an unregistered-test placeholder");

assert.ok(html.includes("ذخیره موقت نمرات / ذخیره ویرایش"), "Guidance form must expose a clear save-and-edit action");
assert.ok(html.includes("score_model_version:'guidance-v3'"), "Only actual, versioned assessment records may enter capacity ranking");
assert.ok(html.includes("آزمون توانایی") && html.includes("آزمون رغبت") && html.includes("data-track="), "Actual aptitude and interest inputs must be captured per track");
assert.ok(html.includes("assessment_points:{aptitude:x.aptitude,interest:x.interest"), "Per-track assessment scores must be saved separately");
assert.ok(html.includes("drawTrackAssessmentInputs()"), "The form must render the track-specific assessment controls");
assert.ok(html.includes("function estimateAssessmentPoints(track") && html.includes("const scale=max=>Math.round(ratio*max*10)/10"), "Default assessment values must be proportionally estimated from relevant subject grades");
assert.ok(html.includes("assessment_sources:x.assessmentSources") && html.includes("assessment_estimates:") && html.includes("grade_based_estimate"), "Estimated values must be stored separately from actual scores and source-labelled");
assert.ok(html.includes("estimated_total_points:x.estimatedTotal") && html.includes("points[key]=displayPoints[key]===null||assessmentSources[key]==='grade_based_estimate'?null:displayPoints[key]"), "Estimated totals must remain display-only and must not enter actual capacity ranking");
assert.ok(html.includes("if(field==='academic')return v(x.academic)") && html.includes("x.estimatedTotal-x.academic"), "Printed academic and estimated consultation rows must display correctly");
assert.ok(html.includes("علامت * یعنی امتیاز پیش‌فرض و برآوردی"), "The printed report must disclose estimated values");
assert.ok(html.includes("نتیجه آزمون واقعی نیستند"), "The saved interest and aptitude fields must disclose that estimates are not actual test results");
assert.ok(html.includes("اولویت آزمایشی:") && html.includes("الف از ۸۵، ب از ۷۵ و ج از ۶۵"), "The interface must disclose the experimental A/B/C score bands");
assert.ok(html.includes("فیلدهای خالی ذخیره می‌شوند و صفر محسوب نمی‌شوند"), "Partial grade entry must be explicitly supported without treating blanks as zero");
assert.ok(html.includes("پس از امتحانات دی‌ماه تکمیل شود"), "Grade 9 entry must be clearly deferrable until after the December exams");
assert.ok(html.includes("if(guidance)await api('counseling_guidance','PATCH',payload") && html.includes("else await api('counseling_guidance','POST',payload)"), "Saving again must update the existing guidance record rather than create a duplicate");
