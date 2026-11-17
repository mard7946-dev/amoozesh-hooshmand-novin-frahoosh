import { createClient } from "npm:@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
const clean=(v:unknown,max=180)=>String(v??"").trim().slice(0,max);
const managerRoles=new Set(["manager","مدیر","مدیریت","principal","administrator","admin"]);
const executiveRoles=new Set(["executive","معاون اجرایی","معاونت اجرایی","معاون اجرایی مدرسه"]);
const subjects=["عربی","علوم","زبان","ریاضی","مطالعات","فارسی","انضباط"];
async function getCaller(admin:any,token:string){
 const {data:{user},error}=await admin.auth.getUser(token);
 if(error||!user)throw Object.assign(new Error("نشست ورود معتبر نیست؛ دوباره وارد شوید."),{status:401});
 const {data:account,error:accountError}=await admin.from("account_settings").select("auth_user_id,role,tenant_school_id").eq("auth_user_id",user.id).maybeSingle();
 const role=clean(account?.role).toLowerCase();
 if(accountError||!account||(!managerRoles.has(role)&&!executiveRoles.has(role)))throw Object.assign(new Error("فقط مدیر و معاون اجرایی مجاز به مدیریت کارنامه هستند."),{status:403});
 const schoolId=clean(account.tenant_school_id,80);
 if(!schoolId)throw Object.assign(new Error("شناسه مدرسه برای حساب شما ثبت نشده است."),{status:409});
 const {data:membership,error:membershipError}=await admin.from("school_memberships").select("id,role").eq("auth_user_id",user.id).eq("school_id",schoolId).eq("is_active",true).limit(1).maybeSingle();
 if(membershipError||!membership)throw Object.assign(new Error("عضویت فعال شما در این مدرسه تأیید نشد."),{status:403});
 const membershipRole=clean(membership.role).toLowerCase();
 if(!managerRoles.has(role)&&!executiveRoles.has(role)&&!executiveRoles.has(membershipRole))throw Object.assign(new Error("دسترسی معاونت اجرایی تأیید نشد."),{status:403});
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
   const [school,students,teachers,cards]=await Promise.all([
    admin.from("schools").select("id,name").eq("id",schoolId).maybeSingle(),
    admin.from("students").select("id,first_name,last_name,grade,class_name,student_code").eq("tenant_school_id",schoolId).order("last_name"),
    admin.from("teachers").select("id,first_name,last_name,subject,employment_status").eq("tenant_school_id",schoolId).order("last_name"),
    admin.from("school_report_cards").select("id,student_ref,student_id,student_name,grade,class_name,academic_year,term,subjects,created_at,updated_at").eq("school_id",schoolId).order("updated_at",{ascending:false})
   ]);
   for(const x of [school,students,teachers,cards])if(x.error)throw new Error("دریافت اطلاعات کارنامه ناموفق بود.");
   return reply({school:school.data,students:students.data??[],teachers:teachers.data??[],cards:cards.data??[],subjects});
  }
  if(action==="save"){
   const student=body.student??{},studentName=clean(student.name,160),grade=clean(student.grade,50),className=clean(student.class_name,80);
   const academicYear=clean(body.academic_year,30),term=clean(body.term||"میان‌ترم",40);
   if(studentName.length<2||!grade||!className||!academicYear)throw new Error("نام دانش‌آموز، پایه، کلاس و سال تحصیلی الزامی است.");
   const studentId=Number.isInteger(Number(student.id))&&Number(student.id)>0?Number(student.id):null;
   if(studentId){
    const {data:existing,error}=await admin.from("students").select("id,first_name,last_name,grade,class_name").eq("id",studentId).eq("tenant_school_id",schoolId).maybeSingle();
    if(error||!existing)throw new Error("دانش‌آموز انتخاب‌شده متعلق به این مدرسه نیست.");
   }
   if(!Array.isArray(body.subjects)||body.subjects.length!==subjects.length)throw new Error("اطلاعات هر هفت درس باید تکمیل شود.");
   const cleanSubjects=body.subjects.map((x:any)=>{
    const subject=clean(x.subject,40),teacher=clean(x.teacher,120),score=Number(x.score);
    if(!subjects.includes(subject)||!teacher||!Number.isFinite(score)||score<0||score>20)throw new Error("نام دبیر و نمره معتبر از صفر تا ۲۰ برای همه درس‌ها الزامی است.");
    return {subject,teacher,score:Number(score.toFixed(2))};
   });
   if(new Set(cleanSubjects.map((x:any)=>x.subject)).size!==subjects.length)throw new Error("هر درس باید دقیقاً یک بار ثبت شود.");
   const studentRef=studentId?"student:"+studentId:clean(student.ref,100);
   if(!studentRef||!studentRef.startsWith("manual:")&&!studentRef.startsWith("student:"))throw new Error("شناسه دانش‌آموز معتبر نیست.");
   const payload={school_id:schoolId,student_ref:studentRef,student_id:studentId,student_name:studentName,grade,class_name:className,academic_year:academicYear,term,subjects:cleanSubjects,created_by:user.id,updated_at:new Date().toISOString()};
   const {data,error}=await admin.from("school_report_cards").upsert(payload,{onConflict:"school_id,student_ref,academic_year,term"}).select("id,student_ref,student_id,student_name,grade,class_name,academic_year,term,subjects,created_at,updated_at").single();
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
