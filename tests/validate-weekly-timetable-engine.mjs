import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source=readFileSync("classroom/weekly-timetable-engine.js","utf8");
const sandbox={};
vm.runInNewContext(source,sandbox);
const generate=sandbox.FrahooshWeeklyTimetableEngine?.generate;
assert.equal(typeof generate,"function","weekly timetable engine must be exposed");

const base={
 days:["شنبه","یکشنبه","دوشنبه"],
 periods:[
  {number:1,start:"08:00",end:"08:45"},
  {number:2,start:"09:00",end:"09:45"},
  {number:3,start:"10:00",end:"10:45"}
 ],
 requirements:[
  {className:"۷/۱",subject:"ریاضی",teacher:"دبیر الف",pattern:"two",weight:"سنگین",allowedDays:["شنبه","یکشنبه","دوشنبه"]},
  {className:"۷/۱",subject:"علوم",teacher:"دبیر ب",pattern:"one",weight:"سبک",allowedDays:["شنبه","یکشنبه","دوشنبه"]},
  {className:"۷/۲",subject:"فارسی",teacher:"دبیر الف",pattern:"one",weight:"متوسط",allowedDays:["شنبه","یکشنبه","دوشنبه"]}
 ]
};
const result=generate(base);
assert.equal(result.ok,true,"a feasible explicit timetable should be generated");
assert.equal(result.rows.length,4,"session counts must exactly match the requested patterns");
const classSlots=new Set(),teacherSlots=new Set();
for(const row of result.rows){
 const slot=row.weekday+"|"+row.period;
 const ck=row.class_name+"|"+slot;
 assert.equal(classSlots.has(ck),false,"a class cannot have two lessons in the same slot");
 classSlots.add(ck);
 for(const teacher of row.teachers){
  const tk=teacher+"|"+slot;
  assert.equal(teacherSlots.has(tk),false,"a teacher cannot be assigned to two classes in the same slot");
  teacherSlots.add(tk);
 }
 assert.ok(base.days.includes(row.weekday),"only manager-selected days may be used");
 assert.ok(base.periods.some(p=>p.number===row.period&&p.start===row.start_time&&p.end===row.end_time),"only manager-entered bell times may be used");
}
const exact=generate({...base,requirements:[{className:"۷/۱",subject:"هنر",teacher:"دبیر پ",pattern:"one",fixedDay:"دوشنبه",fixedPeriod:3,allowedDays:["دوشنبه"]}]});
assert.equal(exact.ok,true);
assert.equal(exact.rows[0].weekday,"دوشنبه");
assert.equal(exact.rows[0].period,3);
const alternating=generate({...base,requirements:[{className:"۷/۱",subject:"علوم",teacher:"دبیر الف",studiesTeacher:"دبیر ب",pattern:"one_plus_studies",allowedDays:["شنبه","یکشنبه"]}]});
assert.equal(alternating.ok,true);
assert.equal(alternating.rows.length,2);
assert.equal(alternating.rows.filter(x=>x.session_type==="متناوب با مطالعات").length,1);
assert.equal(alternating.rows.find(x=>x.session_type==="متناوب با مطالعات").teachers.length,2);
const partial=generate({...base,requirements:[...base.requirements,{className:"۷/۳",subject:"فیزیک",teacher:"دبیر ج",pattern:"three",allowedDays:[]}]});
assert.equal(partial.ok,true,"teachers with unknown workdays must not block a partial timetable");
assert.equal(partial.rows.length,4,"only lessons for teachers with confirmed workdays should be placed");
assert.equal(partial.pendingSessions.length,3,"all sessions for teachers without declared workdays must remain pending");
assert.ok(partial.pendingSessions.every(x=>x.teacher==="دبیر ج"));
const onlyPending=generate({...base,requirements:[{className:"۷/۳",subject:"فیزیک",teacher:"دبیر ج",pattern:"one",allowedDays:[]}]});
assert.equal(onlyPending.ok,true,"a plan with only pending teachers is a valid empty draft");
assert.equal(onlyPending.rows.length,0);
assert.equal(onlyPending.pendingSessions.length,1);
const invalid=generate({...base,days:[]});
assert.equal(invalid.ok,false,"the engine must not invent operating days");
const emptyLessons=generate({...base,requirements:[]});
assert.equal(emptyLessons.ok,false,"the engine must not generate an empty timetable");
const missingPeriodNumber=generate({...base,periods:[{number:"",start:"08:00",end:"08:45"}]});
assert.equal(missingPeriodNumber.ok,false,"the engine must not invent period numbers");
const overlap=generate({...base,periods:[{number:1,start:"08:00",end:"09:00"},{number:2,start:"08:45",end:"09:30"}]});
assert.equal(overlap.ok,false,"overlapping bells must be rejected");
const impossible=generate({...base,days:["شنبه"],periods:[{number:1,start:"08:00",end:"08:45"}],requirements:[{className:"۷/۱",subject:"ریاضی",teacher:"دبیر الف",pattern:"two"}]});
assert.equal(impossible.ok,false,"the engine must not silently drop unplaceable sessions");
assert.equal(impossible.rows.length,0,"no incomplete timetable may be returned as a successful plan");
assert.ok(impossible.errors.some(x=>x.includes("کلاس")||x.includes("دبیر")), "failed schedules must explain the specific class or teacher conflict");

const page=readFileSync("classroom/weekly-timetable-builder.html","utf8");
assert.ok(page.includes("list_weekly_schedule"),"builder must verify manager authorization through the classroom service");

assert.ok(page.includes("روزهای کاری اعلام‌شده برای هر دبیر را وارد کنید"),"the UI must explain phased teacher availability");
assert.ok(page.includes("خالی"),"the UI must show unassigned timetable slots as empty");
assert.ok(page.includes("برنامه فعال مدرسه را تغییر نمی‌دهد"),"preview must not silently overwrite the active timetable");
for(const block of page.split("<script").slice(1)){
 const start=block.indexOf(">"),end=block.indexOf("</script>");
 const script=start>=0&&end>start?block.slice(start+1,end).trim():"";
 if(script)assert.doesNotThrow(()=>new Function(script),"builder inline script must be syntactically valid");
}
console.log("Weekly timetable generation constraints and manager UI checks passed.");
