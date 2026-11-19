import assert from "node:assert/strict";import{readFileSync}from"node:fs";
const p=readFileSync("teacher-photo-exam.html","utf8"),portal=readFileSync("portal.html","utf8"),wf=readFileSync(".github/workflows/publish-six-icon-portal.yml","utf8");
for(const x of ['id="photos"','multiple','data-f="text"','data-f="points"','data-f="lines"','اختلاف بارم','confirm(','size:A4','break-inside:avoid','تصویر اصلی سؤال','OCR هوش مصنوعی هنوز به سرویس تأییدشده متصل نشده'])assert.ok(p.includes(x),"Missing "+x);
assert.ok(p.includes("frahoosh_novin_access_token")&&p.includes('portalRole!=="teacher"'),"Page must reject direct access without the teacher session");
assert.ok(p.includes("اداره کل آموزش و پرورش شهرستان های استان تهران")&&p.includes("۱۴۰۵-۱۴۰۶")&&p.includes("نمره تجدید نظر با عدد")&&p.includes("تعداد صفحه")&&p.includes("ردیف")&&p.includes("question-row")&&p.includes("groups.length")&&p.includes("school-head"));
assert.ok(portal.includes("طراح برگه آزمون تصویری")&&portal.includes("teacher-photo-exam.html"));
assert.ok(wf.includes("'teacher-photo-exam.html'")&&wf.includes("teacher-photo-exam.html _site/"));
const js=[...p.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(x=>x[1]).filter(x=>x.trim()).at(-1);assert.doesNotThrow(()=>new Function(js));
console.log("Teacher photo exam builder checks passed.");