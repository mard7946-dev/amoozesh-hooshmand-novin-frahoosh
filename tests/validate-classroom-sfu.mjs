import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../classroom/sfu-pilot.html", import.meta.url), "utf8");
const inlineScripts = [];
let cursor = 0;
while (true) {
  const start = html.indexOf("<script", cursor);
  if (start < 0) break;
  const openEnd = html.indexOf(">", start);
  const closeStart = html.indexOf("</script>", openEnd + 1);
  if (openEnd < 0 || closeStart < 0) break;
  const source = html.slice(openEnd + 1, closeStart);
  if (source.trim()) inlineScripts.push(source);
  cursor = closeStart + 9;
}

assert.ok(inlineScripts.length > 0, "SFU pilot must contain its browser controller");
for (const source of inlineScripts) new Function(source);

assert.ok(html.includes('postFunction("classroom-authorize"'), "Pilot must reuse the school authorization function");
assert.ok(html.includes('postFunction("classroom-sfu"'), "Pilot must call the isolated SFU backend");
assert.ok(html.includes('action:"publish"'), "Pilot must publish local tracks through the backend");
assert.ok(html.includes('action:"subscribe"'), "Pilot must subscribe to authorized remote tracks");
assert.ok(html.includes('action:"renegotiate"'), "Pilot must complete SFU offer/answer exchanges");
assert.ok(html.includes("mutation_id:mutationId"), "Pilot must bind renegotiation to the server-side mutation lock");
assert.ok(html.includes('action:"complete_publish"'), "Pilot must release publisher locks after applying the SFU answer");
assert.ok(html.includes('action:"leave"'), "Pilot must explicitly clean up when leaving");
assert.ok(html.includes("stun:stun.cloudflare.com:3478"), "Pilot must configure the documented Cloudflare STUN server");
assert.ok(html.includes("navigator.mediaDevices.getUserMedia"), "Pilot must request media only after an explicit user action");
assert.ok(!html.includes("CLOUDFLARE_SFU_APP_SECRET"), "SFU App Secret must never appear in browser assets");
assert.ok(!html.includes("CLOUDFLARE_REALTIME_API_TOKEN"), "RealtimeKit credentials must not appear in the new pilot");

const bootStart = html.indexOf("async function boot(){");
const bootEnd = html.indexOf('window.addEventListener("pagehide"', bootStart);
assert.ok(bootStart >= 0 && bootEnd > bootStart, "Pilot boot lifecycle must be present");
assert.ok(!html.slice(bootStart, bootEnd).includes("getUserMedia"), "Page load must not automatically request microphone or camera");

console.log("Classroom SFU pilot browser checks passed.");
