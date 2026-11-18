(function(root){
 "use strict";
 const clean=v=>String(v??"").replace(/[۰-۹]/g,d=>String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٠-٩]/g,d=>String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[\u200c\u200f\u202a-\u202e]/g,"").trim();
 const key=v=>clean(v).replace(/\s+/g,"").toLowerCase();
 const clock=v=>{const m=clean(v).match(/^(\d{1,2}):(\d{2})$/);if(!m)return null;const h=+m[1],n=+m[2];return h<24&&n<60?h*60+n:null};
 function generate(input){
  const errors=[],days=(input.days||[]).map(clean).filter(Boolean),periods=(input.periods||[]).map((p,i)=>({number:Number(clean(p.number)),start:clean(p.start),end:clean(p.end)}));
  if(!days.length)errors.push("حداقل یک روز فعال انتخاب کنید.");
  if(!periods.length)errors.push("حداقل یک زنگ تعریف کنید.");
  const periodNumbers=new Set();
  periods.forEach(p=>{const a=clock(p.start),b=clock(p.end);if(!Number.isInteger(p.number)||p.number<1)errors.push("شماره زنگ معتبر نیست.");if(periodNumbers.has(p.number))errors.push("شماره زنگ تکراری است: "+p.number);periodNumbers.add(p.number);if(a===null||b===null||b<=a)errors.push("ساعت شروع و پایان زنگ "+p.number+" معتبر نیست.");});
  for(let i=0;i<periods.length;i++)for(let j=i+1;j<periods.length;j++){const a=clock(periods[i].start),b=clock(periods[i].end),c=clock(periods[j].start),d=clock(periods[j].end);if(a!==null&&b!==null&&c!==null&&d!==null&&a<d&&c<b)errors.push("ساعت زنگ "+periods[i].number+" با زنگ "+periods[j].number+" هم‌پوشانی دارد.");}
  const requirements=(input.requirements||[]).map((r,i)=>({...r,_i:i,className:clean(r.className),subject:clean(r.subject),teacher:clean(r.teacher),studiesTeacher:clean(r.studiesTeacher),pattern:clean(r.pattern),weight:clean(r.weight),allowedDays:(r.allowedDays||[]).map(clean).filter(Boolean),blocked:(r.blocked||[]).map(clean)}));
  if(!requirements.length)errors.push("حداقل یک درس و کلاس وارد کنید.");
  requirements.forEach((r,i)=>{if(!r.className||!r.subject||!r.teacher)errors.push("ردیف "+(i+1)+": کلاس، درس و دبیر الزامی است.");if(!["one","two","three","one_plus_studies"].includes(r.pattern))errors.push("ردیف "+(i+1)+": نوع تعداد جلسات مشخص نیست.");if(r.pattern==="one_plus_studies"&&!r.studiesTeacher)errors.push("ردیف "+(i+1)+": برای زنگ متناوب با مطالعات، دبیر مطالعات را مشخص کنید.");if(r.allowedDays.some(d=>!days.some(x=>key(x)===key(d))))errors.push("ردیف "+(i+1)+": یکی از روزهای مجاز در روزهای فعال مدرسه نیست.");});
  if(errors.length)return {ok:false,errors,rows:[],stats:{required:0,placed:0}};
  const slots=days.flatMap(day=>periods.map(p=>({day,period:p.number,start:p.start,end:p.end,key:key(day)+"|"+p.number})));
  const tasks=[];
  requirements.forEach((r,i)=>{const count=r.pattern==="one"?1:r.pattern==="two"?2:r.pattern==="three"?3:2;for(let n=0;n<count;n++){const shared=r.pattern==="one_plus_studies"&&n===1;tasks.push({id:tasks.length,source:i,className:r.className,subject:shared?r.subject+" / مطالعات":r.subject,teacher:r.teacher,teachers:shared?[r.teacher,r.studiesTeacher]:[r.teacher],weight:r.weight,shared,allowedDays:r.allowedDays,blocked:r.blocked,fixedDay:clean(r.fixedDay),fixedPeriod:Number(r.fixedPeriod)||0,sequence:n});}});
  const classBusy=new Set(),teacherBusy=new Set(),classDayCount=new Map(),teacherDayCount=new Map(),heavySlots=new Map(),placed=[],nodeLimit=250000;let nodes=0,best=null,lastConflict=[];
  const dayKey=(c,d)=>key(c)+"|"+key(d),resourceKey=(t,s)=>key(t)+"|"+s.key;
  function staticEligible(task,s){
    if(task.fixedDay&&key(task.fixedDay)!==key(s.day))return false;
    if(task.fixedPeriod&&task.fixedPeriod!==s.period)return false;
    if(task.allowedDays.length&&!task.allowedDays.some(d=>key(d)===key(s.day)))return false;
    if(task.blocked.some(x=>key(x)===key(s.day+":"+s.period)||key(x)===key(s.day+" زنگ "+s.period)))return false;
    return true;
  }
  function candidates(task){return slots.filter(s=>staticEligible(task,s)&&!classBusy.has(resourceKey(task.className,s))&&!task.teachers.some(t=>teacherBusy.has(resourceKey(t,s))));}
  function diagnose(task){
    const eligible=slots.filter(s=>staticEligible(task,s));
    if(!eligible.length)return ["برای "+task.className+" · "+task.subject+" هیچ زنگی با روزها و زنگ‌های مجاز ثبت‌شده باقی نمانده است."];
    const reasons=[];
    for(const s of eligible){
      const sameClass=placed.find(p=>p.slot.key===s.key&&key(p.task.className)===key(task.className));
      if(sameClass)reasons.push("کلاس "+task.className+" · "+s.day+" زنگ "+s.period+" هم‌زمان برای "+sameClass.task.subject+" و "+task.subject+" لازم شده است.");
      for(const teacher of task.teachers){
        const other=placed.find(p=>p.slot.key===s.key&&p.task.teachers.some(t=>key(t)===key(teacher)));
        if(other)reasons.push("دبیر "+teacher+" · "+s.day+" زنگ "+s.period+" هم‌زمان برای "+other.task.className+" / "+other.task.subject+" و "+task.className+" / "+task.subject+" تعیین شده است.");
      }
    }
    return [...new Set(reasons)].slice(0,6);
  }
  function score(task,s){
    let v=(classDayCount.get(dayKey(task.className,s.day))||0)*3;
    for(const t of task.teachers)v+=(teacherDayCount.get(dayKey(t,s.day))||0)*2;
    if(task.weight==="سنگین"){
      const prior=heavySlots.get(dayKey(task.className,s.day))||[];
      if(prior.length)v+=40;
      if(prior.some(p=>Math.abs(p-s.period)===1))v+=25;
    }
    return v;
  }
  function place(task,s,sign){
    const ck=resourceKey(task.className,s);
    if(sign>0){classBusy.add(ck);task.teachers.forEach(t=>teacherBusy.add(resourceKey(t,s)));classDayCount.set(dayKey(task.className,s.day),(classDayCount.get(dayKey(task.className,s.day))||0)+1);task.teachers.forEach(t=>teacherDayCount.set(dayKey(t,s.day),(teacherDayCount.get(dayKey(t,s.day))||0)+1));if(task.weight==="سنگین"){const k=dayKey(task.className,s.day);heavySlots.set(k,[...(heavySlots.get(k)||[]),s.period]);}}
    else{classBusy.delete(ck);task.teachers.forEach(t=>teacherBusy.delete(resourceKey(t,s)));const k=dayKey(task.className,s.day),cv=(classDayCount.get(k)||1)-1;if(cv)classDayCount.set(k,cv);else classDayCount.delete(k);task.teachers.forEach(t=>{const q=dayKey(t,s.day),v=(teacherDayCount.get(q)||1)-1;if(v)teacherDayCount.set(q,v);else teacherDayCount.delete(q)});if(task.weight==="سنگین"){const k2=dayKey(task.className,s.day);heavySlots.set(k2,(heavySlots.get(k2)||[]).filter(p=>p!==s.period));}}
  }
  function search(remaining){
    if(++nodes>nodeLimit)return false;
    if(!remaining.length){best=placed.slice();return true;}
    let chosen=null,opts=null;
    for(const task of remaining){const c=candidates(task);if(!opts||c.length<opts.length){chosen=task;opts=c;if(c.length<=1)break;}}
    if(!opts||!opts.length){lastConflict=diagnose(chosen);return false;}
    opts.sort((a,b)=>score(chosen,a)-score(chosen,b)||days.indexOf(a.day)-days.indexOf(b.day)||a.period-b.period);
    const next=remaining.filter(t=>t.id!==chosen.id);
    for(const s of opts){place(chosen,s,1);placed.push({task:chosen,slot:s});if(search(next))return true;placed.pop();place(chosen,s,-1);if(nodes>nodeLimit)break;}
    return false;
  }
  const staticEmpty=tasks.filter(t=>!slots.some(s=>(!t.fixedDay||key(t.fixedDay)===key(s.day))&&(!t.fixedPeriod||t.fixedPeriod===s.period)&&(!t.allowedDays.length||t.allowedDays.some(d=>key(d)===key(s.day)))&&!t.blocked.some(x=>key(x)===key(s.day+":"+s.period)||key(x)===key(s.day+" زنگ "+s.period))));
  const ok=search(tasks.slice());
  if(!ok){
   const first=staticEmpty[0]||tasks[0];const reason=nodes>nodeLimit?"تعداد حالت‌های بررسی از حد مجاز بیشتر شد؛ اطلاعات را به چند مرحله تقسیم کنید.":staticEmpty.length?"برای یکی از جلسات با محدودیت‌های ثبت‌شده هیچ روز و زنگ مجازی وجود ندارد.":"با توجه به تداخل دبیران و کلاس‌ها، برای همه جلسات جای خالی سازگار پیدا نشد.";
   return {ok:false,errors:[reason+(first?" مورد بررسی: "+first.className+" · "+first.subject+" · "+first.teacher:""),...lastConflict,"هیچ برنامه ناقصی منتشر نشد."],rows:[],stats:{required:tasks.length,placed:0,searchNodes:nodes}};
  }
  const rows=best.map(({task,slot})=>({class_name:task.className,weekday:slot.day,period:slot.period,subject:task.subject,teacher:task.teacher,alternating_teacher:task.shared?requirements[task.source].studiesTeacher:"",session_type:task.shared?"متناوب با مطالعات":"کامل",weight:task.weight,start_time:slot.start,end_time:slot.end,teachers:task.teachers}));
  rows.sort((a,b)=>days.indexOf(a.weekday)-days.indexOf(b.weekday)||a.period-b.period||a.class_name.localeCompare(b.class_name,"fa"));
  return {ok:true,errors:[],rows,stats:{required:tasks.length,placed:rows.length,searchNodes:nodes,classes:new Set(rows.map(x=>x.class_name)).size,teachers:new Set(rows.flatMap(x=>x.teachers)).size}};
 }
 root.FrahooshWeeklyTimetableEngine={generate};
})(typeof window!=="undefined"?window:globalThis);
