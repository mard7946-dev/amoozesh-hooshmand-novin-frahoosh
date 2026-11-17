import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
});
const clean = (value: unknown, max = 240) => String(value ?? "").trim().slice(0, max);
const normalize = (value: unknown) => clean(value).replace(/[\u200c\u200f\u202a-\u202e]/g, "")
  .replace(/[ي]/g, "ی").replace(/[ك]/g, "ک").toLowerCase();
const managerRoles = new Set(["manager", "مدیر", "مدیر مدرسه", "مدیریت", "principal", "administrator", "admin"]);
const deputyRoles = new Set(["deputy", "معاون", "معاونت", "executive", "educational", "cultural",
  "executive_deputy", "educational_deputy", "pastoral_deputy", "معاون اجرایی", "معاون آموزشی",
  "معاون پرورشی", "معاونت اجرایی", "معاونت آموزشی", "معاونت پرورشی"]);
const studentRoles = new Set(["student", "دانش آموز", "دانش‌آموز", "دانشآموز"]);
function validDate(value: unknown) { const v = String(value ?? ""); if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false; const d = new Date(v + "T00:00:00Z"); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v; }
async function getStudentsForGrade(admin: any, schoolId: string, grade: string) {
  const all: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from("students").select("id,class_name")
      .eq("tenant_school_id", schoolId).eq("grade", grade).order("id", { ascending: true }).range(from, from + 999);
    if (error) throw error;
    const batch = data ?? []; all.push(...batch);
    if (batch.length < 1000) break;
  }
  return all;
}
function validatePlan(body: any) {
  const title = clean(body.title, 160), start = clean(body.start_date, 10), end = clean(body.end_date, 10);
  if (title.length < 2 || !validDate(start) || !validDate(end) || end < start) throw new Error("عنوان و بازهٔ زمانی معتبر وارد کنید.");
  if (!Array.isArray(body.allowed_weekdays) || !body.allowed_weekdays.length ||
      body.allowed_weekdays.some((d: unknown) => !Number.isInteger(d) || Number(d) < 0 || Number(d) > 6)) {
    throw new Error("روزهای مجاز امتحان را مشخص کنید.");
  }
  if (!Array.isArray(body.holidays) || body.holidays.some((d: unknown) => !validDate(d) || String(d) < start || String(d) > end)) {
    throw new Error("تاریخ تعطیلی باید معتبر و داخل بازهٔ امتحانات باشد.");
  }
  if (!Array.isArray(body.grade_plans) || body.grade_plans.length < 1 || body.grade_plans.length > 20) {
    throw new Error("حداقل یک پایه تعریف کنید.");
  }
  if (!Array.isArray(body.schedule) || body.schedule.length > 500) throw new Error("برنامهٔ تولیدشده معتبر نیست.");
  const grades = new Set<string>();
  for (const grade of body.grade_plans) {
    const name = clean(grade.grade, 40);
    if (!name || grades.has(name) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(clean(grade.start_time, 5)) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(clean(grade.end_time, 5)) ||
        grade.end_time <= grade.start_time || !Array.isArray(grade.subjects) || grade.subjects.length < 1 || grade.subjects.length > 80) {
      throw new Error("اطلاعات پایه، ساعت یا فهرست درس‌ها کامل و معتبر نیست.");
    }
    grades.add(name);
    const subjects = new Set<string>();
    for (const subject of grade.subjects) {
      const label = clean(subject.subject, 100);
      if (!label || subjects.has(label)) {
        throw new Error("نام درس‌ها باید کامل و یکتا باشند.");
      }
      subjects.add(label);
    }
  }
  const seen = new Set<string>(), gradeDays = new Set<string>();
  for (const item of body.schedule) {
    const grade = clean(item.grade, 40), subject = clean(item.subject, 100), date = clean(item.exam_date, 10);
    const key = grade + "|" + subject, dayKey = grade + "|" + date;
    const settings = body.grade_plans.find((g: any) => clean(g.grade, 40) === grade);
    const declared = settings?.subjects?.find((s: any) => clean(s.subject, 100) === subject);
    if (!grades.has(grade) || !validDate(date) || date < start || date > end ||
        seen.has(key) || gradeDays.has(dayKey) || !declared) {
      throw new Error("یکی از ردیف‌های برنامهٔ امتحانی نامعتبر، تکراری یا ناسازگار با فهرست درس‌ها است.");
    }
    seen.add(key);
    gradeDays.add(dayKey);
    if (body.holidays.includes(date) || !body.allowed_weekdays.includes(new Date(date + "T12:00:00Z").getUTCDay())) {
      throw new Error("برنامه شامل تاریخ تعطیل یا روز غیرمجاز است.");
    }
    if (!settings || clean(item.start_time, 5) !== clean(settings.start_time, 5) ||
        clean(item.end_time, 5) !== clean(settings.end_time, 5)) {
      throw new Error("ساعت یکی از امتحان‌ها با تنظیم ساعت پایه مطابقت ندارد.");
    }
  }
  const expected = body.grade_plans.reduce((n: number, g: any) => n + g.subjects.length, 0);
  if (body.schedule.length !== expected) throw new Error("تعداد درس‌های برنامه با فهرست درس‌های پایه‌ها برابر نیست.");
  return { title, start, end };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ message: "فقط درخواست POST پذیرفته می‌شود." }, 405);
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return reply({ message: "ابتدا وارد سامانه شوید." }, 401);
  const url = (Deno.env.get("SUPABASE_URL") ?? "").trim();
  let serviceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  const bundle = (Deno.env.get("SUPABASE_SECRET_KEYS") ?? "").trim();
  if (bundle) {
    try { const parsed = JSON.parse(bundle); const candidate = typeof parsed === "string" ? parsed : parsed.default ?? parsed.service_role ?? parsed.serviceRole ?? parsed.service_role_key; if (typeof candidate === "string" && candidate.trim()) serviceKey = candidate.trim(); }
    catch { if (bundle.startsWith("sb_secret_") || bundle.startsWith("eyJ")) serviceKey = bundle; }
  }
  if (!url || !serviceKey) return reply({ message: "تنظیمات امن سرویس کامل نیست." }, 503);
  try {
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: auth, error: authError } = await admin.auth.getUser(token);
    if (authError || !auth.user) return reply({ message: "نشست معتبر نیست؛ دوباره وارد شوید." }, 401);
    const { data: profile, error: profileError } = await admin.from("account_settings")
      .select("auth_user_id,role,national_code,tenant_school_id").eq("auth_user_id", auth.user.id).maybeSingle();
    if (profileError || !profile?.tenant_school_id) return reply({ message: "حساب به مدرسهٔ مشخصی متصل نیست." }, 403);
    const schoolId = String(profile.tenant_school_id);
    const { data: memberships, error: membershipError } = await admin.from("school_memberships")
      .select("role").eq("auth_user_id", auth.user.id).eq("school_id", schoolId).eq("is_active", true);
    if (membershipError || !memberships?.length) return reply({ message: "عضویت فعال در این مدرسه تأیید نشد." }, 403);
    const roles = new Set(memberships.map((m: any) => normalize(m.role)));
    const role = normalize(profile.role);
    const manager = managerRoles.has(role) && [...roles].some(r => managerRoles.has(r));
    const deputy = deputyRoles.has(role) && [...roles].some(r => deputyRoles.has(r));
    const student = studentRoles.has(role) && [...roles].some(r => studentRoles.has(r));
    const body = await req.json().catch(() => ({}));
    const action = clean(body.action, 40);

    if (action === "student_list") {
      if (!student) return reply({ message: "این بخش فقط برای دانش‌آموزان است." }, 403);
      const nationalCode = clean(profile.national_code, 20);
      if (!nationalCode) return reply({ message: "شناسهٔ دانش‌آموزی حساب پیدا نشد." }, 403);
      const { data: pupil, error: pupilError } = await admin.from("students")
        .select("id,grade,class_name").eq("tenant_school_id", schoolId).eq("national_code", nationalCode).maybeSingle();
      if (pupilError || !pupil) return reply({ message: "پروندهٔ دانش‌آموز در این مدرسه پیدا نشد." }, 404);
      const { data: plans, error } = await admin.from("school_exam_plans").select("id,title,start_date,end_date,schedule,published_at")
        .eq("school_id", schoolId).eq("status", "published").order("published_at", { ascending: false }).limit(50);
      if (error) throw error;
      const { data: seats, error: seatError } = await admin.from("exam_seats")
        .select("exam_name,seat_no").eq("tenant_school_id", schoolId).eq("student_id", pupil.id);
      if (seatError) throw seatError;
      const seatMap = new Map((seats ?? []).map((seat: any) => [seat.exam_name, seat.seat_no]));
      const schedules = (plans ?? []).flatMap((p: any) => (Array.isArray(p.schedule) ? p.schedule : [])
        .filter((item: any) => normalize(item.grade) === normalize(pupil.grade))
        .map((item: any) => {
          const examKey = p.id + "|" + clean(item.grade, 40) + "|" + clean(item.subject, 100) + "|" + clean(item.exam_date, 10);
          return { ...item, seat_no: seatMap.get(examKey) ?? null, plan_id: p.id, plan_title: p.title, period_start: p.start_date, period_end: p.end_date };
        }));
      return reply({ ok: true, student: { grade: pupil.grade, class_name: pupil.class_name }, schedules });
    }

    if (!manager && !deputy) return reply({ message: "فقط مدیر و معاونت مجاز به مدیریت برنامهٔ امتحانات هستند." }, 403);
    if (action === "grade_counts") {
      if (!Array.isArray(body.grades) || !body.grades.length || body.grades.length > 20) return reply({ message: "فهرست پایه‌ها معتبر نیست." }, 400);
      const unique = [...new Set(body.grades.map((g: unknown) => clean(g, 40)).filter(Boolean))];
      if (unique.length !== body.grades.length) return reply({ message: "نام پایه‌ها باید کامل و یکتا باشد." }, 400);
      const counts = [];
      for (const grade of unique) {
        const pupils = await getStudentsForGrade(admin, schoolId, grade);
        counts.push({ grade, student_count: pupils.length, seat_from: pupils.length ? 1 : null, seat_to: pupils.length || null, class_count: new Set(pupils.map((p: any) => clean(p.class_name, 80)).filter(Boolean)).size });
      }
      return reply({ ok: true, counts });
    }
    if (action === "list") {
      const { data, error } = await admin.from("school_exam_plans")
        .select("id,title,start_date,end_date,allowed_weekdays,holidays,grade_plans,schedule,status,published_at,updated_at")
        .eq("school_id", schoolId).order("updated_at", { ascending: false }).limit(50);
      if (error) throw error;
      return reply({ ok: true, plans: data ?? [], can_publish: manager });
    }
    if (action === "save") {
      const validated = validatePlan(body);
      const id = clean(body.id, 64);
      if (id) {
        const { data: existing, error: findError } = await admin.from("school_exam_plans")
          .select("id,status").eq("id", id).eq("school_id", schoolId).maybeSingle();
        if (findError) throw findError;
        if (!existing) return reply({ message: "برنامهٔ موردنظر در این مدرسه پیدا نشد." }, 404);
        if (existing.status !== "draft") return reply({ message: "برنامهٔ منتشرشده قفل است و بدون فرایند اصلاح مدیر تغییر نمی‌کند." }, 409);
        const { data, error } = await admin.from("school_exam_plans").update({
          title: validated.title, start_date: validated.start, end_date: validated.end,
          allowed_weekdays: body.allowed_weekdays, holidays: body.holidays,
          grade_plans: body.grade_plans, schedule: body.schedule, updated_at: new Date().toISOString(),
        }).eq("id", id).eq("school_id", schoolId).eq("status", "draft")
          .select("id,title,status,updated_at").single();
        if (error) throw error;
        return reply({ ok: true, plan: data });
      }
      const { data, error } = await admin.from("school_exam_plans").insert({
        school_id: schoolId, title: validated.title, start_date: validated.start, end_date: validated.end,
        allowed_weekdays: body.allowed_weekdays, holidays: body.holidays,
        grade_plans: body.grade_plans, schedule: body.schedule, status: "draft", created_by: auth.user.id,
      }).select("id,title,status,updated_at").single();
      if (error) throw error;
      return reply({ ok: true, plan: data });
    }
    if (action === "publish") {
      if (!manager) return reply({ message: "انتشار نهایی فقط با تأیید مدیر مدرسه انجام می‌شود." }, 403);
      const id = clean(body.id, 64);
      if (!id) return reply({ message: "شناسهٔ برنامه مشخص نیست." }, 400);
      const { data: plan, error: planError } = await admin.from("school_exam_plans")
        .select("id,title,grade_plans,schedule,status,start_date").eq("id", id).eq("school_id", schoolId).maybeSingle();
      if (planError) throw planError;
      if (!plan || plan.status !== "draft") return reply({ message: "برنامهٔ پیش‌نویس پیدا نشد یا قبلاً منتشر شده است." }, 409);
      const assignments: any[] = [];
      const previousSeatByGrade = new Map<string, Map<number, number>>();
      for (const item of (Array.isArray(plan.schedule) ? plan.schedule : [])) {
        const pupils = await getStudentsForGrade(admin, schoolId, clean(item.grade, 40));
        if (!pupils.length) throw new Error("برای پایه " + clean(item.grade, 40) + " دانش‌آموزی ثبت نشده است؛ انتشار متوقف شد.");
        const previous = previousSeatByGrade.get(clean(item.grade, 40)) ?? new Map<number, number>();
        let shuffled = [...pupils];
        const shuffle = (list: any[]) => {
          const copy = [...list];
          for (let i = copy.length - 1; i > 0; i--) {
            const bytes = new Uint32Array(1); crypto.getRandomValues(bytes);
            const j = bytes[0] % (i + 1); [copy[i], copy[j]] = [copy[j], copy[i]];
          }
          return copy;
        };
        if (previous.size) {
          let valid = false;
          for (let attempt = 0; attempt < 100 && !valid; attempt++) {
            shuffled = shuffle(pupils);
            valid = shuffled.every((pupil: any, index: number) => previous.get(pupil.id) !== index + 1);
          }
          if (!valid) {
            const ordered = [...pupils].sort((a: any, b: any) => (previous.get(a.id) ?? 0) - (previous.get(b.id) ?? 0));
            shuffled = ordered.reverse();
            if (shuffled.some((pupil: any, index: number) => previous.get(pupil.id) === index + 1)) {
              shuffled = [...pupils].sort((a: any, b: any) => a.id - b.id);
              const seats = shuffled.map((pupil: any) => ({ pupil, seat: ((previous.get(pupil.id) ?? 0) % pupils.length) + 1 }));
              seats.sort((a: any, b: any) => a.seat - b.seat);
              shuffled = seats.map((entry: any) => entry.pupil);
            }
          }
        }
        const next = new Map<number, number>();
        const examKey = plan.id + "|" + clean(item.grade, 40) + "|" + clean(item.subject, 100) + "|" + clean(item.exam_date, 10);
        shuffled.forEach((pupil: any, index: number) => {
          const seat = index + 1;
          next.set(pupil.id, seat);
          assignments.push({
            student_id: pupil.id, exam_name: examKey, seat_no: String(seat),
            subject: clean(item.subject, 100), exam_date: clean(item.exam_date, 10),
            class_name: clean(pupil.class_name, 80), tenant_school_id: schoolId,
          });
        });
        previousSeatByGrade.set(clean(item.grade, 40), next);
      }
      try {
        for (let offset = 0; offset < assignments.length; offset += 500) {
          const { error: insertError } = await admin.from("exam_seats").insert(assignments.slice(offset, offset + 500));
          if (insertError) throw insertError;
        }
      } catch (allocationError) {
        await admin.from("exam_seats").delete().eq("tenant_school_id", schoolId).like("exam_name", plan.id + "|%");
        throw allocationError;
      }
      const { data, error } = await admin.from("school_exam_plans").update({
        status: "published", published_by: auth.user.id, published_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq("id", id).eq("school_id", schoolId).eq("status", "draft")
        .select("id,title,status,published_at").maybeSingle();
      if (error || !data) {
        await admin.from("exam_seats").delete().eq("tenant_school_id", schoolId).like("exam_name", plan.id + "|%");
        if (error) throw error;
        return reply({ message: "انتشار برنامه انجام نشد؛ شماره‌های صندلی پاک‌سازی شدند." }, 409);
      }
      return reply({ ok: true, plan: data, allocated_seats: assignments.length });
    }
    return reply({ message: "عملیات درخواستی شناخته نشد." }, 400);
  } catch (error) {
    console.error("exam-planner failure", error);
    return reply({ message: error instanceof Error ? error.message : "عملیات برنامهٔ امتحانات ناموفق بود." }, 500);
  }
});
