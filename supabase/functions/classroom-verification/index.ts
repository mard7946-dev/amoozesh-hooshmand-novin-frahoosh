import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods":"POST, OPTIONS" };
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json; charset=utf-8"}});
const clean=(v:unknown)=>String(v??"").replace(/[\u200c\u200f\u202a-\u202e]/g,"").trim();
const norm=(v:unknown)=>clean(v).replace(/[۰-۹]/g,d=>String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٠-٩]/g,d=>String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).toLocaleLowerCase("fa");
const managerRole=(role:string)=>["manager","مدیر","مدیریت","school_manager"].some(x=>norm(role)===norm(x)||norm(role).includes(norm(x)));
const tehranParts=()=>{
 const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Tehran",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(new Date());
 const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
 const weekday=new Intl.DateTimeFormat("fa-IR",{timeZone:"Asia/Tehran",weekday:"long"}).format(new Date());
 return {date:p.year+"-"+p.month+"-"+p.day,time:p.hour+":"+p.minute,minute:Number(p.hour)*60+Number(p.minute),weekday,now:new Date()};
};
const minutes=(v:unknown)=>{const m=/^(\d{1,2}):(\d{2})/.exec(clean(v));return m?Number(m[1])*60+Number(m[2]):-1;};

Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return reply({message:"درخواست نامعتبر است."},405);
 const token=(req.headers.get("authorization")??"").replace(/^Bearer\s+/i,"").trim();
 if(!token)return reply({message:"ابتدا وارد سامانه شوید."},401);
 const url=(Deno.env.get("SUPABASE_URL")??"").trim();
 let key=(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"").trim();
 const bundle=(Deno.env.get("SUPABASE_SECRET_KEYS")??"").trim();
 if(bundle){try{const b=JSON.parse(bundle);const k=typeof b==="string"?b:b.default??b.service_role??b.serviceRole??b.service_role_key;if(typeof k==="string"&&k.trim())key=k.trim();}catch{if(bundle.startsWith("sb_secret_")||bundle.startsWith("eyJ"))key=bundle;}}
 if(!url||!key)return reply({message:"اتصال امن پایگاه داده تنظیم نشده است."},503);
 try{
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:auth,error:authError}=await db.auth.getUser(token);
  if(authError||!auth.user)return reply({message:"نشست معتبر نیست؛ دوباره وارد شوید."},401);
  const {data:profile,error:profileError}=await db.from("account_settings").select("username,national_code,display_name,role,tenant_school_id,auth_user_id").eq("auth_user_id",auth.user.id).maybeSingle();
  if(profileError||!profile?.tenant_school_id)return reply({message:"پروفایل مدرسه این حساب تأیید نشد."},403);
  const body=await req.json().catch(()=>({}));
  const action=clean(body.action),school=profile.tenant_school_id,role=norm(profile.role),manager=managerRole(role);
  if(action==="list_settings"){
   if(!manager)return reply({message:"فقط مدیر مدرسه به تنظیم صحت‌سنجی کلاس دسترسی دارد."},403);
   const {data:entries,error}=await db.from("weekly_schedule_entries").select("id,class_name,weekday,period,start_time,end_time,day_enabled").eq("tenant_school_id",school).order("period").limit(1000);
   if(error)throw error;
   const {data:settings,error:settingsError}=await db.from("classroom_verification_period_settings").select("period,check1_time,check2_time,enabled").eq("tenant_school_id",school);
   if(settingsError)throw settingsError;
   const map=new Map((settings??[]).map((x:any)=>[Number(x.period),x]));
   const periods=[1,2,3].map(period=>{
    const rows=(entries??[]).filter((x:any)=>Number(x.period)===period);
    const starts=rows.map((x:any)=>minutes(x.start_time)).filter((n:number)=>n>=0);
    const ends=rows.map((x:any)=>minutes(x.end_time)).filter((n:number)=>n>=0);
    const toTime=(n:number)=>String(Math.floor(n/60)).padStart(2,"0")+":"+String(n%60).padStart(2,"0");
    return {period,session_count:rows.length,class_count:new Set(rows.map((x:any)=>norm(x.class_name))).size,start_time:starts.length?toTime(Math.min(...starts)):"—",end_time:ends.length?toTime(Math.max(...ends)):"—",verification:map.get(period)??null};
   }).filter((p:any)=>p.session_count>0);
   return reply({ok:true,periods});
  }
  if(action==="save_period_settings"){
   if(!manager)return reply({message:"فقط مدیر مدرسه می‌تواند زمان‌های صحت‌سنجی را تنظیم کند."},403);
   const period=Number(body.period),t1=clean(body.check1_time),t2=clean(body.check2_time);
   if(!Number.isInteger(period)||period<1||period>3||!/^\d{2}:\d{2}$/.test(t1)||!/^\d{2}:\d{2}$/.test(t2)||t1===t2)return reply({message:"برای زنگ انتخاب‌شده دو ساعت متفاوت و معتبر وارد کنید."},400);
   const {data:entries,error:entriesError}=await db.from("weekly_schedule_entries").select("start_time,end_time").eq("tenant_school_id",school).eq("period",period).limit(1000);
   if(entriesError)throw entriesError;
   if(!entries?.length)return reply({message:"برای این زنگ برنامه هفتگی ثبت نشده است."},404);
   const starts=entries.map((x:any)=>minutes(x.start_time)).filter((n:number)=>n>=0),ends=entries.map((x:any)=>minutes(x.end_time)).filter((n:number)=>n>=0);
   const lower=starts.length?Math.min(...starts):-1,upper=ends.length?Math.max(...ends):-1,a=minutes(t1),b=minutes(t2);
   if(lower<0||upper<=lower||a<lower||a>=upper||b<lower||b>=upper)return reply({message:"هر دو زمان باید داخل بازه کلی زنگ "+period+" باشند ("+(lower>=0?String(Math.floor(lower/60)).padStart(2,"0")+":"+String(lower%60).padStart(2,"0"):"—")+" تا "+(upper>=0?String(Math.floor(upper/60)).padStart(2,"0")+":"+String(upper%60).padStart(2,"0"):"—")+")."},400);
   const {data,error:saveError}=await db.from("classroom_verification_period_settings").upsert({tenant_school_id:school,period,check1_time:t1,check2_time:t2,enabled:body.enabled!==false,updated_at:new Date().toISOString()},{onConflict:"tenant_school_id,period"}).select("period,check1_time,check2_time,enabled").single();
   if(saveError)throw saveError;
   return reply({ok:true,setting:data,message:"دو زمان صحت‌سنجی برای تمام کلاس‌های این زنگ ذخیره شد."});
  }
  if(action==="status"||action==="confirm"){
   if(role!=="student"&&!role.includes("دانشآموز")&&!role.includes("دانش آموز"))return reply({message:"صحت‌سنجی کلاس فقط برای حساب دانش‌آموز فعال است."},403);
   const code=clean(profile.national_code),username=clean(profile.username);
   let sq=db.from("students").select("id,class_name,national_code,student_code").eq("tenant_school_id",school);
   if(code)sq=sq.eq("national_code",code);else sq=sq.eq("student_code",username);
   const {data:student,error:studentError}=await sq.maybeSingle();
   if(studentError||!student)return reply({message:"پرونده دانش‌آموز با حساب ورود تطبیق داده نشد."},403);
   const scheduleId=Number(body.schedule_entry_id);
   if(!Number.isInteger(scheduleId)||scheduleId<1)return reply({message:"شناسه زنگ برنامه هفتگی معتبر نیست."},400);
   const {data:entry,error:entryError}=await db.from("weekly_schedule_entries").select("id,class_name,weekday,period,start_time,end_time,day_enabled,online_class_id").eq("id",scheduleId).eq("tenant_school_id",school).maybeSingle();
   if(entryError||!entry||norm(entry.class_name)!==norm(student.class_name)||Number(entry.online_class_id)!==Number(body.room_id))return reply({message:"این زنگ متعلق به کلاس ثبت‌شده دانش‌آموز نیست."},403);
   const period=Number((entry as any).period);
   const {data:periodSetting,error:periodSettingError}=await db.from("classroom_verification_period_settings").select("check1_time,check2_time,enabled").eq("tenant_school_id",school).eq("period",period).maybeSingle();
   if(periodSettingError)throw periodSettingError;
   let setting=periodSetting;
   if(!setting){
    const {data:legacySetting,error:legacyError}=await db.from("classroom_verification_settings").select("check1_time,check2_time,enabled").eq("schedule_entry_id",scheduleId).eq("tenant_school_id",school).maybeSingle();
    if(legacyError)throw legacyError;
    setting=legacySetting;
   }
   if(!setting||!setting.enabled)return reply({ok:true,enabled:false});
   const clock=tehranParts();
   const weekdayKey=norm(entry.weekday).replace(/\s/g,"");
   if(weekdayKey!==norm(clock.weekday).replace(/\s/g,"")||entry.day_enabled!==true)return reply({ok:true,enabled:true,not_today:true});
   const start=minutes(entry.start_time),end=minutes(entry.end_time);
   if(!periodSetting&&(clock.minute<start||clock.minute>=end))return reply({ok:true,enabled:true,not_in_class_time:true});
   if(action==="confirm"){
    const eventId=clean(body.event_id);
    const {data:event,error:eventError}=await db.from("classroom_verification_events").select("id,status,deadline_at,schedule_entry_id").eq("id",eventId).eq("student_id",student.id).eq("tenant_school_id",school).maybeSingle();
    if(eventError||!event||Number(event.schedule_entry_id)!==scheduleId)return reply({message:"درخواست صحت‌سنجی برای این زنگ پیدا نشد."},404);
    if(event.status!=="pending")return reply({message:event.status==="confirmed"?"حضور شما قبلاً تأیید شده است.":"مهلت پاسخ‌گویی تمام شده و دسترسی این زنگ غیرفعال شده است."},409);
    if(Date.now()>Date.parse(event.deadline_at)){
     await db.from("classroom_verification_events").update({status:"missed"}).eq("id",event.id).eq("status","pending");
     return reply({message:"مهلت ۹۰ ثانیه‌ای تأیید حضور تمام شد؛ دسترسی شما به این زنگ غیرفعال شد."},409);
    }
    const {data:updated,error:updateError}=await db.from("classroom_verification_events").update({status:"confirmed",responded_at:new Date().toISOString()}).eq("id",event.id).eq("status","pending").select("id,status").maybeSingle();
    if(updateError)throw updateError;
    if(!updated)return reply({message:"درخواست قبلاً تعیین تکلیف شده است."},409);
    return reply({ok:true,confirmed:true,message:"حضور شما با موفقیت تأیید شد."});
   }
   const times=[setting.check1_time,setting.check2_time];
   for(let i=0;i<times.length;i++){
    const due=minutes(times[i]);if(due<0||clock.minute<due)continue;
    const {data:event,error:eventError}=await db.from("classroom_verification_events").select("id,status,deadline_at,check_slot,last_seen_at,prompt_at").eq("schedule_entry_id",scheduleId).eq("student_id",student.id).eq("class_date",clock.date).eq("check_slot",i+1).maybeSingle();
    if(eventError)throw eventError;
    if(!event){
     const now=new Date(),deadline=new Date(now.getTime()+90000);
     const status="pending";
     const {data:created,error:createError}=await db.from("classroom_verification_events").insert({tenant_school_id:school,schedule_entry_id:scheduleId,student_id:student.id,class_date:clock.date,check_slot:i+1,status,prompt_at:now.toISOString(),deadline_at:deadline.toISOString(),last_seen_at:now.toISOString()}).select("id,status,deadline_at,check_slot,last_seen_at,prompt_at").single();
     if(createError&&createError.code!=="23505")throw createError;
     if(created&&created.status==="missed")return reply({ok:true,blocked:true,reason:"در نوبت "+(i+1)+" صحت‌سنجی زنگ، درخواست در زمان مقرر تأیید نشده است."});
     if(created)return reply({ok:true,enabled:true,prompt:true,event:created,check_slot:i+1});
    }
    if(event?.status==="pending"){
     const nowMs=Date.now(),deadlineMs=Date.parse(event.deadline_at),lastSeenMs=Date.parse(event.last_seen_at||event.prompt_at);
     if(nowMs>deadlineMs){
      const wasOnlineThroughDeadline=lastSeenMs>=deadlineMs-15000&&nowMs-lastSeenMs<=30000;
      if(wasOnlineThroughDeadline){
       await db.from("classroom_verification_events").update({status:"missed"}).eq("id",event.id).eq("status","pending");
       return reply({ok:true,blocked:true,reason:"مهلت ۹۰ ثانیه‌ای نوبت "+(i+1)+" صحت‌سنجی تمام شده است؛ درخواست در زمان اتصال فعال تأیید نشد."});
      }
      const extendedDeadline=new Date(nowMs+90000).toISOString();
      const {data:extended,error:extendError}=await db.from("classroom_verification_events").update({deadline_at:extendedDeadline,last_seen_at:new Date().toISOString()}).eq("id",event.id).eq("status","pending").select("id,status,deadline_at,check_slot,last_seen_at").single();
      if(extendError)throw extendError;
      return reply({ok:true,enabled:true,prompt:true,event:extended,check_slot:i+1,deadline_extended:true});
     }
     await db.from("classroom_verification_events").update({last_seen_at:new Date().toISOString()}).eq("id",event.id).eq("status","pending");
     return reply({ok:true,enabled:true,prompt:true,event,check_slot:i+1});
    }
    if(event?.status==="missed")return reply({ok:true,blocked:true,reason:"نوبت "+(i+1)+" صحت‌سنجی این زنگ تأیید نشده است؛ دسترسی این زنگ غیرفعال شده است."});
   }
   return reply({ok:true,enabled:true,prompt:false});
  }
  return reply({message:"عملیات صحت‌سنجی پشتیبانی نمی‌شود."},400);
 }catch(error){console.error("classroom-verification failed",String(error));return reply({message:"ثبت یا بررسی صحت‌سنجی انجام نشد؛ دوباره تلاش کنید."},500);}
});
