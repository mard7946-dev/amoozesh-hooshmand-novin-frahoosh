import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const window = {};
vm.runInNewContext(readFileSync(new URL('../jalali-date.js', import.meta.url), 'utf8'), { window, Intl, Date, Error, String, Number, RegExp, Object });
const dates = window.FrahooshJalali;
assert.equal(dates.toISODate('۱۴۰۵/۰۸/۰۸'), '2026-10-30');
assert.equal(dates.toISODate('۱۴۰۵/۱۲/۲۹'), '2027-03-20');
assert.equal(dates.toISODate('۱۴۰۶/۰۱/۰۱'), '2027-03-21');
assert.equal(dates.fromISODate('2026-10-30'), '1405/08/08');
assert.equal(dates.toISODateTime('۱۴۰۵/۰۸/۰۸ ۱۴:۳۰'), '2026-10-30T14:30:00+03:30');
assert.match(dates.formatDateTime('2026-10-30T14:30:00+03:30'), /۱۴۰۵|1405/);
assert.throws(() => dates.toISODate('۱۴۰۵/۱۳/۰۱'), /معتبر/);
assert.throws(() => dates.toISODateTime('۱۴۰۵/۰۸/۰۸ ۲۵:۹۹'), /معتبر/);

for (const file of ['exam-center.html', 'classroom/management.html']) {
  const html = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  assert.match(html, /jalali-date\.js/, file + ' must load the shared Jalali utility');
  assert.doesNotMatch(html, /type=["']date["']|type=["']datetime-local["']/i, file + ' must not expose Gregorian native date controls');
}
const bulletin = readFileSync(new URL('../bulletin.html', import.meta.url), 'utf8');
assert.match(bulletin, /for\(let i=-2;i<=370;i\+\+\)/, 'bulletin date conversion must scan the full Jalali year');
assert.match(bulletin, /timeZone:'Asia\/Tehran'/, 'bulletin dates must use Tehran time');
assert.match(bulletin, /-210\*60\*1000/, 'bulletin date-time inputs must be converted from Tehran time to UTC');

const exam = readFileSync(new URL('../exam-center.html', import.meta.url), 'utf8');
assert.match(exam, /toISODateTime\(\$\('startsDate'\)\.value\+.*startsTime/);
assert.match(exam, /toISODateTime\(\$\('endsDate'\)\.value\+.*endsTime/);
const classroom = readFileSync(new URL('../classroom/management.html', import.meta.url), 'utf8');
assert.match(classroom, /toISODate\(\$\('attDate'\)\.value\)/);
assert.match(classroom, /toISODate\(\$\('hwDue'\)\.value\)/);
assert.match(classroom, /toISODate\(\$\('discDate'\)\.value\)/);

for (const file of ['family-invitations.html','parent-meetings.html','finance.html','reports.html','counseling.html','bulletin.html','parent-management.html']) {
  const html = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  assert.match(html, /jalali-date\.js/, file + ' must load shared date picker');
}
const reports = readFileSync(new URL('../reports.html', import.meta.url), 'utf8');
assert.equal((reports.match(/data-jalali-date/g) || []).length, 2, 'both report date filters must use the Jalali picker');
const invitations = readFileSync(new URL('../family-invitations.html', import.meta.url), 'utf8');
assert.match(invitations, /data-jalali-date/);
assert.match(invitations, /data-digital-time/);
const picker = readFileSync(new URL('../jalali-date.js', import.meta.url), 'utf8');
assert.match(picker, /data-jalali-date/);
assert.match(picker, /data-digital-time/);
assert.match(picker, /input\.type='hidden'/, 'the named form field must preserve the HH:mm value without invoking native time controls');
assert.match(picker, /type='number'/, 'hour and minute must use numeric controls');
assert.match(picker, /data-hour|ساعت/, 'digital control must expose an hour value');
assert.match(picker, /دقیقه/, 'digital control must expose a minute value');
assert.match(picker, /frahoosh-time-arrow/, 'hour and minute must have explicit up/down arrow buttons');
assert.match(picker, /input\.type='hidden'/);
assert.doesNotMatch(picker, /input\.type='time'/, 'native time controls can open an analog clock on mobile');
assert.match(picker, /input\.min='0'/);
assert.match(picker, /input\.max=String\(max\)/);
assert.match(picker, /انتخاب ساعت دیجیتال|ساعت/);
assert.match(picker, /firstDay=\(first\.getUTCDay\(\)\+1\)%7/);
console.log('Jalali date and picker validation passed.');
