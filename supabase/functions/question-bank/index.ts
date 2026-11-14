import { createClient } from "npm:@supabase/supabase-js@2";
import { fetchPinnedHttps, publicHttpsUrl } from "./safe-fetch.ts";
import { parsePdfQuestions } from "./pdf-parser.ts";

const cors = { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods":"POST, OPTIONS" };
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
const clean=(v:unknown)=>String(v??"").trim().slice(0,12000);
const norm=(v:unknown)=>clean(v).replace(/[\u200c\u200f\u202a-\u202e]/g,"").replace(/ي/g,"ی").replace(/ك/g,"ک").toLocaleLowerCase("fa");
const readBounded=async(response:Response,maxBytes:number):Promise<Uint8Array>=>{
 const declared=Number(response.headers.get("content-length")||0);
 if(declared>maxBytes){await response.body?.cancel();throw new Error("RESPONSE_TOO_LARGE");}
 if(!response.body)throw new Error("EMPTY_RESPONSE");
 const reader=response.body.getReader();const chunks:Uint8Array[]=[];let total=0;
 try{
  while(true){
   const {done,value}=await reader.read();if(done)break;
   total+=value.byteLength;
   if(total>maxBytes){await reader.cancel();throw new Error("RESPONSE_TOO_LARGE");}
   chunks.push(value);
  }
 }finally{reader.releaseLock();}
 const result=new Uint8Array(total);let offset=0;
 for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.byteLength;}
 return result;
};
const toBase64=(bytes:Uint8Array)=>{let binary="";const step=0x8000;for(let i=0;i<bytes.length;i+=step)binary+=String.fromCharCode(...bytes.subarray(i,Math.min(i+step,bytes.length)));return btoa(binary);};

Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
 if(req.method!=="POST") return reply({message:"درخواست نامعتبر است."},405);
 const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
 if(!token) return reply({message:"ابتدا وارد سامانه شوید."},401);
 const url=Deno.env.get("SUPABASE_URL")||"";
 const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
 if(!url||!key) return reply({message:"سرویس بانک سؤال آماده نیست."},503);
 try{
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:auth,error:authErr}=await db.auth.getUser(token);
  if(authErr||!auth.user) return reply({message:"نشست معتبر نیست."},401);
  const {data:profile,error:pErr}=await db.from("account_settings").select("role,tenant_school_id,display_name").eq("auth_user_id",auth.user.id).maybeSingle();
  if(pErr||!profile?.tenant_school_id) return reply({message:"پروفایل مدرسه تأیید نشد."},403);
  const role=norm(profile.role);
  const manager=["manager","مدیر","school_manager"].includes(role);
  const deputy=["deputy","educational_deputy","معاون","معاون آموزشی"].includes(role);
  const teacher=["teacher","دبیر","معلم"].includes(role);
  if(!manager&&!deputy&&!teacher) return reply({message:"این نقش به بانک سؤال دسترسی ندارد."},403);
  const {data:members,error:mErr}=await db.from("school_memberships").select("role").eq("school_id",profile.tenant_school_id).eq("auth_user_id",auth.user.id).eq("is_active",true);
  if(mErr) return reply({message:"بررسی عضویت مدرسه ناموفق بود."},503);
  const membershipRoles=(members||[]).map(x=>norm(x.role));
  const valid=manager?membershipRoles.some(x=>["manager","مدیر","school_manager"].includes(x)):deputy?membershipRoles.some(x=>["deputy","معاون","معاون آموزشی","educational_deputy"].includes(x)):membershipRoles.some(x=>["teacher","دبیر","معلم"].includes(x));
  if(!valid) return reply({message:"عضویت فعال این نقش در مدرسه تأیید نشد."},403);
  const body=await req.json().catch(()=>({}));
  const action=clean(body.action);
  const school=profile.tenant_school_id;
  if(action==="bootstrap"){
   let query=db.from("question_bank").select("id,subject,grade,chapter,topic,difficulty,question_type,prompt,options,correct_answer,explanation,points,source_url,source_title,source_license,status,created_at").eq("tenant_school_id",school);
   if(!manager) query=query.eq("status","published");
   if(body.subject) query=query.ilike("subject","%"+clean(body.subject)+"%");
   if(body.grade) query=query.eq("grade",clean(body.grade));
   const {data:questions,error}=await query.order("created_at",{ascending:false}).limit(300);
   if(error) throw error;
   const {data:collections,error:cErr}=await db.from("question_collections").select("id,title").eq("tenant_school_id",school).eq("owner_auth_user_id",auth.user.id).order("created_at");
   if(cErr) throw cErr;
   let collection=collections?.[0];
   if(!collection){const created=await db.from("question_collections").insert({tenant_school_id:school,owner_auth_user_id:auth.user.id,title:"سؤال‌های من"}).select("id,title").single();if(created.error)throw created.error;collection=created.data;}
   const {data:items,error:iErr}=await db.from("question_collection_items").select("question_id").eq("collection_id",collection.id);
   if(iErr)throw iErr;
   return reply({ok:true,role:manager?"manager":deputy?"deputy":"teacher",questions:questions||[],collection,selected_ids:(items||[]).map(x=>x.question_id)});
  }
  if(action==="create_question"&&manager){
   const q=body.question||{};
   const prompt=clean(q.prompt),subject=clean(q.subject);
   if(!prompt||!subject) return reply({message:"متن سؤال و نام درس الزامی است."},400);
   const payload={tenant_school_id:school,created_by:auth.user.id,subject,grade:clean(q.grade),chapter:clean(q.chapter),topic:clean(q.topic),difficulty:["easy","medium","hard"].includes(q.difficulty)?q.difficulty:"medium",question_type:["multiple_choice","true_false","short_answer","essay","fill_blank"].includes(q.question_type)?q.question_type:"multiple_choice",prompt,options:Array.isArray(q.options)?q.options.slice(0,8).map(clean):[],correct_answer:clean(q.correct_answer),explanation:clean(q.explanation),points:Math.max(0,Number(q.points)||1),source_url:clean(q.source_url),source_title:clean(q.source_title),source_license:clean(q.source_license),source_permission_confirmed:q.source_permission_confirmed===true,status:"draft"};
   const {data,error}=await db.from("question_bank").insert(payload).select("id").single();if(error)throw error;
   return reply({ok:true,id:data.id,message:"سؤال به‌صورت پیش‌نویس ذخیره شد."});
  }
  if(action==="publish_question"&&manager){
   const {data,error}=await db.from("question_bank").update({status:"published",updated_at:new Date().toISOString()}).eq("tenant_school_id",school).eq("id",clean(body.question_id)).select("id").maybeSingle();
   if(error)throw error;if(!data)return reply({message:"سؤال پیدا نشد."},404);
   return reply({ok:true,message:"سؤال در بانک مرکزی منتشر شد."});
  }
  if(action==="archive_question"&&manager){
   const {error}=await db.from("question_bank").update({status:"archived",updated_at:new Date().toISOString()}).eq("tenant_school_id",school).eq("id",clean(body.question_id));if(error)throw error;return reply({ok:true});
  }
  if(action==="add_to_collection"&&(deputy||teacher)){
   const questionId=clean(body.question_id);
   const {data:q,error:qErr}=await db.from("question_bank").select("id").eq("tenant_school_id",school).eq("id",questionId).eq("status","published").maybeSingle();
   if(qErr||!q)return reply({message:"سؤال منتشرشده‌ای با این شناسه پیدا نشد."},404);
   let {data:c,error:cErr}=await db.from("question_collections").select("id").eq("tenant_school_id",school).eq("owner_auth_user_id",auth.user.id).limit(1).maybeSingle();
   if(cErr)throw cErr;
   if(!c){const made=await db.from("question_collections").insert({tenant_school_id:school,owner_auth_user_id:auth.user.id,title:"سؤال‌های من"}).select("id").single();if(made.error)throw made.error;c=made.data;}
   const {error}=await db.from("question_collection_items").upsert({collection_id:c.id,question_id:questionId},{onConflict:"collection_id,question_id",ignoreDuplicates:true});
   if(error)throw error;return reply({ok:true,message:"سؤال به مجموعه شخصی شما اضافه شد."});
  }
  if(action==="remove_from_collection"&&(deputy||teacher)){
   const questionId=clean(body.question_id);
   const {data:c,error:cErr}=await db.from("question_collections").select("id").eq("tenant_school_id",school).eq("owner_auth_user_id",auth.user.id).limit(1).maybeSingle();
   if(cErr)throw cErr;if(!c)return reply({ok:true});
   const {error}=await db.from("question_collection_items").delete().eq("collection_id",c.id).eq("question_id",questionId);if(error)throw error;return reply({ok:true});
  }

  if(action==="discover_pdf_links"&&manager){
   if(body.source_permission_confirmed!==true)return reply({message:"برای بررسی صفحه باید مجوز استفاده از محتوای منبع را تأیید کنید."},400);
   const page=publicHttpsUrl(clean(body.source_url));
   if(!page)return reply({message:"فقط نشانی HTTPS عمومی و معتبر پذیرفته می‌شود."},400);
   let response:Response;try{response=await fetchPinnedHttps(page,"text/html",2*1024*1024);}catch(error){if(error instanceof Error&&error.message==="RESPONSE_TOO_LARGE")return reply({message:"حجم صفحه بیشتر از ۲ مگابایت است."},413);if(error instanceof Error&&error.message==="PUBLIC_HOST_VALIDATION_FAILED")return reply({message:"نشانی مقصد به یک IP عمومی معتبر اشاره نمی‌کند."},400);throw error;}
   if(response.status>=300&&response.status<400)return reply({message:"صفحه به نشانی دیگری هدایت می‌شود؛ لطفاً نشانی نهایی را وارد کنید."},400);
   if(!response.ok)return reply({message:"دریافت صفحه از سایت ممکن نشد."},502);
   const type=response.headers.get("content-type")||"";
   if(!type.toLowerCase().includes("text/html"))return reply({message:"این نشانی صفحه HTML نیست؛ فایل PDF را مستقیماً بارگذاری کنید."},415);
   const html=new TextDecoder().decode(await readBounded(response,2*1024*1024));
   const links=new Map<string,{url:string,title:string}>();
   for(const m of html.matchAll(/<a\b([^>]*?)href\s*=\s*(["'])(.*?)\2([^>]*)>([\s\S]*?)<\/a>/gi)){
    const href=(m[3]||"").replace(/&amp;/g,"&").trim();if(!href)continue;
    let resolved:URL;try{resolved=new URL(href,page);}catch{continue;}
    if(!/\.pdf(?:$|[?#])/i.test(resolved.pathname+resolved.search))continue;
    const safe=publicHttpsUrl(resolved.toString());if(!safe)continue;
    const title=(m[5]||"").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,180)||decodeURIComponent(safe.pathname.split("/").pop()||"فایل PDF");
    links.set(safe.toString(),{url:safe.toString(),title});
   }
   const pdfs=[...links.values()].slice(0,50);
   return reply({ok:true,count:pdfs.length,pdfs,message:pdfs.length?pdfs.length+" فایل PDF در صفحه پیدا شد.":"پیوند PDF قابل‌دسترسی در HTML صفحه پیدا نشد؛ اگر سایت با جاوااسکریپت PDFها را بارگذاری می‌کند، فایل را مستقیم بارگذاری کنید."});
  }
  if(action==="fetch_pdf"&&manager){
   if(body.source_permission_confirmed!==true)return reply({message:"برای دریافت PDF باید مجوز استفاده از محتوا را تأیید کنید."},400);
   const pdfUrl=publicHttpsUrl(clean(body.pdf_url));if(!pdfUrl)return reply({message:"نشانی PDF معتبر و عمومی نیست."},400);
   let response:Response;try{response=await fetchPinnedHttps(pdfUrl,"application/pdf",15*1024*1024);}catch(error){if(error instanceof Error&&error.message==="RESPONSE_TOO_LARGE")return reply({message:"حجم PDF نباید بیشتر از ۱۵ مگابایت باشد."},413);if(error instanceof Error&&error.message==="PUBLIC_HOST_VALIDATION_FAILED")return reply({message:"نشانی مقصد به یک IP عمومی معتبر اشاره نمی‌کند."},400);throw error;}
   if(response.status>=300&&response.status<400)return reply({message:"فایل PDF به نشانی دیگری هدایت می‌شود؛ فایل را بارگذاری کنید یا نشانی نهایی را وارد کنید."},400);
   if(!response.ok)return reply({message:"دریافت PDF از سایت ممکن نشد."},502);
   let bytes:Uint8Array;try{bytes=await readBounded(response,15*1024*1024);}catch(error){if(error instanceof Error&&error.message==="RESPONSE_TOO_LARGE")return reply({message:"حجم PDF نباید بیشتر از ۱۵ مگابایت باشد."},413);throw error;}
   if(bytes.length<5||new TextDecoder().decode(bytes.subarray(0,5))!=="%PDF-")return reply({message:"نشانی انتخاب‌شده محتوای PDF معتبر برنگرداند."},415);
   return reply({ok:true,file_name:decodeURIComponent(pdfUrl.pathname.split("/").pop()||"questions.pdf"),data:toBase64(bytes)});
  }

  if(action==="import_pdf"&&manager){
   if(body.source_permission_confirmed!==true)return reply({message:"برای ورود PDF باید مجوز استفاده از محتوا را تأیید کنید."},400);
   const sourceText=String(body.text||"").slice(0,180000);
   const subject=clean(body.subject);
   if(!subject)return reply({message:"نام درس الزامی است."},400);
   if(sourceText.length<20)return reply({message:"متن قابل استفاده‌ای از PDF دریافت نشد."},422);
   const chunks=parsePdfQuestions(sourceText,subject,100);
   if(!chunks.length)return reply({message:"سؤال شماره‌گذاری‌شده یا بخش‌بندی‌شده‌ای از متن PDF تشخیص داده نشد. برای جلوگیری از ورود اشتباه، چیزی ذخیره نشد؛ متن PDF و شماره‌گذاری را بررسی کنید.",imported:0},422);
   const rows=chunks.map(q=>({tenant_school_id:school,created_by:auth.user.id,subject:q.subject||subject,grade:clean(body.grade),prompt:q.prompt,question_type:q.question_type,options:q.options,correct_answer:q.correct_answer,source_url:clean(body.source_url),source_title:clean(body.file_name)||"ورود از PDF",source_license:clean(body.source_license),source_permission_confirmed:true,status:"draft"}));
   const {data,error}=await db.from("question_bank").insert(rows).select("id");
   if(error)throw error;
   return reply({ok:true,imported:data?.length||0,message:(data?.length||0)+" سؤال به‌صورت پیش‌نویس وارد شد. درس هر سؤال از عنوان صریح بخش «درس: ...» تشخیص داده شده و در غیر این صورت از درس انتخاب‌شده استفاده شده است؛ متن، گزینه‌ها و پاسخ‌ها را بازبینی کنید."});
  }
  if(action==="import_url"&&manager){
   if(body.source_permission_confirmed!==true)return reply({message:"برای دریافت محتوا باید مجوز استفاده از منبع را تأیید کنید."},400);
   const parsed=publicHttpsUrl(clean(body.source_url));
   if(!parsed)return reply({message:"فقط نشانی HTTPS عمومی روی درگاه امن ۴۴۳ پذیرفته می‌شود."},400);
   let response:Response;
   try{response=await fetchPinnedHttps(parsed,"text/html,application/ld+json",1500000);}
   catch(error){if(error instanceof Error&&error.message==="PUBLIC_HOST_VALIDATION_FAILED")return reply({message:"نشانی مقصد به یک IP عمومی معتبر اشاره نمی‌کند."},400);throw error;}
   if(response.status>=300&&response.status<400)return reply({message:"منبع به نشانی دیگری هدایت می‌شود؛ لطفاً نشانی نهایی HTTPS را وارد کنید."},400);
   if(!response.ok)return reply({message:"دریافت صفحه از منبع انجام نشد."},502);
   const type=response.headers.get("content-type")||"";
   if(!type.includes("text/html")&&!type.includes("application/ld+json"))return reply({message:"فعلاً فقط صفحه HTML یا داده JSON-LD قابل بررسی است."},415);
   const raw=new TextDecoder().decode(await readBounded(response,1500000));
   const scripts=[...raw.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
   const found:any[]=[];
   for(const match of scripts){try{const parsedJson=JSON.parse(match[1]);const candidates=Array.isArray(parsedJson)?parsedJson:[parsedJson];for(const item of candidates){const list=Array.isArray(item["@graph"])?item["@graph"]:[item];for(const node of list){const kind=String(node["@type"]||"");if((kind==="Question"||kind==="Quiz")&&node.name&&node.text)found.push(node);}}}catch{}}
   if(!found.length)return reply({message:"از این صفحه سؤال ساختاریافته قابل استخراج پیدا نشد. می‌توانید اطلاعات را دستی ثبت کنید یا منبعی با داده استاندارد Quiz/Question بدهید.",imported:0},422);
   const rows=found.slice(0,100).map(q=>({tenant_school_id:school,created_by:auth.user.id,subject:clean(body.subject)||"نیازمند دسته‌بندی",grade:clean(body.grade),prompt:clean(q.text||q.name),question_type:"short_answer",options:[],correct_answer:"",source_url:parsed.toString(),source_title:clean(q.name)||parsed.hostname,source_license:clean(body.source_license),source_permission_confirmed:true,status:"draft"})).filter(q=>q.prompt);
   if(!rows.length)return reply({message:"سؤال قابل ذخیره‌ای از صفحه استخراج نشد."},422);
   const {data,error}=await db.from("question_bank").insert(rows).select("id");if(error)throw error;
   return reply({ok:true,imported:data?.length||0,message:"سؤال‌ها به‌صورت پیش‌نویس وارد شدند؛ پس از تکمیل دسته‌بندی و بازبینی می‌توانید منتشر کنید."});
  }
  return reply({message:"این عملیات برای نقش شما مجاز نیست یا شناخته نشد."},403);
 }catch(error){console.error("question-bank error",error);return reply({message:"عملیات بانک سؤال انجام نشد؛ ساختار داده و دسترسی سرویس را بررسی کنید."},500);}
});
