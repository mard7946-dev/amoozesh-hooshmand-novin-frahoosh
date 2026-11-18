import { createClient } from "npm:@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
const clean=(v:unknown,max=180)=>String(v??"").trim().slice(0,max);
const managerRoles=new Set(["manager","مدیر","مدیریت"]);
const executiveRoles=new Set(["executive","executive_deputy","معاون اجرایی","معاونت اجرایی","معاون اجرایی مدرسه"]);
const subjects=["ریاضی","عربی","فارسی","مطالعات","زبان","علوم","انضباط"];
async function getCaller(admin:any,token:string){
 const {data:{user},error}=await admin.auth.getUser(token);
 if(error||!user)throw Object.assign(new Error("نشست ورود معتبر نیست؛ دوباره وارد شوید."),{status:401});
 const {data:account,error:accountError}=await admin.from("account_settings").select("auth_user_id,role,tenant_school_id").eq("auth_user_id",user.id).maybeSingle();
 const role=clean(account?.role).toLowerCase();
 if(accountError||!account)throw Object.assign(new Error("حساب کاربری مدرسه پیدا نشد."),{status:403});
 const schoolId=clean(account.tenant_school_id,80);
 if(!schoolId)throw Object.assign(new Error("شناسه مدرسه برای حساب شما ثبت نشده است."),{status:409});
 const {data:membership,error:membershipError}=await admin.from("school_memberships").select("id,role").eq("auth_user_id",user.id).eq("school_id",schoolId).eq("is_active",true).limit(1).maybeSingle();
 if(membershipError||!membership)throw Object.assign(new Error("عضویت فعال شما در این مدرسه تأیید نشد."),{status:403});
 const membershipRole=clean(membership.role).toLowerCase();
 if(!managerRoles.has(role)&&!executiveRoles.has(role)&&!executiveRoles.has(membershipRole))throw Object.assign(new Error("فقط مدیر و معاون اجرایی مجاز به مدیریت کارنامه هستند."),{status:403});
 return {user,schoolId,role};
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return reply({message:"درخواست نامعتبر است."},405);
 const bearer=req.headers.get("Authorization")??"";
 if(!bearer.startsWith("Bearer "))return reply({message:"ابتدا وارد سامانه شوید."},401);
 const url=(Deno.env.get("SUPABASE_URL")??"").trim();
 let serviceKey=(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"").trim();
 const bundle=(Deno.env.get("SUPABASE_SECRET_KEYS")??"").trim();
 if(bundle){try{const p=JSON.parse(bundle),v=typeof p==="string"?p:p.default??p.service_role??p.serviceRole??p.service_role_key;if(typeof v==="string"&&v.trim())serviceKey=v.trim()}catch{if(bundle.startsWith("sb_secret_")||bundle.startsWith("eyJ"))serviceKey=bundle}}
 if(!url||!serviceKey)return reply({message:"تنظیمات امن سرویس کامل نیست."},503);
 const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
 try{
  const {user,schoolId}=await getCaller(admin,bearer.slice(7));
  const body=await req.json().catch(()=>({}));
  const action=clean(body.action||"list",20);
  if(action==="list"){
   const [school,students,teachers,cards,teacherAssignments]=await Promise.all([
    admin.from("schools").select("id,name").eq("id",schoolId).maybeSingle(),
    admin.from("students").select("id,first_name,last_name,grade,class_name,student_code").eq("tenant_school_id",schoolId).order("last_name"),
    admin.from("teachers").select("id,first_name,last_name,subject,employment_status").eq("tenant_school_id",schoolId).order("last_name"),
    admin.from("school_report_cards").select("id,student_ref,student_id,student_name,grade,class_name,academic_year,term,subjects,executive_name,manager_name,created_at,updated_at").eq("school_id",schoolId).order("updated_at",{ascending:false}),
    admin.from("school_report_card_teachers").select("grade,class_name,subject,teacher_name").eq("school_id",schoolId).order("grade").order("class_name")
   ]);
   for(const x of [school,students,teachers,cards,teacherAssignments])if(x.error)throw new Error("دریافت اطلاعات کارنامه ناموفق بود.");
   return reply({school:school.data,students:students.data??[],teachers:teachers.data??[],teacherAssignments:teacherAssignments.data??[],cards:cards.data??[],subjects});
  }
  if(action==="save_teachers"){
   const grade=clean(body.grade,50),className=clean(body.class_name,80);
   if(!grade||!className||!Array.isArray(body.teachers)||body.teachers.length!==subjects.length)throw new Error("پایه، کلاس و نام دبیران هفت درس الزامی است.");
   const rows=body.teachers.map((x:any)=>({school_id:schoolId,grade,class_name:className,subject:clean(x.subject,40),teacher_name:clean(x.teacher_name,120),created_by:user.id,updated_at:new Date().toISOString()}));
   if(rows.some((x:{subject:string;teacher_name:string})=>!subjects.includes(x.subject)||x.teacher_name.length<2)||new Set(rows.map((x:{subject:string})=>x.subject)).size!==subjects.length)throw new Error("برای هر درس یک نام دبیر معتبر وارد کنید.");
   const {data:assignments,error}=await admin.from("school_report_card_teachers").upsert(rows,{onConflict:"school_id,grade,class_name,subject"}).select("grade,class_name,subject,teacher_name");
   if(error)throw new Error("ذخیره نام دبیران کلاس انجام نشد؛ ساختار پایگاه داده را بررسی کنید.");
   return reply({assignments:assignments??[],message:"نام دبیران کلاس ذخیره شد."});
  }
  if(action==="save"){
   const student=body.student??{};let studentName=clean(student.name,160),grade=clean(student.grade,50),className=clean(student.class_name,80);
   const academicYear=clean(body.academic_year,30),term=clean(body.term||"میان‌ترم",40);
   if(studentName.length<2||!grade||!className||!academicYear)throw new Error("نام دانش‌آموز، پایه، کلاس و سال تحصیلی الزامی است.");
   const studentId=Number.isInteger(Number(student.id))&&Number(student.id)>0?Number(student.id):null;
   if(studentId){
    const {data:existing,error}=await admin.from("students").select("id,first_name,last_name,grade,class_name").eq("id",studentId).eq("tenant_school_id",schoolId).maybeSingle();
    if(error||!existing)throw new Error("دانش‌آموز انتخاب‌شده متعلق به این مدرسه نیست.");
    studentName=clean([existing.first_name,existing.last_name].filter(Boolean).join(" "),160);grade=clean(existing.grade,50);className=clean(existing.class_name,80);
   }
   if(!Array.isArray(body.subjects)||body.subjects.length!==subjects.length)throw new Error("اطلاعات هر هفت درس باید تکمیل شود.");
   const cleanSubjects=body.subjects.map((x:any)=>{
    const subject=clean(x.subject,40),teacher=clean(x.teacher,120),attendance=clean(x.attendance,20);
    const absent=attendance==="غایب",score=absent?null:Number(x.score);
    if(!subjects.includes(subject)||!teacher||(!absent&&(x.score===null||x.score===""||!Number.isFinite(score)||score<0||score>20))||(attendance&&!absent))throw new Error("برای هر درس، نام دبیر و نمره معتبر از صفر تا ۲۰ یا وضعیت غایب الزامی است.");
    return {subject,teacher,score:absent?null:Number(score.toFixed(2)),attendance:absent?"غایب":""};
   });
   if(new Set(cleanSubjects.map((x:any)=>x.subject)).size!==subjects.length)throw new Error("هر درس باید دقیقاً یک بار ثبت شود.");
   const studentRef=studentId?"student:"+studentId:clean(student.ref,100);
   if(!studentRef||!studentRef.startsWith("manual:")&&!studentRef.startsWith("student:"))throw new Error("شناسه دانش‌آموز معتبر نیست.");
   const payload={school_id:schoolId,student_ref:studentRef,student_id:studentId,student_name:studentName,grade,class_name:className,academic_year:academicYear,term,subjects:cleanSubjects,executive_name:clean(body.executive_name,120),manager_name:clean(body.manager_name,120),created_by:user.id,updated_at:new Date().toISOString()};
   const {data,error}=await admin.from("school_report_cards").upsert(payload,{onConflict:"school_id,student_ref,academic_year,term"}).select("id,student_ref,student_id,student_name,grade,class_name,academic_year,term,subjects,executive_name,manager_name,created_at,updated_at").single();
   if(error)throw new Error("ذخیره کارنامه انجام نشد؛ ساختار پایگاه داده یا اطلاعات را بررسی کنید.");
   return reply({card:data,message:"کارنامه با موفقیت ذخیره شد."});
  }
  if(action==="delete"){
   const id=clean(body.id,60);if(!id)throw new Error("شناسه کارنامه نامعتبر است.");
   const {error}=await admin.from("school_report_cards").delete().eq("id",id).eq("school_id",schoolId);
   if(error)throw new Error("حذف کارنامه انجام نشد.");
   return reply({message:"کارنامه حذف شد."});
  }
  return reply({message:"عملیات درخواستی پشتیبانی نمی‌شود."},400);
 }catch(e){return reply({message:e instanceof Error?e.message:"عملیات کارنامه ناموفق بود."},(e as any)?.status||400)}
});
