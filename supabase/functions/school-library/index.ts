import { createClient } from "npm:@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json; charset=utf-8"}});
const clean=(v:unknown,max=2000)=>String(v??"").trim().slice(0,max);
const norm=(v:unknown)=>clean(v,100).replace(/[\u200c\u200f\u202a-\u202e]/g,"").replace(/ي/g,"ی").replace(/ك/g,"ک").toLocaleLowerCase("fa");
const types=["textbook","handout","lesson","worksheet","other"];
const privateHost=(h:string)=>h==="localhost"||h.endsWith(".localhost")||h.endsWith(".local")||h==="127.0.0.1"||h==="0.0.0.0"||h==="::1"||/^10\./.test(h)||/^192\.168\./.test(h)||/^172\.(1[6-9]|2\d|3[01])\./.test(h);
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return reply({message:"درخواست نامعتبر است."},405);
 const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
 if(!token)return reply({message:"ابتدا وارد سامانه شوید."},401);
 const url=Deno.env.get("SUPABASE_URL")||"",key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
 if(!url||!key)return reply({message:"سرویس کتابخانه آماده نیست."},503);
 try{
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:auth,error:authErr}=await db.auth.getUser(token);
  if(authErr||!auth.user)return reply({message:"نشست معتبر نیست."},401);
  const {data:p,error:pErr}=await db.from("account_settings").select("role,tenant_school_id").eq("auth_user_id",auth.user.id).maybeSingle();
  if(pErr||!p?.tenant_school_id)return reply({message:"پروفایل مدرسه تأیید نشد."},403);
  const role=norm(p.role),manager=["manager","مدیر","school_manager"].includes(role);
  const deputy=["deputy","educational_deputy","معاون","معاون آموزشی"].includes(role);
  const teacher=["teacher","دبیر","معلم"].includes(role);
  if(!manager&&!deputy&&!teacher)return reply({message:"این نقش به کتابخانه دسترسی ندارد."},403);
  const {data:members,error:mErr}=await db.from("school_memberships").select("role").eq("school_id",p.tenant_school_id).eq("auth_user_id",auth.user.id).eq("is_active",true);
  if(mErr)return reply({message:"بررسی عضویت مدرسه ناموفق بود."},503);
  const memberRoles=(members||[]).map(x=>norm(x.role));
  const allowed=manager?memberRoles.some(x=>["manager","مدیر","school_manager"].includes(x)):deputy?memberRoles.some(x=>["deputy","معاون","معاون آموزشی","educational_deputy"].includes(x)):memberRoles.some(x=>["teacher","دبیر","معلم"].includes(x));
  if(!allowed)return reply({message:"عضویت فعال این نقش در مدرسه تأیید نشد."},403);
  const body=await req.json().catch(()=>({})),action=clean(body.action,50),school=p.tenant_school_id;
  if(action==="list"){
   let query=db.from("school_library_resources").select("id,title,description,resource_type,subject,grade,chapter,storage_path,source_url,source_title,source_license,status,created_at").eq("school_id",school);
   if(!manager)query=query.eq("status","published");
   if(body.type)query=query.eq("resource_type",clean(body.type,30));
   if(body.grade)query=query.eq("grade",clean(body.grade,80));
   if(body.subject)query=query.ilike("subject","%"+clean(body.subject,80)+"%");
   const {data,error}=await query.order("created_at",{ascending:false}).limit(300);
   if(error)throw error;
   return reply({ok:true,role:manager?"manager":deputy?"deputy":"teacher",items:data||[]});
  }
  if(action==="add_link"&&manager){
   const title=clean(body.title,240),raw=clean(body.source_url,2000);
   if(title.length<2||!raw)return reply({message:"عنوان و نشانی منبع الزامی است."},400);
   let parsed:URL;try{parsed=new URL(raw)}catch{return reply({message:"نشانی اینترنتی معتبر نیست."},400)}
   if(parsed.protocol!=="https:"||privateHost(parsed.hostname)||parsed.username||parsed.password)return reply({message:"فقط پیوند عمومی HTTPS پذیرفته می‌شود."},400);
   const {data,error}=await db.from("school_library_resources").insert({school_id:school,created_by:auth.user.id,title,description:clean(body.description),resource_type:types.includes(body.resource_type)?body.resource_type:"other",subject:clean(body.subject,80),grade:clean(body.grade,80),chapter:clean(body.chapter,120),source_url:parsed.toString(),source_title:clean(body.source_title,240)||parsed.hostname,source_license:clean(body.source_license,240),permission_confirmed:body.permission_confirmed===true,status:"published"}).select("id").single();
   if(error)throw error;return reply({ok:true,id:data.id,message:"پیوند به کتابخانه اضافه شد."});
  }
  if(action==="upload_pdf"&&manager){
   if(body.permission_confirmed!==true)return reply({message:"برای بارگذاری PDF باید تأیید کنید اجازهٔ نگهداری و انتشار فایل را دارید."},400);
   const title=clean(body.title,240),b64=String(body.data_base64||"").replace(/^data:application\/pdf;base64,/i,"").replace(/\s/g,"");
   if(title.length<2||!b64)return reply({message:"عنوان و فایل PDF الزامی است."},400);
   if(b64.length>35_000_000)return reply({message:"حجم فایل بیش از ۲۵ مگابایت است."},413);
   let binary:string;try{binary=atob(b64)}catch{return reply({message:"محتوای فایل معتبر نیست."},400)}
   if(binary.length>25*1024*1024)return reply({message:"حجم فایل بیش از ۲۵ مگابایت است."},413);
   const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
   if(new TextDecoder().decode(bytes.slice(0,5))!=="%PDF-")return reply({message:"فایل انتخاب‌شده PDF معتبر نیست."},415);
   const path=school+"/"+crypto.randomUUID()+".pdf";
   const {error:upErr}=await db.storage.from("school-library-files").upload(path,bytes,{contentType:"application/pdf",upsert:false});
   if(upErr)throw upErr;
   const {data,error}=await db.from("school_library_resources").insert({school_id:school,created_by:auth.user.id,title,description:clean(body.description),resource_type:types.includes(body.resource_type)?body.resource_type:"other",subject:clean(body.subject,80),grade:clean(body.grade,80),chapter:clean(body.chapter,120),storage_path:path,source_title:clean(body.source_title,240),source_license:clean(body.source_license,240),permission_confirmed:true,status:"published"}).select("id").single();
   if(error){await db.storage.from("school-library-files").remove([path]);throw error}
   return reply({ok:true,id:data.id,message:"فایل PDF به کتابخانه اضافه شد."});
  }
  if(action==="open"||action==="download"){
   const {data:item,error}=await db.from("school_library_resources").select("id,storage_path,source_url,status").eq("school_id",school).eq("id",clean(body.id,80)).maybeSingle();
   if(error)throw error;if(!item||!(item.status==="published"||manager))return reply({message:"منبع منتشرشده پیدا نشد."},404);
   if(item.source_url)return reply({url:item.source_url,external:true});
   if(!item.storage_path)return reply({message:"فایل این منبع موجود نیست."},404);
   const {data:signed,error:sErr}=await db.storage.from("school-library-files").createSignedUrl(item.storage_path,600,{download:action==="download"});
   if(sErr)throw sErr;return reply({url:signed.signedUrl,external:false});
  }
  if(action==="archive"&&manager){
   const {data:item,error}=await db.from("school_library_resources").update({status:"archived",updated_at:new Date().toISOString()}).eq("school_id",school).eq("id",clean(body.id,80)).select("id,storage_path").maybeSingle();
   if(error)throw error;if(!item)return reply({message:"منبع پیدا نشد."},404);
   if(item.storage_path)await db.storage.from("school-library-files").remove([item.storage_path]);
   return reply({ok:true,message:"منبع بایگانی شد."});
  }
  return reply({message:"این عملیات برای نقش شما مجاز نیست."},403);
 }catch(error){console.error("school-library error",error);return reply({message:"عملیات کتابخانه انجام نشد؛ دسترسی سرویس و ساختار پایگاه داده را بررسی کنید."},500)}
});
