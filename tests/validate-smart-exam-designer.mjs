import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const page = readFileSync("smart-exam-designer.html", "utf8");
const api = readFileSync("supabase/functions/smart-exam-designer/index.ts", "utf8");
const migration = readFileSync("supabase/migrations/20261120070000_smart_exam_designer_secure_vault.sql", "utf8");
const portal = readFileSync("portal.html", "utf8");
const legacyApi = readFileSync("supabase/functions/question-bank/index.ts", "utf8");

assert.ok(portal.includes("طراحی هوشمند آزمون") && portal.includes("مخزن محرمانه آزمون‌ها"), "Teacher designer and management vault routes must be present");
assert.ok(api.includes('"executive"') && api.includes('memberRoles.has("executive")'), "The actual executive role and active school membership must be required");
assert.ok(api.includes('action === "get_draft" && teacher') && api.includes('.eq("created_by", actorId).eq("status", "draft")'), "Teachers may retrieve only their own mutable drafts");
assert.ok(api.includes('action === "vault_get" && (manager || executive)'), "Only manager and executive deputy may retrieve final exam content");
assert.ok(api.includes('action === "archive" && (manager || executive)'), "Only manager and executive deputy may archive final exams");
assert.ok(api.includes('origin === "ai_generated" && (sourceUrl || sourceTitle)'), "AI-generated questions must not be misrepresented as source-derived");
assert.ok(api.includes("chap.sch.ir") && api.includes("permitted_external"), "Official and permission-based source provenance must be validated");
assert.ok(migration.includes("enable row level security") && migration.includes("revoke all") && migration.includes("to service_role"), "All new exam tables must deny direct client access");
assert.ok(migration.includes("finalize_smart_exam") && migration.includes("delete from public.smart_exam_draft_payloads"), "Finalization must atomically move content and remove teacher draft payload");
assert.equal(migration.split("create or replace function public.finalize_smart_exam(").length - 1, 1, "The migration must define exactly one complete finalization function");
assert.ok(migration.includes("v_duration !~") && migration.includes("v_duration::integer not between 1 and 600"), "Database finalization must validate a normalized, bounded exam duration");
assert.ok(migration.includes("prevent_smart_exam_vault_content_update") && migration.includes("Final exam content is immutable"), "Final vault content must be immutable");
assert.ok(migration.includes("archive_smart_exam") && migration.includes("smart_exam_audit_logs"), "Archiving must be transactional and audited");
assert.ok(page.includes("ai_generated") && page.includes("conceptual") && page.includes("multiple_choice") && page.includes("synonym_antonym") && page.includes("translation"), "Question types and provenance choices must be available");
assert.ok(page.includes("محتوای آزمون پس از تأیید نهایی برای دبیر قابل مشاهده نیست"), "Teacher UI must not offer finalized content access");
assert.ok(page.includes("چاپ / ذخیره PDF") && page.includes('src="assets/school-logo.svg"'), "The official school logo and print-to-PDF action must be used");
assert.ok(page.includes("اداره کل آموزش و پرورش شهرستان‌های استان تهران") && page.includes("مدیریت آموزش و پرورش شهرستان قدس") && page.includes("دبیرستان دوره اول متوسطه سردار شهید حاجی‌زاده ۲") && page.includes("۱۴۰۵–۱۴۰۶"), "The official school header must match the supplied template");
assert.ok(page.includes('id="className"') && page.includes('id="teacherName"') && page.includes('id="examDate"') && page.includes('id="durationMinutes"'), "Teacher must enter the official header metadata before finalization");
assert.ok(page.includes("counter(page)") && page.includes("counter(pages)") && page.includes("display:table-header-group"), "The print layout must repeat the header and number printed pages");
assert.ok(api.includes("class_name: clean(rawHeader.class_name") && api.includes("return { header, pdf_page_reference: clean(source.pdf_page_reference, 80), questions"), "Validated header metadata and PDF page provenance must be stored with the draft");
assert.ok(api.includes("function validatePayload(raw: unknown, allowIncomplete = false)") && api.includes("validatePayload(body.payload, true)") && api.includes("!allowIncomplete && !prompt"), "Incomplete teacher question cards must be saveable as drafts");
assert.ok(api.includes("\"conceptual\""), "Conceptual questions must be accepted by the secure backend");
assert.ok(migration.includes("Official exam header metadata is incomplete") && migration.includes("duration_minutes"), "Database finalization must reject incomplete print-header metadata");
assert.ok(page.includes("پیش‌نمایش و چاپ این نسخه با سربرگ رسمی ارسالی مدرسه انجام می‌شود"), "Print must use the supplied official school header");
assert.ok(api.includes("asciiDigits(rawHeader.duration_minutes)"), "Persian numerals in exam duration must be normalized before database validation");
assert.ok(legacyApi.includes('["executive","executive_deputy","معاون اجرایی"]') && !legacyApi.includes('["educational","educational_deputy","معاون آموزشی"]'), "Legacy question-bank endpoint must no longer authorize educational deputy as vault manager");
assert.ok(legacyApi.indexOf("if(!manager&&!deputy)") < legacyApi.indexOf('if(action==="add_to_collection"&&(deputy||teacher))'), "Legacy endpoint must reject teachers before shared-bank actions are reachable");
const scripts = [...page.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]).filter(x => x.trim());
for (const script of scripts) assert.doesNotThrow(() => new Function(script), "Smart exam designer JavaScript syntax must be valid");
console.log("Smart exam designer authorization, provenance, immutability, and UI checks passed.");

