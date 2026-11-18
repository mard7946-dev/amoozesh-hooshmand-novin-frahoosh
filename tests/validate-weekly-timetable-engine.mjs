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
  {className:"۷/۱",subject:"ریاضی",teacher:"دبیر الف",pattern:"two",weight:"سنگین"},
  {className:"۷/۱",subject:"علوم",teacher:"دبیر ب",pattern:"one",weight:"سبک"},
  {className:"۷/۲",subject:"فارسی",teacher:"دبیر الف",pattern:"one",weight:"متوسط"}
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
const exact=generate({...base,requirements:[{className:"۷/۱",subject:"هنر",teacher:"دبیر پ",pattern:"one",fixedDay:"دوشنبه",fixedPeriod:3}]});
assert.equal(exact.ok,true);
assert.equal(exact.rows[0].weekday,"دوشنبه");
assert.equal(exact.rows[0].period,3);
const alternating=generate({...base,requirements:[{className:"۷/۱",subject:"علوم",teacher:"دبیر الف",studiesTeacher:"دبیر ب",pattern:"one_plus_studies"}]});
assert.equal(alternating.ok,true);
assert.equal(alternating.rows.length,2);
assert.equal(alternating.rows.filter(x=>x.session_type==="متناوب با مطالعات").length,1);
assert.equal(alternating.rows.find(x=>x.session_type==="متناوب با مطالعات").teachers.length,2);
const invalid=generate({...base,days:[]});
assert.equal(invalid.ok,false,"the engine must not invent operating days");
const missingPeriodNumber=generate({...base,periods:[{number:"",start:"08:00",end:"08:45"}]});
assert.equal(missingPeriodNumber.ok,false,"the engine must not invent period numbers");
const overlap=generate({...base,periods:[{number:1,start:"08:00",end:"09:00"},{number:2,start:"08:45",end:"09:30"}]});
assert.equal(overlap.ok,false,"overlapping bells must be rejected");
const impossible=generate({...base,days:["شنبه"],periods:[{number:1,start:"08:00",end:"08:45"}],requirements:[{className:"۷/۱",subject:"ریاضی",teacher:"دبیر الف",pattern:"two"}]});
assert.equal(impossible.ok,false,"the engine must not silently drop unplaceable sessions");
assert.equal(impossible.rows.length,0,"no incomplete timetable may be returned as a successful plan");

const page=readFileSync("classroom/weekly-timetable-builder.html","utf8");
assert.ok(page.includes("list_weekly_schedule"),"builder must verify manager authorization through the classroom service");

assert.ok(page.includes("برنامه فعال مدرسه را تغییر نمی‌دهد"),"preview must not silently overwrite the active timetable");
for(const block of page.split("<script").slice(1)){
 const start=block.indexOf(">"),end=block.indexOf("</script>");
 const script=start>=0&&end>start?block.slice(start+1,end).trim():"";
 if(script)assert.doesNotThrow(()=>new Function(script),"builder inline script must be syntactically valid");
}
console.log("Weekly timetable generation constraints and manager UI checks passed.");
