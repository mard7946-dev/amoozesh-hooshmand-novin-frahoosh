import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const clean = (v: unknown) => String(v ?? "").trim();
const managerRoles = ["manager", "مدیر", "مدیریت", "principal", "administrator", "admin"];
const assignableRoles = ["teacher", "student", "parent", "executive", "educational", "cultural", "advisor"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ message: "درخواست نامعتبر است." }, 405);
  const bearer = req.headers.get("Authorization") ?? "";
  if (!bearer.startsWith("Bearer ")) return reply({ message: "ابتدا وارد سامانه شوید." }, 401);

  const url = (Deno.env.get("SUPABASE_URL") ?? "").trim();
  let serviceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  const bundleRaw = (Deno.env.get("SUPABASE_SECRET_KEYS") ?? "").trim();
  if (bundleRaw) {
    try {
      const parsed = JSON.parse(bundleRaw);
      const candidate = typeof parsed === "string" ? parsed : parsed.default ?? parsed.service_role ?? parsed.serviceRole ?? parsed.service_role_key;
      if (typeof candidate === "string" && candidate.trim()) serviceKey = candidate.trim();
    } catch (_) {
      if (bundleRaw.startsWith("sb_secret_") || bundleRaw.startsWith("eyJ")) serviceKey = bundleRaw;
    }
  }
  if (!url || !serviceKey) return reply({ message: "تنظیمات امن سرویس کامل نیست." }, 503);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error: authError } = await admin.auth.getUser(bearer.slice(7));
  if (authError || !auth.user) return reply({ message: "نشست ورود معتبر نیست؛ دوباره وارد شوید." }, 401);

  const { data: caller, error: callerError } = await admin.from("account_settings")
    .select("auth_user_id,role,tenant_school_id").eq("auth_user_id", auth.user.id).maybeSingle();
  if (callerError || !caller) return reply({ message: "حساب مدیریت پیدا نشد." }, 403);
  if (!managerRoles.includes(clean(caller.role).toLowerCase())) return reply({ message: "فقط مدیر سامانه اجازه مدیریت کاربران این مدرسه را دارد." }, 403);
  const schoolId = clean(caller.tenant_school_id);
  if (!schoolId) return reply({ message: "شناسه مدرسه برای حساب مدیر ثبت نشده است." }, 409);
  const { data: managerMembership, error: managerMembershipError } = await admin.from("school_memberships")
    .select("id").eq("auth_user_id", auth.user.id).eq("school_id", schoolId).eq("role", "manager").eq("is_active", true).maybeSingle();
  if (managerMembershipError || !managerMembership) return reply({ message: "عضویت فعال مدیر برای این مدرسه تأیید نشد." }, 403);

  const body = await req.json().catch(() => ({}));
  const action = clean(body.action || "list");
  if (action === "list") {
    const { data: accounts, error } = await admin.from("account_settings")
      .select("username,display_name,role,auth_user_id,national_code,phone,tenant_school_id")
      .eq("tenant_school_id", schoolId).order("display_name", { ascending: true }).limit(500);
    if (error) {
      console.error("admin-manage-users list failed", error.code);
      return reply({ message: "فهرست کاربران دریافت نشد." }, 500);
    }
    const ids = (accounts ?? []).map((x: { auth_user_id?: string | null }) => x.auth_user_id).filter(Boolean);
    let memberships: Array<{ auth_user_id: string; role: string; is_active: boolean }> = [];
    if (ids.length) {
      const { data, error: membershipError } = await admin.from("school_memberships")
        .select("auth_user_id,role,is_active").eq("school_id", schoolId).in("auth_user_id", ids).limit(1000);
      if (membershipError) {
        console.error("admin-manage-users memberships failed", membershipError.code);
        return reply({ message: "وضعیت عضویت کاربران دریافت نشد." }, 500);
      }
      memberships = data ?? [];
    }
    const activeById = new Map(memberships.map((m) => [m.auth_user_id, m.is_active]));
    return reply({ users: (accounts ?? []).map((a: Record<string, unknown>) => ({
      username: a.username, display_name: a.display_name, role: a.role,
      auth_user_id: a.auth_user_id, national_code: a.national_code, phone: a.phone,
      is_active: a.auth_user_id ? (activeById.get(String(a.auth_user_id)) ?? false) : false,
    })) });
  }


  if (action === "list_profiles") {
    const [studentsResult, teachersResult, staffResult, schedulesResult] = await Promise.all([
      admin.from("students").select("id,first_name,last_name,national_code,student_code,grade,class_name,phone,parent_phone,father_name,religion,sect,email,address,birth_date").eq("tenant_school_id", schoolId).order("last_name").limit(2000),
      admin.from("teachers").select("id,first_name,last_name,national_code,phone,mobile,email,subject,grades,employee_code,father_name,religion,sect,description").eq("tenant_school_id", schoolId).order("last_name").limit(1000),
      admin.from("staff").select("id,first_name,last_name,national_code,phone,role,employee_code,father_name,religion,sect,description,employment_status").eq("tenant_school_id", schoolId).order("last_name").limit(1000),
      admin.from("generated_weekly_schedule").select("id,teacher,subject,grade,class_name,weekday,bell,week_index").eq("tenant_school_id", schoolId).limit(5000),
    ]);
    const failed = [studentsResult, teachersResult, staffResult, schedulesResult].find((x) => x.error);
    if (failed) return reply({ message: "اطلاعات پرونده‌ها یا برنامه هفتگی دریافت نشد." }, 500);
    const accountsResult = await admin.from("account_settings").select("display_name,username,national_code,role,phone,auth_user_id").eq("tenant_school_id", schoolId).limit(2000);
    if (accountsResult.error) return reply({ message: "اطلاعات حساب کاربران دریافت نشد." }, 500);
    const accountByNationalCode = new Map((accountsResult.data ?? []).map((a: any) => [clean(a.national_code), a]));
    const profile = (row: any, category: string) => {
      const account: any = accountByNationalCode.get(clean(row.national_code)) ?? {};
      return { ...row, category, display_name: [clean(row.first_name), clean(row.last_name)].filter(Boolean).join(" ") || clean(account.display_name) || clean(account.username) || "بدون نام", username: account.username ?? "", auth_user_id: account.auth_user_id ?? null, account_role: account.role ?? "" };
    };
    return reply({ profiles: [
      ...(studentsResult.data ?? []).map((x: any) => profile(x, "student")),
      ...(teachersResult.data ?? []).map((x: any) => profile(x, "teacher")),
      ...(staffResult.data ?? []).filter((x: any) => ["executive","educational","cultural","advisor","deputy","معاون","معاون اجرایی","معاون آموزشی","معاون پرورشی"].includes(clean(x.role).toLowerCase())).map((x: any) => profile(x, "deputy")),
    ], schedules: schedulesResult.data ?? [] });
  }

  if (action === "import_profiles") {
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length || rows.length > 1000) return reply({ message: "فایل اطلاعات باید بین ۱ تا ۱۰۰۰ ردیف داشته باشد." }, 400);
    const digits = (v: unknown) => clean(v).replace(/[۰-۹]/g, d => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
    const roleOf = (v: unknown) => { const s=clean(v).toLowerCase().replace(/\s+/g," "); if(["student","دانش‌آموز","دانش آموز"].includes(s))return "student"; if(["teacher","دبیر","دبیران","معلم"].includes(s))return "teacher"; if(["executive","معاون اجرایی","معاون","معاونین"].includes(s))return "executive"; if(["educational","معاون آموزشی"].includes(s))return "educational"; if(["cultural","معاون پرورشی"].includes(s))return "cultural"; if(["advisor","مشاور"].includes(s))return "advisor"; return ""; };
    const results: Array<{row:number;success:boolean;message?:string}> = [];
    for(let i=0;i<rows.length;i++){
      const raw=rows[i]&&typeof rows[i]==="object"?rows[i] as Record<string,unknown>:{};
      const get=(...keys:string[])=>{for(const k of keys)if(raw[k]!==undefined&&clean(raw[k]))return clean(raw[k]);return "";};
      const role=roleOf(get("category","role","گروه","نقش")), national=digits(get("national_code","کد ملی")), first=get("first_name","نام"), last=get("last_name","نام خانوادگی");
      if(!role||!national||!first||!last){results.push({row:i+2,success:false,message:"گروه، کد ملی، نام و نام خانوادگی الزامی است."});continue;}
      try{
        const common:any={first_name:first,last_name:last,national_code:national,phone:get("phone","شماره تماس","تلفن")||null,religion:get("religion","دین")||null,sect:get("sect","مذهب")||null,father_name:get("father_name","نام پدر")||null,tenant_school_id:schoolId};
        let table="",payload:any={...common};
        if(role==="student"){table="students";payload={...payload,student_code:get("student_code","شماره دانش‌آموزی")||null,grade:get("grade","پایه")||null,class_name:get("class_name","کلاس","نام کلاس","پایه و کلاس")||null,parent_phone:get("parent_phone","شماره تماس اولیا","تلفن اولیا")||null,mother_name:get("mother_name","نام مادر")||null,birth_date:get("birth_date","تاریخ تولد")||null,email:get("email","ایمیل")||null,address:get("address","نشانی","آدرس")||null};}
        else if(role==="teacher"){table="teachers";payload={...payload,mobile:get("mobile","موبایل")||get("phone","شماره تماس")||null,email:get("email","ایمیل")||null,subject:get("subject","درس")||null,grades:get("grades","پایه‌های تدریس")||null,employee_code:get("employee_code","کد پرسنلی")||null,description:get("description","توضیحات")||null};}
        else{table="staff";payload={...payload,role,employee_code:get("employee_code","کد پرسنلی")||null,employment_status:get("employment_status","وضعیت استخدام")||null,description:get("description","توضیحات")||null};}
        const existing=await admin.from(table).select("id").eq("tenant_school_id",schoolId).eq("national_code",national).maybeSingle();if(existing.error)throw existing.error;
        const write=existing.data?await admin.from(table).update(payload).eq("id",existing.data.id).eq("tenant_school_id",schoolId):await admin.from(table).insert(payload);if(write.error)throw write.error;
        results.push({row:i+2,success:true});
      }catch(e){results.push({row:i+2,success:false,message:String((e as any)?.message??"ذخیره ناموفق بود.")});}
    }
    return reply({success:true,total:rows.length,succeeded:results.filter(x=>x.success).length,failed:results.filter(x=>!x.success).length,results});
  }

  if (action === "import_schedule") {
    const rows=Array.isArray(body.rows)?body.rows:[];if(!rows.length||rows.length>3000)return reply({message:"فایل برنامه باید بین ۱ تا ۳۰۰۰ ردیف داشته باشد."},400);
    const digits=(v:unknown)=>clean(v).replace(/[۰-۹]/g,d=>String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٠-٩]/g,d=>String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
    const results:Array<{row:number;success:boolean;message?:string}>=[];
    for(let i=0;i<rows.length;i++){
      const raw=rows[i]&&typeof rows[i]==="object"?rows[i] as Record<string,unknown>:{};
      const val=(...keys:string[])=>{for(const k of keys)if(raw[k]!==undefined&&clean(raw[k]))return clean(raw[k]);return "";};
      const className=val("class_name","کلاس","نام کلاس","پایه و کلاس"),weekday=val("weekday","روز","روز هفته","روز هفته تحصیلی"),subject=val("subject","درس","نام درس"),teacherName=val("teacher","teacher_name","نام دبیر","دبیر","نام و نام خانوادگی دبیر"),period=Number(digits(val("period","زنگ","شماره زنگ","ساعت تدریس","bell"))),grade=val("grade","پایه")||className.split("/")[0]||"",bell=val("bell","زنگ","شماره زنگ","period")||String(period||"");
      if(!className||!weekday||!subject||!teacherName||!Number.isInteger(period)||period<1||period>12){results.push({row:i+2,success:false,message:"کلاس، روز، درس، نام دبیر و شماره زنگ ۱ تا ۱۲ الزامی است."});continue;}
      try{
        const row={teacher:teacherName,subject,grade,class_name:className,weekday,bell,week_index:Number(digits(val("week_index","هفته")))||1,created_at:new Date().toISOString(),tenant_school_id:schoolId};
        const existing=await admin.from("generated_weekly_schedule").select("id").eq("tenant_school_id",schoolId).eq("class_name",className).eq("weekday",weekday).eq("bell",bell).eq("subject",subject).eq("teacher",teacherName).maybeSingle();if(existing.error)throw existing.error;
        const write=existing.data?await admin.from("generated_weekly_schedule").update(row).eq("id",existing.data.id).eq("tenant_school_id",schoolId):await admin.from("generated_weekly_schedule").insert(row);if(write.error)throw write.error;
        results.push({row:i+2,success:true});
      }catch(e){results.push({row:i+2,success:false,message:String((e as any)?.message??"ذخیره برنامه ناموفق بود.")});}
    }
    return reply({success:true,total:rows.length,succeeded:results.filter(x=>x.success).length,failed:results.filter(x=>!x.success).length,results});
  }

  const targetId = clean(body.auth_user_id);
  if (!targetId || targetId === auth.user.id) return reply({ message: "حساب هدف نامعتبر است." }, 400);
  const { data: target, error: targetError } = await admin.from("account_settings")
    .select("auth_user_id,role,tenant_school_id,username").eq("auth_user_id", targetId).maybeSingle();
  if (targetError || !target) return reply({ message: "کاربر هدف پیدا نشد." }, 404);
  if (clean(target.tenant_school_id) !== schoolId) return reply({ message: "امکان تغییر کاربران مدرسه دیگر وجود ندارد." }, 403);
  if (managerRoles.includes(clean(target.role).toLowerCase())) return reply({ message: "تغییر یا غیرفعال‌سازی حساب مدیریتی از این بخش مجاز نیست." }, 403);

  if (action === "set_role") {
    const role = clean(body.role);
    if (!assignableRoles.includes(role)) return reply({ message: "نقش انتخاب‌شده مجاز نیست." }, 400);
    const { error: accountUpdateError } = await admin.from("account_settings")
      .update({ role, updated_at: new Date().toISOString() }).eq("auth_user_id", targetId).eq("tenant_school_id", schoolId);
    if (accountUpdateError) {
      console.error("admin-manage-users role update failed", accountUpdateError.code);
      return reply({ message: "نقش کاربر ذخیره نشد." }, 500);
    }
    const { data: membership, error: membershipReadError } = await admin.from("school_memberships")
      .select("id").eq("auth_user_id", targetId).eq("school_id", schoolId).maybeSingle();
    if (membershipReadError) return reply({ message: "نقش ذخیره شد، اما همگام‌سازی عضویت کامل نشد؛ بررسی لازم است." }, 500);
    const membershipWrite = membership
      ? await admin.from("school_memberships").update({ role, updated_at: new Date().toISOString() }).eq("id", membership.id)
      : await admin.from("school_memberships").insert({ auth_user_id: targetId, school_id: schoolId, role, is_active: true });
    if (membershipWrite.error) {
      console.error("admin-manage-users membership role update failed", membershipWrite.error.code);
      return reply({ message: "نقش حساب تغییر کرد اما عضویت همگام نشد؛ لطفاً وضعیت را بررسی کنید." }, 500);
    }
    return reply({ success: true, message: "نقش کاربر ذخیره شد." });
  }

  if (action === "set_active") {
    const isActive = body.is_active === true;
    const { data: membership, error: membershipReadError } = await admin.from("school_memberships")
      .select("id").eq("auth_user_id", targetId).eq("school_id", schoolId).maybeSingle();
    if (membershipReadError) return reply({ message: "وضعیت عضویت بررسی نشد." }, 500);
    if (membership) {
      const { error } = await admin.from("school_memberships")
        .update({ is_active: isActive, updated_at: new Date().toISOString() }).eq("id", membership.id);
      if (error) return reply({ message: "وضعیت کاربر ذخیره نشد." }, 500);
    } else {
      const role = clean(target.role);
      if (!assignableRoles.includes(role)) return reply({ message: "نقش این کاربر نیازمند بررسی مدیر سامانه است." }, 409);
      const { error } = await admin.from("school_memberships")
        .insert({ auth_user_id: targetId, school_id: schoolId, role, is_active: isActive });
      if (error) return reply({ message: "وضعیت عضویت ذخیره نشد." }, 500);
    }
    return reply({ success: true, message: isActive ? "دسترسی کاربر فعال شد." : "دسترسی کاربر در این مدرسه غیرفعال شد." });
  }
  return reply({ message: "عملیات پشتیبانی نمی‌شود." }, 400);
});