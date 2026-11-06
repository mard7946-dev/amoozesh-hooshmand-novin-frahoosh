import { activeTeacherAccounts, resolveTeacherAccount } from "../supabase/functions/classroom-management/teacher-identity.ts";

const accounts = [
  { username: "teacher-1", auth_user_id: "u1", display_name: "رضا فهیم‌راد", role: "teacher" },
  { username: "teacher-2", auth_user_id: "u2", display_name: "علی پورمیرزایی", role: "teacher" },
  { username: "teacher-3", auth_user_id: "u3", display_name: "مسلم محمد زاده", role: "teacher" },
  { username: "dual-cultural", auth_user_id: "u4", display_name: "عادل کلهر", role: "cultural" },
  { username: "dual-educational", auth_user_id: "u5", display_name: "محمدرضا صفی", role: "educational" },
  { username: "inactive-dual", auth_user_id: "u6", display_name: "دبیر غیرفعال", role: "cultural" },
];
const memberships = [
  { auth_user_id: "u4", role: "cultural", is_active: true },
  { auth_user_id: "u4", role: "teacher", is_active: true },
  { auth_user_id: "u5", role: "educational", is_active: true },
  { auth_user_id: "u5", role: "teacher", is_active: true },
  { auth_user_id: "u6", role: "teacher", is_active: false },
];
const teachers = activeTeacherAccounts(accounts, memberships);

Deno.test("active teacher memberships include staff with dual primary roles", () => {
  if (!teachers.some(account => account.username === "dual-cultural")) throw new Error("cultural staff with active teacher membership was omitted");
  if (!teachers.some(account => account.username === "dual-educational")) throw new Error("educational staff with active teacher membership was omitted");
  if (teachers.some(account => account.username === "inactive-dual")) throw new Error("inactive teacher membership must not grant teacher matching");
});

Deno.test("unique surname aliases resolve to the active teacher account", () => {
  const cases = [
    ["فهیم راد", "teacher-1"],
    ["پورمیرزا", "teacher-2"],
    ["محمدزاده", "teacher-3"],
    ["کلهر", "dual-cultural"],
    ["صفی", "dual-educational"],
  ];
  for (const [alias, username] of cases) {
    const resolved = resolveTeacherAccount({ teacher: alias }, teachers);
    if (resolved?.username !== username) throw new Error("Failed to resolve " + alias);
  }
});

Deno.test("ambiguous teacher aliases are rejected instead of guessed", () => {
  const ambiguous = [
    ...teachers,
    { username: "teacher-7", auth_user_id: "u7", display_name: "مهدی فهیم راد", role: "teacher" },
  ];
  if (resolveTeacherAccount({ teacher: "فهیم راد" }, ambiguous) !== null) throw new Error("ambiguous teacher alias must not be selected");
});
