import { createClient } from "npm:@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
const clean=(v:unknown,max=200)=>String(v??"").trim().slice(0,max);
const managerRoles=new Set(["manager","مدیر","مدیریت","principal","administrator","admin"]);
const reportRoles=new Set([...managerRoles,"educational","معاون آموزشی","معاونت آموزشی","executive","معاون اجرایی","معاونت اجرایی","cultural","معاون پرورشی","معاونت پرورشی","advisor","مشاور","counselor"]);
async function fetchRows(admin:any,table:string,columns:string,schoolId:string){
 const all:Record<string,unknown>[]=[];const size=1000;
 for(let offset=0;offset<5000;offset+=size){
  const {data,error}=await admin.from(table).select(columns).eq("tenant_school_id",schoolId).range(offset,offset+size-1);
  if(error)throw new Error("خواندن اطلاعات جدول "+table+" ناموفق بود.");
  const page=(data??[]) as Record<string,unknown>[];all.push(...page);if(page.length<size)break;
 }
 return all;
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return reply({message:"درخواست نامعتبر است."},405);
 const bearer=req.headers.get("Authorization")??"";if(!bearer.startsWith("Bearer "))return reply({message:"ابتدا وارد سامانه شوید."},401);
 const url=(Deno.env.get("SUPABASE_URL")??"").trim();let serviceKey=(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"").trim();
 const bundle=(Deno.env.get("SUPABASE_SECRET_KEYS")??"").trim();
 if(bundle){try{const p=JSON.parse(bundle),v=typeof p==="string"?p:p.default??p.service_role??p.serviceRole??p.service_role_key;if(typeof v==="string"&&v.trim())serviceKey=v.trim()}catch{if(bundle.startsWith("sb_secret_")||bundle.startsWith("eyJ"))serviceKey=bundle}}
 if(!url||!serviceKey)return reply({message:"تنظیمات امن سرویس کامل نیست."},503);
 const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:auth,error:authErr}=await admin.auth.getUser(bearer.slice(7));if(authErr||!auth.user)return reply({message:"نشست ورود معتبر نیست؛ دوباره وارد شوید."},401);
 const {data:caller,error:callerErr}=await admin.from("account_settings").select("auth_user_id,role,tenant_school_id").eq("auth_user_id",auth.user.id).maybeSingle();
 const role=clean(caller?.role).toLowerCase();if(callerErr||!caller||!reportRoles.has(role))return reply({message:"نقش حساب شما اجازه مشاهده گزارش‌های مدرسه را ندارد."},403);
 const schoolId=clean(caller.tenant_school_id,80);if(!schoolId)return reply({message:"شناسه مدرسه برای حساب شما ثبت نشده است."},409);
 const {data:membership,error:membershipErr}=await admin.from("school_memberships").select("id,role").eq("auth_user_id",auth.user.id).eq("school_id",schoolId).eq("is_active",true).maybeSingle();
 if(membershipErr||!membership)return reply({message:"عضویت فعال شما در این مدرسه تأیید نشد."},403);
 const body=await req.json().catch(()=>({}));if(clean(body.action||"get",20)!=="get")return reply({message:"عملیات درخواستی پشتیبانی نمی‌شود."},400);
 try{
  const [school,students,attendance,grades,studentGrades,discipline,teachers,teacherClasses,competitions,financeVouchers,financeLines]=await Promise.all([
   admin.from("schools").select("id,name,school_code").eq("id",schoolId).maybeSingle(),
   fetchRows(admin,"students","id,first_name,last_name,grade,class_name,student_code",schoolId),
   fetchRows(admin,"attendance","id,student_id,date,attendance_date,status,description,teacher_id,subject,class_name,approval_status,approved_at,approved_by",schoolId),
   fetchRows(admin,"grades","id,student_id,teacher_id,subject,exam_name,score,description,created_at,grade_type,term,max_score,grade_date,title,assessment_date,school_year,class_name",schoolId),
   fetchRows(admin,"student_grades","id,student_id,teacher_id,subject,class_name,assessment_type,assessment_title,score,coefficient,grade_date,grade_date_shamsi,description,term,created_at,updated_at,manager_released",schoolId),
   fetchRows(admin,"discipline_records","id,student_id,teacher_id,title,description,priority,status,created_at,item_id,deduction,actor_username,actor_role,note,incident_date",schoolId),
   fetchRows(admin,"teachers","id,first_name,last_name,subject,employment_status",schoolId),
   fetchRows(admin,"teacher_classes","id,teacher_id,teacher_name,subject,grade,class_name,active",schoolId),
   fetchRows(admin,"competitions","id,title,category,start_date,end_date,status,description,created_at",schoolId),
   managerRoles.has(role)?fetchRows(admin,"finance_vouchers","id,document_number,fiscal_year,voucher_date,voucher_type,description,counterparty,status",schoolId):Promise.resolve([]),
   managerRoles.has(role)?fetchRows(admin,"finance_voucher_lines","id,voucher_id,line_no,account_code,account_title,debit,credit,student_id,student_name,parent_name,description",schoolId):Promise.resolve([])
  ]);
  if(!school.data)return reply({message:"اطلاعات مدرسه پیدا نشد."},404);
  return reply({school:school.data,permissions:{finance:managerRoles.has(role)},students,attendance,grades,studentGrades,discipline,teachers,teacherClasses,competitions,financeVouchers,financeLines});
 }catch(e){return reply({message:e instanceof Error?e.message:"دریافت گزارش‌ها ناموفق بود."},500)}
});