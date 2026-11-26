import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("supabase/functions/school-bulletin/index.ts", "utf8");

assert.match(
  source,
  /educational:\{title:"تابلوی آموزشی",icon:"📚",roles:\["manager","deputy","educational"\]\}/,
  "معاون باید مجوز ثبت در تابلوی آموزشی را داشته باشد",
);
assert.match(
  source,
  /cultural:\{title:"تابلوی پرورشی، فرهنگی و ورزشی",icon:"🏅",roles:\["manager","deputy","cultural"\]\}/,
  "معاون باید مجوز ثبت در تابلوی فرهنگی را داشته باشد",
);
assert.match(
  source,
  /administrative:\{title:"تابلوی امور اداری",icon:"🗂️",roles:\["manager","deputy","executive"\]\}/,
  "معاون باید مجوز ثبت در تابلوی اداری را داشته باشد",
);
assert.match(
  source,
  /if\(!board\|\|!board\.roles\.includes\(u\.role\)\)/,
  "تابع باید مجوز نقش را سمت سرور کنترل کند",
);
assert.match(
  source,
  /status:manager\?"published":"pending_manager"/,
  "اطلاعیه معاون باید برای تأیید مدیر ارسال شود",
);

assert.match(source,/function audienceMatches\(b:any,u:any\)/,"نمایش اطلاعیه باید براساس مخاطبان انتخاب‌شده و نقش کاربر کنترل شود");
assert.match(source,/b.status==="published"&&audienceMatches\(b,u\)/,"کاربران فقط اطلاعیه منتشرشده و مجاز به نقش خود را ببینند");
assert.match(source,/audience_roles:parseAudience\(x.audience_roles\)/,"مخاطبان باید هنگام ثبت و ویرایش در پایگاه داده ذخیره شوند");
assert.match(source,/b.status==="published"&&audienceMatches\(b,u\)/,"دسترسی پیوست نیز باید با مخاطب اطلاعیه هماهنگ باشد");
console.log("School bulletin role and audience authorization checks passed.");
