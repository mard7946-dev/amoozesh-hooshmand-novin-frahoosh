const clean = (value: unknown) => String(value ?? "").replace(/[\u200c\u200f\u202a-\u202e]/g, "").trim();
const norm = (value: unknown) => clean(value).replace(/[۰-۹]/g, d => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
  .replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).toLocaleLowerCase("fa");
const key = (value: unknown) => norm(value).replace(/\s+/g, "");
const isTeacherRole = (role: unknown) => ["teacher", "دبیر", "معلم"].some(value => norm(role).includes(norm(value)));

export function activeTeacherAccounts(accounts: any[], memberships: any[]) {
  const teacherMembershipIds = new Set((memberships ?? [])
    .filter((membership: any) => membership?.is_active !== false && isTeacherRole(membership?.role))
    .map((membership: any) => clean(membership.auth_user_id)));
  return (accounts ?? []).filter((account: any) =>
    isTeacherRole(account?.role) || teacherMembershipIds.has(clean(account?.auth_user_id))
  );
}

export function resolveTeacherAccount(row: any, teacherAccounts: any[]) {
  const requested = clean(row?.teacher_username);
  if (requested) return (teacherAccounts ?? []).find((account: any) => key(account.username) === key(requested)) ?? null;
  const teacherKey = key(row?.teacher ?? row?.teacher_name);
  if (!teacherKey) return null;
  const matches = (teacherAccounts ?? []).filter((account: any) => {
    const displayKey = key(account.display_name);
    const usernameKey = key(account.username);
    const nameParts = norm(account.display_name).split(/\s+/).filter(Boolean);
    const lastNameKey = key(nameParts[nameParts.length - 1] || "");
    return displayKey === teacherKey || usernameKey === teacherKey || displayKey.endsWith(teacherKey) ||
      lastNameKey === teacherKey || (teacherKey.length >= 4 && lastNameKey.startsWith(teacherKey));
  });
  return matches.length === 1 ? matches[0] : null;
}
