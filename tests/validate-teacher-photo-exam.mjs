import assert from "node:assert/strict";import{readFileSync}from"node:fs";
const p=readFileSync("teacher-photo-exam.html","utf8"),portal=readFileSync("portal.html","utf8"),wf=readFileSync(".github/workflows/publish-six-icon-portal.yml","utf8");
for(const x of ['id="photos"','multiple','data-f="text"','data-f="points"','data-f="lines"','اختلاف بارم','confirm(','size:A4','break-inside:avoid','تصویر اصلی سؤال','تبدیل عکس به متن سؤال','افزودن سؤال دستی','افزودن سؤال از تصویر بارگذاری‌شده','fas+eng','در حال استخراج متن سؤال','متن استخراج شد'])assert.ok(p.includes(x),"Missing "+x);
assert.ok(p.includes("frahoosh_novin_access_token")&&p.includes('portalRole!=="teacher"'),"Page must reject direct access without the teacher session");
assert.ok(p.includes("اداره كل آموزش و پرورش شهرستان هاي استان تهران")&&p.includes("۱۴۰۶-۱۴۰۵")&&p.includes("نمره تجدید نظر با عدد")&&p.includes("تعداد صفحه")&&p.includes("class=\"school-head\"")&&p.includes("groups.length"),"Exam print header must retain school identity, year, page count, and review fields");
assert.ok(portal.includes("طراح برگه آزمون تصویری")&&portal.includes("teacher-photo-exam.html"));
assert.ok(wf.includes("'teacher-photo-exam.html'")&&wf.includes("teacher-photo-exam.html _site/"));
assert.ok(p.includes('<div class="question-number">سؤال ')&&p.includes('<div class="question-mark">بارم: ')&&p.includes('<article class="question-card question-row">'),"Each question must render in its own bordered card with its number and score");
assert.ok(p.includes("position:relative;display:flex;align-items:center;justify-content:center")&&p.includes("سال تحصیلی ۱۴۰۶-۱۴۰۵"),"Centered header and Persian year must be formatted");
assert.ok(p.includes(".figure{display:block;width:auto;height:auto;max-width:100%;max-height:none;object-fit:contain") && p.includes("'+photo.dataUrl+'") && p.includes("reader.readAsDataURL(f)"),"Original uploaded image must be embedded as a data URL in print output with proportional sizing and no height clipping");assert.ok(p.includes("question-card")&&p.includes("questions-list")&&p.includes("Vazirmatn")&&p.includes("document.fonts.ready"),"Print output must use independent question cards and wait for the Persian font");assert.ok(p.includes('data-f="type"')&&p.includes('value="test"')&&p.includes('value="blank"')&&p.includes('value="tf"')&&p.includes('value="short"')&&p.includes('value="essay"'),"Every question must have a selectable question type");assert.ok(p.includes('class="type-card question-row"')&&p.includes('type==="essay"?items.map')&&p.includes('سؤال‌های تستی')&&p.includes('سؤال‌های جای خالی')&&p.includes('سؤال‌های صحیح و غلط')&&p.includes('سؤال‌های پاسخ کوتاه'),"Objective questions must be grouped by type and every essay question must have its own card");
const js=[...p.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(x=>x[1]).filter(x=>x.trim()).at(-1);assert.doesNotThrow(()=>new Function(js));

// Exercise the same OCR segmentation and classification functions used by the page.
const helperSource=p.match(/function splitOcrQuestions\(raw\)\{[\s\S]*?function inferOcrQuestionType\(text\)\{[\s\S]*?\n\}/)?.[0];
assert.ok(helperSource,"OCR segmentation helper must be present");
const ocrHelpers=new Function(helperSource+"; return {splitOcrQuestions,inferOcrQuestionType};")();
const parsed=ocrHelpers.splitOcrQuestions("۱- حاصل ۲+۲ چیست؟\n۲- جای خالی را کامل کنید: تهران پایتخت ______ است.\n۳- درست یا نادرست: زمین گرد است.\n۴- گزینه صحیح را انتخاب کنید:\nالف) گزینه اول\nب) گزینه دوم");
assert.equal(parsed.length,4,"Numbered OCR questions must become separate question records");
assert.deepEqual(parsed.map(q=>q.type),["essay","blank","tf","test"],"OCR questions must be classified into the four requested types");
assert.equal(ocrHelpers.splitOcrQuestions("یک سؤال بدون شماره")[0].text,"یک سؤال بدون شماره","Unnumbered OCR text must remain one question");
assert.ok(p.includes("متن تصویر به ")&&p.includes("S.questions.splice(firstIndex,1,...created)"),"OCR must insert separated questions into the question list");

console.log("Teacher photo exam builder checks passed.");