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
 if(a.user.app_metadata?.must_change_password===true)return reply({message:"برای دسترسی به پنل اولیا، ابتدا رمز عبور اولیه را تغییر دهید."},403);
 const {data:c,error:ce}=await db.from("account_settings").select("username,display_name,phone,email,national_code,role,auth_user_id,tenant_school_id").eq("auth_user_id",a.user.id).maybeSingle();
 if(ce||!c)return reply({message:"حساب کاربری پیدا نشد."},403);
 const role=clean(c.role).toLowerCase(),school=clean(c.tenant_school_id);
 if(!school)return reply({message:"شناسه مدرسه ثبت نشده است."},409);
 // Parent links imported from the school spreadsheet are keyed by the parent's national code.
 // A parent's login username may differ, so resolve both authenticated account identifiers.
 const normalizeIdentity=(value:unknown)=>clean(value).replace(/[۰-۹]/g,d=>String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٠-٩]/g,d=>String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[\s-]/g,"");
 const parentIdentityKeys=[...new Set([clean(c.username),clean(c.national_code),normalizeIdentity(c.username),normalizeIdentity(c.national_code)].filter(Boolean))];
 const isManager=managerRoles.includes(role),isParent=role==="parent";
 if(!isManager&&!isParent)return reply({message:"این حساب اجازه دسترسی به پنل اولیا را ندارد."},403);
 const expectedRole=isManager?"manager":"parent";
 const input=await req.json().catch(()=>({}));
 const action=clean(input.action||"list");
 if(action==="manage_child_links"){
  if(!isManager)return reply({message:"فقط مدیر مدرسه می‌تواند ارتباط فرزندان و اولیا را مدیریت کند."},403);
  const {data:actorMembership,error:actorMembershipError}=await db.from("school_memberships").select("id").eq("auth_user_id",a.user.id).eq("school_id",school).eq("role","manager").eq("is_active",true).maybeSingle();
  if(actorMembershipError||!actorMembership)return reply({message:"عضویت فعال مدیر مدرسه تأیید نشد."},403);
  const parentUsername=clean(input.parent_username),studentIds=[...new Set((Array.isArray(input.student_ids)?input.student_ids:[]).map((v:any)=>Number(v)).filter((v:number)=>Number.isInteger(v)&&v>0))],relationshipType=["father","mother","guardian"].includes(clean(input.relationship_type))?clean(input.relationship_type):"guardian";
  if(!parentUsername||!studentIds.length||studentIds.length>20)return reply({message:"انتخاب حساب ولی و دست‌کم یک دانش‌آموز (حداکثر ۲۰ نفر) الزامی است."},400);
  const {data:targetParent,error:parentError}=await db.from("account_settings").select("username,national_code,auth_user_id,role").eq("tenant_school_id",school).eq("username",parentUsername).eq("role","parent").maybeSingle();
  if(parentError||!targetParent?.auth_user_id)return reply({message:"حساب ولی انتخاب‌شده معتبر نیست."},404);
  const {data:activeMembership,error:membershipError}=await db.from("school_memberships").select("id").eq("auth_user_id",targetParent.auth_user_id).eq("school_id",school).eq("role","parent").eq("is_active",true).maybeSingle();
  if(membershipError||!activeMembership)return reply({message:"عضویت فعال این ولی در مدرسه تأیید نشد."},409);
  const {data:validStudents,error:studentError}=await db.from("students").select("id").eq("tenant_school_id",school).in("id",studentIds);
  if(studentError||!validStudents||validStudents.length!==studentIds.length)return reply({message:"حداقل یکی از دانش‌آموزان انتخاب‌شده متعلق به این مدرسه نیست."},400);
  const identityKeys=[...new Set([clean(targetParent.username),clean(targetParent.national_code)].filter(Boolean))];
  const {data:existing,error:existingError}=await db.from("parent_children").select("parent_username,student_id").eq("tenant_school_id",school).in("parent_username",identityKeys).in("student_id",studentIds);
  if(existingError)return reply({message:"بررسی ارتباط‌های قبلی انجام نشد."},500);
  const already=new Set((existing??[]).map((x:any)=>Number(x.student_id)));
  const rows=studentIds.filter((id:number)=>!already.has(id)).map((id:number)=>({parent_username:clean(targetParent.username),student_id:id,tenant_school_id:school,relationship_type:relationshipType}));
  if(rows.length){
   const {error:insertError}=await db.from("parent_children").upsert(rows,{onConflict:"parent_username,student_id",ignoreDuplicates:true});
   if(insertError){console.error("parent child link save",insertError.code);return reply({message:"ذخیره ارتباط فرزندان با حساب ولی انجام نشد."},500)}
  }
  return reply({ok:true,added:rows.length,already_linked:already.size,total:studentIds.length});
 }
 if(action==="create_association"){
  if(!isParent)return reply({message:"ثبت درخواست انجمن فقط از پنل ولی مجاز است."},403);
  const studentId=Number(input.student_id),requestType=clean(input.request_type),expertise=clean(input.expertise).slice(0,500),message=clean(input.message);
  if(!Number.isInteger(studentId)||!requestType||!message)return reply({message:"انتخاب فرزند، نوع درخواست و توضیحات الزامی است."},400);
  if(requestType.length>120||message.length<5||message.length>3000)return reply({message:"نوع درخواست یا توضیحات خارج از محدوده مجاز است."},400);
  const {data:links,error:linkError}=await db.from("parent_children").select("parent_username,student_id").eq("tenant_school_id",school).in("parent_username",parentIdentityKeys).eq("student_id",studentId).limit(2);
  if(linkError)return reply({message:"بررسی ارتباط ولی و دانش‌آموز انجام نشد."},500);
  if(!links?.length)return reply({message:"برای این حساب، ارتباط ولی با این دانش‌آموز پیدا نشد؛ شناسه ورود و کد ملی حساب را بررسی کنید."},403);
  if(links.length>1)return reply({message:"برای این حساب بیش از یک شناسه ولی منطبق پیدا شد؛ مدیر باید اطلاعات هویتی را بررسی کند."},409);
  const matchedParentUsername=clean(links[0].parent_username);
  const {data:student,error:studentError}=await db.from("students").select("id,first_name,last_name").eq("tenant_school_id",school).eq("id",studentId).maybeSingle();
  if(studentError||!student)return reply({message:"پرونده دانش‌آموز پیدا نشد."},404);
  const {data:created,error}=await db.from("parent_association_requests").insert({tenant_school_id:school,parent_user_id:a.user.id,parent_username:matchedParentUsername,parent_name:c.display_name||c.username,parent_phone:c.phone||"",student_id:student.id,student_name:[student.first_name,student.last_name].filter(Boolean).join(" "),request_type:requestType,expertise,message,status:"pending"}).select("id,status,created_at").single();
  if(error){console.error("parent association create",error.code);return reply({message:"ثبت درخواست انجمن انجام نشد."},500)}
  return reply({ok:true,request:created});
 }
 if(action==="review_association"){
  if(!isManager)return reply({message:"فقط مدیر مدرسه می‌تواند درخواست انجمن را بررسی کند."},403);
  const id=Number(input.id),status=clean(input.status),note=clean(input.manager_note).slice(0,1000);
  if(!Number.isInteger(id)||!["approved","rejected"].includes(status))return reply({message:"اطلاعات بررسی درخواست معتبر نیست."},400);
  const {data:updated,error}=await db.from("parent_association_requests").update({status,manager_note:note,reviewed_by:a.user.id,reviewed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("tenant_school_id",school).eq("id",id).select("id,status").maybeSingle();
  if(error||!updated)return reply({message:"ذخیره نتیجه بررسی درخواست ناموفق بود."},500);
  return reply({ok:true,request:updated});
 }

 const {data:m,error:me}=await db.from("school_memberships").select("id").eq("auth_user_id",a.user.id).eq("school_id",school).eq("role",expectedRole).eq("is_active",true).maybeSingle();
 if(me||!m)return reply({message:"عضویت فعال مدرسه تأیید نشد."},403);
 const availableStudentsResult=isManager?await db.from("students").select("id,first_name,last_name,grade,class_name,student_code").eq("tenant_school_id",school).order("last_name").limit(1000):{data:[],error:null};
 if(availableStudentsResult.error)return reply({message:"فهرست دانش‌آموزان مدرسه دریافت نشد."},500);
 const [parentsResult,linksResult]=await Promise.all([
  isManager
   ? db.from("account_settings").select("username,display_name,phone,email,national_code,role,auth_user_id").eq("tenant_school_id",school).eq("role","parent").order("display_name").limit(1000)
   : db.from("account_settings").select("username,display_name,phone,email,national_code,role,auth_user_id").eq("tenant_school_id",school).eq("auth_user_id",a.user.id).eq("role","parent").limit(1),
  isManager
   ? db.from("parent_children").select("parent_username,student_id").eq("tenant_school_id",school).limit(3000)
   : db.from("parent_children").select("parent_username,student_id").eq("tenant_school_id",school).in("parent_username",parentIdentityKeys).limit(1000)
 ]);
 if(parentsResult.error||linksResult.error)return reply({message:"اطلاعات حساب ولی یا اتصال فرزندان دریافت نشد."},500);
 const parents=parentsResult.data??[],links=linksResult.data??[];
 const studentIds=[...new Set(links.map((x:any)=>Number(x.student_id)).filter((x:number)=>Number.isInteger(x)&&x>0))];
 const base=db;
 const [students,discipline,grades,gradeAdjustments,meetings,activities,associationRequests,attendance,assignments,exams,payments,messages,bulletins]=await Promise.all([
  studentIds.length?base.from("students").select("id,first_name,last_name,student_code,national_code,grade,class_name,parent_phone,phone").eq("tenant_school_id",school).in("id",studentIds).order("last_name"):Promise.resolve({data:[],error:null}),
  studentIds.length?base.from("discipline_records").select("id,student_id,title,description,priority,status,incident_date,record_type,subject,class_name,actor_role,created_at").eq("tenant_school_id",school).in("student_id",studentIds).is("deleted_at",null).order("id",{ascending:false}).limit(3000):Promise.resolve({data:[],error:null}),
  studentIds.length?base.from("student_grades").select("id,student_id,subject,assessment_type,assessment_title,score,coefficient,grade_date_shamsi,term,manager_released").eq("tenant_school_id",school).in("student_id",studentIds).order("id",{ascending:false}).limit(5000):Promise.resolve({data:[],error:null}),
  studentIds.length?base.from("student_grade_adjustments").select("id,student_id,target_score,subject,term,delta,actor_role,applied_at").eq("tenant_school_id",school).in("student_id",studentIds).order("applied_at",{ascending:false}).limit(2000):Promise.resolve({data:[],error:null}),
  isManager?base.from("parent_meeting_requests").select("id,parent_name,parent_username,student_id,student_name,target_role,target_name,requested_date_shamsi,requested_time,reason,status,educational_approval,manager_approval,created_at").eq("tenant_school_id",school).order("id",{ascending:false}).limit(2000):base.from("parent_meeting_requests").select("id,parent_name,parent_username,student_id,student_name,target_role,target_name,requested_date_shamsi,requested_time,reason,status,educational_approval,manager_approval,created_at").eq("tenant_school_id",school).eq("parent_username",clean(c.username)).order("id",{ascending:false}).limit(500),
  isManager?base.from("parent_activities").select("id,title,description,activity_date,status,parent_username,activity_type,consent_text,created_at").eq("tenant_school_id",school).order("id",{ascending:false}).limit(2000):base.from("parent_activities").select("id,title,description,activity_date,status,parent_username,activity_type,consent_text,created_at").eq("tenant_school_id",school).eq("parent_username",clean(c.username)).order("id",{ascending:false}).limit(500),
  isManager?base.from("parent_association_requests").select("id,parent_user_id,parent_username,parent_name,parent_phone,student_id,student_name,request_type,expertise,message,status,manager_note,created_at,reviewed_at").eq("tenant_school_id",school).order("created_at",{ascending:false}).limit(2000):base.from("parent_association_requests").select("id,parent_user_id,parent_username,parent_name,parent_phone,student_id,student_name,request_type,expertise,message,status,manager_note,created_at,reviewed_at").eq("tenant_school_id",school).eq("parent_user_id",a.user.id).order("created_at",{ascending:false}).limit(500),
  studentIds.length?base.from("attendance").select("id,student_id,date,attendance_date,status,description,subject,approval_status").eq("tenant_school_id",school).in("student_id",studentIds).order("id",{ascending:false}).limit(5000):Promise.resolve({data:[],error:null}),
  studentIds.length?base.from("assignments").select("id,student_id,title,description,status,created_at,due_date,subject,class_name").eq("tenant_school_id",school).or("student_id.in.("+studentIds.join(",")+"),student_id.is.null").eq("status","active").order("id",{ascending:false}).limit(3000):Promise.resolve({data:[],error:null}),
  base.from("exam_schedule").select("id,subject,grade,start_date,end_date,weight,exam_date,duration,exam_start_time,exam_end_time,syllabus_scope,school_year").eq("tenant_school_id",school).order("exam_date").limit(1000),
  studentIds.length?base.from("payment_records").select("id,student_id,parent_username,title,amount,payment_type,status,payment_date_shamsi,description,parent_name").eq("tenant_school_id",school).in("student_id",studentIds).order("id",{ascending:false}).limit(2000):Promise.resolve({data:[],error:null}),
  base.from("portal_messages").select("id,sender_name,sender_role,recipient_name,recipient_role,subject,body,status,created_at,read_at").eq("school_id",school).eq("recipient_user_id",a.user.id).eq("status","delivered").order("created_at",{ascending:false}).limit(500),
  base.from("school_bulletins").select("id,board_key,title,body,status,created_at,published_at,starts_at,ends_at").eq("school_id",school).eq("status","published").order("published_at",{ascending:false}).limit(300)
 ]);
 const classNames=[...new Set((students.data??[]).map((s:any)=>clean(s.class_name)).filter(Boolean))];
 const safeAssignments=(assignments.data??[]).filter((x:any)=>x.student_id!==null&&x.student_id!==undefined?studentIds.includes(Number(x.student_id)):Boolean(x.class_name)&&classNames.includes(clean(x.class_name)));
 const schedule=classNames.length?await base.from("weekly_schedule_entries").select("id,class_name,weekday,period,subject,teacher_name,room,academic_year,start_time,end_time").eq("tenant_school_id",school).in("class_name",classNames).order("period"):{data:[],error:null};
 const assignmentSubmissions=studentIds.length?await base.from("assignment_submissions").select("id,assignment_id,student_id,status,submitted_at,created_at").eq("tenant_school_id",school).in("student_id",studentIds).order("id",{ascending:false}).limit(5000):{data:[],error:null};
 const failed=[students,discipline,grades,gradeAdjustments,meetings,activities,associationRequests,attendance,assignments,schedule,exams,payments,messages,bulletins,assignmentSubmissions].find((x:any)=>x.error);
 if(failed){console.error("parent-management query failed",failed.error?.code);return reply({message:"دریافت اطلاعات پنل اولیا ناموفق بود؛ ساختار جدول‌ها را بررسی کنید."},500)}
 const responseLinks=isParent?links.map((link:any)=>({...link,parent_username:clean(c.username)})):links;
 return reply({ok:true,role:expectedRole,parents,links:responseLinks,students:students.data??[],availableStudents:isManager?(availableStudentsResult.data??[]):[],discipline:discipline.data??[],grades:grades.data??[],gradeAdjustments:gradeAdjustments.data??[],meetings:meetings.data??[],activities:activities.data??[],associationRequests:associationRequests.data??[],attendance:attendance.data??[],assignments:safeAssignments,assignmentSubmissions:assignmentSubmissions.data??[],schedule:schedule.data??[],exams:exams.data??[],payments:payments.data??[],messages:messages.data??[],bulletins:bulletins.data??[]});
});