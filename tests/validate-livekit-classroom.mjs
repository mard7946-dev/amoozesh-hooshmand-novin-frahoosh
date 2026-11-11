import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync("classroom/realtime.html", "utf8");
assert.match(html, /livekit-client@2\.23\.0/);
assert.doesNotMatch(html, /@cloudflare\/realtimekit/i);
const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1])
  .filter((script) => script.trim());
assert.equal(inlineScripts.length, 1, "Expected one inline classroom client script");
for (const script of inlineScripts) new Function(script);

const tokenFunction = readFileSync("supabase/functions/classroom-realtime-token/index.ts", "utf8");
const meetingsFunction = readFileSync("supabase/functions/classroom-meetings/index.ts", "utf8");
const livekitHelper = readFileSync("supabase/functions/_shared/livekit.ts", "utf8");

assert.match(tokenFunction, /createLiveKitParticipantToken/);
assert.match(tokenFunction, /classroom-authorize/);
assert.match(tokenFunction, /if \(!activeRoles\.has\(requestedRole\)\) \{/);
assert.match(tokenFunction, /const isHost = isCreator && requestedRole === "manager";/);
assert.match(tokenFunction, /liveKitRoomName\.startsWith\("frahoosh-"\)/, "Legacy RealtimeKit meeting IDs must not be issued as LiveKit room tokens");
assert.match(tokenFunction, /update\(\{ cloudflare_meeting_id: candidateRoomName \}\)/, "Existing scheduled room registry rows must migrate to a LiveKit room name");
assert.match(meetingsFunction, /storedRoomName\.startsWith\("frahoosh-"\)/, "Ending a legacy meeting must not call LiveKit with a RealtimeKit ID");
assert.doesNotMatch(tokenFunction, /CLOUDFLARE_REALTIME_API_TOKEN|cloudflare\(/i);
assert.match(meetingsFunction, /createLiveKitRoom/);
assert.match(meetingsFunction, /deleteLiveKitRoom/);
assert.doesNotMatch(meetingsFunction, /CLOUDFLARE_REALTIME_API_TOKEN|cloudflare\(/i);
assert.match(livekitHelper, /roomCreate:\s*true/);
assert.match(livekitHelper, /canPublishData:\s*false/);
assert.match(livekitHelper, /canPublishSources/);
assert.match(livekitHelper, /max_participants:\s*1000/);

console.log("LiveKit classroom migration checks passed.");
