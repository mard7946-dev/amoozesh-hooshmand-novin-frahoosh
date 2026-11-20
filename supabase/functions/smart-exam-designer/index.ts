import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const clean = (value: unknown, max = 12000) => String(value ?? "").trim().slice(0, max);
const normalize = (value: unknown) => clean(value, 200)
  .replace(/[\u200c\u200f\u202a-\u202e]/g, "")
  .replace(/ي/g, "ی").replace(/ك/g, "ک").toLocaleLowerCase("fa");

const questionTypes = new Set([
  "multiple_choice", "true_false", "fill_blank", "short_answer", "essay",
  "problem", "equation", "grammar", "vocabulary", "synonym_antonym",
  "translation", "other",
]);
const sourceTypes = new Set(["official_reference", "ai_generated", "teacher_authored", "permitted_external"]);

function validatePayload(raw: unknown) {
  if (!raw || typeof raw !== "object") throw new Error("اطلاعات آزمون معتبر نیست.");
  const source = raw as Record<string, unknown>;
  const rawHeader = source.header && typeof source.header === "object" ? source.header as Record<string, unknown> : {};
  const header = {
    class_name: clean(rawHeader.class_name, 80),
    teacher_name: clean(rawHeader.teacher_name, 100),
    exam_date: clean(rawHeader.exam_date, 24),
    duration_minutes: clean(rawHeader.duration_minutes, 4),
  };
  if (!Array.isArray(source.questions) || source.questions.length < 1 || source.questions.length > 100) {
    throw new Error("هر آزمون باید بین ۱ تا ۱۰۰ سؤال داشته باشد.");
  }
  let total = 0;
  const questions = source.questions.map((entry, index) => {
    if (!entry || typeof entry !== "object") throw new Error("ساختار سؤال " + (index + 1) + " معتبر نیست.");
    const q = entry as Record<string, unknown>;
    const prompt = clean(q.prompt);
    const type = clean(q.question_type, 60);
    const points = Number(q.points);
    const origin = clean(q.source_origin, 60);
    if (!prompt || !questionTypes.has(type)) throw new Error("متن یا نوع سؤال " + (index + 1) + " معتبر نیست.");
    if (!Number.isFinite(points) || points <= 0 || points > 100) throw new Error("بارم سؤال " + (index + 1) + " باید بیشتر از صفر و حداکثر ۱۰۰ باشد.");
    if (!sourceTypes.has(origin)) throw new Error("منشأ سؤال " + (index + 1) + " را مشخص کنید.");
    const sourceUrl = clean(q.source_url, 1000);
    const sourceTitle = clean(q.source_title, 240);
    const permission = q.source_permission_confirmed === true;
    if (origin === "official_reference") {
      let host = "";
      try { host = new URL(sourceUrl).hostname.toLowerCase(); } catch { /* invalid URL */ }
      if (!sourceTitle || !sourceUrl || !(host === "chap.sch.ir" || host.endsWith(".chap.sch.ir"))) {
        throw new Error("برای سؤال مستند، عنوان منبع و نشانی رسمی chap.sch.ir لازم است.");
      }
    }
    if (origin === "permitted_external" && (!sourceUrl || !sourceTitle || !permission)) {
      throw new Error("برای منبع بیرونی، نشانی، عنوان و تأیید مجوز استفاده لازم است.");
    }
    if (origin === "ai_generated" && (sourceUrl || sourceTitle)) {
      throw new Error("سؤال تولیدشده با هوش مصنوعی نباید به‌عنوان سؤال برگرفته از منبع ثبت شود.");
    }
    total += points;
    return {
      order: index + 1,
      question_type: type,
      difficulty: ["easy", "medium", "hard"].includes(clean(q.difficulty)) ? clean(q.difficulty) : "medium",
      prompt,
      options: Array.isArray(q.options) ? q.options.slice(0, 8).map(x => clean(x, 1000)) : [],
      correct_answer: clean(q.correct_answer, 4000),
      explanation: clean(q.explanation, 4000),
      points,
      source_origin: origin,
      source_url: sourceUrl,
      source_title: sourceTitle,
      source_license: clean(q.source_license, 500),
      source_permission_confirmed: permission,
    };
  });
  if (total > 100) throw new Error("مجموع بارم آزمون نباید از ۱۰۰ بیشتر شود.");
  return { header, questions, total_points: Number(total.toFixed(2)) };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ message: "درخواست نامعتبر است." }, 405);

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return reply({ message: "ابتدا وارد سامانه شوید." }, 401);
  const url = (Deno.env.get("SUPABASE_URL") || "").trim();
  const serviceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
  if (!url || !serviceKey) return reply({ message: "سرویس طراحی هوشمند آزمون آماده نیست." }, 503);

  try {
    const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: auth, error: authError } = await db.auth.getUser(token);
    if (authError || !auth.user) return reply({ message: "نشست معتبر نیست." }, 401);

    const { data: profile, error: profileError } = await db.from("account_settings")
      .select("role,tenant_school_id,display_name")
      .eq("auth_user_id", auth.user.id).maybeSingle();
    if (profileError || !profile?.tenant_school_id) return reply({ message: "پروفایل مدرسه تأیید نشد." }, 403);

    const { data: memberships, error: membershipError } = await db.from("school_memberships")
      .select("role").eq("school_id", profile.tenant_school_id)
      .eq("auth_user_id", auth.user.id).eq("is_active", true);
    if (membershipError) return reply({ message: "بررسی عضویت مدرسه ناموفق بود." }, 503);

    const profileRole = normalize(profile.role);
    const memberRoles = new Set((memberships || []).map((item: { role: string }) => normalize(item.role)));
    const manager = ["manager", "مدیر", "school_manager"].includes(profileRole) && memberRoles.has("manager");
    const executive = ["executive", "executive_deputy", "معاون اجرایی"].includes(profileRole) &&
      (memberRoles.has("executive") || memberRoles.has("executive_deputy"));
    const teacher = ["teacher", "دبیر", "معلم"].includes(profileRole) && memberRoles.has("teacher");
    if (!manager && !executive && !teacher) {
      return reply({ message: "این نقش به طراحی یا مخزن محرمانه آزمون دسترسی ندارد." }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const action = clean(body.action, 80);
    const schoolId = profile.tenant_school_id;
    const actorId = auth.user.id;

    if (action === "bootstrap") {
      if (teacher) {
        const { data, error } = await db.from("smart_exam_papers")
          .select("id,title,subject,grade,book_title,book_edition,chapter,lesson,topic,status,total_points,submitted_at,created_at,updated_at")
          .eq("tenant_school_id", schoolId).eq("created_by", actorId)
          .order("updated_at", { ascending: false }).limit(100);
        if (error) throw error;
        return reply({ ok: true, role: "teacher", papers: data || [] });
      }
      const { data, error } = await db.from("smart_exam_vault")
        .select("paper_id,title,subject,grade,book_title,book_edition,chapter,lesson,topic,total_points,status,finalized_at,archived_at")
        .eq("tenant_school_id", schoolId)
        .order("finalized_at", { ascending: false }).limit(200);
      if (error) throw error;
      return reply({ ok: true, role: manager ? "manager" : "executive", vault: data || [] });
    }

    if (action === "save_draft" && teacher) {
      const paperId = clean(body.paper_id, 80) || null;
      const title = clean(body.title, 180);
      const subject = clean(body.subject, 100);
      const grade = Number(body.grade);
      const bookTitle = clean(body.book_title, 180);
      const edition = clean(body.book_edition, 40) || "۱۴۰۵–۱۴۰۶";
      const curriculumUrl = clean(body.curriculum_source_url, 1000) || "https://chap.sch.ir/";
      let curriculumHost = "";
      try { curriculumHost = new URL(curriculumUrl).hostname.toLowerCase(); } catch { /* invalid URL */ }
      if (title.length < 2 || subject.length < 2 || ![7, 8, 9].includes(grade) ||
          bookTitle.length < 2 || !(curriculumHost === "chap.sch.ir" || curriculumHost.endsWith(".chap.sch.ir"))) {
        return reply({ message: "عنوان آزمون، درس، پایه هفتم تا نهم، کتاب رسمی و نشانی chap.sch.ir را کامل کنید." }, 400);
      }
      let validated;
      try { validated = validatePayload(body.payload); }
      catch (error) { return reply({ message: error instanceof Error ? error.message : "محتوای سؤال‌ها معتبر نیست." }, 400); }

      const { data, error } = await db.rpc("save_smart_exam_draft", {
        p_paper_id: paperId,
        p_school_id: schoolId,
        p_actor_id: actorId,
        p_title: title,
        p_subject: subject,
        p_grade: grade,
        p_book_title: bookTitle,
        p_book_edition: edition,
        p_chapter: clean(body.chapter, 180),
        p_lesson: clean(body.lesson, 180),
        p_topic: clean(body.topic, 180),
        p_page_reference: clean(body.page_reference, 80),
        p_curriculum_source_url: curriculumUrl,
        p_payload: validated,
      });
      if (error) {
        console.error("smart exam draft save failed", error.message);
        return reply({ message: "ذخیره پیش‌نویس انجام نشد؛ ممکن است برگه قفل یا نشست نامعتبر شده باشد." }, 409);
      }
      return reply({ ok: true, paper_id: data, total_points: validated.total_points, message: "پیش‌نویس آزمون ذخیره شد." });
    }

    if (action === "get_draft" && teacher) {
      const paperId = clean(body.paper_id, 80);
      const { data: paper, error: paperError } = await db.from("smart_exam_papers")
        .select("id,created_by,status").eq("id", paperId).eq("tenant_school_id", schoolId)
        .eq("created_by", actorId).eq("status", "draft").maybeSingle();
      if (paperError) throw paperError;
      if (!paper) return reply({ message: "پیش‌نویس پیدا نشد یا قبلاً تأیید نهایی شده است." }, 404);
      const { data: draft, error } = await db.from("smart_exam_draft_payloads")
        .select("payload").eq("paper_id", paperId).maybeSingle();
      if (error) throw error;
      if (!draft) return reply({ message: "محتوای پیش‌نویس پیدا نشد." }, 404);
      const { data: meta, error: metaError } = await db.from("smart_exam_papers")
        .select("id,title,subject,grade,book_title,book_edition,chapter,lesson,topic,page_reference,curriculum_source_url")
        .eq("id", paperId).single();
      if (metaError) throw metaError;
      return reply({ ok: true, paper: meta, payload: draft.payload });
    }

    if (action === "finalize" && teacher) {
      const paperId = clean(body.paper_id, 80);
      const { data, error } = await db.rpc("finalize_smart_exam", {
        p_paper_id: paperId, p_school_id: schoolId, p_actor_id: actorId,
      });
      if (error) {
        console.error("smart exam finalize failed", error.message);
        return reply({ message: "تأیید نهایی انجام نشد؛ پیش‌نویس را بررسی و دوباره تلاش کنید." }, 409);
      }
      return reply({ ok: true, result: data, message: "آزمون تأیید نهایی و به مخزن محرمانه منتقل شد. محتوای آن دیگر در دسترس حساب دبیر نیست." });
    }

    if (action === "vault_get" && (manager || executive)) {
      const paperId = clean(body.paper_id, 80);
      const { data, error } = await db.from("smart_exam_vault").select("*")
        .eq("paper_id", paperId).eq("tenant_school_id", schoolId).maybeSingle();
      if (error) throw error;
      if (!data) return reply({ message: "آزمون نهایی در مخزن مدرسه پیدا نشد." }, 404);
      return reply({ ok: true, paper: data });
    }

    if (action === "archive" && (manager || executive)) {
      const paperId = clean(body.paper_id, 80);
      const { data, error } = await db.rpc("archive_smart_exam", {
        p_paper_id: paperId, p_school_id: schoolId, p_actor_id: actorId,
      });
      if (error) {
        console.error("smart exam archive failed", error.message);
        return reply({ message: "بایگانی آزمون انجام نشد." }, 409);
      }
      if (data !== true) return reply({ message: "آزمون فعال پیدا نشد." }, 404);
      return reply({ ok: true, message: "آزمون در بایگانی قرار گرفت." });
    }

    return reply({ message: "این عملیات برای نقش شما مجاز نیست یا شناخته نشد." }, 403);
  } catch (error) {
    console.error("smart-exam-designer error", error);
    return reply({ message: "عملیات طراحی هوشمند آزمون انجام نشد؛ وضعیت سرویس را بررسی کنید." }, 500);
  }
});
