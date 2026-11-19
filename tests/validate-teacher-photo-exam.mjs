import assert from "node:assert/strict";import{readFileSync}from"node:fs";
const p=readFileSync("teacher-photo-exam.html","utf8"),portal=readFileSync("portal.html","utf8"),wf=readFileSync(".github/workflows/publish-six-icon-portal.yml","utf8");
for(const x of ['id="photos"','multiple','data-f="text"','data-f="points"','data-f="lines"','اختلاف بارم','confirm(','size:A4','break-inside:avoid','تصویر اصلی سؤال','تبدیل عکس به متن سؤال','افزودن سؤال دستی','افزودن سؤال از تصویر بارگذاری‌شده','fas+eng','در حال استخراج متن سؤال','متن سؤال استخراج شد'])assert.ok(p.includes(x),"Missing "+x);
assert.ok(p.includes("frahoosh_novin_access_token")&&p.includes('portalRole!=="teacher"'),"Page must reject direct access without the teacher session");
assert.ok(p.includes("اداره كل آموزش و پرورش شهرستان هاي استان تهران")&&p.includes("۱۴۰۶-۱۴۰۵")&&p.includes("نمره تجدید نظر با عدد")&&p.includes("تعداد صفحه")&&p.includes("class=\"school-head\"")&&p.includes("groups.length"),"Exam print header must retain school identity, year, page count, and review fields");
assert.ok(portal.includes("طراح برگه آزمون تصویری")&&portal.includes("teacher-photo-exam.html"));
assert.ok(wf.includes("'teacher-photo-exam.html'")&&wf.includes("teacher-photo-exam.html _site/"));
assert.ok(p.includes('<div class="question-number">سؤال ')&&p.includes('<div class="question-mark">بارم: ')&&p.includes('<article class="question-card question-row">'),"Each question must render in its own bordered card with its number and score");
assert.ok(p.includes("position:relative;display:flex;align-items:center;justify-content:center")&&p.includes("سال تحصیلی ۱۴۰۶-۱۴۰۵"),"Centered header and Persian year must be formatted");
assert.ok(p.includes(".figure{display:block;width:auto;height:auto;max-width:100%;max-height:none;object-fit:contain") && p.includes("'+photo.dataUrl+'") && p.includes("reader.readAsDataURL(f)"),"Original uploaded image must be embedded as a data URL in print output with proportional sizing and no height clipping");assert.ok(p.includes("question-card")&&p.includes("questions-list")&&p.includes("Vazirmatn")&&p.includes("document.fonts.ready"),"Print output must use independent question cards and wait for the Persian font");assert.ok(p.includes('data-f="type"')&&p.includes('value="test"')&&p.includes('value="blank"')&&p.includes('value="tf"')&&p.includes('value="short"')&&p.includes('value="essay"'),"Every question must have a selectable question type");assert.ok(p.includes('class="type-card question-row"')&&p.includes('type==="essay"?items.map')&&p.includes('سؤال‌های تستی')&&p.includes('سؤال‌های جای خالی')&&p.includes('سؤال‌های صحیح و غلط')&&p.includes('سؤال‌های پاسخ کوتاه'),"Objective questions must be grouped by type and every essay question must have its own card");
const js=[...p.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(x=>x[1]).filter(x=>x.trim()).at(-1);assert.doesNotThrow(()=>new Function(js));

// Exercise the same OCR segmentation and classification functions used by the page.
const helperStart=p.indexOf("function normalizeOcrText("),helperEnd=p.indexOf("async function ocrPhoto",helperStart);
const helperSource=p.slice(helperStart,helperEnd);
assert.ok(helperStart>=0&&helperEnd>helperStart,"Layout-aware OCR parsing helpers must be present");
const ocrHelpers=new Function(helperSource+"; return {splitOcrQuestions,inferOcrQuestionType,extractOcrQuestionRecords};")();
const parsed=ocrHelpers.splitOcrQuestions("۱- حاصل ۲+۲ چیست؟\n۲- جای خالی را کامل کنید: تهران پایتخت ______ است.\n۳- درست یا نادرست: زمین گرد است.\n۴- گزینه صحیح را انتخاب کنید:\nالف) گزینه اول\nب) گزینه دوم");
assert.equal(parsed.length,4,"Numbered OCR questions must become separate question records");
assert.deepEqual(parsed.map(q=>q.type),["essay","blank","tf","test"],"OCR questions must be classified into the four requested types");
assert.equal(ocrHelpers.splitOcrQuestions("یک سؤال بدون شماره")[0].text,"یک سؤال بدون شماره","Unnumbered OCR text must remain one question");
assert.ok(p.includes("متن تصویر به ")&&p.includes("S.questions.splice(firstIndex,1,...created)"),"OCR must insert separated questions into the question list"); 
const layoutLines=[{text:"گزینه صحیح را انتخاب کنید",bbox:{x0:10,y0:10,x1:300,y1:30}},{text:"۱) حاصل ۲+۲ چیست؟",bbox:{x0:10,y0:40,x1:300,y1:60}},{text:"الف) گزینه اول",bbox:{x0:10,y0:65,x1:300,y1:82}},{text:"ب) گزینه دوم",bbox:{x0:10,y0:84,x1:300,y1:101}},{text:"در جای خالی کلمه مناسب را بنویسید",bbox:{x0:10,y0:120,x1:300,y1:140}},{text:"۱) تهران پایتخت ______ است.",bbox:{x0:10,y0:150,x1:300,y1:170}},{text:"درستی و نادرستی عبارت‌های زیر را مشخص کنید",bbox:{x0:10,y0:190,x1:300,y1:210}},{text:"۱) زمین گرد است.",bbox:{x0:10,y0:220,x1:300,y1:240}},{text:"سوالات تشریحی",bbox:{x0:10,y0:260,x1:300,y1:280}},{text:"۱) مجموعه زیر را بنویسید.",bbox:{x0:10,y0:290,x1:300,y1:310}},{text:"الف) زیرمجموعه اول",bbox:{x0:10,y0:315,x1:300,y1:332}},{text:"ب) زیرمجموعه دوم",bbox:{x0:10,y0:334,x1:300,y1:351}}];
const layoutQuestions=ocrHelpers.extractOcrQuestionRecords({text:layoutLines.map(x=>x.text).join("\\n"),lines:layoutLines});
assert.equal(layoutQuestions.length,4,"Layout OCR must keep the four printed exam sections separate");
assert.deepEqual(layoutQuestions.map(q=>q.section),["A","B","C","D"],"Section headers must determine each question's section");
assert.deepEqual(layoutQuestions.map(q=>q.type),["test","blank","tf","essay"],"Section headings must override noisy OCR type guesses");
assert.ok(layoutQuestions[0].text.includes("الف) گزینه اول")&&layoutQuestions[0].text.includes("ب) گزینه دوم"),"Multiple-choice options must remain attached to their parent question");
assert.deepEqual(layoutQuestions[3].subparts,["الف","ب"],"Persian subparts must remain nested under the numbered essay question");
assert.ok(layoutQuestions[3].text.includes("الف) زیرمجموعه اول")&&layoutQuestions[3].text.includes("ب) زیرمجموعه دوم"),"Essay subpart text must not be split into independent questions");


console.log("Teacher photo exam builder checks passed.");