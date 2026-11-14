import { createClient } from "npm:@supabase/supabase-js@2";
import { parsePdfQuestions } from "./pdf-parser.ts";

const cors = { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods":"POST, OPTIONS" };
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
const clean=(v:unknown)=>String(v??"").trim().slice(0,12000);
const norm=(v:unknown)=>clean(v).replace(/[\u200c\u200f\u202a-\u202e]/g,"").replace(/ي/g,"ی").replace(/ك/g,"ک").toLocaleLowerCase("fa");
const vaultKey=(v:unknown)=>norm(v).replace(/\s+/g," ");
async function ensureVault(db:any,school:string,subjectValue:unknown,gradeValue:unknown){const subject=clean(subjectValue).replace(/\s+/g," "),grade=clean(gradeValue).replace(/\s+/g," "),subject_key=vaultKey(subject),grade_key=vaultKey(grade);if(!subject)return null;const {error:upsertError}=await db.from("question_vaults").upsert({tenant_school_id:school,subject,grade,subject_key,grade_key},{onConflict:"tenant_school_id,subject_key,grade_key",ignoreDuplicates:true});if(upsertError)throw upsertError;const {data,error}=await db.from("question_vaults").select("id,subject,grade").eq("tenant_school_id",school).eq("subject_key",subject_key).eq("grade_key",grade_key).single();if(error)throw error;return data;}
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
  const deputy=["educational","educational_deputy","معاون آموزشی"].includes(role);
  const teacher=["teacher","دبیر","معلم"].includes(role);
  if(!manager&&!deputy&&!teacher) return reply({message:"این نقش به بانک سؤال دسترسی ندارد."},403);
  const {data:members,error:mErr}=await db.from("school_memberships").select("role").eq("school_id",profile.tenant_school_id).eq("auth_user_id",auth.user.id).eq("is_active",true);
  if(mErr) return reply({message:"بررسی عضویت مدرسه ناموفق بود."},503);
  const membershipRoles=(members||[]).map(x=>norm(x.role));
  const valid=manager?membershipRoles.some(x=>["manager","مدیر","school_manager"].includes(x)):deputy?membershipRoles.some(x=>["educational","educational_deputy","معاون آموزشی"].includes(x)):membershipRoles.some(x=>["teacher","دبیر","معلم"].includes(x));
  if(!valid) return reply({message:"عضویت فعال این نقش در مدرسه تأیید نشد."},403);
  const body=await req.json().catch(()=>({}));
  const action=clean(body.action);
  const school=profile.tenant_school_id;
  if(action==="bootstrap"){
   const {data:vaultRows,error:vaultErr}=await db.from("question_vaults").select("id,subject,grade,created_at").eq("tenant_school_id",school).order("subject").order("grade");if(vaultErr)throw vaultErr;
   const visibleVaults=await Promise.all((vaultRows||[]).map(async(v:any)=>{let countQuery=db.from("question_bank").select("id",{count:"exact",head:true}).eq("tenant_school_id",school).eq("vault_id",v.id);if(!manager&&!deputy)countQuery=countQuery.eq("status","published");else countQuery=countQuery.neq("status","archived");const {count,error}=await countQuery;if(error)throw error;return {...v,question_count:count||0};}));
   const activeVaultId=clean(body.vault_id),pageSize=20,pageNumber=Math.max(1,Math.min(10000,Math.trunc(Number(body.page)||1)));
   let questions:any[]=[],questionCount=0;
   if(activeVaultId){let questionQuery=db.from("question_bank").select("id,vault_id,subject,grade,chapter,topic,difficulty,question_type,prompt,options,correct_answer,explanation,points,source_url,source_title,source_license,status,created_at",{count:"exact"}).eq("tenant_school_id",school).eq("vault_id",activeVaultId);if(!manager&&!deputy)questionQuery=questionQuery.eq("status","published");else questionQuery=questionQuery.neq("status","archived");if(body.search)questionQuery=questionQuery.ilike("prompt","%"+clean(body.search)+"%");const {data,error,count}=await questionQuery.order("created_at",{ascending:false}).range((pageNumber-1)*pageSize,pageNumber*pageSize-1);if(error)throw error;questions=data||[];questionCount=count||0;}
   const vaults=visibleVaults;
   const {data:collections,error:cErr}=await db.from("question_collections").select("id,title").eq("tenant_school_id",school).eq("owner_auth_user_id",auth.user.id).order("created_at");
   if(cErr) throw cErr;
   let collection=collections?.[0];
   if(!collection){const created=await db.from("question_collections").insert({tenant_school_id:school,owner_auth_user_id:auth.user.id,title:"سؤال‌های من"}).select("id,title").single();if(created.error)throw created.error;collection=created.data;}
   const {data:items,error:iErr}=await db.from("question_collection_items").select("question_id").eq("collection_id",collection.id);
   if(iErr)throw iErr;
   const paperQuery=db.from("question_papers").select("id,title,subject,grade,status,created_by,total_points,submitted_at,approved_at,review_note,created_at,updated_at").eq("tenant_school_id",school);
   if(teacher)paperQuery.eq("created_by",auth.user.id);
   const {data:papers,error:paperErr}=await paperQuery.order("updated_at",{ascending:false}).limit(100);
   if(paperErr)throw paperErr;
   return reply({ok:true,role:manager?"manager":deputy?"deputy":"teacher",questions,vaults:vaults||[],question_count:questionCount,page:pageNumber,collection,selected_ids:(items||[]).map(x=>x.question_id),papers:papers||[]});
  }
  if(action==="create_question"&&manager){
   const q=body.question||{};
   const prompt=clean(q.prompt),subject=clean(q.subject);
   if(!prompt||!subject) return reply({message:"متن سؤال و نام درس الزامی است."},400);
   const grade=clean(q.grade),vault=await ensureVault(db,school,subject,grade);if(!vault)return reply({message:"مخزن درس و پایه معتبر نیست."},400);
   const payload={tenant_school_id:school,vault_id:vault.id,created_by:auth.user.id,subject,grade,chapter:clean(q.chapter),topic:clean(q.topic),difficulty:["easy","medium","hard"].includes(q.difficulty)?q.difficulty:"medium",question_type:["multiple_choice","true_false","short_answer","essay","fill_blank"].includes(q.question_type)?q.question_type:"multiple_choice",prompt,options:Array.isArray(q.options)?q.options.slice(0,8).map(clean):[],correct_answer:clean(q.correct_answer),explanation:clean(q.explanation),points:Math.max(0,Number(q.points)||1),source_url:clean(q.source_url),source_title:clean(q.source_title),source_license:clean(q.source_license),source_permission_confirmed:q.source_permission_confirmed===true,status:"published"};
   const {data,error}=await db.from("question_bank").insert(payload).select("id").single();if(error)throw error;
   return reply({ok:true,id:data.id,vault_id:vault.id,message:"سؤال به مخزن "+subject+" · "+(grade||"بدون پایه")+" اضافه شد."});
  }
  if(action==="update_question"&&(manager||deputy)){
   const questionId=clean(body.question_id),q=body.question||{};
   const prompt=clean(q.prompt),subject=clean(q.subject);
   if(!prompt||!subject)return reply({message:"متن سؤال و نام درس الزامی است."},400);
   const grade=clean(q.grade),vault=await ensureVault(db,school,subject,grade);if(!vault)return reply({message:"مخزن درس و پایه معتبر نیست."},400);
   const payload={subject,grade,vault_id:vault.id,chapter:clean(q.topic),question_type:["multiple_choice","true_false","short_answer","essay","fill_blank"].includes(q.question_type)?q.question_type:"short_answer",prompt,options:Array.isArray(q.options)?q.options.slice(0,8).map(clean):[],correct_answer:clean(q.correct_answer),explanation:clean(q.explanation),updated_at:new Date().toISOString()};
   const {data,error}=await db.from("question_bank").update(payload).eq("tenant_school_id",school).eq("id",questionId).neq("status","archived").select("id").maybeSingle();
   if(error)throw error;if(!data)return reply({message:"سؤال فعال پیدا نشد."},404);
   return reply({ok:true,message:"متن سؤال و دسته‌بندی درس اصلاح شد."});
  }
  if(action==="archive_question"&&(manager||deputy)){
   const {error}=await db.from("question_bank").update({status:"archived",updated_at:new Date().toISOString()}).eq("tenant_school_id",school).eq("id",clean(body.question_id));if(error)throw error;return reply({ok:true});
  }
  if(action==="bulk_archive_questions"&&manager){
   const {data,error}=await db.from("question_bank").update({status:"archived",updated_at:new Date().toISOString()}).eq("tenant_school_id",school).neq("status","archived").select("id");
   if(error)throw error;
   const archived=Array.isArray(data)?data.length:0;
   return reply({ok:true,archived,message:archived+" سؤال فعال مدرسه به بایگانی منتقل شد. برگه‌های آزمون قبلی تغییری نکردند."});
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

  if(action==="create_paper"&&teacher){
   const title=clean(body.title),subject=clean(body.subject),grade=clean(body.grade);
   if(title.length<2||!subject)return reply({message:"عنوان برگه و درس الزامی است."},400);
   const {data,error}=await db.from("question_papers").insert({tenant_school_id:school,created_by:auth.user.id,title,subject,grade,status:"draft"}).select("id").single();
   if(error)throw error;
   return reply({ok:true,paper_id:data.id,message:"برگهٔ آزمون ایجاد شد؛ اکنون سؤال‌ها را انتخاب کنید."});
  }
  if(action==="get_paper"){
   const paperId=clean(body.paper_id);
   const {data:paper,error}=await db.from("question_papers").select("*").eq("tenant_school_id",school).eq("id",paperId).maybeSingle();
   if(error)throw error;if(!paper)return reply({message:"برگه پیدا نشد."},404);
   if(teacher&&paper.created_by!==auth.user.id)return reply({message:"به این برگه دسترسی ندارید."},403);
   if(teacher&&paper.status==="approved")return reply({ok:true,paper:{id:paper.id,title:paper.title,subject:paper.subject,grade:paper.grade,status:paper.status,total_points:paper.total_points,approved_at:paper.approved_at},items:[],export_allowed:false});
   const {data:items,error:itemErr}=await db.from("question_paper_items").select("id,question_id,points,order_index,question_bank(id,subject,grade,question_type,prompt,options)").eq("paper_id",paperId).order("order_index",{ascending:true}).order("created_at",{ascending:true});
   if(itemErr)throw itemErr;
   return reply({ok:true,paper,items:items||[],export_allowed:(manager||deputy)&&paper.status==="approved"});
  }
  if(action==="add_paper_item"&&teacher){
   const paperId=clean(body.paper_id),questionId=clean(body.question_id),points=Number(body.points);
   if(!Number.isFinite(points)||points<=0||points>100)return reply({message:"نمره سؤال باید بیشتر از صفر و حداکثر ۱۰۰ باشد."},400);
   const {data:paper,error:pErr}=await db.from("question_papers").select("id,subject,status").eq("tenant_school_id",school).eq("id",paperId).eq("created_by",auth.user.id).maybeSingle();
   if(pErr)throw pErr;if(!paper)return reply({message:"برگه متعلق به شما نیست."},403);
   if(!["draft","returned"].includes(paper.status))return reply({message:"پس از ارسال برای تأیید، امکان تغییر برگه وجود ندارد."},409);
   const {data:question,error:qErr}=await db.from("question_bank").select("id,subject,grade").eq("tenant_school_id",school).eq("id",questionId).eq("status","published").maybeSingle();
   if(qErr)throw qErr;if(!question)return reply({message:"سؤال منتشرشده پیدا نشد."},404);
   if(norm(question.subject)!==norm(paper.subject)||norm(question.grade)!==norm(paper.grade))return reply({message:"فقط سؤال‌های همان درس و همان پایه را می‌توانید به این برگه اضافه کنید."},400);
   const {data:existing,error:eErr}=await db.from("question_paper_items").select("id").eq("paper_id",paperId).eq("question_id",questionId).maybeSingle();
   if(eErr)throw eErr;
   if(existing){const {error}=await db.from("question_paper_items").update({points}).eq("id",existing.id);if(error)throw error;}
   else{
    const {data:positions,error:cErr}=await db.from("question_paper_items").select("order_index").eq("paper_id",paperId);
    if(cErr)throw cErr;if((positions||[]).length>=100)return reply({message:"هر برگه حداکثر ۱۰۰ سؤال می‌تواند داشته باشد."},400);
    const nextOrder=(positions||[]).reduce((max,item)=>Math.max(max,Number(item.order_index)+1),0);
    const {error}=await db.from("question_paper_items").insert({paper_id:paperId,question_id:questionId,points,order_index:nextOrder});
    if(error)throw error;
   }
   return reply({ok:true,message:"سؤال و نمره آن در برگه ذخیره شد."});
  }
  if(action==="remove_paper_item"&&teacher){
   const paperId=clean(body.paper_id),itemId=clean(body.item_id);
   const {data:paper,error:pErr}=await db.from("question_papers").select("id,status").eq("tenant_school_id",school).eq("id",paperId).eq("created_by",auth.user.id).maybeSingle();
   if(pErr)throw pErr;if(!paper)return reply({message:"برگه پیدا نشد."},404);
   if(!["draft","returned"].includes(paper.status))return reply({message:"این برگه قفل شده است."},409);
   const {error}=await db.from("question_paper_items").delete().eq("paper_id",paperId).eq("id",itemId);
   if(error)throw error;return reply({ok:true});
  }
  if(action==="submit_paper"&&teacher){
   const paperId=clean(body.paper_id);
   const {data:paper,error:pErr}=await db.from("question_papers").select("id,status").eq("tenant_school_id",school).eq("id",paperId).eq("created_by",auth.user.id).maybeSingle();
   if(pErr)throw pErr;if(!paper)return reply({message:"برگه پیدا نشد."},404);
   if(!["draft","returned"].includes(paper.status))return reply({message:"این برگه قبلاً ارسال شده یا تأیید نهایی شده است."},409);
   const {data:items,error:iErr}=await db.from("question_paper_items").select("points").eq("paper_id",paperId);
   if(iErr)throw iErr;if(!items?.length)return reply({message:"برای ارسال، دست‌کم یک سؤال انتخاب کنید."},400);
   const total=items.reduce((sum,item)=>sum+Number(item.points||0),0);
   if(total<=0||total>100)return reply({message:"مجموع نمره‌ها باید بیشتر از صفر و حداکثر ۱۰۰ باشد."},400);
   const {data,error}=await db.from("question_papers").update({status:"submitted",total_points:total,submitted_at:new Date().toISOString(),review_note:"",updated_at:new Date().toISOString()}).eq("id",paperId).in("status",["draft","returned"]).select("id").maybeSingle();
   if(error)throw error;if(!data)return reply({message:"وضعیت برگه تغییر کرده است؛ صفحه را تازه‌سازی کنید."},409);
   return reply({ok:true,message:"برگه برای تأیید نهایی مدیر یا معاون آموزشی ارسال شد."});
  }
  if(action==="review_paper"&&(manager||deputy)){
   const paperId=clean(body.paper_id),decision=clean(body.decision),noteText=clean(body.note);
   if(!["approve","return"].includes(decision))return reply({message:"تصمیم بررسی معتبر نیست."},400);
   if(decision==="return"&&!noteText)return reply({message:"برای بازگرداندن برگه، علت اصلاح را بنویسید."},400);
   const patch=decision==="approve"?{status:"approved",approved_by:auth.user.id,approved_at:new Date().toISOString(),review_note:"",updated_at:new Date().toISOString()}:{status:"returned",approved_by:null,approved_at:null,review_note:noteText,updated_at:new Date().toISOString()};
   const {data,error}=await db.from("question_papers").update(patch).eq("tenant_school_id",school).eq("id",paperId).eq("status","submitted").select("id").maybeSingle();
   if(error)throw error;if(!data)return reply({message:"فقط برگهٔ در انتظار تأیید قابل بررسی است."},409);
   return reply({ok:true,message:decision==="approve"?"برگه تأیید نهایی شد؛ خروجی فقط برای مدیر و معاون آموزشی فعال است.":"برگه برای اصلاح به دبیر بازگردانده شد."});
  }
  if(action==="get_approved_paper"&&(manager||deputy)){
   const paperId=clean(body.paper_id);
   const {data:paper,error}=await db.from("question_papers").select("id,title,subject,grade,status,total_points,created_by,approved_at").eq("tenant_school_id",school).eq("id",paperId).eq("status","approved").maybeSingle();
   if(error)throw error;if(!paper)return reply({message:"فقط برگهٔ تأییدشده برای خروجی قابل دریافت است."},404);
   const {data:items,error:itemErr}=await db.from("question_paper_items").select("points,order_index,question_bank(subject,grade,question_type,prompt,options)").eq("paper_id",paperId).order("order_index",{ascending:true}).order("created_at",{ascending:true});
   if(itemErr)throw itemErr;
   return reply({ok:true,paper,items:items||[],export_allowed:true});
  }
  if(action==="import_pdf"&&manager){
   if(body.source_permission_confirmed!==true)return reply({message:"برای ورود PDF باید مجوز استفاده از محتوا را تأیید کنید."},400);
   const sourceText=String(body.text||"").slice(0,180000);
   const subject=clean(body.subject);
   if(!subject)return reply({message:"نام درس الزامی است."},400);
   if(sourceText.length<20)return reply({message:"متن قابل استفاده‌ای از PDF دریافت نشد."},422);
   const chunks=parsePdfQuestions(sourceText,subject,500);
   if(!chunks.length)return reply({message:"سؤال شماره‌گذاری‌شده یا بخش‌بندی‌شده‌ای از متن PDF تشخیص داده نشد. برای جلوگیری از ورود اشتباه، چیزی ذخیره نشد؛ متن PDF و شماره‌گذاری را بررسی کنید.",imported:0},422);
   const grade=clean(body.grade),vaultByKey=new Map<string,any>();for(const q of chunks){const vault=await ensureVault(db,school,q.subject||subject,grade);if(!vault)throw new Error("مخزن درس و پایه ساخته نشد.");vaultByKey.set(vaultKey(q.subject||subject)+"|"+vaultKey(grade),vault);}
   const rows=chunks.map(q=>{const vault=vaultByKey.get(vaultKey(q.subject||subject)+"|"+vaultKey(grade));return {tenant_school_id:school,vault_id:vault.id,created_by:auth.user.id,subject:q.subject||subject,grade,prompt:q.prompt,question_type:q.question_type,options:q.options,correct_answer:q.correct_answer,source_url:clean(body.source_url),source_title:clean(body.file_name)||"ورود از PDF",source_license:clean(body.source_license),source_permission_confirmed:true,status:"published"};});
   const {data,error}=await db.from("question_bank").insert(rows).select("id");
   if(error)throw error;
   return reply({ok:true,imported:data?.length||0,vault_ids:[...new Set([...vaultByKey.values()].map(v=>v.id))],message:(data?.length||0)+" سؤال در مخزن‌های اختصاصی درس و پایه ذخیره شد."});
  }
  return reply({message:"این عملیات برای نقش شما مجاز نیست یا شناخته نشد."},403);
 }catch(error){console.error("question-bank error",error);return reply({message:"عملیات بانک سؤال انجام نشد؛ ساختار داده و دسترسی سرویس را بررسی کنید."},500);}
});
