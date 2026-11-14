export type ParsedPdfQuestion = {
  subject: string;
  prompt: string;
  options: string[];
  question_type: "multiple_choice" | "essay";
  correct_answer: string;
};

const clean = (value: string) => value
  .replace(/[\u200e\u200f\u202a-\u202e]/g, "")
  .replace(/[\u00a0\t]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const toAsciiDigits = (value: string) => value
  .replace(/[۰-۹]/g, digit => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
  .replace(/[٠-٩]/g, digit => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));

const questionStart = /^\s*(?:(?:سؤال|سوال|پرسش)\s*(?:شماره\s*)?)?\d{1,3}\s*[.)\]ـ:：\-–—]\s*/i;
const optionLine = /^\s*(?:الف|ب|ج|د|آ|A|B|C|D)\s*[.)\]ـ:：\-–—]\s*/i;
const answerLine = /^\s*(?:پاسخ(?:\s*صحیح)?|جواب(?:\s*صحیح)?)\s*[:：\-–—]?\s*(الف|ب|ج|د|آ|[1-4]|A|B|C|D)(?:\s|$)/i;
const subjectHeading = /^\s*(?:درس|نام\s*درس|ماده\s*درسی)\s*[:：\-–—]\s*(.{2,80})\s*$/i;

export function parsePdfQuestions(
  input: string,
  fallbackSubject: string,
  maxQuestions = 100,
): ParsedPdfQuestion[] {
  const fallback = clean(fallbackSubject);
  const text = toAsciiDigits(input.replace(/\r/g, ""));
  const lines = text.split("\n").map(line => line.trim()).filter(Boolean);
  const blocks: Array<{ subject: string; lines: string[] }> = [];
  let currentSubject = fallback;
  let current: string[] = [];

  const flush = () => {
    if (current.length) blocks.push({ subject: currentSubject, lines: current });
    current = [];
  };

  for (const line of lines) {
    const heading = line.match(subjectHeading);
    if (heading) {
      flush();
      currentSubject = clean(heading[1]) || fallback;
      continue;
    }
    if (questionStart.test(line)) {
      flush();
      current.push(line.replace(questionStart, "").trim());
    } else if (current.length) {
      current.push(line);
    }
  }
  flush();

  const parsed: ParsedPdfQuestion[] = [];
  for (const block of blocks) {
    const promptLines: string[] = [];
    const options: string[] = [];
    let answer = "";
    let collectingOptions = false;

    for (const line of block.lines) {
      const answerMatch = line.match(answerLine);
      if (answerMatch) {
        answer = answerMatch[1];
        continue;
      }
      const optionMatch = line.match(optionLine);
      if (optionMatch) {
        collectingOptions = true;
        const value = clean(line.replace(optionLine, ""));
        if (value) options.push(value);
        continue;
      }
      if (collectingOptions && options.length && line.length < 240) {
        options[options.length - 1] = clean(options[options.length - 1] + " " + line);
      } else {
        promptLines.push(line);
      }
    }

    const prompt = clean(promptLines.join(" "));
    if (prompt.length < 5) continue;
    parsed.push({
      subject: block.subject || fallback,
      prompt,
      options: options.slice(0, 8),
      question_type: options.length >= 2 ? "multiple_choice" : "essay",
      correct_answer: answer,
    });
    if (parsed.length >= maxQuestions) break;
  }
  return parsed;
}
