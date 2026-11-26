import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../counseling.html", import.meta.url), "utf8");
const start = html.indexOf("function savedThresholdStatus(record,track){");
const end = html.indexOf("\nfunction clampScore", start);
assert.ok(start >= 0 && end > start, "Guidance eligibility and priority engine must exist");

const context = {
  students: [],
  guidanceCohort: [],
  guidanceCohortError: "",
  selected: null,
  guidance: null,
  gradeScoresFromForm: () => ({
    grade7_scores: { math: 15, technical: 13 },
    grade8_scores: { math: 15, technical: 13 },
    grade9_scores: { math: 15, technical: 13 }
  }),
  norm: value => String(value ?? "").trim(),
  $: () => ({ textContent: "" })
};
vm.runInNewContext(
  html.slice(start, end) + "\nglobalThis.applyGuidancePriorities = applyGuidancePriorities; globalThis.savedThresholdStatus = savedThresholdStatus;",
  context
);

function marksFor(subjects = ["math"]) {
  const marks = {};
  for (const year of ["grade7_scores", "grade8_scores", "grade9_scores"]) {
    marks[year] = Object.fromEntries(subjects.map(subject => [subject, subject === "technical" ? 13 : 15]));
  }
  return marks;
}
function runPriority({
  capacity = 2,
  currentScore = 75,
  currentAcademic = 32,
  saved = [{ total: 95, academic: 35 }, { total: 85, academic: 33 }],
  thresholdPassed = true,
  thresholdKnown = true,
  key = "math",
  threshold = { math: 14 },
  capacityPoolKey = key
} = {}) {
  context.students = [...saved.map((_, i) => i + 1), saved.length + 1].map(id => ({ id, grade: "نهم" }));
  context.selected = { id: saved.length + 1 };
  context.guidanceCohort = saved.map((score, index) => ({
    student_id: index + 1,
    ...marksFor(Object.keys(threshold || { math: 14 })),
    recommendation_scores: {
      [key]: {
        score_model_version: "guidance-v3",
        total_points: score.total,
        academic_points: score.academic
      }
    }
  }));
  const track = {
    key,
    capacity,
    capacityPoolKey,
    thresholds: threshold,
    thresholdKnown,
    thresholdComplete: thresholdKnown,
    thresholdPassed,
    allYearsComplete: true,
    actualAssessmentsComplete: true,
    total: currentScore,
    academic: currentAcademic
  };
  return context.applyGuidancePriorities([track])[0].priority;
}

const needsRegionalCapacity = "شرایط تحصیلی احراز شده؛ اولویت الف/ب نیازمند ظرفیت مصوب منطقه است";
assert.equal(runPriority(), needsRegionalCapacity, "Eligible candidate must not receive a fabricated B without the official regional capacity and current-year rule");
assert.equal(runPriority({ capacity: 1 }), needsRegionalCapacity, "School planning capacity must not be used as a substitute for official regional capacity");
assert.equal(runPriority({ currentScore: 90, currentAcademic: 35 }), needsRegionalCapacity, "Even a high score must not fabricate A without the official registration-priority inputs");
assert.equal(runPriority({ currentScore: 72, currentAcademic: 30 }), needsRegionalCapacity, "A middle-band score must not fabricate C");
assert.equal(runPriority({ currentScore: 62, currentAcademic: 30 }), needsRegionalCapacity, "A low score must not be converted into a locally invented C cutoff");
assert.equal(runPriority({ thresholdPassed: false }), "حدنصاب تحصیلی احراز نشده", "Counseling points cannot compensate for a failed academic threshold");
assert.equal(runPriority({ thresholdKnown: false, threshold: null, key: "fanni_services" }), "نیازمند حدنصاب معتبر این زمینه", "Unknown vocational thresholds must be reported as unknown, not as rejection or a fabricated priority");
assert.equal(runPriority({ saved: [], currentScore: 90, currentAcademic: 35 }), needsRegionalCapacity, "The selected candidate must be included without inventing a capacity rank");
assert.equal(runPriority({ saved: [{ total: null, academic: null }], currentScore: 75 }), needsRegionalCapacity, "Missing comparison records must never create a fabricated registration priority");
assert.equal(runPriority({ currentScore: 90, currentAcademic: 30, saved: [{ total: 80, academic: 35 }], capacity: 1 }), needsRegionalCapacity, "Consultation total and school capacity must not be used to fabricate registration priority");

const industryThreshold = context.savedThresholdStatus(
  { ...marksFor(["math", "technical"]), recommendation_scores: {} },
  { thresholds: { math: 10, technical: 12 } }
);
assert.equal(industryThreshold.complete, true, "Industry threshold should be recalculated from stored grade marks");
assert.equal(industryThreshold.passed, true, "Industry candidate meeting math 10 and technical 12 should pass");
const industryFail = context.savedThresholdStatus(
  { grade7_scores: { math: 9, technical: 12 }, grade8_scores: { math: 9, technical: 12 }, grade9_scores: { math: 9, technical: 12 } },
  { thresholds: { math: 10, technical: 12 } }
);
assert.equal(industryFail.passed, false, "Industry candidate below math 10 must not qualify");

