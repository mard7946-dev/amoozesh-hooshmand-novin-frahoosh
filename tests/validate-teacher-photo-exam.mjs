import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const p=readFileSync("teacher-photo-exam.html","utf8");
const portal=readFileSync("portal.html","utf8");
const wf=readFileSync(".github/workflows/publish-six-icon-portal.yml","utf8");

for(const token of [
  'id="photos"','multiple','data-f="text"','data-f="points"','data-f="lines"',
  'confirm(','size:A4','break-inside:avoid','تصویر اصلی سؤال','تبدیل عکس به متن سؤال',
  'افزودن سؤال دستی','افزودن سؤال از تصویر بارگذاری‌شده','fas+eng',
  'در حال استخراج متن سؤال','متن سؤال استخراج شد'
]) assert.ok(p.includes(token),"Missing "+token);

assert.ok(p.includes("frahoosh_novin_access_token")&&p.includes('portalRole!=="teacher"'),"Page must reject direct access without the teacher session");
assert.ok(p.includes("اداره کل آموزش و پرورش شهرستان‌های استان تهران")&&p.includes("۱۴۰۵–۱۴۰۶")&&p.includes("class=\"school-head\""),"School identity and header must remain in the page");
assert.ok(portal.includes("طراح برگه آزمون تصویری")&&portal.includes("teacher-photo-exam.html"));
assert.ok(wf.includes("'teacher-photo-exam.html'")&&wf.includes("teacher-photo-exam.html _site/"));
assert.ok(p.includes("function makeDoc()")&&p.includes("question-card-head")&&p.includes("question-card-content"),"Print output must use the redesigned question cards");
assert.ok(p.includes("Vazirmatn")&&p.includes("question-type")&&p.includes("question-score"),"Professional output must include readable Persian typography, type and score labels");
assert.ok(p.includes("grid-template-columns:23mm 1fr")&&p.includes("background:#f8fafc")&&p.includes("border-top:3px solid #0f766e"),"Print header must use the new professional visual style");
assert.ok(p.includes('const groupable=new Set(["test","blank","tf","short"])')&&p.includes("group.items.push")&&p.includes('type==="essay"'),"Independent questions must be grouped by type while essay and composite questions remain separate");
assert.ok(p.includes("const visual=imageSrc?")&&p.includes("const text=q.text?")&&p.includes("q.cropDataUrl")&&p.includes("question-scan"),"Cropped question images and recognized text must appear together inside the same question card");
assert.ok(p.includes("cropOcrQuestionImage(p.file,item.bbox)")&&p.includes("bbox.x0")&&p.includes("bbox.x1")&&p.includes("const leftRule=")&&p.includes("const rightRule=")&&p.includes("const topRule=")&&p.includes("const bottomRule="),"OCR crops must use detected table-cell boundaries on both axes");
assert.ok(p.includes("data-f=\"type\"")&&p.includes('value="test"')&&p.includes('value="blank"')&&p.includes('value="tf"')&&p.includes('value="short"')&&p.includes('value="essay"'),"Every question must have a selectable question type");
assert.ok(p.includes("page-number")&&p.includes("@page{size:A4"),"A4 print layout must retain page numbering support");

