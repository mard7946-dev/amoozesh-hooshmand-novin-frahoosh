import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source=readFileSync("classroom/weekly-timetable-engine.js","utf8");
const sandbox={};
vm.runInNewContext(source,sandbox);
const generate=sandbox.FrahooshWeeklyTimetableEngine?.generate;
assert.equal(typeof generate,"function","automatic weekly timetable engine must be exposed");

const base={
 days:["شنبه","یکشنبه","دوشنبه","سه‌شنبه","چهارشنبه"],
 periods:[
  {number:1,start:"08:00",end:"08:45"},
  {number:2,start:"09:00",end:"09:45"},
  {number:3,start:"10:00",end:"10:45"}
 ],
 teachers:[
  {name:"دبیر الف",subjects:["ریاضی","علوم"],days:["شنبه","دوشنبه","چهارشنبه"]},
  {name:"دبیر ب",subjects:["علوم","مطالعات"],days:["شنبه","یکشنبه","سه‌شنبه"]},
  {name:"دبیر پ",subjects:["فارسی","قرآن"],days:["یکشنبه","دوشنبه","چهارشنبه"]}
 ],
 requirements:[
  {className:"۷/۱",subject:"ریاضی",count:2,weight:"سنگین"},
  {className:"۷/۱",subject:"علوم",count:1,weight:"متوسط"},
  {className:"۷/۲",subject:"فارسی",count:2,weight:"سبک"},
  {className:"۷/۲",subject:"قرآن",count:1,weight:"سبک"}
 ]
};
const result=generate(base);
assert.equal(result.ok,true,"feasible automatic allocation should succeed");
assert.equal(result.rows.length,6,"all weekly lesson counts must be placed");
const classSlots=new Set(),teacherSlots=new Set(),counts=new Map();
for(const row of result.rows){
 const slot=row.weekday+"|"+row.period;
 const ck=row.class_name+"|"+slot;
 assert.equal(classSlots.has(ck),false,"a class cannot have two lessons in one period");
 classSlots.add(ck);
 for(const teacher of row.teachers){
  const tk=teacher+"|"+slot;
  assert.equal(teacherSlots.has(tk),false,"a teacher cannot teach two classes in one period");
  teacherSlots.add(tk);
 }
 assert.ok(base.days.includes(row.weekday),"only selected school days may be used");
 assert.ok(base.periods.some(p=>p.number===row.period&&p.start===row.start_time&&p.end===row.end_time),"only configured bell times may be used");
 const k=row.class_name+"|"+row.subject;counts.set(k,(counts.get(k)||0)+1);
}
assert.equal(counts.get("۷/۱|ریاضی"),2);
assert.equal(counts.get("۷/۱|علوم"),1);
assert.equal(counts.get("۷/۲|فارسی"),2);
assert.equal(counts.get("۷/۲|قرآن"),1);
assert.ok(result.rows.filter(r=>r.class_name==="۷/۱"&&r.subject==="علوم").every(r=>r.teacher==="دبیر الف"||r.teacher==="دبیر ب"),"engine must choose a qualified teacher automatically");

const multiSubject=generate({...base,requirements:[{className:"۷/۱",subject:"قرآن",count:1},{className:"۷/۲",subject:"فارسی",count:1}]});
assert.equal(multiSubject.ok,true,"one teacher may be eligible for multiple subjects");
assert.ok(multiSubject.rows.every(r=>r.teacher==="دبیر پ"));

const alternating=generate({...base,requirements:[],alternatingGroups:[{classA:"۷/۱",classB:"۷/۲",subjectA:"علوم",subjectB:"مطالعات"}]});
assert.equal(alternating.ok,true,"parallel classes should share one alternating period");
assert.equal(alternating.rows.length,2,"the shared period must be represented for both classes");
assert.equal(alternating.rows[0].weekday,alternating.rows[1].weekday);
assert.equal(alternating.rows[0].period,alternating.rows[1].period);
assert.deepEqual([...alternating.rows[0].teachers].sort(),["دبیر الف","دبیر ب"]);
assert.ok(alternating.rows.every(r=>r.alternating&&r.alternating_teacher.includes("·")));
assert.ok(alternating.rows.find(r=>r.class_name==="۷/۱").teacher.includes("علوم"));
assert.ok(alternating.rows.find(r=>r.class_name==="۷/۱").alternating_teacher.includes("مطالعات"));
assert.ok(alternating.rows.find(r=>r.class_name==="۷/۲").teacher.includes("مطالعات"));
assert.ok(alternating.rows.find(r=>r.class_name==="۷/۲").alternating_teacher.includes("علوم"));
assert.equal(alternating.rows[0].class_name==="۷/۱"?alternating.rows[0].teacher.includes("دبیر الف"):alternating.rows[1].teacher.includes("دبیر الف"),true);

const noTeacher=generate({...base,requirements:[{className:"۷/۱",subject:"زیست",count:1}]});
assert.equal(noTeacher.ok,false,"a lesson with no qualified teacher must be rejected");
const noDays=generate({...base,teachers:base.teachers.map(t=>({...t,days:[]}))});
assert.equal(noDays.ok,false,"teacher attendance days are required");
const badPeriods=generate({...base,periods:[{number:1,start:"08:00",end:"09:00"},{number:2,start:"08:45",end:"09:30"}]});
assert.equal(badPeriods.ok,false,"overlapping bell times must be rejected");
const impossible=generate({...base,days:["شنبه"],periods:[{number:1,start:"08:00",end:"08:45"}],teachers:[{name:"دبیر الف",subjects:["ریاضی"],days:["شنبه"]}],requirements:[{className:"۷/۱",subject:"ریاضی",count:2}]});
assert.equal(impossible.ok,false,"an impossible schedule must not be returned as complete");
assert.equal(impossible.rows.length,0,"no partial plan may be reported as a successful plan");

const page=readFileSync("classroom/weekly-timetable-builder.html","utf8");
assert.ok(page.includes('id="teachers"'),"manager must enter teacher profiles separately");
assert.ok(page.includes('id="requirements"'),"manager must enter class-level subject counts separately");
assert.ok(page.includes("تخصیص خودکار دبیر"),"the UI must describe automatic teacher allocation");
assert.ok(!page.includes('class="rteacher"'),"manager must not assign each teacher to each class manually");
assert.ok(!page.includes("ساعت شروع کار دبیر")&&!page.includes("ساعت پایان کار دبیر"),"teacher work hours are not required");
assert.ok(page.includes("برنامه فعال مدرسه را تغییر نمی‌دهد"),"the generated plan must not overwrite the active timetable");
for(const block of page.split("<script").slice(1)){
 const start=block.indexOf(">"),end=block.indexOf("</script>");
 const script=start>=0&&end>start?block.slice(start+1,end).trim():"";
 if(script)assert.doesNotThrow(()=>new Function(script),"builder inline script must be syntactically valid");
}
console.log("Automatic teacher allocation, weekly counts, alternating classes, conflict prevention and manager UI checks passed.");
