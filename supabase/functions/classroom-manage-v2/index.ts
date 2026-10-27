import { createClient } from "npm:@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});
const clean=(v:unknown,max=180)=>String(v??"").replace(/[\u200c\u200f\u202a-\u202e]/g,"").trim().slice(0,max);
const norm=(v:unknown)=>clean(v).toLowerCase().replace(/[يى]/g,"ی").replace(/ك/g,"ک").replace(/\s+/g," ");
const digits=(v:unknown)=>clean(v,40).replace(/[۰-۹]/g,d=>String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٠-٩]/g,d=>String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
const aliases={manager:["manager","مدیر","مدیر مدرسه"],deputy:["deputy","executive_deputy","educational_deputy","pastoral_deputy","معاونت","معاون اجرایی","معاون آموزشی","معاون پرورشی"],teacher:["teacher","دبیر","معلم"],student:["student","دانش‌آموز","دانش آموز"]};
const dayMap=new Map([["شنبه","شنبه"],["saturday","شنبه"],["sat","شنبه"],["یکشنبه","یکشنبه"],["sunday","یکشنبه"],["دوشنبه","دوشنبه"],["monday","دوشنبه"],["سه‌شنبه","سه‌شنبه"],["سه شنبه","سه‌شنبه"],["tuesday","سه‌شنبه"],["چهارشنبه","چهارشنبه"],["wednesday","چهارشنبه"],["پنجشنبه","پنجشنبه"],["پنج‌شنبه","پنجشنبه"],["thursday","پنجشنبه"],["جمعه","جمعه"],["friday","جمعه"]]);
function field(row:Record<string,unknown>,...names:string[]){const entries=Object.entries(row||{}).map(([k,v])=>[norm(k),v] as const);const hit=entries.find(([k])=>names.some(n=>k===norm(n)));return clean(hit?.[1],300)}
function hasRole(role:string,kind:string){return aliases[kind as keyof typeof aliases].includes(norm(role))}
function timeValue(v:unknown){const s=digits(v).replace(/\s/g,"");if(!s)return null;const m=s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);if(!m)return null;const h=Number(m[1]),min=Number(m[2]);return h<24&&min<60?String(h).padStart(2,"0")+":"+String(min).padStart(2,"0"):null}
async function context(req:Request){
 const authorization=req.headers.get("authorization")||"",token=authorization.startsWith("Bearer ")?authorization.slice(7):"";
 if(!token)throw Object.assign(new Error("ابتدا وارد پنل فراهوش شوید."),{status:401});
 const url=(Deno.env.get("SUPABASE_URL")||"").trim();let key=(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"").trim();const bundle=(Deno.env.get("SUPABASE_SECRET_KEYS")||"").trim();
 if(bundle){try{const b=JSON.parse(bundle);const candidate=typeof b==="string"?b:b.default??b.service_role??b.serviceRole??b.service_role_key;if(typeof candidate==="string"&&candidate.trim())key=candidate.trim()}catch{if(bundle.startsWith("sb_secret_")||bundle.startsWith("eyJ"))key=bundle}}
 if(!url||!key)throw Object.assign(new Error("سرویس مدیریت کلاس پیکربندی نشده است."),{status:503});
 const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:authData,error:authError}=await admin.auth.getUser(token);if(authError||!authData.user)throw Object.assign(new Error("نشست معتبر نیست؛ دوباره وارد شوید."),{status:401});
 const {data:profile,error}=await admin.from("account_settings").select("username,national_code,display_name,role,auth_user_id,tenant_school_id").eq("auth_user_id",authData.user.id).maybeSingle();
 if(error||!profile?.tenant_school_id)throw Object.assign(new Error("پروفایل یا مدرسهٔ متصل به این حساب پیدا نشد."),{status:403});
 const {data:membership,error:me}=await admin.from("school_memberships").select("id").eq("school_id",profile.tenant_school_id).eq("auth_user_id",authData.user.id).eq("is_active",true).maybeSingle();
 if(me||!membership)throw Object.assign(new Error("عضویت فعال این حساب در مدرسه تأیید نشد."),{status:403});
 const role=norm(profile.role),isManager=hasRole(role,"manager"),isDeputy=hasRole(role,"deputy"),isTeacher=hasRole(role,"teacher"),isStudent=hasRole(role,"student");
 if(!isManager&&!isDeputy&&!isTeacher&&!isStudent)throw Object.assign(new Error("این نقش اجازهٔ استفاده از ابزارهای کلاس را ندارد."),{status:403});
 let teacher=null,student=null;
 if(isTeacher){let lookup=await admin.from("teachers").select("id,first_name,last_name,national_code,employee_code").eq("tenant_school_id",profile.tenant_school_id).eq("national_code",clean(profile.national_code)).limit(1).maybeSingle();if(!lookup.data&&profile.username)lookup=await admin.from("teachers").select("id,first_name,last_name,national_code,employee_code").eq("tenant_school_id",profile.tenant_school_id).eq("employee_code",clean(profile.username)).limit(1).maybeSingle();teacher=lookup.data||null;}
 if(isStudent){const {data,error:e}=await admin.from("students").select("id,first_name,last_name,national_code,grade,class_name").eq("national_code",profile.national_code).eq("tenant_school_id",profile.tenant_school_id).maybeSingle();if(e||!data?.class_name)throw Object.assign(new Error("کلاس ثبت‌شدهٔ دانش‌آموز پیدا نشد."),{status:403});student=data;}
 return {admin,profile,tenant:profile.tenant_school_id,role,isManager,isDeputy,isTeacher,isStudent,teacher,student,userId:authData.user.id};
}
async function classAccess(ctx:any,classId:number){
 const {data:room,error}=await ctx.admin.from("online_classes").select("id,title,subject,grade,class_name,teacher,status,start_at,end_at,tenant_school_id").eq("id",classId).eq("tenant_school_id",ctx.tenant).maybeSingle();
 if(error||!room)throw Object.assign(new Error("کلاس پیدا نشد."),{status:404});
 if(ctx.isManager||ctx.isDeputy)return room;
 if(ctx.isStudent&&norm(room.class_name)===norm(ctx.student.class_name))return room;
 if(ctx.isTeacher){
  const teacherName=norm([ctx.teacher?.first_name,ctx.teacher?.last_name].filter(Boolean).join(" "))||norm(ctx.profile.display_name);
  if(norm(room.teacher)===teacherName||norm(room.teacher)===norm(ctx.profile.display_name)||norm(room.teacher)===norm(ctx.profile.username))return room;
  if(ctx.teacher?.id){const {data}=await ctx.admin.from("online_class_teachers").select("id").eq("class_id",classId).eq("teacher_id",ctx.teacher.id).eq("tenant_school_id",ctx.tenant).limit(1);if(data?.length)return room;}
 }
 throw Object.assign(new Error("این کلاس به حساب شما اختصاص داده نشده است."),{status:403});
}
async function studentsFor(ctx:any,className:string){
 const {data,error}=await ctx.admin.from("students").select("id,first_name,last_name,grade,class_name,national_code").eq("tenant_school_id",ctx.tenant).eq("class_name",className).order("last_name").limit(1000);
 if(error)throw error;return data||[];
}
async function createScheduleRow(ctx:any,row:any,teacher:any){
 const className=clean(row.className||row.class_name||row["کلاس"]||row["پایه و کلاس"],80);
 const subject=clean(row.subject||row["درس"]||row["عنوان درس"],120);
 const weekday=dayMap.get(norm(row.weekday||row.day||row["روز"]))||"";
 const period=Number(digits(row.period||row["زنگ"]||row["شماره زنگ"]));
 const startTime=timeValue(row.start_time||row.startTime||row["ساعت شروع"]||row["شروع"]);
 const endTime=timeValue(row.end_time||row.endTime||row["ساعت پایان"]||row["پایان"]);
 if(!className||!subject||!weekday||!Number.isInteger(period)||period<1||period>12||!teacher)throw new Error("یک ردیف برنامه ناقص است: کلاس، روز، زنگ، درس و دبیر لازم است.");
 const teacherName=[teacher.first_name,teacher.last_name].filter(Boolean).join(" ")||clean(row.teacher_name||row.teacher||row["نام دبیر"]);
 let onlineClassId=Number(row.online_class_id||row.class_id)||0;
 if(onlineClassId){const {data}=await ctx.admin.from("online_classes").select("id").eq("id",onlineClassId).eq("tenant_school_id",ctx.tenant).maybeSingle();if(!data)onlineClassId=0;}
 if(!onlineClassId){
  const {data:existing}=await ctx.admin.from("online_classes").select("id").eq("tenant_school_id",ctx.tenant).eq("class_name",className).eq("subject",subject).eq("teacher",teacherName).limit(1).maybeSingle();
  if(existing)onlineClassId=existing.id;
 }
 const classPayload={title:subject,subject,lesson:subject,teacher:teacherName,grade:clean(row.grade||row["پایه"]||className.split("/")[0],40),class_name:className,status:"scheduled",start_time:startTime||"",end_time:endTime||"",duration:50,activated_by:clean(ctx.profile.display_name)||clean(ctx.profile.username),tenant_school_id:ctx.tenant};
 if(onlineClassId){const {error}=await ctx.admin.from("online_classes").update(classPayload).eq("id",onlineClassId).eq("tenant_school_id",ctx.tenant);if(error)throw error;}
 else{const {data,error}=await ctx.admin.from("online_classes").insert(classPayload).select("id").single();if(error)throw error;onlineClassId=data.id;}
 const {data:old}=await ctx.admin.from("weekly_schedule_entries").select("id").eq("tenant_school_id",ctx.tenant).eq("class_name",className).eq("weekday",weekday).eq("period",period).limit(1).maybeSingle();
 const schedulePayload={class_name:className,weekday,period,subject,teacher_id:teacher.id,teacher_name:teacherName,teacher_username:clean(row.teacher_username||row.teacherUsername||row["نام کاربری دبیر"],100),start_time:startTime,end_time:endTime,day_enabled:true,online_class_id:onlineClassId,tenant_school_id:ctx.tenant,academic_year:clean(row.academic_year||row["سال تحصیلی"],30)};
 if(old){const {error}=await ctx.admin.from("weekly_schedule_entries").update(schedulePayload).eq("id",old.id).eq("tenant_school_id",ctx.tenant);if(error)throw error;}
 else{const {error}=await ctx.admin.from("weekly_schedule_entries").insert(schedulePayload);if(error)throw error;}
 const students=await studentsFor(ctx,className);
 for(const s of students){const {data:linked}=await ctx.admin.from("online_class_students").select("id").eq("class_id",onlineClassId).eq("student_id",s.id).eq("tenant_school_id",ctx.tenant).limit(1);if(!linked?.length){const {error}=await ctx.admin.from("online_class_students").insert({class_id:onlineClassId,student_id:s.id,student_name:[s.first_name,s.last_name].filter(Boolean).join(" "),tenant_school_id:ctx.tenant});if(error)throw error;}}
 return {onlineClassId,className,subject,weekday,period,students:students.length};
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return reply({message:"درخواست نامعتبر است."},405);
 try{
  const ctx=await context(req),body=await req.json().catch(()=>({})),action=clean(body.action,40);
  if(action==="list"){
   if(ctx.isManager||ctx.isDeputy){
    const [classes,schedule,teachers,students]=await Promise.all([
     ctx.admin.from("online_classes").select("id,title,subject,grade,class_name,teacher,status,start_time,end_time,start_at,end_at").eq("tenant_school_id",ctx.tenant).order("id",{ascending:false}).limit(500),
     ctx.admin.from("weekly_schedule_entries").select("id,class_name,weekday,period,subject,teacher_id,teacher_name,teacher_username,start_time,end_time,online_class_id,day_enabled").eq("tenant_school_id",ctx.tenant).order("weekday").order("period").limit(2000),
     ctx.admin.from("teachers").select("id,first_name,last_name,subject,employee_code,national_code").eq("tenant_school_id",ctx.tenant).order("first_name").limit(500),
     ctx.admin.from("students").select("id,first_name,last_name,grade,class_name").eq("tenant_school_id",ctx.tenant).order("last_name").limit(2000)
    ]);
    for(const x of [classes,schedule,teachers,students])if(x.error)throw x.error;
    return reply({ok:true,classes:classes.data||[],schedule:schedule.data||[],teachers:teachers.data||[],students:students.data||[]});
   }
   if(ctx.isTeacher){
    const [classes,schedule]=await Promise.all([
     ctx.admin.from("online_classes").select("id,title,subject,grade,class_name,teacher,status,start_time,end_time,start_at,end_at").eq("tenant_school_id",ctx.tenant).order("id",{ascending:false}).limit(500),
     ctx.admin.from("weekly_schedule_entries").select("id,class_name,weekday,period,subject,teacher_id,teacher_name,teacher_username,start_time,end_time,online_class_id").eq("tenant_school_id",ctx.tenant).order("weekday").order("period").limit(2000)
    ]);
    if(classes.error||schedule.error)throw classes.error||schedule.error;
    const name=norm([ctx.teacher?.first_name,ctx.teacher?.last_name].filter(Boolean).join(" "))||norm(ctx.profile.display_name);
    const assigned=(classes.data||[]).filter((r:any)=>norm(r.teacher)===name||norm(r.teacher)===norm(ctx.profile.display_name)||norm(r.teacher)===norm(ctx.profile.username));
    const extra=ctx.teacher?.id?await ctx.admin.from("online_class_teachers").select("class_id").eq("teacher_id",ctx.teacher.id).eq("tenant_school_id",ctx.tenant):{data:[]};
    const ids=new Set([...(assigned.map((r:any)=>r.id)),...((extra.data||[]).map((r:any)=>r.class_id))]);
    return reply({ok:true,classes:(classes.data||[]).filter((r:any)=>ids.has(r.id)),schedule:(schedule.data||[]).filter((r:any)=>ids.has(r.online_class_id)),teachers:[],students:[]});
   }
   if(ctx.isStudent){
    const {data:schedule,error}=await ctx.admin.from("weekly_schedule_entries").select("id,class_name,weekday,period,subject,teacher_name,start_time,end_time,online_class_id").eq("tenant_school_id",ctx.tenant).eq("class_name",ctx.student.class_name).order("weekday").order("period").limit(500);
    if(error)throw error;return reply({ok:true,classes:[],schedule:schedule||[],teachers:[],students:[]});
   }
  }
  if(action==="import"){
   if(!ctx.isManager)throw Object.assign(new Error("فقط مدیر مدرسه می‌تواند فایل Excel را ثبت کند."),{status:403});
   const inputStudents=Array.isArray(body.students)?body.students:[],inputSchedule=Array.isArray(body.schedule)?body.schedule:[];
   if(inputStudents.length>3000||inputSchedule.length>3000)throw Object.assign(new Error("تعداد ردیف‌های فایل از حد مجاز بیشتر است."),{status:400});
   const studentIds=new Map<string,number>();let studentCount=0,skippedStudents=0;
   for(const row of inputStudents){
    const first=field(row,"نام","first_name","firstName"),last=field(row,"نام خانوادگی","نام‌خانوادگی","last_name","lastName");
    const className=field(row,"کلاس","پایه و کلاس","class_name","className","class"),grade=field(row,"پایه","grade")||className.split("/")[0];
    const rawNationalCode=digits(field(row,"کد ملی","کدملی","national_code","nationalCode"));const nationalCode=rawNationalCode.padStart(10,"0");
    if(!first||!last||!className||!rawNationalCode||!/^\d{10}$/.test(nationalCode)){skippedStudents++;continue;}
    const payload={first_name:first,last_name:last,class_name:className,grade,national_code:nationalCode,student_code:field(row,"کد دانش آموز","کد دانش‌آموز","student_code","studentCode"),tenant_school_id:ctx.tenant};
    const {data:old,error:findError}=await ctx.admin.from("students").select("id").eq("tenant_school_id",ctx.tenant).eq("national_code",nationalCode).limit(1).maybeSingle();if(findError)throw findError;
    let saved:any;
    if(old){const {data,error}=await ctx.admin.from("students").update(payload).eq("id",old.id).select("id").single();if(error)throw error;saved=data;}
    else{const {data,error}=await ctx.admin.from("students").insert(payload).select("id").single();if(error)throw error;saved=data;}
    studentIds.set(className+":"+nationalCode,saved.id);studentCount++;
   }
   const {data:teachers,error:te}=await ctx.admin.from("teachers").select("id,first_name,last_name,national_code,employee_code").eq("tenant_school_id",ctx.tenant).limit(1000);if(te)throw te;
   const {data:accounts,error:ae}=await ctx.admin.from("account_settings").select("username,display_name,national_code,role").eq("tenant_school_id",ctx.tenant).limit(2000);if(ae)throw ae;
   let scheduleCount=0,skippedSchedule=0;const results=[];
   for(const row of inputSchedule){
    const userKey=norm(field(row,"نام کاربری دبیر","teacher_username","teacherUsername","username"));
    const teacherLabel=norm(field(row,"نام دبیر","دبیر","teacher","teacher_name","teacherName"));
    let teacher:any=(teachers||[]).find((t:any)=>norm(t.employee_code)===userKey||norm(t.national_code)===userKey);
    if(!teacher&&userKey){const acc=(accounts||[]).find((a:any)=>norm(a.username)===userKey);if(acc?.national_code)teacher=(teachers||[]).find((t:any)=>norm(t.national_code)===norm(acc.national_code));}
    if(!teacher&&teacherLabel)teacher=(teachers||[]).find((t:any)=>norm([t.first_name,t.last_name].filter(Boolean).join(" "))===teacherLabel);
    try{const result=await createScheduleRow(ctx,{...row,className:field(row,"کلاس","پایه و کلاس","class_name","className","class"),subject:field(row,"درس","عنوان درس","subject"),weekday:field(row,"روز","weekday","day"),period:field(row,"زنگ","شماره زنگ","period"),start_time:field(row,"شروع","ساعت شروع","start_time","startTime"),end_time:field(row,"پایان","ساعت پایان","end_time","endTime"),teacher_username:userKey},teacher);scheduleCount++;results.push(result);}
    catch(e){skippedSchedule++;if(results.length<10)results.push({error:clean((e as Error).message,200)});}
   }
   return reply({ok:true,imported:{students:studentCount,scheduleRows:scheduleCount},skipped:{students:skippedStudents,scheduleRows:skippedSchedule},details:results.slice(0,20),message:"اطلاعات معتبر ثبت شد؛ ردیف‌های ناقص در گزارش مشخص شده‌اند."});
  }
  if(action==="create-class"){
   if(!ctx.isManager)throw Object.assign(new Error("فقط مدیر مدرسه می‌تواند کلاس بسازد."),{status:403});
   const teacherId=Number(body.teacher_id),{data:teacher,error}=await ctx.admin.from("teachers").select("id,first_name,last_name,national_code,employee_code").eq("id",teacherId).eq("tenant_school_id",ctx.tenant).maybeSingle();
   if(error||!teacher)throw Object.assign(new Error("دبیر انتخاب‌شده پیدا نشد."),{status:400});
   const result=await createScheduleRow(ctx,{className:body.class_name,subject:body.subject,weekday:body.weekday,period:body.period,start_time:body.start_time,end_time:body.end_time,grade:body.grade,academic_year:body.academic_year},teacher);
   return reply({ok:true,result,message:"کلاس ساخته شد و به برنامه هفتگی متصل شد."});
  }
  if(action==="assign-collaborator"){
   if(!ctx.isManager)throw Object.assign(new Error("فقط مدیر می‌تواند همکار کلاس را تعیین کند."),{status:403});
   const classId=Number(body.class_id),teacherId=Number(body.teacher_id);
   const {data:room,error:re}=await ctx.admin.from("online_classes").select("id").eq("id",classId).eq("tenant_school_id",ctx.tenant).maybeSingle();if(re||!room)throw Object.assign(new Error("کلاس پیدا نشد."),{status:404});
   const {data:teacher,error:te}=await ctx.admin.from("teachers").select("id,first_name,last_name").eq("id",teacherId).eq("tenant_school_id",ctx.tenant).maybeSingle();if(te||!teacher)throw Object.assign(new Error("همکار آموزشی پیدا نشد."),{status:400});
   const {data:existing}=await ctx.admin.from("online_class_teachers").select("id").eq("class_id",classId).eq("teacher_id",teacherId).eq("tenant_school_id",ctx.tenant).limit(1);
   if(!existing?.length){const {error}=await ctx.admin.from("online_class_teachers").insert({class_id:classId,teacher_id:teacherId,teacher_name:[teacher.first_name,teacher.last_name].filter(Boolean).join(" "),tenant_school_id:ctx.tenant});if(error)throw error;}
   return reply({ok:true,message:"همکار به کلاس اضافه شد."});
  }
  if(action==="start-class"){
   const room=await classAccess(ctx,Number(body.class_id));if(!ctx.isManager&&!ctx.isDeputy&&!ctx.isTeacher)throw Object.assign(new Error("اجازه شروع کلاس را ندارید."),{status:403});
   const start=new Date(),end=new Date(start.getTime()+50*60000);
   const {data,error}=await ctx.admin.from("online_classes").update({status:"active",start_at:start.toISOString(),end_at:end.toISOString(),activated_at:start.toISOString(),activated_by:clean(ctx.profile.display_name)}).eq("id",room.id).eq("tenant_school_id",ctx.tenant).select("id,title,subject,class_name,teacher,status,start_at,end_at").single();
   if(error)throw error;
   await ctx.admin.from("weekly_schedule_entries").update({activated_at:start.toISOString(),activated_by:clean(ctx.profile.display_name)}).eq("online_class_id",room.id).eq("tenant_school_id",ctx.tenant);
   return reply({ok:true,room:data});
  }
  if(action==="roster"||action==="attendance"||action==="grades"){
   if(ctx.isStudent)throw Object.assign(new Error("دانش‌آموز فقط می‌تواند سوابق خودش را مشاهده کند."),{status:403});
   const classId=Number(body.class_id);const room=await classAccess(ctx,classId);
   if(action==="roster"){const list=await studentsFor(ctx,room.class_name);return reply({ok:true,students:list.map((s:any)=>({id:s.id,first_name:s.first_name,last_name:s.last_name,grade:s.grade,class_name:s.class_name}))});}
   if(action==="attendance"){
    const date=clean(body.date,10)||new Date().toISOString().slice(0,10);
    if(Array.isArray(body.records)){
     const roster=await studentsFor(ctx,room.class_name);let saved=0;
     for(const entry of body.records){const student=roster.find((s:any)=>Number(s.id)===Number(entry.student_id));const status=clean(entry.status,20);if(!student||!["present","absent"].includes(status))continue;
      const {data:old}=await ctx.admin.from("teacher_attendance").select("id").eq("tenant_school_id",ctx.tenant).eq("class_id",classId).eq("student_id",student.id).eq("attendance_date",date).limit(1).maybeSingle();
      const payload={class_id:classId,student_id:student.id,student_name:[student.first_name,student.last_name].filter(Boolean).join(" "),teacher_id:ctx.teacher?.id||null,class_name:room.class_name,subject:room.subject||"",attendance_date:date,status,note:clean(entry.note,250),tenant_school_id:ctx.tenant};
      const result=old?await ctx.admin.from("teacher_attendance").update(payload).eq("id",old.id):await ctx.admin.from("teacher_attendance").insert(payload);if(result.error)throw result.error;saved++;
     }return reply({ok:true,saved,message:"حضور و غیاب ذخیره شد."});
    }
    const {data,error}=await ctx.admin.from("teacher_attendance").select("id,student_id,student_name,attendance_date,status,note").eq("tenant_school_id",ctx.tenant).eq("class_id",classId).eq("attendance_date",date).order("student_name");if(error)throw error;return reply({ok:true,date,attendance:data||[]});
   }
   if(action==="grades"){
    if(Array.isArray(body.records)){
     const roster=await studentsFor(ctx,room.class_name),subject=clean(body.subject,120),title=clean(body.assessment_title,120),date=clean(body.grade_date,10)||new Date().toISOString().slice(0,10);
     if(!subject||!title)throw Object.assign(new Error("درس و عنوان ارزشیابی را وارد کنید."),{status:400});
     let saved=0;for(const entry of body.records){const student=roster.find((s:any)=>Number(s.id)===Number(entry.student_id)),score=Number(digits(entry.score));if(!student||entry.score===""||!Number.isFinite(score)||score<0||score>100)continue;
      const {data:old}=await ctx.admin.from("student_grades").select("id").eq("tenant_school_id",ctx.tenant).eq("student_id",student.id).eq("class_name",room.class_name).eq("subject",subject).eq("assessment_title",title).limit(1).maybeSingle();
      const payload={student_id:student.id,teacher_id:ctx.teacher?.id||null,class_name:room.class_name,subject,assessment_type:"کلاسی",assessment_title:title,score,grade_date:date,description:clean(entry.description,500),manager_released:1,tenant_school_id:ctx.tenant};
      const result=old?await ctx.admin.from("student_grades").update(payload).eq("id",old.id):await ctx.admin.from("student_grades").insert(payload);if(result.error)throw result.error;saved++;
     }return reply({ok:true,saved,message:"نمرات ذخیره شد."});
    }
    const {data,error}=await ctx.admin.from("student_grades").select("id,student_id,subject,assessment_title,score,grade_date,description,manager_released").eq("tenant_school_id",ctx.tenant).eq("class_name",room.class_name).eq("subject",room.subject||"").order("created_at",{ascending:false}).limit(500);if(error)throw error;return reply({ok:true,grades:data||[]});
   }
  }
  if(action==="student-records"){
   if(!ctx.isStudent)throw Object.assign(new Error("این بخش مخصوص حساب دانش‌آموز است."),{status:403});
   const [grades,attendance,schedule]=await Promise.all([
    ctx.admin.from("student_grades").select("subject,assessment_title,score,grade_date,description,class_name").eq("tenant_school_id",ctx.tenant).eq("student_id",ctx.student.id).eq("manager_released",1).order("created_at",{ascending:false}).limit(100),
    ctx.admin.from("teacher_attendance").select("class_name,subject,attendance_date,status,note").eq("tenant_school_id",ctx.tenant).eq("student_id",ctx.student.id).order("attendance_date",{ascending:false}).limit(100),
    ctx.admin.from("weekly_schedule_entries").select("class_name,weekday,period,subject,teacher_name,start_time,end_time,online_class_id").eq("tenant_school_id",ctx.tenant).eq("class_name",ctx.student.class_name).order("weekday").order("period").limit(500)
   ]);
   if(grades.error||attendance.error||schedule.error)throw grades.error||attendance.error||schedule.error;
   return reply({ok:true,grades:grades.data||[],attendance:attendance.data||[],schedule:schedule.data||[]});
  }
  return reply({message:"عملیات درخواستی پشتیبانی نمی‌شود."},400);
 }catch(error){const status=Number((error as any)?.status)||500;if(status===500)console.error("classroom-manage failed",String(error));return reply({message:clean((error as Error).message)||"عملیات انجام نشد."},status);}
});