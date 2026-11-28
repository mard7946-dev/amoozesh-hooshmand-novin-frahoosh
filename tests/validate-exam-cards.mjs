import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const cards = readFileSync("exam-entry-cards.html", "utf8");
const cardApi = readFileSync("supabase/functions/exam-entry-cards/index.ts", "utf8");
const planner = readFileSync("exam-planner.html", "utf8");
const plannerApi = readFileSync("supabase/functions/exam-planner/index.ts", "utf8");
const publish = readFileSync(".github/workflows/publish-six-icon-portal.yml", "utf8");

assert.ok(cards.includes("i+=2") && cards.includes("grid-template-rows:132mm 132mm"), "Print layout must place exactly two full-width cards on each A4 page");
assert.ok(cards.includes("ردیف") && cards.includes("نام درس") && cards.includes("تاریخ آزمون") && cards.includes("شماره صندلی") && cards.includes("زمان آزمون") && cards.includes("بودجه‌بندی فصل‌ها و درس‌ها"), "Card table must contain every requested column");
assert.ok(cards.includes('seatAssignments.get(String(c.student_id)+"|"+String(x.exam_key))'), "Each student must resolve a separate seat assignment for every exam");
assert.ok(cards.includes("publishedSchedules.filter(x=>String(x.grade||\"\")===String(c.grade||\"\")"), "Schedules must be filtered to the student's grade");
assert.ok(cards.includes("photo_fallback") && cards.includes("card-photo"), "Student photo or a visible empty photo space must be rendered");
assert.ok(cardApi.includes('.eq("school_id", schoolId).eq("status", "published")'), "Only published plans from the active school may be included");
assert.ok(cardApi.includes('.eq("tenant_school_id", schoolId)') && cardApi.includes('.eq("school_id", schoolId)'), "Student, card, and seat queries must be school-scoped");
assert.ok(cardApi.includes('String(selectedPlan.id) + "|"') && cardApi.includes("seatAssignments"), "Seat numbers must be linked by plan, exam, and student");
assert.ok(planner.includes("subject-duration") && planner.includes("subject-budget"), "Exam planner must allow a different duration and curriculum scope for every subject");
assert.ok(planner.includes("duration_minutes:duration") && planner.includes("budget:subject.budget"), "Each generated exam row must retain its own duration and budget");
assert.ok(plannerApi.includes("duration_minutes") && plannerApi.includes("clean(item.budget, 240)"), "Server validation must enforce subject duration and budget consistency");
assert.ok(publish.includes("'exam-entry-cards.html'") && publish.includes("'exam-planner.html'"), "GitHub Pages must publish both updated pages");

for (const [name, html] of [["exam-entry-cards", cards], ["exam-planner", planner]]) {
  const scripts = html.split("<script>").slice(1).map(source => source.split("</script>")[0]).filter(source => source.trim());
  assert.ok(scripts.length, name + " must contain its application script");
  for (const script of scripts) new Function(script);
}
console.log("Exam cards, per-exam seat mapping, A4 print layout, and per-subject duration/budget checks passed.");
