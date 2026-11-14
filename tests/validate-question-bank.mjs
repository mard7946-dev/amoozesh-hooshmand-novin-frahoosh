import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const page=readFileSync("question-bank.html","utf8");
const api=readFileSync("supabase/functions/question-bank/index.ts","utf8");
const portal=readFileSync("portal.html","utf8");
const migration=readFileSync("supabase/migrations/20261113190000_central_question_bank.sql","utf8");
const papersMigration=readFileSync("supabase/migrations/20261114080000_question_paper_approval_workflow.sql","utf8");
assert.ok(portal.includes("roleItems.push(['📚','بانک سؤال'"),"Question bank must appear for manager, deputy and teacher");
assert.ok(page.includes("question-bank") && page.includes("frahoosh_novin_access_token"),"Question bank UI must use the authenticated school session");
assert.ok(api.includes('action==="create_question"&&manager'),"Only manager can create central questions");
assert.ok(api.includes("const rows=chunks.map(q=>{") && api.includes('status:"published"') && api.includes("vault_id:vault.id") && api.includes("سؤال در مخزن‌های اختصاصی درس و پایه ذخیره شد"),"PDF imports must be bulk-published into subject-grade vaults");
assert.ok(api.includes('action==="update_question"&&(manager||deputy)') && api.includes('action==="archive_question"&&(manager||deputy)'),"Manager and educational deputy can edit/remove questions");
assert.ok(!page.includes("data-publish=") && !api.includes('action==="publish_question"'),"No per-question publishing step remains");
assert.ok(api.includes('action==="add_to_collection"&&(deputy||teacher)'),"Deputies and teachers can add published questions to personal collections");
assert.ok(page.includes('id="pdfFile"') && page.includes('id="pdfSubject"'),"Manager must be able to upload a PDF directly and assign its default subject");
assert.ok(!page.includes('id="pdfPageUrl"') && !api.includes('action==="fetch_pdf"') && !api.includes('action==="discover_pdf_links"'),"Question-bank PDF ingestion must use manual file upload only");
assert.ok(migration.includes("enable row level security") && migration.includes("revoke all") && migration.includes("service_role"),"Question bank tables must deny direct client access and use server authorization");
console.log("Central question bank checks passed.");

const parser = readFileSync("supabase/functions/question-bank/pdf-parser.ts", "utf8");
assert.ok(page.includes('id="pdfFile"'), "Direct PDF upload must remain available");
assert.ok(page.includes('id="pdfSubject"'), "Every PDF import must have a fallback lesson category");
assert.ok(page.includes('font-family:"B Zar","B Nazanin",Tahoma,Arial,sans-serif!important'), "Question cards must use one consistent Persian font stack");
assert.ok(parser.includes("subjectHeading") && parser.includes('subject: block.subject || fallback'), "Questions must be grouped under explicit lesson headings or the selected fallback lesson");
assert.ok(api.includes("parsePdfQuestions(sourceText,subject,500)"), "PDF imports must use the tested parser");
const pageScripts = [...page.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]).filter(source => source.trim());
for (const source of pageScripts) assert.doesNotThrow(() => new Function(source), "Question bank page script syntax must be valid");

assert.ok(api.includes('action==="create_paper"&&teacher'), "Only teachers can create their own exam papers");
assert.ok(api.includes('action==="add_paper_item"&&teacher') && api.includes('norm(question.subject)!==norm(paper.subject)'), "Teachers can only add published questions from the same subject");
assert.ok(api.includes('action==="submit_paper"&&teacher'), "Teachers can submit their paper for final approval");
assert.ok(api.includes('action==="review_paper"&&(manager||deputy)'), "Only manager or educational deputy can approve or return submitted papers");
assert.ok(api.includes('action==="get_approved_paper"&&(manager||deputy)'), "Only manager or educational deputy can retrieve approved paper export data");
assert.ok(api.includes('if(teacher&&paper.status==="approved")') && api.includes('export_allowed:false'), "Teachers must not retrieve approved paper contents or export data");
assert.ok(api.includes('["educational","educational_deputy","معاون آموزشی"]'), "The educational deputy role must be recognized explicitly");
assert.ok(papersMigration.includes("question_papers") && papersMigration.includes("question_paper_items") && papersMigration.includes("revoke all") && papersMigration.includes("service_role"), "Exam paper tables must be protected from direct client access");
assert.ok(page.includes("data-paper-export") && page.includes("get_approved_paper") && page.includes("چاپ / ذخیره خروجی PDF"), "Approved PDF print action must be visible in the manager/deputy review workflow");
assert.ok(page.includes('"B Zar","B Nazanin",Tahoma,Arial,sans-serif'), "Question bank and print output must use a consistent Persian font stack");

assert.ok(api.includes('action==="update_question"&&(manager||deputy)') && page.includes('data-edit=') && page.includes('data-archive='), "Manager and educational deputy can edit or remove questions");

assert.ok(page.includes('id="bulkArchiveBtn"') && page.includes('confirmation!=="حذف همه"'), "Manager bulk archive must require an explicit typed confirmation");
assert.ok(page.includes('api("bulk_archive_questions")'), "Bulk archive button must call the server action");
assert.ok(api.includes('action==="bulk_archive_questions"&&manager') && api.includes('eq("tenant_school_id",school).neq("status","archived").select("id")'), "Bulk archive must be manager-only and scoped to active questions in the current school");

const vaultMigration = readFileSync("supabase/migrations/20261114120000_question_subject_grade_vaults.sql", "utf8");
assert.ok(vaultMigration.includes("question_vaults") && vaultMigration.includes("question_bank_vault_id_fkey") && vaultMigration.includes("vault_id set not null"), "Every existing and new question must belong to one subject-grade vault");
assert.ok(api.includes("ensureVault(db,school,subject,grade)") && api.includes("vault_id:vault.id"), "Manual questions must be assigned to their exact subject-grade vault");
assert.ok(api.includes("vault_ids:[...new Set") && api.includes("vaultByKey"), "PDF import must create and assign a separate vault for each detected subject and selected grade");
assert.ok(page.includes('id="vaults"') && page.includes("data-vault=") && page.includes("questionListInfo") && !page.includes("questionPageInfo") && !page.includes("prevQuestions"), "Question browsing must show one continuous list per subject-grade vault without visible pagination");
assert.ok(page.includes('id="questionTypeFilter"') && ["multiple_choice","fill_blank","true_false","short_answer","essay"].every(type=>page.includes('value="'+type+'"')), "Question bank must provide all five requested question-type filters");
assert.ok(api.includes('if(selectedType)questionQuery=questionQuery.eq("question_type",selectedType)') && api.includes(".range(offset,offset+999)") && api.includes("questions.push(...batch)") && api.includes('.order("created_at",{ascending:true})'), "The server must return every matching question in append order, batching internally beyond the API page limit");
assert.ok(page.includes('request.question_type=$("questionTypeFilter").value') && page.includes('request.search=$("search").value.trim()'), "Question text search and type filter must be combined in the same request");
assert.ok(page.includes("optionMarkup") && page.includes("option-row") && page.includes("question-prompt"), "Question text and its options must render as one structured question card");
assert.ok(page.includes("data-view=") && page.includes("questionDetailDialog") && page.includes("showQuestionDetail") && page.includes("question-detail-body"), "Every question must open a responsive full-content view with all options");
assert.ok(page.includes("font-size:16pt") && page.includes("gap:8px") && page.includes("@page{size:A4"), "Printed questions and options must use professional A4 typography and spacing");
