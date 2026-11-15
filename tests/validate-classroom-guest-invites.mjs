import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("supabase/migrations/20261115130000_classroom_single_use_guest_invites.sql", "utf8");
const token = readFileSync("supabase/functions/classroom-realtime-token/index.ts", "utf8");
const meetings = readFileSync("supabase/functions/classroom-meetings/index.ts", "utf8");
const managerPage = readFileSync("classroom/meetings.html", "utf8");
const realtimePage = readFileSync("classroom/realtime.html", "utf8");
const config = readFileSync("supabase/config.toml", "utf8");

assert.match(migration, /token_hash text not null unique/);
assert.match(migration, /enable row level security/i);
assert.match(migration, /revoke all .* from anon, authenticated/i);
assert.match(migration, /grant all .* to service_role/i);
assert.match(config, /\[functions\.classroom-realtime-token\][\s\S]*verify_jwt = false/);
assert.match(token, /const guestToken = clean\(body\?\.guest_token\)/);
assert.match(token, /await sha256Hex\(guestToken\)/);
assert.match(token, /\.eq\("use_count", invite\.use_count\)/);
assert.match(token, /\.is\("revoked_at", null\)/);
assert.match(token, /host: false, screenShare: false, role: "guest"/);
assert.match(token, /auth\.getUser\(bearer\)/);
assert.match(meetings, /if \(action === "guest_link"\)/);
assert.match(meetings, /max_uses: 1, use_count: 0/);
assert.match(managerPage, /ساخت لینک مهمان یک‌بارمصرف/);
assert.match(realtimePage, /guest_token/);
assert.match(realtimePage, /guestName/);
console.log("Classroom single-use guest invite checks passed.");
