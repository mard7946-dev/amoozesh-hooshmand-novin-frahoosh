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
    const [accountsResult, teacherAssignmentsResult] = await Promise.all([
      admin.from("account_settings").select("display_name,username,national_code,role,phone,auth_user_id").eq("tenant_school_id", schoolId).limit(2000),
      admin.from("teacher_classes").select("id,teacher_id,subject,grade,class_name,active").eq("tenant_school_id", schoolId).eq("active", 1).limit(5000),
    ]);
    if (accountsResult.error) return reply({ message: "اطلاعات حساب کاربران دریافت نشد." }, 500);
    if (teacherAssignmentsResult.error) {
      console.error("admin-manage-users teacher assignments failed", teacherAssignmentsResult.error.code);
      return reply({ message: "ارتباط دبیران با کلاس‌ها و درس‌ها دریافت نشد." }, 500);
    }
    const accountByNationalCode = new Map((accountsResult.data ?? []).map((a: any) => [clean(a.national_code), a]));
    const assignmentsByTeacher = new Map<number, any[]>();
    for (const assignment of teacherAssignmentsResult.data ?? []) {
      const teacherId = Number(assignment.teacher_id);
      if (!Number.isFinite(teacherId)) continue;
      const current = assignmentsByTeacher.get(teacherId) ?? [];
      current.push({ id: assignment.id, subject: assignment.subject, grade: assignment.grade, class_name: assignment.class_name, active: assignment.active });
      assignmentsByTeacher.set(teacherId, current);
    }
    const profile = (row: any, category: string) => {
      const account: any = accountByNationalCode.get(clean(row.national_code)) ?? {};
      const base = { ...row, category, display_name: [clean(row.first_name), clean(row.last_name)].filter(Boolean).join(" ") || clean(account.display_name) || clean(account.username) || "بدون نام", username: account.username ?? "", auth_user_id: account.auth_user_id ?? null, account_role: account.role ?? "" };
      return category === "teacher" ? { ...base, assigned_classes: (assignmentsByTeacher.get(Number(row.id)) ?? []).sort((a, b) => String(a.grade).localeCompare(String(b.grade), "fa") || String(a.class_name).localeCompare(String(b.class_name), "fa") || String(a.subject).localeCompare(String(b.subject), "fa")) } : base;
    };
    return reply({ profiles: [
      ...(studentsResult.data ?? []).map((x: any) => profile(x, "student")),
      ...(teachersResult.data ?? []).map((x: any) => profile(x, "teacher")),
      ...(staffResult.data ?? []).map((x: any) => profile(x, ["executive","educational","cultural","advisor","deputy","معاون","معاون اجرایی","معاون آموزشی","معاون پرورشی"].includes(clean(x.role).toLowerCase()) ? "deputy" : "staff")),
    ], schedules: schedulesResult.data ?? [] });
  }


  if (action === "import_parents") {
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length || rows.length > 1000) return reply({ message: "فایل اولیا باید بین ۱ تا ۱۰۰۰ ردیف داشته باشد." }, 400);
    const digits = (v: unknown) => clean(v).replace(/[۰-۹]/g, d => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
    const get = (raw: Record<string, unknown>, ...keys: string[]) => {
      for (const key of keys) if (raw[key] !== undefined && clean(raw[key])) return clean(raw[key]);
      return "";
    };
    const groups = new Map<string, { parentCode: string; parentName: string; phone: string; children: Array<{ code: string; row: number; name: string }> }>();
    const rowErrors: Array<{ row: number; success: false; message: string }> = [];
    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i] && typeof rows[i] === "object" ? rows[i] as Record<string, unknown> : {};
      const parentCode = digits(get(raw, "parent_national_code", "کد ملی ولی", "کد ملی سرپرست"));
      const parentName = get(raw, "parent_name", "نام ولی", "نام و نام خانوادگی ولی");
      const phone = digits(get(raw, "parent_phone", "شماره تماس ولی", "تلفن ولی"));
      const childCode = digits(get(raw, "student_national_code", "کد ملی دانش‌آموز", "کد ملی فرزند"));
      const childName = [get(raw, "student_first_name", "نام دانش‌آموز", "نام فرزند"), get(raw, "student_last_name", "نام خانوادگی دانش‌آموز", "نام خانوادگی فرزند")].filter(Boolean).join(" ");
      if (!/^\\d{10}$/.test(parentCode) || !parentName || !/^\\d{10}$/.test(childCode)) {
        rowErrors.push({ row: i + 2, success: false, message: "کد ملی ۱۰ رقمی ولی، نام ولی و کد ملی ۱۰ رقمی دانش‌آموز الزامی است." });
        continue;
      }
      const current = groups.get(parentCode);
      if (current) {
        if (current.parentName !== parentName || current.phone !== phone) {
          rowErrors.push({ row: i + 2, success: false, message: "اطلاعات ولی با ردیف‌های دیگر همین کد ملی یکسان نیست." });
          continue;
        }
        if (current.children.some(x => x.code === childCode)) {
          rowErrors.push({ row: i + 2, success: false, message: "این دانش‌آموز برای این ولی در فایل تکرار شده است." });
          continue;
        }
        current.children.push({ code: childCode, row: i + 2, name: childName });
      } else {
        groups.set(parentCode, { parentCode, parentName, phone, children: [{ code: childCode, row: i + 2, name: childName }] });
      }
    }
    const allChildCodes = [...new Set([...groups.values()].flatMap(g => g.children.map(c => c.code)))];
    const studentsResult = allChildCodes.length
      ? await admin.from("students").select("id,national_code,first_name,last_name,tenant_school_id").eq("tenant_school_id", schoolId).in("national_code", allChildCodes).limit(2000)
      : { data: [], error: null };
    if (studentsResult.error) return reply({ message: "بررسی کد ملی دانش‌آموزان انجام نشد." }, 500);
    const studentsByCode = new Map<string, any[]>();
    for (const student of studentsResult.data ?? []) {
      const code = digits(student.national_code);
      const list = studentsByCode.get(code) ?? [];
      list.push(student);
      studentsByCode.set(code, list);
    }
    const parentCodes = [...groups.keys()];
    const accountsResult = parentCodes.length
      ? await admin.from("account_settings").select("username,email,role,auth_user_id,tenant_school_id").eq("tenant_school_id", schoolId).in("username", parentCodes).limit(1000)
      : { data: [], error: null };
    if (accountsResult.error) return reply({ message: "بررسی حساب‌های قبلی اولیا انجام نشد." }, 500);
    const accountsByUsername = new Map((accountsResult.data ?? []).map((x: any) => [clean(x.username), x]));
    const results: Array<Record<string, unknown>> = [...rowErrors];
    for (const group of groups.values()) {
      const missing = group.children.filter(child => (studentsByCode.get(child.code) ?? []).length !== 1);
      if (missing.length) {
        results.push({ row: group.children[0].row, rows: group.children.map(x => x.row), success: false,
          message: "پرونده دانش‌آموز با کد ملی دقیقاً یک مورد در همین مدرسه پیدا نشد: " + missing.map(x => x.code).join("، ") });
        continue;
      }
      const students = group.children.map(child => (studentsByCode.get(child.code) ?? [])[0]);
      const email = group.parentCode + "@parent.frahoosh.invalid";
      const existing = accountsByUsername.get(group.parentCode);
      if (existing && (clean(existing.role) !== "parent" || clean(existing.email).toLowerCase() !== email || !clean(existing.auth_user_id))) {
        results.push({ row: group.children[0].row, rows: group.children.map(x => x.row), success: false,
          message: "کد ملی ولی قبلاً برای حساب دیگری ثبت شده است؛ برای جلوگیری از اتصال اشتباه، تغییری انجام نشد." });
        continue;
      }
      let authUserId = clean(existing?.auth_user_id);
      let temporaryPassword = "";
      let created = false;
      try {
        if (!existing) {
          const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
          const bytes = new Uint8Array(24);
          crypto.getRandomValues(bytes);
          temporaryPassword = Array.from(bytes, b => alphabet[b % alphabet.length]).join("");
          const { data: authCreated, error: authCreateError } = await admin.auth.admin.createUser({
            email, password: temporaryPassword, email_confirm: true,
            user_metadata: { username: group.parentCode, display_name: group.parentName, role: "parent", tenant_school_id: schoolId }
          });
          if (authCreateError || !authCreated.user) throw new Error("ساخت حساب ورود ولی انجام نشد.");
          authUserId = authCreated.user.id;
          created = true;
          const { error: accountError } = await admin.from("account_settings").insert({
            username: group.parentCode, display_name: group.parentName, phone: group.phone || null,
            email, national_code: group.parentCode, role: "parent", auth_user_id: authUserId,
            tenant_school_id: schoolId, preferences: "{}"
          });
          if (accountError) throw accountError;
          const { error: membershipError } = await admin.from("school_memberships").insert({
            auth_user_id: authUserId, school_id: schoolId, role: "parent", is_active: true
          });
          if (membershipError) throw membershipError;
        } else {
          const { error: updateError } = await admin.from("account_settings").update({
            display_name: group.parentName, phone: group.phone || null, updated_at: new Date().toISOString()
          }).eq("username", group.parentCode).eq("tenant_school_id", schoolId);
          if (updateError) throw updateError;
          const { data: membership, error: membershipReadError } = await admin.from("school_memberships")
            .select("id").eq("auth_user_id", authUserId).eq("school_id", schoolId).eq("role", "parent").maybeSingle();
          if (membershipReadError) throw membershipReadError;
          if (membership) {
            const { error } = await admin.from("school_memberships").update({ is_active: true, updated_at: new Date().toISOString() }).eq("id", membership.id);
            if (error) throw error;
          } else {
            const { error } = await admin.from("school_memberships").insert({ auth_user_id: authUserId, school_id: schoolId, role: "parent", is_active: true });
            if (error) throw error;
          }
        }
        const links = students.map((student: any) => ({
          parent_username: group.parentCode, student_id: student.id, tenant_school_id: schoolId
        }));
        const { error: linkError } = await admin.from("parent_children").upsert(links, {
          onConflict: "parent_username,student_id", ignoreDuplicates: true
        });
        if (linkError) throw linkError;
        results.push({
          row: group.children[0].row, rows: group.children.map(x => x.row), success: true,
          username: group.parentCode, created, temporary_password: created ? temporaryPassword : null,
          linked_students: students.map((s: any) => ({ id: s.id, name: [s.first_name, s.last_name].filter(Boolean).join(" ") }))
        });
      } catch (error) {
        if (created && authUserId) {
          await admin.from("parent_children").delete().eq("tenant_school_id", schoolId).eq("parent_username", group.parentCode);
          await admin.from("school_memberships").delete().eq("auth_user_id", authUserId).eq("school_id", schoolId);
          await admin.from("account_settings").delete().eq("username", group.parentCode).eq("tenant_school_id", schoolId);
          await admin.auth.admin.deleteUser(authUserId);
        }
        console.error("admin-manage-users import parents failed", String((error as any)?.code ?? "unknown"));
        results.push({ row: group.children[0].row, rows: group.children.map(x => x.row), success: false,
          message: "ساخت حساب یا اتصال فرزندان انجام نشد؛ اطلاعات این ولی ذخیره نشد." });
      }
    }
    const succeeded = results.filter(x => x.success).length;
    return reply({ success: true, total: rows.length, succeeded, failed: rows.length - succeeded, results });
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