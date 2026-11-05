import {
  buildDisciplineScoreBatches,
  isSchoolManagerRole,
} from "../supabase/functions/classroom-management/discipline-rules.ts";

function equal(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(label + ": expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));
  }
}

Deno.test("teacher gets minus one proposal for each complete three discipline records", () => {
  const batches = buildDisciplineScoreBatches(
    [{id:1,record_type:"discipline"},{id:2,record_type:"discipline"},{id:3,record_type:"discipline"},{id:4,record_type:"discipline"},{id:5,record_type:"discipline"},{id:6,record_type:"discipline"}],
    [6],
    "teacher",
  );
  equal(batches.map(x => ({ids:x.sourceRecordIds,score:x.targetScore,delta:x.delta,discipline:x.disciplineCount,praise:x.praiseCount})), [
    {ids:[4,5,6],score:"continuous",delta:-1,discipline:3,praise:0},
  ], "teacher discipline threshold and incremental batch");
});

Deno.test("teacher gets plus one proposal for each complete two praise records", () => {
  const batches = buildDisciplineScoreBatches(
    [{id:1,record_type:"praise"},{id:2,record_type:"praise"}],
    [1,2],
    "teacher",
  );
  equal(batches.map(x => ({ids:x.sourceRecordIds,score:x.targetScore,delta:x.delta,discipline:x.disciplineCount,praise:x.praiseCount})), [
    {ids:[1,2],score:"continuous",delta:1,discipline:0,praise:2},
  ], "teacher praise threshold");
});

Deno.test("deputy gets minus one discipline proposal for each complete three records", () => {
  const batches = buildDisciplineScoreBatches(
    [{id:10,record_type:"discipline"},{id:11,record_type:"punishment"},{id:12,record_type:"discipline"}],
    [12],
    "deputy",
  );
  equal(batches.map(x => ({ids:x.sourceRecordIds,score:x.targetScore,delta:x.delta,discipline:x.disciplineCount,praise:x.praiseCount})), [
    {ids:[10,11,12],score:"discipline",delta:-1,discipline:3,praise:0},
  ], "deputy discipline threshold");
});

Deno.test("old completed batches are not proposed again when only a later record is inserted", () => {
  const batches = buildDisciplineScoreBatches(
    [{id:1,record_type:"discipline"},{id:2,record_type:"discipline"},{id:3,record_type:"discipline"},{id:4,record_type:"discipline"}],
    [4],
    "teacher",
  );
  equal(batches.length, 0, "do not recreate an already completed batch");
});

Deno.test("praise and discipline thresholds are counted independently", () => {
  const batches = buildDisciplineScoreBatches(
    [{id:1,record_type:"discipline"},{id:2,record_type:"praise"},{id:3,record_type:"discipline"},{id:4,record_type:"praise"},{id:5,record_type:"discipline"}],
    [4,5],
    "teacher",
  );
  equal(batches.map(x => [x.sourceRecordIds,x.targetScore,x.delta]), [
    [[1,3,5],"continuous",-1],
    [[2,4],"continuous",1],
  ], "independent counters");
});

Deno.test("only explicit school-manager labels can approve proposals", () => {
  equal(isSchoolManagerRole("manager"), true, "manager");
  equal(isSchoolManagerRole("مدیر مدرسه"), true, "Persian manager");
  equal(isSchoolManagerRole("معاون آموزشی"), false, "educational deputy");
  equal(isSchoolManagerRole("معاون اجرایی"), false, "executive deputy");
  equal(isSchoolManagerRole("معاون مدیر"), false, "deputy manager phrase");
});
