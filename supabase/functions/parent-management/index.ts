import { createClient } from "npm:@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const reply=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,"Content-Type":"application/json; charset=utf-8"}});
const clean=(v:unknown)=>String(v??"").trim();
const managerRoles=["manager","مدیر","مدیریت","principal","administrator","admin"];
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return reply({message:"درخواست نامعتبر است."},405);
 const bearer=req.headers.get("Authorization")??"";
 if(!bearer.startsWith("Bearer "))return reply({message:"ابتدا وارد سامانه شوید."},401);
 const url=(Deno.env.get("SUPABASE_URL")??"").trim();
 let key=(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"").trim();
 const raw=(Deno.env.get("SUPABASE_SECRET_KEYS")??"").trim();
 if(raw){try{const p=JSON.parse(raw),v=typeof p==="string"?p:p.default??p.service_role??p.serviceRole??p.service_role_key;if(typeof v==="string"&&v.trim())key=v.trim()}catch{if(raw.startsWith("sb_secret_")||raw.startsWith("eyJ"))key=raw}}
 if(!url||!key)return reply({message:"تنظیمات امن سرویس کامل نیست."},503);
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:a,error:ae}=await db.auth.getUser(bearer.slice(7));
 if(ae||!a.user)return reply({message:"نشست ورود معتبر نیست."},401);
 const {data:c,error:ce}=await db.from("account_settings").select("username,display_name,phone,email,national_code,role,auth_user_id,tenant_school_id").eq("auth_user_id",a.user.id).maybeSingle();
 if(ce||!c)return reply({message:"حساب کاربری پیدا نشد."},403);
 const role=clean(c.role).toLowerCase(),school=clean(c.tenant_school_id);
 if(!school)return reply({message:"شناسه مدرسه ثبت نشده است."},409);
 const isManager=managerRoles.includes(role),isParent=role==="parent";
 if(!isManager&&!isParent)return reply({message:"این حساب اجازه دسترسی به پنل اولیا را ندارد."},403);
 const expectedRole=isManager?"manager":"parent";
 const {data:m,error:me}=await db.from("school_memberships").select("id").eq("auth_user_id",a.user.id).eq("school_id",school).eq("role",expectedRole).eq("is_active",true).maybeSingle();
 if(me||!m)return reply({message:"عضویت فعال مدرسه تأیید نشد."},403);
 const [parentsResult,linksResult]=await Promise.all([
  isManager
   ? db.from("account_settings").select("username,display_name,phone,email,national_code,role,auth_user_id").eq("tenant_school_id",school).eq("role","parent").order("display_name").limit(1000)
   : db.from("account_settings").select("username,display_name,phone,email,national_code,role,auth_user_id").eq("tenant_school_id",school).eq("auth_user_id",a.user.id).eq("role","parent").limit(1),
  isManager
   ? db.from("parent_children").select("parent_username,student_id").eq("tenant_school_id",school).limit(3000)
   : db.from("parent_children").select("parent_username,student_id").eq("tenant_school_id",school).eq("parent_username",clean(c.username)).limit(1000)
 ]);
 if(parentsResult.error||linksResult.error)return reply({message:"اطلاعات حساب ولی یا اتصال فرزندان دریافت نشد."},500);
 const parents=parentsResult.data??[],links=linksResult.data??[];
 const studentIds=[...new Set(links.map((x:any)=>Number(x.student_id)).filter((x:number)=>Number.isInteger(x)&&x>0))];
 const base=db;
 const [students,discipline,grades,meetings,activities,attendance,assignments,exams,payments,messages,bulletins]=await Promise.all([
  studentIds.length?base.from("students").select("id,first_name,last_name,student_code,national_code,grade,class_name,parent_phone,phone").eq("tenant_school_id",school).in("id",studentIds).order("last_name"):Promise.resolve({data:[],error:null}),
  studentIds.length?base.from("discipline_records").select("id,student_id,title,description,priority,status,incident_date,created_at").eq("tenant_school_id",school).in("student_id",studentIds).order("id",{ascending:false}).limit(3000):Promise.resolve({data:[],error:null}),
  studentIds.length?base.from("student_grades").select("id,student_id,subject,assessment_type,assessment_title,score,coefficient,grade_date_shamsi,term,manager_released").eq("tenant_school_id",school).in("student_id",studentIds).order("id",{ascending:false}).limit(5000):Promise.resolve({data:[],error:null}),
  isManager?base.from("parent_meeting_requests").select("id,parent_name,parent_username,student_id,student_name,target_role,target_name,requested_date_shamsi,requested_time,reason,status,educational_approval,manager_approval,created_at").eq("tenant_school_id",school).order("id",{ascending:false}).limit(2000):base.from("parent_meeting_requests").select("id,parent_name,parent_username,student_id,student_name,target_role,target_name,requested_date_shamsi,requested_time,reason,status,educational_approval,manager_approval,created_at").eq("tenant_school_id",school).eq("parent_username",clean(c.username)).order("id",{ascending:false}).limit(500),
  isManager?base.from("parent_activities").select("id,title,description,activity_date,status,parent_username,activity_type,consent_text,created_at").eq("tenant_school_id",school).order("id",{ascending:false}).limit(2000):base.from("parent_activities").select("id,title,description,activity_date,status,parent_username,activity_type,consent_text,created_at").eq("tenant_school_id",school).eq("parent_username",clean(c.username)).order("id",{ascending:false}).limit(500),
  studentIds.length?base.from("attendance").select("id,student_id,date,attendance_date,status,description,subject,approval_status").eq("tenant_school_id",school).in("student_id",studentIds).order("id",{ascending:false}).limit(5000):Promise.resolve({data:[],error:null}),
  studentIds.length?base.from("assignments").select("id,student_id,title,description,status,created_at,due_date,subject,class_name").eq("tenant_school_id",school).or("student_id.in.("+studentIds.join(",")+"),student_id.is.null").order("id",{ascending:false}).limit(3000):Promise.resolve({data:[],error:null}),
  base.from("exam_schedule").select("id,subject,grade,start_date,end_date,weight,exam_date,duration,exam_start_time,exam_end_time,syllabus_scope,school_year").eq("tenant_school_id",school).order("exam_date").limit(1000),
  studentIds.length?base.from("payment_records").select("id,student_id,parent_username,title,amount,payment_type,status,payment_date_shamsi,description,parent_name").eq("tenant_school_id",school).in("student_id",studentIds).order("id",{ascending:false}).limit(2000):Promise.resolve({data:[],error:null}),
  base.from("portal_messages").select("id,sender_name,sender_role,recipient_name,recipient_role,subject,body,status,created_at,read_at").eq("school_id",school).eq("recipient_user_id",a.user.id).eq("status","delivered").order("created_at",{ascending:false}).limit(500),
  base.from("school_bulletins").select("id,board_key,title,body,status,created_at,published_at,starts_at,ends_at").eq("school_id",school).eq("status","published").order("published_at",{ascending:false}).limit(300)
 ]);
 const classNames=[...new Set((students.data??[]).map((s:any)=>clean(s.class_name)).filter(Boolean))];\n const safeAssignments=(assignments.data??[]).filter((x:any)=>x.student_id!==null&&x.student_id!==undefined?studentIds.includes(Number(x.student_id)):Boolean(x.class_name)&&classNames.includes(clean(x.class_name)));
 const schedule=classNames.length?await base.from("weekly_schedule_entries").select("id,class_name,weekday,period,subject,teacher_name,room,academic_year,start_time,end_time").eq("tenant_school_id",school).in("class_name",classNames).order("period"):{data:[],error:null};
 const failed=[students,discipline,grades,meetings,activities,attendance,assignments,schedule,exams,payments,messages,bulletins].find((x:any)=>x.error);
 if(failed){console.error("parent-management query failed",failed.error?.code);return reply({message:"دریافت اطلاعات پنل اولیا ناموفق بود؛ ساختار جدول‌ها را بررسی کنید."},500)}
 return reply({ok:true,role:expectedRole,parents,links,students:students.data??[],discipline:discipline.data??[],grades:grades.data??[],meetings:meetings.data??[],activities:activities.data??[],attendance:attendance.data??[],assignments:safeAssignments,schedule:schedule.data??[],exams:exams.data??[],payments:payments.data??[],messages:messages.data??[],bulletins:bulletins.data??[]});
});