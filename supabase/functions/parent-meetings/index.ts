import { createClient } from "npm:@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const reply=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,"Content-Type":"application/json; charset=utf-8"}});
const clean=(v:unknown)=>String(v??"").trim();
const managerRoles=["manager","مدیر","مدیریت","principal","administrator","admin"];
const deputyRoles=["educational","executive","cultural","advisor","deputy"];
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
 const {data:profile,error:pe}=await db.from("account_settings").select("username,display_name,role,tenant_school_id,auth_user_id").eq("auth_user_id",a.user.id).maybeSingle();
 if(pe||!profile?.tenant_school_id)return reply({message:"پروفایل مدرسه پیدا نشد."},403);
 const role=clean(profile.role).toLowerCase(),school=profile.tenant_school_id;
 const {data:membership,error:me}=await db.from("school_memberships").select("id").eq("auth_user_id",a.user.id).eq("school_id",school).eq("is_active",true).maybeSingle();
 if(me||!membership)return reply({message:"عضویت فعال مدرسه تأیید نشد."},403);
 const input=await req.json().catch(()=>({})),action=clean(input.action||"list");
 const isManager=managerRoles.includes(role);
 const isDeputy=deputyRoles.includes(role);
 const userName=profile.display_name||profile.username||a.user.email||"کاربر";
 const select="id,parent_id,parent_name,parent_username,student_id,student_name,target_role,target_name,recipient_user_id,recipient_role,requested_date_shamsi,requested_time,reason,status,approval_deputy_role,educational_approval,deputy_approved_by,deputy_approved_at,manager_approved_by,manager_approved_at,recipient_response,recipient_response_note,recipient_responded_at,rejection_stage,rejection_reason,created_at";
 const base=()=>db.from("parent_meeting_requests").select(select).eq("tenant_school_id",school).order("id",{ascending:false}).limit(1000);
 if(action==="context"){
  if(role!=="parent")return reply({ok:true,role,students:[],recipients:[]});
  const [linksResult,recipientsResult]=await Promise.all([
   db.from("parent_children").select("student_id").eq("tenant_school_id",school).eq("parent_username",profile.username),
   db.from("account_settings").select("auth_user_id,username,display_name,role").eq("tenant_school_id",school).eq("role","teacher").order("display_name").limit(1000)
  ]);
  if(linksResult.error||recipientsResult.error)return reply({message:"فهرست فرزندان یا دبیران دریافت نشد."},500);
  const ids=(linksResult.data??[]).map(x=>Number(x.student_id)).filter(x=>Number.isInteger(x)&&x>0);
  const children=ids.length?await db.from("students").select("id,first_name,last_name,grade,class_name").eq("tenant_school_id",school).in("id",ids).order("last_name"):{data:[],error:null};
  if(children.error)return reply({message:"فهرست فرزندان دریافت نشد."},500);
  return reply({ok:true,role,students:(children.data??[]).map(x=>({id:x.id,name:[x.first_name,x.last_name].filter(Boolean).join(" "),grade:x.grade,class_name:x.class_name})),recipients:(recipientsResult.data??[]).filter(x=>x.auth_user_id).map(x=>({id:x.auth_user_id,name:x.display_name||x.username,role:x.role}))});
 }
 if(action==="directory"){
  const {data,error}=await db.from("account_settings").select("auth_user_id,username,display_name,role").eq("tenant_school_id",school).in("role",["teacher","educational","executive","cultural","advisor","manager"]).order("display_name").limit(1000);
  if(error)return reply({message:"فهرست مخاطبان دریافت نشد."},500);
  return reply({ok:true,users:(data??[]).filter(x=>x.auth_user_id).map(x=>({id:x.auth_user_id,name:x.display_name||x.username,role:x.role}))});
 }
 if(action==="students"){
  if(role!=="parent")return reply({message:"فهرست فرزندان فقط برای حساب ولی مجاز است."},403);
  const {data:links,error:le}=await db.from("parent_children").select("student_id").eq("tenant_school_id",school).eq("parent_username",profile.username);
  if(le)return reply({message:"دریافت ارتباط فرزندان ناموفق بود."},500);
  const ids=(links??[]).map(x=>x.student_id);
  if(!ids.length)return reply({ok:true,students:[]});
  const {data:children,error:se}=await db.from("students").select("id,first_name,last_name,grade,class_name").eq("tenant_school_id",school).in("id",ids).order("last_name");
  if(se)return reply({message:"دریافت فهرست دانش‌آموزان ناموفق بود."},500);
  return reply({ok:true,students:(children??[]).map(x=>({id:x.id,name:[x.first_name,x.last_name].filter(Boolean).join(" "),grade:x.grade,class_name:x.class_name}))});
 }
 if(action==="create"){
  if(role!=="parent")return reply({message:"ثبت درخواست ملاقات فقط از پنل ولی دانش‌آموز مجاز است."},403);
  const studentId=Number(input.student_id),targetId=clean(input.recipient_user_id),date=clean(input.requested_date_shamsi),time=clean(input.requested_time),reason=clean(input.reason);
  if(!Number.isInteger(studentId)||!targetId||!date||!reason)return reply({message:"دانش‌آموز، مخاطب، روز ملاقات و علت ملاقات الزامی است."},400);
  if(reason.length>3000)return reply({message:"علت ملاقات بیش از حد مجاز است."},400);
  const {data:link,error:le}=await db.from("parent_children").select("student_id").eq("tenant_school_id",school).eq("parent_username",profile.username).eq("student_id",studentId).maybeSingle();
  if(le||!link)return reply({message:"این دانش‌آموز به حساب ولی متصل نیست."},403);
  const {data:student,error:se}=await db.from("students").select("id,first_name,last_name").eq("tenant_school_id",school).eq("id",studentId).maybeSingle();
  if(se||!student)return reply({message:"پرونده دانش‌آموز پیدا نشد."},404);
  const {data:recipient,error:re}=await db.from("account_settings").select("auth_user_id,display_name,username,role").eq("tenant_school_id",school).eq("auth_user_id",targetId).maybeSingle();
  if(re||!recipient||clean(recipient.role).toLowerCase()!=="teacher")return reply({message:"برای درخواست ملاقات فقط می‌توانید یک دبیر را انتخاب کنید."},400);
  const row={tenant_school_id:school,parent_id:profile.username,parent_name:userName,parent_username:profile.username,student_id:student.id,student_name:[student.first_name,student.last_name].filter(Boolean).join(" "),target_role:recipient.role,target_name:recipient.display_name||recipient.username,recipient_user_id:recipient.auth_user_id,recipient_role:recipient.role,requested_date_shamsi:date,requested_time:time||null,reason,status:"pending_deputy",approval_deputy_role:"educational",educational_approval:"pending",manager_approval:"pending"};
  const {data:created,error}=await db.from("parent_meeting_requests").insert(row).select("id,status").single();
  if(error){console.error("parent meeting create",error.code);return reply({message:"ثبت درخواست ملاقات انجام نشد."},500)}
  const {error:messageError}=await db.from("parent_meeting_messages").insert({request_id:created.id,tenant_school_id:school,sender_user_id:a.user.id,sender_role:role,sender_name:userName,body:reason});
  if(messageError){await db.from("parent_meeting_requests").delete().eq("id",created.id).eq("tenant_school_id",school);return reply({message:"ثبت پیام اولیه انجام نشد."},500)}
  return reply({ok:true,...created});
 }
 if(action==="list"){
  const {data,error}=await base();if(error){console.error("parent meeting list",error.code);return reply({message:"دریافت درخواست‌ها ناموفق بود."},500)}
  const rows=(data??[]).filter(m=>isManager|| (isDeputy&&m.status==="pending_deputy"&&m.approval_deputy_role===role) || (m.recipient_user_id===a.user.id) || (m.parent_username===profile.username));
  return reply({ok:true,requests:rows});
 }
 const id=Number(input.id);if(!Number.isInteger(id))return reply({message:"شناسه درخواست معتبر نیست."},400);
 const {data:m,error:findError}=await db.from("parent_meeting_requests").select(select).eq("id",id).eq("tenant_school_id",school).maybeSingle();
 if(findError||!m)return reply({message:"درخواست ملاقات پیدا نشد."},404);
 const patch:any={updated_at:new Date().toISOString()};
 if(action==="messages"||action==="send_message"){
  const allowed=isManager||(isDeputy&&m.approval_deputy_role===role)||m.recipient_user_id===a.user.id||m.parent_username===profile.username;
  if(!allowed)return reply({message:"دسترسی به گفت‌وگوی این درخواست مجاز نیست."},403);
  if(action==="messages"){const {data:messages,error}=await db.from("parent_meeting_messages").select("id,sender_user_id,sender_role,sender_name,body,created_at").eq("request_id",id).eq("tenant_school_id",school).order("created_at",{ascending:true});if(error)return reply({message:"دریافت پیام‌ها ناموفق بود."},500);return reply({ok:true,messages:messages??[]})}
  const body=clean(input.body);if(!body||body.length>4000)return reply({message:"متن پیام باید بین ۱ تا ۴۰۰۰ نویسه باشد."},400);
  const {data:sent,error}=await db.from("parent_meeting_messages").insert({request_id:id,tenant_school_id:school,sender_user_id:a.user.id,sender_role:role,sender_name:userName,body}).select("id,created_at").single();if(error)return reply({message:"ارسال پیام انجام نشد."},500);return reply({ok:true,message:sent});
 }
 if(action==="approve_deputy"||action==="reject_deputy"){
  if(!isDeputy||m.status!=="pending_deputy"||m.approval_deputy_role!==role)return reply({message:"این درخواست در صف تأیید معاون شما نیست."},403);
  if(action==="approve_deputy"){patch.status="pending_manager";patch.educational_approval="approved";patch.manager_approval="pending";patch.deputy_approved_by=a.user.id;patch.deputy_approved_at=new Date().toISOString()}
  else{const why=clean(input.reason);if(!why)return reply({message:"علت رد الزامی است."},400);patch.status="rejected_deputy";patch.educational_approval="rejected";patch.rejection_stage="deputy";patch.rejection_reason=why;patch.rejected_by=a.user.id}
 }else if(action==="approve_manager"||action==="reject_manager"){
  if(!isManager||m.status!=="pending_manager")return reply({message:"این درخواست در صف تأیید مدیریت نیست."},403);
  if(action==="approve_manager"){patch.status="awaiting_recipient";patch.manager_approval="approved";patch.manager_approved_by=a.user.id;patch.manager_approved_at=new Date().toISOString()}
  else{const why=clean(input.reason);if(!why)return reply({message:"علت رد الزامی است."},400);patch.status="rejected_manager";patch.manager_approval="rejected";patch.rejection_stage="manager";patch.rejection_reason=why;patch.rejected_by=a.user.id}
 }else if(action==="respond"){
  if(m.recipient_user_id!==a.user.id||m.status!=="awaiting_recipient")return reply({message:"فقط مخاطب درخواستِ تأییدشده می‌تواند پاسخ دهد."},403);
  const response=clean(input.response);if(!["approved","rejected"].includes(response))return reply({message:"پاسخ تأیید یا رد را انتخاب کنید."},400);
  const responseNote=clean(input.note).slice(0,1000);if(response==="rejected"&&!responseNote)return reply({message:"علت رد درخواست توسط دبیر الزامی است."},400);patch.status=response==="approved"?"completed":"rejected_recipient";patch.recipient_response=response;patch.recipient_response_note=responseNote||null;patch.recipient_responded_at=new Date().toISOString();
 }else return reply({message:"عملیات ناشناخته است."},400);
 const {error:updateError}=await db.from("parent_meeting_requests").update(patch).eq("id",id).eq("tenant_school_id",school);
 if(updateError){console.error("parent meeting update",updateError.code);return reply({message:"ذخیره مرحله درخواست ناموفق بود."},500)}
 return reply({ok:true,status:patch.status});
});