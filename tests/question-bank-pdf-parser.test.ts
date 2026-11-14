import { assertEquals } from "jsr:@std/assert";
import { parsePdfQuestions } from "../supabase/functions/question-bank/pdf-parser.ts";

Deno.test("extracts Persian and Latin numbered questions with choices and answers", () => {
  const text = [
    "۱) حاصل جمع دو و سه چیست؟",
    "الف) چهار",
    "ب) پنج",
    "ج) شش",
    "د) هفت",
    "پاسخ صحیح: ب",
    "2- کدام گزینه درست است؟",
    "A) گزینه اول",
    "B) گزینه دوم",
    "پاسخ: A",
  ].join("\n");
  assertEquals(parsePdfQuestions(text, "ریاضی"), [
    { subject: "ریاضی", prompt: "حاصل جمع دو و سه چیست؟", options: ["چهار", "پنج", "شش", "هفت"], question_type: "multiple_choice", correct_answer: "ب" },
    { subject: "ریاضی", prompt: "کدام گزینه درست است؟", options: ["گزینه اول", "گزینه دوم"], question_type: "multiple_choice", correct_answer: "A" },
  ]);
});

Deno.test("assigns explicit lesson sections to their own subjects", () => {
  const text = [
    "درس: ریاضی",
    "۱. حاصل دو در دو چیست؟",
    "درس: علوم",
    "۲) آب در چند درجه می‌جوشد؟",
  ].join("\n");
  const questions = parsePdfQuestions(text, "عمومی");
  assertEquals(questions.map(question => question.subject), ["ریاضی", "علوم"]);
});

Deno.test("ignores unnumbered prose and caps imported questions", () => {
  const questions = parsePdfQuestions("این فقط مقدمه است.\n۱- سؤال اول چیست؟\n۲- سؤال دوم چیست؟", "فارسی", 1);
  assertEquals(questions.length, 1);
  assertEquals(questions[0].subject, "فارسی");
});

Deno.test("normalizes Arabic letter variants and whitespace into consistent Persian text", () => {
  const questions = parsePdfQuestions("۱)  كدام  يكي  از موارد زير درست است؟\nالف) گزینه اول", "علوم");
  assertEquals(questions[0].prompt, "کدام یکی از موارد زیر درست است؟");
});
