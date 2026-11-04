import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const targets = [
  "supabase/functions/school-portal-login/index.ts",
  "supabase/functions/classroom-login/index.ts",
  "supabase/functions/classroom-authorize/index.ts",
  "supabase/functions/assessment-center/index.ts",
];

for (const path of targets) {
  const source = readFileSync(path, "utf8");
  assert.match(source, /async function hasActiveSchoolMembership\(/, `${path}: membership helper exists`);
  assert.match(source, /from\("school_memberships"\)/, `${path}: membership table is queried`);
  assert.match(source, /\.eq\("auth_user_id",\s*(?:authData\.user\.id|login\.user\.id)\)/, `${path}: membership is bound to authenticated user`);
  assert.match(source, /\.eq\("school_id",\s*profile\.tenant_school_id\)/, `${path}: membership is bound to profile school`);
  assert.match(source, /\.eq\("is_active",\s*true\)/, `${path}: inactive membership is excluded`);
  assert.match(source, /normalize\(membership\.role\)|norm\(membership\.role\)/, `${path}: membership role is checked`);
  assert.match(source, /if \(!membershipActive\)/, `${path}: access fails closed without active membership`);
}

console.log("Active school membership authorization checks passed for all four protected functions.");
