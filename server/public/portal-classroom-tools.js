(function(){
'use strict';
const $=id=>document.getElementById(id);
const css=' .live-tools{margin-top:16px}.live-tools h3{margin-top:20px}.live-tools .field,.live-tools input,.live-tools select{width:100%;padding:11px;margin:6px 0 12px;border:1px solid var(--line);border-radius:10px;background:#081326;color:var(--text);font:inherit}.live-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px;border:1px solid var(--line);border-radius:10px;margin:8px 0;background:#101f36}.live-row .live-name{flex:1;min-width:140px;font-weight:700}.live-row button{padding:8px 12px;border-radius:8px;border:1px solid var(--line);background:#203451;color:var(--text);cursor:pointer}.live-row button[aria-pressed="true"]{background:#174c43;border-color:#68d7b7;color:#fff}.live-row input{width:110px;margin:0}.live-note{padding:10px;border-radius:10px;background:#172943;color:var(--muted);margin:10px 0;white-space:pre-wrap}.live-tools hr{border-color:var(--line);margin:20px 0}';
const style=document.createElement('style');style.textContent=css;document.head.appendChild(style);
let currentClass='',students=[],attendance=new Map();
function make(tag,attrs,text){const n=document.createElement(tag);Object.keys(attrs||{}).forEach(k=>{if(k==='className')n.className=attrs[k];else if(k==='text')n.textContent=attrs[k];else n.setAttribute(k,attrs[k])});if(text!==undefined)n.textContent=text;return n}
function card(id,title){const el=make('section',{id:id,className:'card live-tools'});el.appendChild(make('h2',{},title));return el}
function note(parent,id,text){const n=make('div',{id:id,className:'live-note',role:'status'},text||'');parent.appendChild(n);return n}
function field(parent,id,label,placeholder,type){parent.appendChild(make('label',{for:id},label));const n=make(type==='select'?'select':'input',{id:id});if(type&&type!=='select')n.type=type||'text';if(placeholder)n.placeholder=placeholder;parent.appendChild(n);return n}
function button(parent,label,fn){const b=make('button',{type:'button',className:'btn',text:label});b.addEventListener('click',fn);parent.appendChild(b);return b}
async function api(path,opts){return window.FrahooshPortal.api(path,opts||{})}
function currentUser(){return window.FrahooshPortal&&window.FrahooshPortal.user}
function dashboard(){return $('dashboard')}
async function setup(){
 const user=currentUser();if(!user||!dashboard())return;
 const role=user.role;
 if(role==='manager')await setupCollaborators();
 if(['teacher','pastoral_deputy','educational_deputy'].includes(role))await setupTeacher();
 if(role==='student')await setupStudent();
 addModuleShortcuts(role);
}
function addModuleShortcuts(role){
 const grid=$('moduleGrid');if(!grid)return;
 if(role==='manager'&&!$('manageClassesShortcut')){const b=make('button',{id:'manageClassesShortcut',type:'button',className:'module-tile primary-module'});b.append(make('span',{className:'module-icon'},'🗂️'),make('strong',{},'مدیریت کلاس‌ها'));b.addEventListener('click',()=>{const p=$('managerPanel');if(p)p.scrollIntoView({behavior:'smooth',block:'start'})});grid.appendChild(b)}
 grid.addEventListener('click',function(e){const b=e.target.closest('.module-tile');if(!b)return;const label=(b.innerText||b.textContent||'').trim();let target='';if(role==='teacher'&&label.indexOf('دفتر کلاسی')>=0)target='teacherLivePanel';if(role==='teacher'&&label.indexOf('ثبت نمرات کلاسی')>=0)target='teacherLivePanel';if(role==='student'&&label.indexOf('مشاهده نمرات درسی')>=0)target='studentLivePanel';if(!target)return;e.preventDefault();e.stopPropagation();if(e.stopImmediatePropagation)e.stopImmediatePropagation();const p=$(target);if(p)p.scrollIntoView({behavior:'smooth',block:'start'});},true);
}
async function setupCollaborators(){
 const manager=$('managerPanel');if(!manager||$('collabLivePanel'))return;
 const panel=card('collabLivePanel','مدیریت همکاران کلاس');panel.appendChild(make('p',{},'برای کلاس‌های موجود، دبیر یا همکار آموزشی مجاز تعیین کنید.'));
 const classSelect=field(panel,'collabLiveClass','کلاس','', 'select');
 const teacherSelect=field(panel,'collabLiveTeacher','همکار آموزشی','', 'select');
 const status=note(panel,'collabLiveStatus','در حال دریافت کلاس‌ها و همکاران…');
 button(panel,'افزودن همکار به کلاس',async()=>{try{if(!classSelect.value||!teacherSelect.value)throw new Error('کلاس و همکار را انتخاب کنید.');const d=await api('/classes/'+encodeURIComponent(classSelect.value)+'/collaborators',{method:'POST',body:JSON.stringify({teacherId:Number(teacherSelect.value)})});status.textContent=d.message;await loadClasses()}catch(e){status.textContent=e.message}});
 manager.insertAdjacentElement('afterend',panel);
 async function loadClasses(){const d=await api('/classes');classSelect.replaceChildren();for(const r of d.classrooms){const o=make('option',{value:r.id},(r.title||'کلاس')+' · '+r.grade_class+' · '+(r.teacher_name||''));classSelect.appendChild(o)}if(!d.classrooms.length)status.textContent='ابتدا از بخش مدیریت کلاس‌ها کلاس بسازید.'}
 try{const d=await api('/teachers');for(const t of d.teachers)teacherSelect.appendChild(make('option',{value:t.id},t.display_name+' · '+t.role));await loadClasses();if(classSelect.value)status.textContent='کلاس و همکار را انتخاب کنید.'}catch(e){status.textContent=e.message}
}
async function setupTeacher(){
 if($('teacherLivePanel'))return;
 const panel=card('teacherLivePanel','دفتر کلاسی دبیر');
 panel.appendChild(make('p',{className:'live-note'},'برای حضور و غیاب یا ثبت نمره، کلاس اختصاص‌یافته را انتخاب کنید.'));
 const cls=field(panel,'teacherLiveClass','کلاس','', 'select');
 const status=note(panel,'teacherLiveStatus','در حال بارگذاری کلاس‌ها…');
 panel.appendChild(make('h3',{},'حضور و غیاب'));
 const date=field(panel,'teacherLiveDate','تاریخ حضور و غیاب','', 'date');
 date.value=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
 const att=make('div',{id:'teacherLiveAttendance'});panel.appendChild(att);
 button(panel,'ذخیره حضور و غیاب',async()=>{try{const records=students.filter(s=>attendance.has(Number(s.id))).map(s=>({studentId:Number(s.id),status:attendance.get(Number(s.id))}));if(!records.length)throw new Error('برای دانش‌آموزان حاضر یا غایب را انتخاب کنید.');const d=await api('/classes/'+encodeURIComponent(cls.value)+'/attendance',{method:'POST',body:JSON.stringify({date:date.value,attendance:records})});status.textContent=d.message+' · '+d.saved+' دانش‌آموز'}catch(e){status.textContent=e.message}});
 panel.appendChild(make('hr',{}));panel.appendChild(make('h3',{},'ثبت نمرات کلاسی'));
 const subject=field(panel,'teacherLiveSubject','درس','نام درس','text');const assessment=field(panel,'teacherLiveAssessment','عنوان ارزشیابی','مثلاً آزمون فصل اول','text');
 const gradeRows=make('div',{id:'teacherLiveGrades'});panel.appendChild(gradeRows);
 button(panel,'ذخیره نمرات',async()=>{try{if(!cls.value||!subject.value.trim()||!assessment.value.trim())throw new Error('کلاس، درس و عنوان ارزشیابی را وارد کنید.');const grades=[...gradeRows.querySelectorAll('input[data-student]')].filter(x=>x.value.trim()!=='').map(x=>({studentId:Number(x.dataset.student),score:x.value}));if(!grades.length)throw new Error('حداقل یک نمره وارد کنید.');const d=await api('/classes/'+encodeURIComponent(cls.value)+'/grades',{method:'POST',body:JSON.stringify({subject:subject.value.trim(),assessmentTitle:assessment.value.trim(),grades})});status.textContent=d.message+' · '+d.saved+' نمره';await loadHistory()}catch(e){status.textContent=e.message}});
 panel.appendChild(make('h3',{},'سوابق ثبت نمره'));const history=make('div',{id:'teacherLiveHistory'});panel.appendChild(history);
 dashboard().appendChild(panel);
 cls.addEventListener('change',loadStudents);date.addEventListener('change',loadAttendance);
 async function loadStudents(){currentClass=cls.value;students=[];attendance.clear();att.replaceChildren();gradeRows.replaceChildren();history.replaceChildren();if(!currentClass)return;try{const d=await api('/classes/'+encodeURIComponent(currentClass)+'/students');students=d.students||[];status.textContent='تعداد دانش‌آموزان کلاس: '+students.length;renderAttendance();renderGradeInputs();await Promise.all([loadAttendance(),loadHistory()])}catch(e){status.textContent=e.message}}
 function renderAttendance(){att.replaceChildren();if(!students.length){att.textContent='فهرست دانش‌آموزی پیدا نشد.';return}for(const s of students){const row=make('div',{className:'live-row'});row.appendChild(make('span',{className:'live-name'},[s.display_name,s.family_name].filter(Boolean).join(' ')));for(const [v,l] of [['present','حاضر'],['absent','غایب']]){const b=make('button',{type:'button','aria-pressed':String(attendance.get(Number(s.id))===v)},l);b.addEventListener('click',()=>{attendance.set(Number(s.id),v);row.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',String(x.textContent===l)))});row.appendChild(b)}att.appendChild(row)}}
 function renderGradeInputs(){gradeRows.replaceChildren();for(const s of students){const row=make('div',{className:'live-row'});row.appendChild(make('span',{className:'live-name'},[s.display_name,s.family_name].filter(Boolean).join(' ')));const input=make('input',{type:'number',min:'0',max:'100',step:'0.25','data-student':s.id,'aria-label':'نمره '+s.display_name});input.placeholder='نمره از ۱۰۰';row.appendChild(input);gradeRows.appendChild(row)}}
 async function loadAttendance(){if(!currentClass||!date.value)return;try{const d=await api('/classes/'+encodeURIComponent(currentClass)+'/attendance?date='+encodeURIComponent(date.value));attendance=new Map((d.attendance||[]).map(x=>[Number(x.student_id),x.status]));renderAttendance()}catch(e){status.textContent=e.message}}
 async function loadHistory(){if(!currentClass)return;try{const d=await api('/classes/'+encodeURIComponent(currentClass)+'/grades');history.replaceChildren();if(!d.grades.length){history.textContent='هنوز نمره‌ای ثبت نشده است.';return}for(const g of d.grades.slice(0,30)){const s=students.find(x=>Number(x.id)===Number(g.student_id));history.appendChild(make('div',{className:'item'},(s?[s.display_name,s.family_name].filter(Boolean).join(' '):'دانش‌آموز')+' · '+g.subject+' · '+g.assessment_title+' · '+g.score))} }catch(e){history.textContent=e.message}}
 try{const d=await api('/classes');cls.replaceChildren();for(const r of d.classrooms)cls.appendChild(make('option',{value:r.id},(r.title||'کلاس')+' · '+r.grade_class+' · '+(r.teacher_name||'')));if(!d.classrooms.length){status.textContent='هنوز کلاسی به حساب شما اختصاص داده نشده است.';return}await loadStudents()}catch(e){status.textContent=e.message}
}
async function setupStudent(){
 if($('studentLivePanel'))return;
 const panel=card('studentLivePanel','سوابق آموزشی دانش‌آموز');panel.appendChild(make('p',{className:'live-note'},'فقط سوابق ثبت‌شده برای حساب خودتان نمایش داده می‌شود.'));
 panel.appendChild(make('h3',{},'نمرات'));const grades=make('div',{id:'studentLiveGrades'});panel.appendChild(grades);panel.appendChild(make('h3',{},'حضور و غیاب'));const attendanceList=make('div',{id:'studentLiveAttendance'});panel.appendChild(attendanceList);dashboard().appendChild(panel);
 try{const d=await api('/student/records');if(!d.grades.length)grades.textContent='هنوز نمره‌ای ثبت نشده است.';for(const g of d.grades){grades.appendChild(make('div',{className:'item'},(g.class_title||'کلاس')+' · '+(g.subject||'درس')+' · '+g.assessment_title+' · نمره: '+g.score+(g.notes?' · '+g.notes:'')))}if(!d.attendance.length)attendanceList.textContent='سابقه حضور و غیاب ثبت نشده است.';for(const a of d.attendance){attendanceList.appendChild(make('div',{className:'item'},a.lesson_date+' · '+(a.class_title||'کلاس')+' · '+(a.status==='present'?'حاضر':'غایب')))}}catch(e){grades.textContent=e.message}
}
window.addEventListener('frahoosh:ready',()=>setup().catch(e=>console.error('classroom tools failed',e)));
if(currentUser())setup().catch(e=>console.error('classroom tools failed',e));
})();