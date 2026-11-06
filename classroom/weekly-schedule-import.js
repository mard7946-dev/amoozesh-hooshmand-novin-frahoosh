/* Convert Frahoosh's class-by-weekday Excel timetable into one row per lesson. */
(function (root) {
  const days = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"];
  const digitMap = "۰۱۲۳۴۵۶۷۸۹";
  const normalizeDigits = value => String(value ?? "")
    .replace(/[۰-۹]/g, d => String(digitMap.indexOf(d)))
    .replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  const key = value => normalizeDigits(value).replace(/[\u200c\u200f\s_ـ]/g, "").trim().toLowerCase();
  const gradeFor = className => {
    const first = normalizeDigits(className).trim().match(/^(7|8|9)\s*\//);
    return first ? ({ "7": "هفتم", "8": "هشتم", "9": "نهم" }[first[1]]) : "";
  };
  function parseCell(value) {
    const lines = String(value ?? "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (!lines.length) return [];
    const dashPairs = lines.map(line => {
      const match = line.match(/^(.+?)\s*[—–-]\s*(.+)$/);
      return match ? { subject: match[1].trim(), teacher: match[2].trim() } : null;
    });
    if (dashPairs.every(Boolean)) return dashPairs;
    if (lines.length >= 2 && lines.length % 2 === 0) {
      const pairs = [];
      for (let i = 0; i < lines.length; i += 2) pairs.push({ subject: lines[i], teacher: lines[i + 1] });
      return pairs;
    }
    return [];
  }
  function parseWeeklyScheduleMatrix(matrix) {
    if (!Array.isArray(matrix) || matrix.length < 4) return null;
    const heading = key((matrix[1] || [])[0]);
    const periodHeading = (matrix[2] || []).map(key).join("|");
    if (!heading.includes("کلاس") || !periodHeading.includes("زنگ")) return null;
    const header = matrix[1] || [], periods = matrix[2] || [];
    let activeDay = "";
    const columns = [];
    for (let col = 1; col < Math.max(header.length, periods.length); col++) {
      if (header[col] && days.some(day => key(day) === key(header[col]))) activeDay = days.find(day => key(day) === key(header[col])) || activeDay;
      const match = normalizeDigits(periods[col]).match(/(?:زنگ\s*)?(\d+)/);
      const period = match ? Number(match[1]) : 0;
      columns.push({ col, weekday: activeDay, period });
    }
    const title = normalizeDigits((matrix[0] || []).filter(Boolean).join(" "));
    const yearMatch = title.match(/(\d{4})\s*[-–]\s*(\d{4})/);
    const academicYear = yearMatch ? yearMatch[1] + "-" + yearMatch[2] : "";
    const rows = [], skipped = [], classNames = new Set();
    for (let rowIndex = 3; rowIndex < matrix.length; rowIndex++) {
      const source = matrix[rowIndex] || [];
      const className = String(source[0] ?? "").trim();
      if (!className) continue;
      classNames.add(className);
      for (const column of columns) {
        if (!column.weekday || !column.period || column.period > 6) continue;
        const cell = source[column.col];
        if (!String(cell ?? "").trim()) continue;
        const pairs = parseCell(cell);
        if (!pairs.length) {
          skipped.push({ row: rowIndex + 1, class_name: className, weekday: column.weekday, period: column.period, value: String(cell) });
          continue;
        }
        const slotTimes = { 1: ["13:30", "14:20"], 2: ["14:30", "15:20"], 3: ["15:30", "16:20"] }[column.period] || ["", ""];
        const toMinutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
        const toClock = value => String(Math.floor(value / 60)).padStart(2, "0") + ":" + String(value % 60).padStart(2, "0");
        const slotStart = toMinutes(slotTimes[0]), slotEnd = toMinutes(slotTimes[1]);
        for (const [pairIndex, pair] of pairs.entries()) {
          if (!pair.subject || !pair.teacher) {
            skipped.push({ row: rowIndex + 1, class_name: className, weekday: column.weekday, period: column.period, value: String(cell) });
            continue;
          }
          // Parallel subjects inside one class bell share the bell in equal consecutive segments.
          // This prevents same-class time collisions while preserving the original bell boundary.
          const start = slotStart + Math.floor((slotEnd - slotStart) * pairIndex / pairs.length);
          const end = slotStart + Math.floor((slotEnd - slotStart) * (pairIndex + 1) / pairs.length);
          rows.push({ class_name: className, weekday: column.weekday, period: column.period, subject: pair.subject, teacher: pair.teacher,
            grade: gradeFor(className), start_time: toClock(start), end_time: toClock(end), academic_year: academicYear });
        }
      }
    }
    return { rows, skipped, class_count: classNames.size, format: "class-by-weekday-matrix" };
  }
  root.frahooshParseWeeklyScheduleMatrix = parseWeeklyScheduleMatrix;
})(typeof window !== "undefined" ? window : globalThis);