assert.ok(api.includes('action === "generate_questions" && teacher'), "Only authenticated teachers may invoke AI question generation");

assert.ok(api.includes("chat_template_kwargs: { enable_thinking: false, clear_thinking: true }"), "GLM question generation must disable reasoning tokens so the model returns usable question content within the request budget");
assert.ok(api.includes("response_format: {") && api.includes('name: "middle_school_exam_questions"') && api.includes("strict: true"), "AI question generation must request a strict structured JSON response");
assert.ok(api.includes("1200 + count * 700"), "The output token budget must scale to the requested number of questions and their explanations");
assert.ok(api.includes("clean(resultBody.response, 30000) ||") && api.includes("clean(firstMessage.content, 30000) ||"), "An empty top-level response must not mask a populated chat completion choice");
assert.ok(api.includes("finishReason") && api.includes("responseKeys: Object.keys(resultBody)"), "Empty model completions must log finish reason and response shape for diagnosis");

assert.ok(api.includes("CLOUDFLARE_AI_TOKEN") && api.includes("CLOUDFLARE_ACCOUNT_ID"), "Cloudflare credentials must be read only from server-side secrets");
assert.ok(api.includes("@cf/zai-org/glm-4.7-flash") && api.includes("textbook_excerpt"), "AI generation must use the configured multilingual model and supplied textbook excerpt");
assert.ok(api.includes("count > 5") && api.includes("rawQuestions.length !== count"), "Each AI generation request must enforce a bounded batch and exact question counts");
assert.ok(api.includes("generationTimeoutMs = 65000") && api.includes("controller.signal.aborted") && api.includes("timedOut: controller.signal.aborted"), "AI question generation must allow realistic model latency and report timeout failures accurately");
assert.ok(api.includes('const analysisModel = "@cf/meta/llama-3.3-70b-instruct-fp8-fast"') && api.includes("controller.abort(), analysisTimeoutMs") && api.includes("const analysisTimeoutMs = 40000"), "Textbook analysis must use the active fast JSON-capable model and return before the long-running request is cut off");
assert.ok(api.includes("body.client_request_id") && api.includes("typeof modelOutput === \"object\"") && api.includes("JSON.parse(raw.slice(firstBrace, lastBrace + 1))"), "Textbook analysis must correlate browser requests and parse both object and text model responses");
assert.ok(page.includes('message.includes("پاسخ هوش مصنوعی کامل نبود")'), "Incomplete textbook summaries must trigger automatic smaller-chunk analysis");
assert.ok(page.includes('const requestId=action==="summarize_textbook_chunk"?crypto.randomUUID():""') && page.includes("client_request_id:requestId") && page.includes('cache:"no-store"') && page.includes("شناسه پیگیری"), "Textbook summary requests must avoid blind retries and surface a correlation ID when the browser cannot receive a response");
assert.ok(page.includes("questionBatches") && page.includes("batchCount===5") && page.includes("generatedQuestions.length!==totalQuestionCount"), "The teacher UI must split large exams into five-question batches and verify the combined count");
assert.ok(page.includes("targetCents") && page.includes("points:(baseCents+(index<extraCents?1:0))/100"), "Marks must be reallocated across the complete exam after batch generation");
assert.ok(api.includes('source_origin: "ai_generated"') && api.includes("source_page_reference") && api.includes("source_page_reference: clean(q.source_page_reference, 80)"), "Generated questions must retain AI provenance and printed page reference");
assert.ok(page.includes('id="pageFrom"') && page.includes('id="pageTo"') && page.includes('id="questionMode"') && page.includes('id="questionCounts"') && page.includes('id="generateQuestions"') && page.includes("extractSelectedPdfChunks") && page.includes("summarizeAllBookChunks") && page.includes("questionPlan") && page.includes("selectWholeBook") && api.includes('action === "summarize_textbook_chunk" && teacher'), "Teacher UI must extract selected textbook PDF pages and expose dynamic question-count controls");
assert.ok(page.includes("تولید سؤال از هوش مصنوعی ممکن است از سهمیه یا اعتبار سرویس استفاده کند"), "AI generation must disclose potential service usage before the request");

