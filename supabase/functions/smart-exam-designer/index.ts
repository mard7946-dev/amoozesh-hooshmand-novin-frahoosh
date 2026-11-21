import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const clean = (value: unknown, max = 12000) => String(value ?? "").trim().slice(0, max);
const asciiDigits = (value: unknown) => clean(value, 4)
  .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
  .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
const safeEditionFolder = (value: unknown) => clean(value, 40)
  .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
  .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
  .replace(/[^A-Za-z0-9._-]/g, "_") || "edition";
const normalize = (value: unknown) => clean(value, 200)
  .replace(/[\u200c\u200f\u202a-\u202e]/g, "")
  .replace(/ي/g, "ی").replace(/ك/g, "ک").toLocaleLowerCase("fa");

const questionTypes = new Set([
  "multiple_choice", "conceptual", "true_false", "fill_blank", "short_answer", "essay",
  "problem", "equation", "grammar", "vocabulary", "synonym_antonym",
  "translation", "other",
]);
const sourceTypes = new Set(["official_reference", "ai_generated", "teacher_authored", "permitted_external"]);

function validatePayload(raw: unknown, allowIncomplete = false) {
  if (!raw || typeof raw !== "object") throw new Error("اطلاعات آزمون معتبر نیست.");
  const source = raw as Record<string, unknown>;
  const rawHeader = source.header && typeof source.header === "object" ? source.header as Record<string, unknown> : {};
  const header = {
    class_name: clean(rawHeader.class_name, 80),
    teacher_name: clean(rawHeader.teacher_name, 100),
    exam_date: clean(rawHeader.exam_date, 24),
    duration_minutes: asciiDigits(rawHeader.duration_minutes),
  };
  if (!Array.isArray(source.questions) || source.questions.length < 1 || source.questions.length > 100) {
    throw new Error("هر آزمون باید بین ۱ تا ۱۰۰ سؤال داشته باشد.");
  }
  let total = 0;
  let totalImageBytes = 0;
  const questions = source.questions.map((entry, index) => {
    if (!entry || typeof entry !== "object") throw new Error("ساختار سؤال " + (index + 1) + " معتبر نیست.");
    const q = entry as Record<string, unknown>;
    const prompt = clean(q.prompt);
    const type = clean(q.question_type, 60);
    const points = Number(q.points);
    const origin = clean(q.source_origin, 60);
    if ((!allowIncomplete && !prompt) || !questionTypes.has(type)) throw new Error("متن یا نوع سؤال " + (index + 1) + " معتبر نیست.");
    if (!Number.isFinite(points) || points <= 0 || points > 100) throw new Error("بارم سؤال " + (index + 1) + " باید بیشتر از صفر و حداکثر ۱۰۰ باشد.");
    if (!sourceTypes.has(origin)) throw new Error("منشأ سؤال " + (index + 1) + " را مشخص کنید.");
    const sourceUrl = clean(q.source_url, 1000);
    const sourceTitle = clean(q.source_title, 240);
    const permission = q.source_permission_confirmed === true;
    const rawImage = typeof q.image_data_url === "string" ? q.image_data_url.trim() : "";
    if (rawImage.length > 1500000 || (rawImage && !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(rawImage))) {
      throw new Error("تصویر سؤال معتبر نیست یا حجم آن بیش از حد مجاز است.");
    }
    totalImageBytes += rawImage.length;
    if (totalImageBytes > 5000000) throw new Error("حجم مجموع تصاویر آزمون نباید از ۵ مگابایت بیشتر شود.");
    if (origin === "official_reference" && (!allowIncomplete || prompt)) {
      let host = "";
      try { host = new URL(sourceUrl).hostname.toLowerCase(); } catch { /* invalid URL */ }
      if (!sourceTitle || !sourceUrl || !(host === "chap.sch.ir" || host.endsWith(".chap.sch.ir"))) {
        throw new Error("برای سؤال مستند، عنوان منبع و نشانی رسمی chap.sch.ir لازم است.");
      }
    }
    if (origin === "permitted_external" && (!allowIncomplete || prompt) && (!sourceUrl || !sourceTitle || !permission)) {
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
      source_page_reference: clean(q.source_page_reference, 80),
      source_pdf_page_reference: clean(q.source_pdf_page_reference, 80),
      image_data_url: rawImage,
    };
  });
  if (total > 100) throw new Error("مجموع بارم آزمون نباید از ۱۰۰ بیشتر شود.");
  return { header, pdf_page_reference: clean(source.pdf_page_reference, 80), questions, total_points: Number(total.toFixed(2)) };
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
    const textbookBucket = "school-textbooks";
    const canManageTextbooks = manager || executive;

    if (action === "list_textbooks") {
      const requestedGrade = Number(body.grade || 0);
      let query = db.from("school_textbook_library")
        .select("id,grade,book_code,subject,title,edition,file_name,file_size_bytes,created_at")
        .eq("school_id", schoolId).eq("is_active", true);
      if ([7, 8, 9].includes(requestedGrade)) query = query.eq("grade", requestedGrade);
      const { data, error } = await query.order("grade").order("subject").order("book_code").limit(300);
      if (error) throw error;
      return reply({ ok: true, books: data || [] });
    }

    if (action === "create_textbook_upload" && canManageTextbooks) {
      const grade = Number(body.grade);
      const code = clean(body.book_code, 12).toUpperCase();
      const subject = clean(body.subject, 120);
      const title = clean(body.title, 180);
      const edition = clean(body.edition, 40) || "۱۴۰۵–۱۴۰۶";
      const fileName = clean(body.file_name, 100);
      const fileSize = Number(body.file_size_bytes);
      if (![7, 8, 9].includes(grade) || !/^[A-Z][0-9]{2,5}$/.test(code) ||
          subject.length < 2 || !new RegExp("^" + code + "\\.pdf$", "i").test(fileName) ||
          !Number.isInteger(fileSize) || fileSize < 1 || fileSize > 52428800) {
        return reply({ message: "پایه، کد کتاب، نام درس یا مشخصات PDF معتبر نیست. سقف هر فایل ۵۰ مگابایت است." }, 400);
      }
      const { data: duplicate, error: duplicateError } = await db.from("school_textbook_library")
        .select("id").eq("school_id", schoolId).eq("grade", grade)
        .eq("book_code", code).eq("edition", edition).maybeSingle();
      if (duplicateError) throw duplicateError;
      if (duplicate) return reply({ message: "این کد کتاب برای همین پایه و نوبت چاپ قبلاً ثبت شده است." }, 409);
      const editionFolder = safeEditionFolder(edition);
      const storagePath = schoolId + "/" + grade + "/" + code + "/" + editionFolder + "/" + code + ".pdf";
      const { data, error } = await db.storage.from(textbookBucket)
        .createSignedUploadUrl(storagePath, { upsert: false });
      if (error || !data?.token || !data?.signedUrl) throw error || new Error("ایجاد نشانی بارگذاری امن ناموفق بود.");
      return reply({ ok: true, bucket: textbookBucket, storage_path: storagePath, signed_url: data.signedUrl, upload_token: data.token });
    }

    if (action === "register_textbook" && canManageTextbooks) {
      const grade = Number(body.grade);
      const code = clean(body.book_code, 12).toUpperCase();
      const subject = clean(body.subject, 120);
      const title = clean(body.title, 180);
      const edition = clean(body.edition, 40) || "۱۴۰۵–۱۴۰۶";
      const fileName = clean(body.file_name, 100);
      const fileSize = Number(body.file_size_bytes);
      const storagePath = clean(body.storage_path, 500);
      const editionFolder = safeEditionFolder(edition);
      const expectedPath = schoolId + "/" + grade + "/" + code + "/" + editionFolder + "/" + code + ".pdf";
      if (![7, 8, 9].includes(grade) || !/^[A-Z][0-9]{2,5}$/.test(code) ||
          subject.length < 2 || fileName.toLowerCase() !== (code + ".pdf").toLowerCase() ||
          storagePath !== expectedPath || !Number.isInteger(fileSize) || fileSize < 1 || fileSize > 52428800) {
        return reply({ message: "مشخصات کتاب برای ثبت نهایی معتبر نیست." }, 400);
      }
      const folder = schoolId + "/" + grade + "/" + code + "/" + editionFolder;
      const { data: objects, error: listError } = await db.storage.from(textbookBucket).list(folder, { limit: 100 });
      if (listError) throw listError;
      if (!(objects || []).some((item: { name: string }) => item.name === code + ".pdf")) {
        return reply({ message: "فایل PDF هنوز در فضای خصوصی بارگذاری نشده است." }, 409);
      }
      const { data, error } = await db.from("school_textbook_library").insert({
        school_id: schoolId, grade, book_code: code, subject, title, edition,
        file_name: code + ".pdf", storage_path: storagePath, file_size_bytes: fileSize,
        mime_type: "application/pdf", uploaded_by: actorId, is_active: true
      }).select("id,grade,book_code,subject,title,edition,file_name,file_size_bytes,created_at").single();
      if (error) {
        if (error.code === "23505") return reply({ message: "این کتاب قبلاً در کتابخانه ثبت شده است." }, 409);
        throw error;
      }
      return reply({ ok: true, book: data, message: "کتاب با موفقیت به کتابخانه خصوصی مدرسه افزوده شد." });
    }

    if (action === "textbook_download_url") {
      const bookId = clean(body.book_id, 80);
      const { data: book, error: bookError } = await db.from("school_textbook_library")
        .select("id,storage_path,file_name,grade,book_code,subject,title,edition")
        .eq("id", bookId).eq("school_id", schoolId).eq("is_active", true).maybeSingle();
      if (bookError) throw bookError;
      if (!book) return reply({ message: "کتاب فعال در کتابخانه پیدا نشد." }, 404);
      const { data, error } = await db.storage.from(textbookBucket).createSignedUrl(book.storage_path, 900);
      if (error || !data?.signedUrl) throw error || new Error("ساخت پیوند موقت دانلود کتاب ناموفق بود.");
      return reply({ ok: true, book, signed_url: data.signedUrl, expires_in: 900 });
    }

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



    if (action === "summarize_textbook_chunk" && teacher) {
      const cloudflareToken = (Deno.env.get("CLOUDFLARE_AI_TOKEN") || "").trim();
      const cloudflareAccount = (Deno.env.get("CLOUDFLARE_ACCOUNT_ID") || "").trim();
      if (!cloudflareToken || !/^[a-f0-9]{32}$/.test(cloudflareAccount)) return reply({ message: "اتصال هوش مصنوعی در محیط مدرسه پیکربندی نشده است." }, 503);
      const sourceText = clean(body.source_text, 12000), pageReference = clean(body.page_reference, 120);
      const mode = clean(body.summary_mode, 20) === "compress" ? "compress" : "analyze";
      if (sourceText.length < 120 || !pageReference) return reply({ message: "متن بخش کتاب یا شماره صفحات برای تحلیل کافی نیست." }, 400);

      const baseInstructions = mode === "compress"
        ? [
          "You consolidate Persian middle-school textbook study notes.",
          "Preserve every distinct examinable topic, definition, process, formula, example, and important distinction.",
          "Remove repetition only. Never invent facts or add outside knowledge.",
          "Return exactly one valid JSON object: {\"summary\":\"Persian notes\"}. No markdown or text outside JSON.",
          "Keep the summary concise, at most 3000 Persian characters, using compact headings."
        ]
        : [
          "Analyze the COMPLETE supplied Persian textbook excerpt for grades 7-9.",
          "Preserve all distinct examinable concepts, definitions, facts, cause-effect links, steps, formulas, examples, vocabulary, and diagram/table descriptions actually present.",
          "Do not create questions, import outside facts, or copy long passages verbatim. Write concise original study notes.",
          "Return exactly one valid JSON object: {\"summary\":\"Persian notes\"}. No markdown or text outside JSON.",
          "Keep the summary concise, at most 700 Persian characters, and begin with the supplied page range."
        ];
      const endpoint = "https://api.cloudflare.com/client/v4/accounts/" + cloudflareAccount + "/ai/run/@cf/zai-org/glm-4.7-flash";
      try {
        let summary = "";
        let lastParseError = "";
        for (let attempt = 0; attempt < 2 && !summary; attempt++) {
          const instructions = attempt === 0
            ? baseInstructions
            : baseInstructions.concat(["IMPORTANT: Previous output was incomplete. Produce a shorter complete JSON object; never stop before closing the JSON braces."]);
          const maxTokens = mode === "compress"
            ? (attempt === 0 ? 4500 : 6500)
            : (attempt === 0 ? 2400 : 3600);
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 28000);
          let response: Response;
          let result: Record<string, unknown>;
          try {
            response = await fetch(endpoint, {
            method: "POST",
            headers: { "Authorization": "Bearer " + cloudflareToken, "Content-Type": "application/json" },
            body: JSON.stringify({
              messages: [
                { role: "system", content: instructions.join(" ") },
                { role: "user", content: JSON.stringify({ pages: pageReference, textbook_content_or_notes: sourceText }) }
              ],
              max_completion_tokens: maxTokens,
              temperature: 0.1,
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: "textbook_summary",
                  description: "A concise Persian study-note summary.",
                  strict: true,
                  schema: {
                    type: "object",
                    properties: { summary: { type: "string" } },
                    required: ["summary"],
                    additionalProperties: false
                  }
                }
              },
              chat_template_kwargs: { enable_thinking: false, clear_thinking: true }
            }),
            signal: controller.signal
            });
            result = await response.json().catch(() => ({})) as Record<string, unknown>;
          } finally {
            clearTimeout(timeout);
          }
          if (!response.ok || result?.success !== true) {
            console.error("Cloudflare textbook analysis failed", response.status, JSON.stringify(result).slice(0, 900));
            return reply({ message: "تحلیل یکی از بخش‌های کتاب توسط هوش مصنوعی ناموفق بود؛ کمی بعد دوباره تلاش کنید." }, 502);
          }
          const resultBody = result?.result && typeof result.result === "object" ? result.result as Record<string, unknown> : {};
          const choices = Array.isArray(result?.choices) ? result.choices as Array<Record<string, unknown>> : [];
          const firstChoice = choices[0] || {};
          const firstMessage = firstChoice.message && typeof firstChoice.message === "object" ? firstChoice.message as Record<string, unknown> : {};
          const raw = clean(resultBody.response ?? firstMessage.content ?? "", 20000).replace(/^\\uFEFF/, "").trim();
          if (!raw) console.warn("Textbook model returned an empty completion", { topLevelKeys: Object.keys(result || {}), resultKeys: Object.keys(resultBody), finishReason: firstChoice.finish_reason || resultBody.finish_reason || null });
          try {
            const firstBrace = raw.indexOf("{"), lastBrace = raw.lastIndexOf("}");
            if (firstBrace < 0 || lastBrace <= firstBrace) throw new Error("Model response did not contain a complete JSON object");
            const parsed = JSON.parse(raw.slice(firstBrace, lastBrace + 1));
            const candidate = clean(parsed?.summary, mode === "compress" ? 3000 : 700);
            const minimumSummaryLength = mode === "compress" ? 45 : 30;
            if (candidate.length < minimumSummaryLength) throw new Error("Model summary was empty or too short");
            summary = candidate;
          } catch (parseError) {
            lastParseError = parseError instanceof Error ? parseError.message : "invalid model JSON";
            console.warn("Textbook summary response was incomplete; retrying", { attempt: attempt + 1, responseLength: raw.length, reason: lastParseError });
          }
        }
        if (!summary) {
          console.error("Textbook summary failed after retry", { mode, sourceLength: sourceText.length, reason: lastParseError });
          return reply({ message: "پاسخ هوش مصنوعی ناقص بود و پس از تلاش مجدد هم کامل نشد؛ بازه صفحات را به چند بخش کوچک‌تر تقسیم کنید و دوباره تلاش کنید." }, 502);
        }
        return reply({ ok: true, summary, page_reference: pageReference });
      } catch (error) {
        console.error("Textbook chunk analysis error", error instanceof Error ? error.message : "unknown");
        return reply({
          message: error instanceof Error && error.name === "AbortError"
            ? "پاسخ هوش مصنوعی در مهلت تعیین‌شده نرسید؛ بازه صفحات را کوچک‌تر کنید و دوباره تلاش کنید."
            : "ارتباط با هوش مصنوعی هنگام تحلیل کتاب برقرار نشد؛ دوباره تلاش کنید."
        }, 502);
      }
    }

    if (action === "generate_questions" && teacher) {
      const cloudflareToken = (Deno.env.get("CLOUDFLARE_AI_TOKEN") || "").trim();
      const cloudflareAccount = (Deno.env.get("CLOUDFLARE_ACCOUNT_ID") || "").trim();
      if (!cloudflareToken || !/^[a-f0-9]{32}$/.test(cloudflareAccount)) {
        return reply({ message: "اتصال هوش مصنوعی در محیط مدرسه پیکربندی نشده است." }, 503);
      }
      const sourceText = clean(body.source_text, 15000);
      const pageReference = clean(body.page_reference, 80);
      const pdfPageReference = clean(body.pdf_page_reference, 80);
      const requested = Array.isArray(body.question_plan) ? body.question_plan : [];
      const targetPoints = Number(body.total_points ?? 20);
      if (sourceText.length < 200 || !pageReference || !pdfPageReference || requested.length < 1 || requested.length > 13 ||
          !Number.isFinite(targetPoints) || targetPoints <= 0 || targetPoints > 20) {
        return reply({ message: "متن کتاب (حداقل ۲۰۰ نویسه)، شماره صفحه، انواع سؤال و بارم کل را کامل کنید." }, 400);
      }
      const plan: { type: string; count: number }[] = [];
      let count = 0;
      for (const item of requested) {
        if (!item || typeof item !== "object") return reply({ message: "برنامهٔ تولید سؤال معتبر نیست." }, 400);
        const type = clean((item as Record<string, unknown>).type, 60);
        const amount = Number((item as Record<string, unknown>).count);
        if (!questionTypes.has(type) || !Number.isInteger(amount) || amount < 1 || amount > 15) {
          return reply({ message: "نوع یا تعداد سؤال درخواستی معتبر نیست." }, 400);
        }
        plan.push({ type, count: amount });
        count += amount;
      }
      if (count < 1 || count > 40 || new Set(plan.map(x => x.type)).size !== plan.length) {
        return reply({ message: "مجموع سؤال‌ها باید بین ۱ تا ۴۰ باشد و هر نوع فقط یک بار ثبت شود." }, 400);
      }
      const targetCents = Math.round(targetPoints * 100);
      if (Math.abs(targetPoints * 100 - targetCents) > 0.000001 || targetCents < count) {
        return reply({ message: "بارم کل باید با دقت حداکثر دو رقم اعشار و دست‌کم یک صدم برای هر سؤال باشد." }, 400);
      }
      const typeLabels: Record<string, string> = {
        multiple_choice: "تستی چهارگزینه‌ای", conceptual: "مفهومی", true_false: "صحیح یا غلط",
        fill_blank: "جای خالی", short_answer: "پاسخ کوتاه", essay: "تشریحی",
        problem: "مسئله", equation: "معادله", grammar: "گرامر",
        vocabulary: "معنی واژه", synonym_antonym: "مترادف یا متضاد",
        translation: "ترجمه", other: "سایر"
      };
      const planText = plan.map(x => ({ question_type: x.type, question_type_label: typeLabels[x.type], count: x.count }));
      const systemPrompt = [
        "You are an assessment author for Persian-speaking middle-school students.",
        "Create original questions using ONLY the supplied textbook excerpt. Never import or reproduce a question from an external source.",
        "Return one valid JSON object only: {\"questions\":[{\"question_type\":string,\"prompt\":string,\"options\":string[],\"correct_answer\":string,\"explanation\":string,\"difficulty\":\"easy|medium|hard\"}]}",
        "Use exactly the requested question types and exact counts. Do not add or omit questions.",
        "For multiple_choice provide exactly four distinct options and make correct_answer identify the correct option. For other types options may be empty.",
        "Write clear age-appropriate Persian. No unsupported facts, trick wording, duplicate questions, or content beyond the excerpt.",
        "Essay questions must each be independently answerable. Keep questions concise and ensure every answer is supported by the excerpt.",
        "Do not assign marks. Do not include source URLs. The application will attach the supplied printed page reference."
      ].join(" ");
      const userPrompt = JSON.stringify({
        subject: clean(body.subject, 100),
        grade: Number(body.grade),
        chapter: clean(body.chapter, 180),
        lesson: clean(body.lesson, 180),
        printed_page_reference: pageReference,
        pdf_page_reference: pdfPageReference,
        requested_question_plan: planText,
        textbook_excerpt: sourceText
      });
      const endpoint = "https://api.cloudflare.com/client/v4/accounts/" + cloudflareAccount + "/ai/run/@cf/zai-org/glm-4.7-flash";
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 110000);
      let generated: unknown;
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Authorization": "Bearer " + cloudflareToken, "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
            max_tokens: Math.min(7000, 500 + count * 180),
            temperature: 0.25
          }),
          signal: controller.signal
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result?.success !== true) {
          console.error("Cloudflare Workers AI request failed", response.status, JSON.stringify(result).slice(0, 1200));
          return reply({ message: "سرویس تولید سؤال پاسخ معتبر نداد. تنظیمات مدل یا سهمیهٔ سرویس را بررسی کنید." }, 502);
        }
        let content = clean(result?.result?.response, 30000);
        content = content.replace(/^\uFEFF/, "").replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
        generated = JSON.parse(content);
      } catch (error) {
        console.error("Cloudflare Workers AI request error", error instanceof Error ? error.message : "unknown");
        return reply({ message: error instanceof Error && error.name === "AbortError" ? "پاسخ هوش مصنوعی بیش از ۱۱۰ ثانیه طول کشید؛ تعداد سؤال‌ها یا بازه صفحات را کمتر کنید و دوباره تلاش کنید." : "ارتباط با سرویس تولید سؤال برقرار نشد یا پاسخ آن قابل خواندن نبود." }, 502);
      } finally {
        clearTimeout(timeout);
      }
      const rawQuestions = (generated as Record<string, unknown>)?.questions;
      if (!Array.isArray(rawQuestions) || rawQuestions.length !== count) {
        return reply({ message: "تعداد سؤال‌های پاسخ‌داده‌شده با درخواست دبیر برابر نیست؛ دوباره تلاش کنید." }, 502);
      }
      const expected = new Map(plan.map(x => [x.type, x.count]));
      const actual = new Map<string, number>();
      const baseCents = Math.floor(targetCents / count);
      const extraCents = targetCents % count;
      const questions = rawQuestions.map((entry, index) => {
        if (!entry || typeof entry !== "object") throw new Error("ساختار پاسخ هوش مصنوعی معتبر نیست.");
        const q = entry as Record<string, unknown>;
        const type = clean(q.question_type, 60);
        actual.set(type, (actual.get(type) || 0) + 1);
        const prompt = clean(q.prompt, 5000);
        const options = Array.isArray(q.options) ? q.options.slice(0, 4).map(x => clean(x, 1000)).filter(Boolean) : [];
        const answer = clean(q.correct_answer, 3000);
        if (!expected.has(type) || !prompt || !answer || (type === "multiple_choice" && options.length !== 4)) {
          throw new Error("کیفیت یا ساختار یکی از سؤال‌های تولیدشده قابل قبول نیست.");
        }
        return {
          order: index + 1, question_type: type,
          difficulty: ["easy", "medium", "hard"].includes(clean(q.difficulty)) ? clean(q.difficulty) : "medium",
          prompt, options, correct_answer: answer, explanation: clean(q.explanation, 3000),
          points: (baseCents + (index < extraCents ? 1 : 0)) / 100, source_origin: "ai_generated",
          source_url: "", source_title: "", source_license: "", source_permission_confirmed: false,
          source_page_reference: pageReference,
          source_pdf_page_reference: pdfPageReference
        };
      });
      if ([...expected].some(([type, amount]) => actual.get(type) !== amount) ||
          Math.abs(questions.reduce((sum, q) => sum + q.points, 0) - targetCents / 100) > 0.000001) {
        return reply({ message: "ترکیب یا بارم سؤال‌های تولیدشده با درخواست شما مطابقت ندارد." }, 502);
      }
      return reply({ ok: true, questions, total_points: Number((targetCents / 100).toFixed(2)), message: "سؤال‌ها تولید شدند؛ آن‌ها را بازبینی و سپس پیش‌نویس را ذخیره کنید." });
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
      try { validated = validatePayload(body.payload, true); }
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
      const { data: draft, error: draftError } = await db.from("smart_exam_draft_payloads")
        .select("payload").eq("paper_id", paperId).maybeSingle();
      if (draftError) throw draftError;
      if (!draft?.payload) return reply({ message: "پیش‌نویس آزمون پیدا نشد." }, 404);
      try {
        validatePayload(draft.payload, false);
      } catch (error) {
        return reply({ message: error instanceof Error ? error.message : "همه سؤال‌ها باید کامل شوند." }, 400);
      }
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
