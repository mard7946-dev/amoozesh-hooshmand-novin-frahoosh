import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync("classroom/realtime.html", "utf8");
const meetingsHtml = readFileSync("classroom/meetings.html", "utf8");
const hostLoginFunction = readFileSync("supabase/functions/classroom-host-login/index.ts", "utf8");
const supabaseConfig = readFileSync("supabase/config.toml", "utf8");
assert.match(html, /livekit-client@2\.23\.0/);
assert.match(html, /id="whiteboard"/, "The classroom must include a shared teaching whiteboard");
assert.match(html, /id="boardPen"/, "Teachers must have a pen tool");
assert.match(html, /id="boardEraser"/, "Teachers must have an eraser tool");
assert.match(html, /id="boardText"/, "Teachers must be able to place text");
assert.match(html, /id="boardClear"/, "Teachers must be able to clear the board");
assert.match(html, /DataReceived/, "Participants must receive live whiteboard updates");
assert.match(html, /publishData/, "Authorized hosts must publish whiteboard updates");
assert.match(html, /id="audioStart"/, "The room must offer a user-gesture audio playback fallback");
assert.match(html, /AudioPlaybackStatusChanged/, "The room must detect blocked browser audio playback");
assert.match(html, /id="hostLoginForm"/, "Classroom entry must offer same-page school account authentication");
assert.match(html, /functions\/v1\/classroom-host-login/, "Host entry must resolve full name through the secure school-scoped login function");
assert.match(html, /id="hostFullName"/, "Host entry must request the host full name");
assert.match(html, /id="chooseGuest"/, "The branded entry screen must provide guest entry");
assert.match(html, /id="chooseHost"/, "The branded entry screen must provide host entry");
assert.match(html, /دبیرستان سردار شهید حاجی‌زاده ۲/);
assert.match(html, /سامانه هوشمند، مدرسه یکپارچه، دانش‌آموز خلاق/);
assert.match(html, /frahoosh-golden-brain\.svg/);
assert.match(readFileSync("classroom/assets/frahoosh-golden-brain.svg", "utf8"), /<svg/);
assert.match(hostLoginFunction, /from\("school_memberships"\)/, "Full-name host login must verify active school membership");
assert.match(hostLoginFunction, /school-portal-login/, "Host login must delegate password verification to the existing secure portal login");
assert.match(supabaseConfig, /\[functions\.classroom-host-login\][\s\S]*verify_jwt = false/);
assert.match(meetingsHtml, /id="duration" type="time"/, "Meeting duration must use a digital time control");
assert.ok(meetingsHtml.includes("duration_minutes:(()=>"), "Digital duration must be converted to minutes for the existing API");
assert.doesNotMatch(html, /recoverSessionFromOpenPortal|پنل فراهوش را در همین مرورگر باز نگه دارید/, "Classroom entry must not depend on another open portal tab");
assert.match(html, /querySelectorAll\("button"\)\.forEach\(button=>button.disabled=false\)/, "Leaving a room must allow users to re-enter");
assert.doesNotMatch(html, /@cloudflare\/realtimekit/i);
const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1])
  .filter((script) => script.trim());
assert.equal(inlineScripts.length, 1, "Expected one inline classroom client script");
for (const script of inlineScripts) new Function(script);

const tokenFunction = readFileSync("supabase/functions/classroom-realtime-token/index.ts", "utf8");
const meetingsFunction = readFileSync("supabase/functions/classroom-meetings/index.ts", "utf8");
const livekitHelper = readFileSync("supabase/functions/_shared/livekit.ts", "utf8");
const legacyClassroomRpcMigration = readFileSync("supabase/migrations/20261112081242_revoke_legacy_classroom_student_rpcs.sql", "utf8");
assert.match(legacyClassroomRpcMigration, /REVOKE EXECUTE ON FUNCTION public\.verify_online_class_student\([^;]+ FROM PUBLIC, anon, authenticated/i);
assert.match(legacyClassroomRpcMigration, /REVOKE EXECUTE ON FUNCTION public\.register_online_class_student_guest\([^;]+ FROM PUBLIC, anon, authenticated/i);


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
