import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync("family-communication.html", "utf8");
const portal = readFileSync("portal.html", "utf8");

for (const endpoint of [
  "/functions/v1/parent-management",
  "/functions/v1/parent-meetings",
  "/functions/v1/school-bulletin",
]) assert.ok(page.includes(endpoint), "Family center must reuse the authenticated existing service: " + endpoint);

assert.ok(page.includes("frahoosh_novin_access_token") && page.includes("Authorization:'Bearer '+token"), "All center requests must use the active authenticated session");
assert.ok(page.includes("!['parent','manager'].includes(role)"), "The unified center must be limited to parent and manager roles");
assert.ok(page.includes("Promise.allSettled"), "A failure in one communication service must not hide the other service results");
assert.ok(page.includes("api(endpoints.bulletins,'read',{id:b.id})"), "Bulletin receipt must be recorded against the exact bulletin ID");
assert.ok(page.includes("!x.is_read") && page.includes("!x.read_at"), "Unread messages and bulletins must be counted separately");
assert.ok(page.includes("parent-meetings.html") && page.includes("messages.html") && page.includes("bulletin.html"), "The center must link to the operational meeting, message, and bulletin workflows");
assert.ok(!page.includes("/rest/v1/") && !page.includes("createClient("), "The browser must not read school tables directly");

const scriptStart = page.indexOf("<script>");
const scriptEnd = page.indexOf("</script>", scriptStart);
assert.ok(scriptStart >= 0 && scriptEnd > scriptStart, "Family center must contain its application script");
assert.doesNotThrow(() => new Function(page.slice(scriptStart + 8, scriptEnd)), "Family center JavaScript must parse");

assert.ok(portal.includes("مرکز ارتباط مدرسه و خانواده") && portal.includes("family-communication.html"), "Manager and parent panels must route to the new family communication center");
assert.ok(portal.includes("portalAuthUserRole!==selectedRole.id"), "Panel routing must verify the authenticated role before opening the center");

console.log("Family communication center checks passed: authenticated service reuse, role boundary, partial service failures, receipt action, navigation, and JavaScript syntax.");
