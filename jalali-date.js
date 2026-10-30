/* Shared Jalali date input/format utility for Frahoosh. Stored timestamps remain ISO-8601. */
(function (global) {
  'use strict';
  const tehran = 'Asia/Tehran';
  const digits = value => String(value ?? '').replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  const partsFormatter = new Intl.DateTimeFormat('en-u-ca-persian-nu-latn', {
    timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric'
  });
  function jalaliParts(date) {
    const p = partsFormatter.formatToParts(date);
    const get = type => Number(p.find(x => x.type === type)?.value || 0);
    return { y: get('year'), m: get('month'), d: get('day') };
  }
  function gregorianFromJalali(value) {
    const v = digits(value).trim();
    const m = v.match(/^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})$/);
    if (!m) throw new Error('تاریخ را به شکل ۱۴۰۵/۰۸/۰۸ وارد کنید.');
    const jy = Number(m[1]), jm = Number(m[2]), jd = Number(m[3]);
    if (jm < 1 || jm > 12 || jd < 1 || jd > 31) throw new Error('تاریخ شمسی معتبر نیست.');
    const center = Date.UTC(jy + 621, 2, 21);
    for (let offset = -190; offset <= 190; offset++) {
      const d = new Date(center + offset * 86400000);
      const p = jalaliParts(d);
      if (p.y === jy && p.m === jm && p.d === jd) return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
    }
    throw new Error('تاریخ شمسی معتبر پیدا نشد.');
  }
  const pad = n => String(n).padStart(2, '0');
  function toISODate(value) {
    if (!String(value ?? '').trim()) throw new Error('تاریخ شمسی را وارد کنید.');
    const g = gregorianFromJalali(value);
    return g.y + '-' + pad(g.m) + '-' + pad(g.d);
  }
  function toISODateTime(value) {
    const v = digits(value).trim();
    const m = v.match(/^(\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2})\s+(\d{1,2}):(\d{2})$/);
    if (!m) throw new Error('تاریخ و ساعت را به شکل ۱۴۰۵/۰۸/۰۸ ۱۴:۳۰ وارد کنید.');
    const hh = Number(m[2]), mm = Number(m[3]);
    if (hh > 23 || mm > 59) throw new Error('ساعت واردشده معتبر نیست.');
    const date = toISODate(m[1]);
    return date + 'T' + pad(hh) + ':' + pad(mm) + ':00+03:30';
  }
  function fromISODate(value) {
    if (!value) return '';
    const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return '';
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    const p = jalaliParts(d);
    return p.y + '/' + pad(p.m) + '/' + pad(p.d);
  }
  function formatDateTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
      timeZone: tehran, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).format(date);
  }
  global.FrahooshJalali = Object.freeze({ digits, toISODate, toISODateTime, fromISODate, formatDateTime });
})(window);