const js=[...p.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(x=>x[1]).filter(x=>x.trim()).at(-1);
assert.doesNotThrow(()=>new Function(js),"Page JavaScript must parse");

const helperStart=p.indexOf("function normalizeOcrText(");
const helperEnd=p.indexOf("async function ocrPhoto",helperStart);
assert.ok(helperStart>=0&&helperEnd>helperStart,"OCR parsing helpers must be present");
const helpers=new Function(p.slice(helperStart,helperEnd)+"; return {splitOcrQuestions,inferOcrQuestionType,extractOcrQuestionRecords,detectOcrSection,groupOcrQuestionsForPrint};")();

const parsed=helpers.splitOcrQuestions("۱- حاصل ۲+۲ چیست؟\n۲- جای خالی را کامل کنید: تهران پایتخت ______ است.\n۳- درست یا نادرست: زمین گرد است.\n۴- گزینه صحیح را انتخاب کنید:\nالف) گزینه اول\nب) گزینه دوم");
assert.equal(parsed.length,4,"Numbered OCR questions must become separate question records");
assert.deepEqual(parsed.map(q=>q.type),["essay","blank","tf","test"],"OCR questions must be classified into the four requested types");
assert.equal(helpers.splitOcrQuestions("یک سؤال بدون شماره")[0].text,"یک سؤال بدون شماره","Unnumbered OCR text must remain one question");
assert.equal(helpers.detectOcrSection("سؤال‌های تستی"),"A","Persian multiple-choice section title must be recognized");
assert.equal(helpers.detectOcrSection("سؤال‌های جای خالی"),"B","Persian fill-in section title must be recognized");
assert.equal(helpers.detectOcrSection("سؤال‌های صحیح و غلط"),"C","Persian true-false section title must be recognized");
assert.equal(helpers.detectOcrSection("سوالات تشریحی"),"D","Persian essay section title must be recognized");


const grouped=helpers.groupOcrQuestionsForPrint([
 {type:"test",subparts:["الف","ب","ج","د"],composite:true},
 {type:"test"},
 {type:"blank"},
 {type:"blank"},
 {type:"tf"},
 {type:"short"},
 {type:"essay"},
 {type:"essay",subparts:["الف","ب"],composite:true}
]);
assert.deepEqual(grouped.map(g=>({type:g.type,single:g.single,count:g.items.length})),[
 {type:"test",single:false,count:2},
 {type:"blank",single:false,count:2},
 {type:"tf",single:false,count:1},
 {type:"short",single:false,count:1},
 {type:"essay",single:true,count:1},
 {type:"essay",single:true,count:1}
],"Test options must not be mistaken for composite subparts; independent types share one group and essays/composites remain separate");
assert.ok(p.includes(".question-group{margin:0 0 4mm;border:1px solid")&&p.includes(".question-item+.question-item{border-top:"),"Each type group must have one shared outer border, not a separate box around every question");

const layoutLines=[
 {text:"سؤال‌های تستی",bbox:{x0:10,y0:10,x1:300,y1:30}},
 {text:"۱) حاصل ۲+۲ چیست؟",bbox:{x0:10,y0:40,x1:300,y1:60}},
 {text:"الف) گزینه اول",bbox:{x0:10,y0:65,x1:300,y1:82}},
 {text:"ب) گزینه دوم",bbox:{x0:10,y0:84,x1:300,y1:101}},
 {text:"سؤال‌های جای خالی",bbox:{x0:10,y0:120,x1:300,y1:140}},
 {text:"سؤال ۲",bbox:{x0:10,y0:150,x1:300,y1:170}},
 {text:"تهران پایتخت ______ است.",bbox:{x0:10,y0:172,x1:300,y1:185}},
 {text:"سؤال‌های صحیح و غلط",bbox:{x0:10,y0:190,x1:300,y1:210}},
 {text:"۳) زمین گرد است.",bbox:{x0:10,y0:220,x1:300,y1:240}},
 {text:"سوالات تشریحی",bbox:{x0:10,y0:260,x1:300,y1:280}},
 {text:"۴) مجموعه زیر را بنویسید.",bbox:{x0:10,y0:290,x1:300,y1:310}},
 {text:"الف) زیرمجموعه اول",bbox:{x0:10,y0:315,x1:300,y1:332}},
 {text:"ب) زیرمجموعه دوم",bbox:{x0:10,y0:334,x1:300,y1:351}}
];
const layoutQuestions=helpers.extractOcrQuestionRecords({text:layoutLines.map(x=>x.text).join("\n"),lines:layoutLines});
assert.equal(layoutQuestions.length,4,"Layout OCR must keep the four printed exam sections separate");
assert.deepEqual(layoutQuestions.map(q=>q.section),["A","B","C","D"],"Section headings must determine each question's section");
assert.deepEqual(layoutQuestions.map(q=>q.type),["test","blank","tf","essay"],"Section headings must override noisy OCR type guesses");
assert.deepEqual(layoutQuestions.map(q=>q.number),["۱","۲","۳","۴"],"Question labels at the start or end of OCR lines must be recognized");
assert.ok(layoutQuestions[0].text.includes("الف) گزینه اول")&&layoutQuestions[0].text.includes("ب) گزینه دوم"),"Multiple-choice options must remain attached to their parent question");
assert.deepEqual(layoutQuestions[3].subparts,["الف","ب"],"Persian subparts must remain nested under the numbered essay question");
assert.ok(layoutQuestions[3].text.includes("الف) زیرمجموعه اول")&&layoutQuestions[3].text.includes("ب) زیرمجموعه دوم"),"Essay subpart text must not be split into independent questions");
assert.deepEqual(layoutQuestions.map(q=>q.bbox),[
 {x0:10,x1:300,y0:40,y1:115,toBottom:false},
 {x0:10,x1:300,y0:150,y1:185,toBottom:false},
 {x0:10,x1:300,y0:220,y1:255,toBottom:false},
 {x0:10,x1:300,y0:290,y1:351,toBottom:true}
],"Each question must retain its full vertical image region through the next question or section boundary");
assert.ok(layoutQuestions[3].bbox.toBottom,"The final question crop must extend to the bottom of its source image so its diagram is not lost");

console.log("Teacher photo exam builder checks passed.");

assert.ok(p.includes("subparts:item.subparts||[]")&&p.includes("composite:(item.subparts||[]).length>0"),"OCR-detected subparts must keep a multi-part question in one independent card");
assert.ok(p.includes("question-group")&&p.includes("question-item")&&p.includes("typeNames[group.type]"),"Print output must create shared type groups and individual question cards");
