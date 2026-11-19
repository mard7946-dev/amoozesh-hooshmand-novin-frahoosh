(function(root){
"use strict";
const clean=v=>String(v??"").replace(/[۰-۹]/g,d=>String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٠-٩]/g,d=>String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[\u200c\u200f\u202a-\u202e]/g,"").trim();
const key=v=>clean(v).replace(/\s+/g,"").toLowerCase();
const clock=v=>{const m=clean(v).match(/^(\d{1,2}):(\d{2})$/);if(!m)return null;const h=+m[1],n=+m[2];return h<24&&n<60?h*60+n:null};
function generate(input){
 const errors=[],days=(input.days||[]).map(clean).filter(Boolean),periods=(input.periods||[]).map(p=>({number:Number(clean(p.number)),start:clean(p.start),end:clean(p.end)}));
 const teachers=(input.teachers||[]).map((t,i)=>({id:i,name:clean(t.name),subjects:(t.subjects||[]).map(clean).filter(Boolean),days:(t.days||[]).map(clean).filter(Boolean)}));
 const requirements=(input.requirements||[]).map((r,i)=>({id:i,className:clean(r.className),subject:clean(r.subject),count:Number(r.count),weight:clean(r.weight)}));
 const groups=(input.alternatingGroups||[]).map((g,i)=>({id:i,classA:clean(g.classA),classB:clean(g.classB),subjectA:clean(g.subjectA),subjectB:clean(g.subjectB),weight:clean(g.weight)}));
 if(!days.length)errors.push("روزهای فعال مدرسه را انتخاب کنید.");
 if(!periods.length)errors.push("زنگ‌های مدرسه را تعریف کنید.");
 const periodSet=new Set();
 periods.forEach(p=>{const a=clock(p.start),b=clock(p.end);if(!Number.isInteger(p.number)||p.number<1)errors.push("شماره زنگ معتبر نیست.");if(periodSet.has(p.number))errors.push("شماره زنگ تکراری است: "+p.number);periodSet.add(p.number);if(a===null||b===null||b<=a)errors.push("ساعت زنگ "+p.number+" معتبر نیست.");});
 for(let i=0;i<periods.length;i++)for(let j=i+1;j<periods.length;j++){const a=clock(periods[i].start),b=clock(periods[i].end),c=clock(periods[j].start),d=clock(periods[j].end);if(a!==null&&b!==null&&c!==null&&d!==null&&a<d&&c<b)errors.push("ساعت دو زنگ با یکدیگر هم‌پوشانی دارد.");}
 if(!teachers.length)errors.push("اطلاعات دبیران را وارد کنید.");
 teachers.forEach(t=>{if(!t.name)errors.push("نام هر دبیر الزامی است.");if(!t.subjects.length)errors.push("برای دبیر "+(t.name||"بدون نام")+" دست‌کم یک درس تعیین کنید.");if(!t.days.length)errors.push("روزهای حضور دبیر "+(t.name||"بدون نام")+" را مشخص کنید.");if(t.days.some(d=>!days.some(x=>key(x)===key(d))))errors.push("روز حضور دبیر "+t.name+" خارج از روزهای فعال مدرسه است.");});
 if(!requirements.length&&!groups.length)errors.push("نیاز درسی کلاس‌ها را وارد کنید.");
 requirements.forEach(r=>{if(!r.className||!r.subject)errors.push("نام کلاس و درس در نیاز درسی الزامی است.");if(!Number.isInteger(r.count)||r.count<1||r.count>periods.length*days.length)errors.push("تعداد جلسات "+r.className+" · "+r.subject+" معتبر نیست.");});
 groups.forEach(g=>{if(!g.classA||!g.classB||key(g.classA)===key(g.classB)||!g.subjectA||!g.subjectB)errors.push("اطلاعات کلاس‌های زوجی و درس‌های متناوب کامل نیست.");});
 const findTeachers=subject=>teachers.filter(t=>t.subjects.some(s=>key(s)===key(subject)));
 requirements.forEach(r=>{if(r.subject&&!findTeachers(r.subject).length)errors.push("برای درس "+r.subject+" هیچ دبیری با این تخصص ثبت نشده است.");});
 groups.forEach(g=>{if(g.subjectA&&!findTeachers(g.subjectA).length)errors.push("برای درس "+g.subjectA+" دبیر واجد تخصص ثبت نشده است.");if(g.subjectB&&!findTeachers(g.subjectB).length)errors.push("برای درس "+g.subjectB+" دبیر واجد تخصص ثبت نشده است.");if(g.subjectA&&g.subjectB&&!findTeachers(g.subjectA).some(a=>findTeachers(g.subjectB).some(b=>a.id!==b.id)))errors.push("برای زنگ متناوب "+g.subjectA+" و "+g.subjectB+" باید دو دبیر متفاوت و واجد تخصص وجود داشته باشد.");});
 if(errors.length)return {ok:false,errors,rows:[],stats:{required:0,placed:0}};
 const slots=days.flatMap(day=>periods.map(p=>({day,period:p.number,start:p.start,end:p.end,key:key(day)+"|"+p.number})));
 const tasks=[];
 requirements.forEach(r=>{for(let n=0;n<r.count;n++)tasks.push({kind:"lesson",id:tasks.length,classNames:[r.className],subject:r.subject,weight:r.weight,teacherOptions:findTeachers(r.subject)});});
 groups.forEach(g=>tasks.push({kind:"alternating",id:tasks.length,classNames:[g.classA,g.classB],subjectA:g.subjectA,subjectB:g.subjectB,weight:g.weight,teacherPairs:findTeachers(g.subjectA).flatMap(a=>findTeachers(g.subjectB).filter(b=>a.id!==b.id).map(b=>[a,b]))}));
 const classBusy=new Set(),teacherBusy=new Set(),teacherLoad=new Map(),classDayLoad=new Map(),heavySlots=new Map(),placed=[];let nodes=0;const nodeLimit=600000,busy=(name,s)=>key(name)+"|"+s.key;
 function options(task){
  const out=[];
  for(const s of slots){
   if(task.classNames.some(c=>classBusy.has(busy(c,s))))continue;
   if(task.kind==="lesson"){
    for(const t of task.teacherOptions)if(t.days.some(d=>key(d)===key(s.day))&&!teacherBusy.has(busy(t.name,s)))out.push({slot:s,teachers:[t]});
   }else{
    for(const pair of task.teacherPairs){const [a,b]=pair;if(a.days.some(d=>key(d)===key(s.day))&&b.days.some(d=>key(d)===key(s.day))&&!teacherBusy.has(busy(a.name,s))&&!teacherBusy.has(busy(b.name,s)))out.push({slot:s,teachers:pair});}
   }
  }
  return out;
 }
 function score(task,opt){
  let n=0;for(const t of opt.teachers)n+=(teacherLoad.get(key(t.name))||0)*4;
  for(const c of task.classNames)n+=(classDayLoad.get(key(c)+"|"+key(opt.slot.day))||0)*3;
  if(task.weight==="سنگین"){for(const c of task.classNames){const prior=heavySlots.get(key(c)+"|"+key(opt.slot.day))||[];if(prior.length)n+=35;if(prior.some(p=>Math.abs(p-opt.slot.period)===1))n+=25;}}
  return n;
 }
 function place(task,opt,add){
  const s=opt.slot,delta=add?1:-1;
  for(const c of task.classNames){const k=busy(c,s);if(add)classBusy.add(k);else classBusy.delete(k);const dk=key(c)+"|"+key(s.day),v=(classDayLoad.get(dk)||0)+delta;if(v)classDayLoad.set(dk,v);else classDayLoad.delete(dk);}
  for(const t of opt.teachers){const k=busy(t.name,s);if(add)teacherBusy.add(k);else teacherBusy.delete(k);const v=(teacherLoad.get(key(t.name))||0)+delta;if(v)teacherLoad.set(key(t.name),v);else teacherLoad.delete(key(t.name));}
  if(task.weight==="سنگین")for(const c of task.classNames){const k=key(c)+"|"+key(s.day),v=heavySlots.get(k)||[];if(add)heavySlots.set(k,[...v,s.period]);else{const next=v.filter(p=>p!==s.period);if(next.length)heavySlots.set(k,next);else heavySlots.delete(k);}}
 }
 function search(remaining){
  if(++nodes>nodeLimit)return false;if(!remaining.length)return true;
  let chosen=null,opts=null;
  for(const task of remaining){const o=options(task);if(!opts||o.length<opts.length){chosen=task;opts=o;if(o.length<=1)break;}}
  if(!opts||!opts.length)return false;
  opts.sort((a,b)=>score(chosen,a)-score(chosen,b)||days.indexOf(a.slot.day)-days.indexOf(b.slot.day)||a.slot.period-b.slot.period);
  const next=remaining.filter(t=>t.id!==chosen.id);
  for(const opt of opts){place(chosen,opt,true);placed.push({task:chosen,opt});if(search(next))return true;placed.pop();place(chosen,opt,false);if(nodes>nodeLimit)break;}
  return false;
 }
 if(!search(tasks.slice())){
  const conflict=tasks.find(t=>!options(t));
  const message=nodes>nodeLimit?"تعداد حالت‌های بررسی از حد مجاز گذشت؛ محدودیت‌ها را بازبینی کنید.":"با ترکیب روزهای حضور دبیران و نیاز کلاس‌ها، برنامه کامل و بدون تداخل پیدا نشد.";
  return {ok:false,errors:[message,...(conflict?["بررسی ویژه: "+conflict.classNames.join(" و ")+" · "+(conflict.subject||conflict.subjectA+" / "+conflict.subjectB)]:[]),"برنامه ناقص به‌عنوان خروجی موفق ارائه نشد."],rows:[],stats:{required:tasks.length,placed:0,searchNodes:nodes}};
 }
 const rows=[];
 for(const {task,opt} of placed){const s=opt.slot;
  if(task.kind==="lesson")rows.push({class_name:task.classNames[0],weekday:s.day,period:s.period,start_time:s.start,end_time:s.end,subject:task.subject,teacher:opt.teachers[0].name,session_type:"کامل",weight:task.weight,teachers:[opt.teachers[0].name]});
  else{const [a,b]=opt.teachers;rows.push({class_name:task.classNames[0],weekday:s.day,period:s.period,start_time:s.start,end_time:s.end,subject:task.subjectA+" / "+task.subjectB,teacher:"هفته اول: "+a.name+" · "+task.subjectA+" | "+b.name+" · "+task.subjectB,alternating_teacher:"هفته دوم: "+b.name+" · "+task.subjectB+" | "+a.name+" · "+task.subjectA,session_type:"متناوب با کلاس "+task.classNames[1],weight:task.weight,teachers:[a.name,b.name],alternating:true});rows.push({class_name:task.classNames[1],weekday:s.day,period:s.period,start_time:s.start,end_time:s.end,subject:task.subjectB+" / "+task.subjectA,teacher:"هفته اول: "+b.name+" · "+task.subjectB+" | "+a.name+" · "+task.subjectA,alternating_teacher:"هفته دوم: "+a.name+" · "+task.subjectA+" | "+b.name+" · "+task.subjectB,session_type:"متناوب با کلاس "+task.classNames[0],weight:task.weight,teachers:[a.name,b.name],alternating:true});}
 }
 rows.sort((a,b)=>days.indexOf(a.weekday)-days.indexOf(b.weekday)||a.period-b.period||a.class_name.localeCompare(b.class_name,"fa"));
 return {ok:true,errors:[],rows,stats:{required:tasks.length,placed:tasks.length,classes:new Set(rows.map(r=>r.class_name)).size,teachers:new Set(rows.flatMap(r=>r.teachers)).size,searchNodes:nodes}};
}
root.FrahooshWeeklyTimetableEngine={generate};
})(typeof window!=="undefined"?window:globalThis);
