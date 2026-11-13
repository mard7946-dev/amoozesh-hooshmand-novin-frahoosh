import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const clean = (v: unknown, max = 160) => String(v ?? "").replace(/[\u200c\u200f\u202a-\u202e]/g, "").trim().slice(0, max);
const allowedRoles = new Set(["executive", "manager"]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ message: "درخواست نامعتبر است." }, 405);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return reply({ message: "نشست ورود معتبر نیست؛ دوباره وارد شوید." }, 401);

  const url = (Deno.env.get("SUPABASE_URL") ?? "").trim();
  const serviceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  const anonKey = (Deno.env.get("SUPABASE_ANON_KEY") ?? req.headers.get("apikey") ?? "").trim();
  if (!url || !serviceKey || !anonKey) return reply({ message: "سرویس کارت آزمون موقتاً در دسترس نیست." }, 503);

  const authClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData.user) return reply({ message: "نشست ورود منقضی یا نامعتبر است." }, 401);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const userId = authData.user.id;
  const { data: profile, error: profileError } = await admin.from("account_settings")
    .select("tenant_school_id,role").eq("auth_user_id", userId).maybeSingle();
  if (profileError || !profile?.tenant_school_id) return reply({ message: "اتصال حساب به مدرسه تأیید نشد." }, 403);

  const { data: memberships, error: membershipError } = await admin.from("school_memberships")
    .select("role").eq("school_id", profile.tenant_school_id).eq("auth_user_id", userId).eq("is_active", true);
  if (membershipError) return reply({ message: "بررسی سمت سازمانی انجام نشد." }, 503);
  const roles = new Set((memberships ?? []).map((m: any) => String(m.role ?? "").trim().toLowerCase()));
  if (!allowedRoles.has(String(profile.role ?? "").trim().toLowerCase()) &&
      ![...roles].some(r => allowedRoles.has(r))) {
    return reply({ message: "صدور کارت آزمون فقط برای معاون اجرایی و مدیر مدرسه مجاز است." }, 403);
  }

  const body = await req.json().catch(() => ({}));
  const action = clean(body?.action, 30);
  const schoolId = profile.tenant_school_id;
  const period = clean(body?.exam_period || "نوبت اول", 50) || "نوبت اول";

  try {
    if (action === "bootstrap") {
      const { data: students, error: studentsError } = await admin.from("students")
        .select("id,first_name,last_name,father_name,grade,class_name,photo")
        .eq("tenant_school_id", schoolId)
        .order("grade", { ascending: true }).order("class_name", { ascending: true }).order("last_name", { ascending: true });
      if (studentsError) throw studentsError;
      const { data: cards, error: cardsError } = await admin.from("exam_entry_cards")
        .select("id,student_id,exam_period,first_name,last_name,father_name,grade,class_name,seat_number,photo_data,updated_at")
        .eq("school_id", schoolId).eq("exam_period", period);
      if (cardsError) throw cardsError;
      return reply({ ok: true, students: students ?? [], cards: cards ?? [], exam_period: period });
    }

    if (action === "save") {
      const c = body?.card ?? {};
      const studentId = Number(c.student_id);
      if (!Number.isInteger(studentId) || studentId <= 0) return reply({ message: "دانش‌آموز انتخاب‌شده معتبر نیست." }, 400);
      const { data: student, error: studentError } = await admin.from("students")
        .select("id").eq("id", studentId).eq("tenant_school_id", schoolId).maybeSingle();
      if (studentError || !student) return reply({ message: "این دانش‌آموز به مدرسه شما تعلق ندارد." }, 403);

      const firstName = clean(c.first_name, 80), lastName = clean(c.last_name, 100);
      const fatherName = clean(c.father_name, 100), grade = clean(c.grade, 40);
      const className = clean(c.class_name, 60), seatNumber = clean(c.seat_number, 20);
      const photoData = typeof c.photo_data === "string" ? c.photo_data : null;
      if (!firstName || !lastName || !fatherName || !grade || !className || !seatNumber) {
        return reply({ message: "نام، نام خانوادگی، نام پدر، پایه، کلاس و شماره صندلی الزامی است." }, 400);
      }
      if (photoData && (photoData.length > 500000 || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(photoData))) {
        return reply({ message: "عکس باید JPG، PNG یا WebP و حداکثر ۳۵۰ کیلوبایت باشد." }, 400);
      }
      const payload = {
        school_id: schoolId, student_id: studentId, exam_period: period,
        first_name: firstName, last_name: lastName, father_name: fatherName,
        grade, class_name: className, seat_number: seatNumber, photo_data: photoData,
        created_by: userId, updated_at: new Date().toISOString(),
      };
      const { data: saved, error: saveError } = await admin.from("exam_entry_cards")
        .upsert(payload, { onConflict: "school_id,student_id,exam_period" })
        .select("id,student_id,exam_period,first_name,last_name,father_name,grade,class_name,seat_number,photo_data,updated_at")
        .single();
      if (saveError) {
        if (saveError.code === "23505") return reply({ message: "شماره صندلی برای دانش‌آموز دیگری ثبت شده است." }, 409);
        throw saveError;
      }
      return reply({ ok: true, card: saved, message: "مشخصات کارت ذخیره شد." });
    }

    if (action === "save_many") {
      const items = Array.isArray(body?.cards) ? body.cards : [];
      if (!items.length || items.length > 300) return reply({ message: "فهرست کلاس خالی یا بیش از حد مجاز است." }, 400);
      const ids = items.map((c: any) => Number(c.student_id)).filter((n: number) => Number.isInteger(n) && n > 0);
      if (ids.length !== items.length || new Set(ids).size !== ids.length) return reply({ message: "فهرست دانش‌آموزان معتبر نیست." }, 400);
      const { data: students, error: studentError } = await admin.from("students").select("id")
        .eq("tenant_school_id", schoolId).in("id", ids);
      if (studentError) throw studentError;
      if ((students ?? []).length !== ids.length) return reply({ message: "حداقل یک دانش‌آموز به این مدرسه تعلق ندارد." }, 403);
      const rows = items.map((c: any) => ({
        school_id: schoolId, student_id: Number(c.student_id), exam_period: period,
        first_name: clean(c.first_name, 80), last_name: clean(c.last_name, 100),
        father_name: clean(c.father_name, 100), grade: clean(c.grade, 40),
        class_name: clean(c.class_name, 60), seat_number: clean(c.seat_number, 20),
        photo_data: typeof c.photo_data === "string" ? c.photo_data : null,
        created_by: userId, updated_at: new Date().toISOString(),
      }));
      if (rows.some((r: any) => !r.first_name || !r.last_name || !r.father_name || !r.grade || !r.class_name || !r.seat_number)) {
        return reply({ message: "برای همه دانش‌آموزان نام، نام خانوادگی، نام پدر، پایه، کلاس و شماره صندلی را کامل کنید." }, 400);
      }
      if (rows.some((r: any) => r.photo_data && (r.photo_data.length > 500000 || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(r.photo_data)))) {
        return reply({ message: "یکی از عکس‌ها معتبر نیست یا از حد مجاز بزرگ‌تر است." }, 400);
      }
      const seats = rows.map((r: any) => r.seat_number);
      if (new Set(seats).size !== seats.length) return reply({ message: "شماره صندلی تکراری در همین فهرست وجود دارد." }, 409);
      const { error: saveError } = await admin.from("exam_entry_cards")
        .upsert(rows, { onConflict: "school_id,student_id,exam_period" });
      if (saveError) {
        if (saveError.code === "23505") return reply({ message: "یکی از شماره‌های صندلی قبلاً برای دانش‌آموز دیگری ثبت شده است." }, 409);
        throw saveError;
      }
      return reply({ ok: true, saved_count: rows.length, message: "کارت‌های این فهرست ذخیره شدند." });
    }

    return reply({ message: "عملیات ناشناخته است." }, 400);
  } catch (error) {
    console.error("exam-entry-cards error", String(error));
    return reply({ message: "ذخیره یا دریافت کارت‌ها انجام نشد؛ دوباره تلاش کنید." }, 500);
  }
});
