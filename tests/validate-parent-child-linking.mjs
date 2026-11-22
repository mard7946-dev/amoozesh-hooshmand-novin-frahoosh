import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const backend = readFileSync("supabase/functions/parent-management/index.ts", "utf8");
const page = readFileSync("parent-management.html", "utf8");

assert.match(backend, /action==="manage_child_links"/);
assert.match(backend, /if\(!isManager\).*403/s);
assert.match(backend, /actorMembership.*school_memberships/s);
assert.match(backend, /eq\("role","manager"\).*eq\("is_active",true\)/s);
assert.match(backend, /eq\("username",parentUsername\).*eq\("role","parent"\)/s);
assert.match(backend, /eq\("tenant_school_id",school\).*in\("id",studentIds\)/s);
assert.match(backend, /upsert\(rows,\{onConflict:"parent_username,student_id",ignoreDuplicates:true\}\)/);
assert.match(backend, /availableStudents:isManager\?/);
assert.match(backend, /availableStudentsResult.*isManager\?/s);

assert.match(page, /id="childLinkManager"/);
assert.match(page, /name="childLinkStudent"/);
assert.match(page, /action:'manage_child_links'/);
assert.match(page, /p\.national_code/);
assert.match(page, /normalizeParentKey\(x\.parent_username\)/);
assert.match(page, /d\.availableStudents/);

const inlineScripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)];
assert.ok(inlineScripts.length, "Expected the page's inline application script");
for (const match of inlineScripts) new Function(match[1]);

console.log("Parent-child linking validation passed.");