const textbookMigration = readFileSync("supabase/migrations/20261121035442_school_textbook_library.sql", "utf8");
assert.ok(textbookMigration.includes("school_textbook_library") && textbookMigration.includes("enable row level security"), "Textbook metadata must be isolated behind RLS");
assert.ok(textbookMigration.includes("revoke all") && textbookMigration.includes("to service_role"), "Textbook metadata must not be directly accessible to browser roles");
assert.ok(textbookMigration.includes("'school-textbooks', 'school-textbooks', false") && textbookMigration.includes("application/pdf"), "Textbook PDF bucket must be private and PDF-only");
assert.ok(api.includes('action === "list_textbooks"') && api.includes('action === "textbook_download_pdf"'), "Authorized users must be able to list books and retrieve private PDFs through the authenticated function");
assert.ok(api.includes('action === "create_textbook_upload" && canManageTextbooks') && api.includes('action === "register_textbook" && canManageTextbooks'), "Only management and executive deputy may upload and register textbooks");
assert.ok(api.includes("createSignedUploadUrl") && api.includes("db.storage.from(textbookBucket).download(book.storage_path)"), "Uploads must use a time-limited signed URL and downloads must stream from private Storage through the authenticated function");
assert.ok(api.includes("fileSize > 52428800") && api.includes("^[A-Z][0-9]{2,5}$"), "Book uploads must enforce a bounded file size and preserve coded filenames");
assert.ok(page.includes('id="textbookLibraryPanel"') && page.includes('id="textbookPdf"') && page.includes('id="libraryBookSelect"'), "The exam designer must expose textbook upload and selection controls");
assert.ok(api.includes("createSignedUploadUrl(storagePath, { upsert: false })") && page.includes('fetch(signed.signed_url,{method:"PUT"'), "PDF uploads must use the signed upload URL returned by the Edge Function");
assert.ok(api.includes('action === "textbook_download_pdf"') && api.includes(".download(book.storage_path)") && api.includes('"Content-Type": "application/pdf"'), "Private textbook PDFs must stream through the authenticated CORS-enabled Edge Function");
assert.ok(page.includes('action:"textbook_download_pdf"') && !page.includes("fetch(link.signed_url)"), "The browser must fetch textbook PDFs through the authenticated Edge Function rather than cross-origin Storage URLs");

