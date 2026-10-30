/* Shared attendance classification for school reports. */
(function (global) {
  'use strict';
  function attendanceKind(value) {
    const status = String(value ?? '').trim()
      .replace(/[يى]/g, 'ی')
      .replace(/ك/g, 'ک')
      .toLocaleLowerCase('fa');
    if (['حاضر', 'present'].includes(status)) return 'present';
    if (['تاخیر', 'تأخیر', 'late'].includes(status)) return 'late';
    if (['موجه', 'excused'].includes(status)) return 'excused';
    if (['غایب', 'غیبت', 'غیرموجه', 'absent', 'unexcused'].includes(status)) return 'absent';
    return 'other';
  }
  global.FrahooshReportUtils = Object.freeze({ attendanceKind });
})(window);