assert.equal(
  context.applyGuidancePriorities([
    { key: "fanni_industry", capacity: 90, capacityPoolKey: "industry", thresholdKnown: true, thresholdComplete: true, thresholdPassed: true, allYearsComplete: true, actualAssessmentsComplete: true, total: 90, academic: 30 },
    { key: "kardanesh_industry", capacity: 90, capacityPoolKey: "industry", thresholdKnown: false, thresholdComplete: false, thresholdPassed: false, allYearsComplete: true, actualAssessmentsComplete: true, total: 90, academic: 30 }
  ])[0].priority,
  "نیازمند حدنصاب معتبر این زمینه",
  "Unknown eligibility in a shared vocational field must remain explicitly unknown"
);

console.log("Guidance eligibility, shared-capacity ranking, and incomplete-data checks passed.");

assert.ok(!html.includes("بررسی نشده"), "Guidance source must never show an unreviewed status");
assert.ok(!html.includes("رتبه درصدی"), "Holland table must not include a percentile-rank column");
assert.ok(!html.includes("آزمون ثبت نشده"), "Holland table must not show an unregistered-test placeholder");
assert.ok(html.includes("ذخیره موقت نمرات / ذخیره ویرایش"), "Guidance form must expose a clear save-and-edit action");
assert.ok(html.includes("score_model_version:'guidance-v3'"), "Only versioned assessment records may enter capacity ranking");
assert.ok(html.includes("آزمون توانایی") && html.includes("آزمون رغبت") && html.includes("data-track="), "Actual aptitude and interest inputs must be captured per track");
assert.ok(html.includes("assessment_points:{aptitude:x.aptitude,interest:x.interest"), "Per-track assessment scores must be saved separately");
assert.ok(html.includes("drawTrackAssessmentInputs()"), "The form must render the track-specific assessment controls");
assert.ok(html.includes("function estimateAssessmentPoints(track") && html.includes("const scale=max=>Math.round(ratio*max*10)/10"), "Default assessment values must be proportionally estimated from relevant subject grades");
assert.ok(html.includes("assessment_sources:x.assessmentSources") && html.includes("assessment_estimates:") && html.includes("grade_based_estimate"), "Estimated values must be stored separately from actual scores and source-labelled");
assert.ok(html.includes("estimated_total_points:x.estimatedTotal") && html.includes("points[key]=displayPoints[key]===null||assessmentSources[key]==='grade_based_estimate'?null:displayPoints[key]"), "Estimated totals must remain display-only and must not enter actual capacity ranking");
assert.ok(html.includes("const assessmentValuesPresent=Object.values(displayPoints).every(value=>value!==null&&Number.isFinite(value))"), "Guidance output must guard estimated totals against missing assessment values before printing");
assert.ok(html.includes("if(field==='academic')return v(x.academic)") && html.includes("x.estimatedTotal-x.academic"), "Printed academic and estimated consultation rows must display correctly");
assert.ok(html.includes("علامت * یعنی امتیاز پیش‌فرض و برآوردی"), "The printed report must disclose estimated values");
assert.ok(html.includes("نتیجه آزمون واقعی نیستند"), "Saved estimates must be disclosed as non-real test results");
assert.ok(html.includes("اولویت ثبت‌نام الف/ب") && html.includes("ظرفیت مصوب منطقه"), "The interface must disclose that registration priorities require official regional capacity");
assert.ok(!html.includes("الف از ۸۵، ب از ۷۵ و ج از ۶۵"), "Unsupported local A/B/C cutoffs must be removed");
assert.ok(html.includes("فیلدهای خالی ذخیره می‌شوند و صفر محسوب نمی‌شوند"), "Blank grades must not be treated as zero");
assert.ok(html.includes("پس از امتحانات دی‌ماه تکمیل شود"), "Grade 9 entry must be deferrable until after December exams");
assert.ok(html.includes("if(guidance)await api('counseling_guidance','PATCH',payload") && html.includes("else await api('counseling_guidance','POST',payload)"), "Saving again must update the existing guidance record rather than create a duplicate");

for (const expected of ["capacity:300", "capacity:400", "capacity:90", "capacityPoolKey:'industry'", "capacityPoolKey:'services'", "capacityPoolKey:'agriculture'", "capacityPoolKey:'arts'", "thresholds:{math:10,technical:12}"]) {
  assert.ok(html.includes(expected), "Missing guidance configuration: " + expected);
}
assert.ok(!html.includes("capacity:350") && !html.includes("capacity:500") && !html.includes("capacity:150"), "Old guidance capacities must be removed");
assert.ok(html.includes("{key:'kardanesh_industry'") && html.includes("حدنصاب معتبر کاردانش صنعت باید جداگانه از جدول رسمی سال جاری ثبت شود"), "Kardanesh industry must not inherit an unverified Fanni threshold");
assert.ok(html.includes("{key:'fanni_industry'") && html.includes("thresholds:{math:10,technical:12}"), "The sample Fanni industry threshold must be configured");
assert.ok(html.includes("هر زمینه هنرستان ۹۰ نفر به‌صورت مشترک بین فنی‌وحرفه‌ای و کاردانش"), "The printed report must disclose shared artisan capacities");
assert.ok(html.includes("نیازمند حدنصاب") && html.includes("وضعیت احراز شرایط نامشخص است"), "Unknown thresholds must not be displayed as a rejection");
assert.ok(html.includes("میانگین نمره هر درس با ضرایب پایه هفتم ۱، هشتم ۱ و نهم ۳"), "The printed report must disclose grade weighting");