assert.ok(page.includes('method:"PUT"') && page.includes('"Content-Type":"application/pdf"') && page.includes('"x-upsert":"false"'), "Signed textbook uploads must use a non-overwriting PDF PUT request");
assert.ok(api.includes('const textbookBucket = "school-textbooks"') && api.includes('createSignedUploadUrl(storagePath, { upsert: false })'), "The signed upload URL must be issued for the private textbook bucket");
assert.ok(api.includes('eq("school_id", schoolId)') && api.includes('eq("is_active", true)'), "Textbook listing and retrieval must remain scoped to the authenticated school");
assert.ok(api.includes("const safeEditionFolder = (value: unknown) => clean(value, 40)") && api.split("safeEditionFolder(edition)").length - 1 === 2, "Different print editions must retain their complete edition identifier in separate storage paths");

assert.ok(page.includes('const isTestMode=new URLSearchParams(window.location.search).get("frahoosh-env")==="test"'), "Test mode must be an explicit opt-in query parameter");
assert.ok(page.includes('SUPABASE_URL=isTestMode?"https://ljinsvtitzscrrqazszu.supabase.co":"https://gtmmllcxhdejwjjnyzrh.supabase.co"'), "Test and production environments must use separate Supabase projects");
assert.ok(page.includes('sessionStorage.getItem(isTestMode?"frahoosh_test_access_token":"frahoosh_novin_access_token")'), "Test mode must never reuse the production access token");
assert.ok(page.includes('const role=isTestMode?"test":(sessionStorage.getItem("frahoosh_novin_role")||"")'), "Test login must not depend on a production role session");
assert.ok(page.includes('/auth/v1/token?grant_type=password') && page.includes('JSON.stringify({email,password})') && page.includes('id="testLoginEmail"') && page.includes('id="testLoginPassword"'), "Test mode must authenticate the pre-provisioned test account with its password");

assert.ok(page.includes('id="printedPageFrom"') && page.includes('id="printedPageTo"') && page.includes('id="pdfPageReference"'), "Printed textbook pages must be entered separately from PDF page indices");
assert.ok(page.includes('label for="pageFrom">از صفحه PDF') && page.includes('label for="printedPageFrom">از صفحه چاپی کتاب'), "The UI must clearly distinguish PDF page indices from printed textbook numbering");
assert.ok(api.includes("const pdfPageReference = clean(body.pdf_page_reference, 80)") && api.includes("source_pdf_page_reference: pdfPageReference") && api.includes("source_page_reference: pageReference"), "Generated questions must preserve both printed and PDF page references");
assert.ok(page.includes('class="question-group') && page.includes('essay-group') && page.includes('groupMarkup'), "The print layout must group same-type questions and isolate every essay question");
assert.ok(page.includes('q.image_data_url') && page.includes('class="question-image"'), "The print renderer must safely render an attached question image when present");

assert.ok(page.includes('data-image-file type="file"') && page.includes('data-image-pdf-crop') && page.includes("ensureSelectedPdfDocument") && page.includes('data-image-canvas') && page.includes('ثبت برش تصویر') && page.includes('state.questions[index].image_data_url=cropped'), "Teachers must be able to crop and attach an image from a textbook PDF page or image file to an individual question");
assert.ok(api.includes("const rawImage = typeof q.image_data_url") && api.includes("totalImageBytes > 5000000") && api.includes("image_data_url: rawImage"), "Question images must be validated and bounded before they are stored in exam drafts or the final vault");

assert.ok(api.includes("const targetCents = Math.round(targetPoints * 100)") && api.includes("const baseCents = Math.floor(targetCents / count)") && api.includes("(baseCents + (index < extraCents ? 1 : 0)) / 100"), "Generated question marks must sum exactly to the requested total without rounding drift");
