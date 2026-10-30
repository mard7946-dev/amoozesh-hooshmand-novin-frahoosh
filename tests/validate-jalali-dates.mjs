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
assert.match(exam, /toISODateTime\(f\.get\('starts_at'\)\)/);
assert.match(exam, /toISODateTime\(f\.get\('ends_at'\)\)/);
const classroom = readFileSync(new URL('../classroom/management.html', import.meta.url), 'utf8');
assert.match(classroom, /toISODate\(\$\('attDate'\)\.value\)/);
assert.match(classroom, /toISODate\(\$\('hwDue'\)\.value\)/);
assert.match(classroom, /toISODate\(\$\('discDate'\)\.value\)/);
console.log('Jalali date validation passed.');
