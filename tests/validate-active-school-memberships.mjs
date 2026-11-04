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
  assert.match(source, /import \{ hasActiveSchoolMembership \} from "\.\.\/_shared\/active-school-membership\.ts"/, `${path}: shared membership guard is imported`);
  assert.match(source, /hasActiveSchoolMembership\(admin,\s*(?:authData\.user\.id|login\.user\.id),\s*profile\.tenant_school_id,\s*profile\.role,\s*(?:normalize|norm)\)/, `${path}: access is guarded by the active profile membership`);
  
  
  
  
  
}

console.log("Active school membership authorization checks passed for all four protected functions.");
