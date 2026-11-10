# Classroom Realtime SFU Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an isolated, testable Cloudflare Realtime SFU pilot for Frahoosh online classes without changing the existing RealtimeKit path.

**Architecture:** A new static pilot page uses separate producer and consumer WebRTC PeerConnections. A new Supabase Edge Function authenticates users, reuses `classroom-authorize` for scheduled-room admission, calls the Cloudflare Realtime SFU Connection API, and stores participant, publication, and subscription state in a service-role-only table.

**Tech Stack:** Static HTML/JavaScript, Supabase Edge Functions (Deno + supabase-js v2), PostgreSQL, Cloudflare Realtime SFU Connection API.

**Spec:** `docs/superpowers/specs/2026-11-10-classroom-realtime-sfu-design.md`

## Global Constraints
- Only repository `mard7946-dev/amoozesh-hooshmand-novin-frahoosh`, branch `feat/classroom-realtime-sfu-pilot`.
- Do not modify `classroom/realtime.html`, `classroom-realtime-token`, or the current RealtimeKit registry semantics.
- Keep the SFU App Secret server-side; never include it in browser code, responses, logs, or Git.
- Require a valid Supabase user token and re-check room authorization before admission.
- Use the existing `classroom-authorize` function for scheduled class admission.
- Do not enable capture automatically; local microphone and camera start disabled.
- Serialize mutations per SFU session and validate every per-track result.

## Review Focus
- Missing/invalid SFU App ID or Secret must fail closed without leaking provider details.
- Duplicate join from the same user must not let an old session overwrite the current generation.
- A stale generation must not publish or subscribe after reconnect.
- Partial SFU track allocation must preserve successful track identifiers for cleanup.
- A participant from another room/school must never appear in the current room snapshot.

---

### Task 1: Pure SFU contract helpers and tests

**Files:**
- Create: `supabase/functions/_shared/classroom-sfu.ts`
- Test: `tests/classroom-sfu.test.ts`

**Interfaces:**
- `normalizeSfuRole(value: unknown): string`
- `buildRemoteTrackRequests(publications, excludedParticipantId): Array<{location:"remote";sessionId:string;trackName:string}>`
- `getSafeSfuError(status:number, body:unknown): {code:string; retryable:boolean; message:string}`

- [x] Write tests for role normalization, excluding self/invalid/duplicate publications, sanitizing provider errors, school-scoped room keys, and student-name privacy.
- [x] Run the focused tests first and observe the expected missing-export failures before implementing the helpers.
- [x] Implement the pure helpers.
- [x] Run the focused tests and existing classroom schedule tests in CI.

### Task 2: Private participant registry

**Files:**
- Create: `supabase/migrations/20261110100000_classroom_sfu_pilot.sql`

- [ ] Create `classroom_sfu_participants` with room key, school, source class/meeting, user, role, participant ID, publisher/subscriber session IDs, generation, publications, active status and timestamps.
- [ ] Add uniqueness for one active participant identity per room/user, lookup indexes, RLS, and revoke all client-role access; grant only service_role.
- [ ] Ensure scheduled classes and ad-hoc meetings cannot cross school boundaries at the function boundary.
- [ ] Review migration for safe constraints and no changes to existing RealtimeKit tables.

### Task 3: Secure SFU Edge Function

**Files:**
- Create: `supabase/functions/classroom-sfu/index.ts`
- Modify: `.github/workflows/validate.yml`

**Interfaces:**
- POST actions: `join`, `snapshot`, `publish`, `complete_publish`, `subscribe`, `renegotiate`, `leave`.
- Environment: `CLOUDFLARE_SFU_APP_ID`, `CLOUDFLARE_SFU_APP_SECRET`.
- Browser response contains only short-lived room/session identifiers and SDP needed for negotiation; never provider credentials.

- [x] Validate bearer token with Supabase Auth.
- [x] For scheduled classes, invoke `classroom-authorize` with room ID, schedule entry ID, and active role; re-check the schedule row belongs to the same school and class.
- [x] Verify current user owns the active participant row and generation for every post-join action.
- [x] Implement SFU session creation, local track publication, remote track subscription, renegotiation, snapshot, and cleanup.
- [x] Serialize publisher/subscriber mutations with expiring server-side leases and browser-side queues.
- [x] Inspect HTTP and per-track errors; reconcile session tracks for cleanup; sanitize errors and do not log SDP.
- [x] Add Deno type-check and unit tests to CI.

### Task 4: Isolated browser pilot page

**Files:**
- Create: `classroom/sfu-pilot.html`

- [x] Reuse the current Supabase session-storage contract and the existing `classroom-authorize` room list.
- [x] Render only authorized schedule entries; retain the active-bell gate.
- [x] Create producer and consumer PeerConnections with Cloudflare STUN.
- [x] Capture local audio/video only after explicit user action; publish with the actual transceiver mids.
- [x] Subscribe to authorized participants' active publications and map received mids to remote video elements.
- [x] Queue per-session mutations; send mutation IDs, hold publisher lock until the browser applies the answer, and hold subscriber lock through `renegotiate`.
- [x] Poll room snapshots with bounded intervals and reconcile subscriptions without duplicates.
- [x] Implement explicit leave and cleanup; keep the current class page unchanged.

### Task 5: Verification and handoff

**Files:**
- Review: all files above and GitHub Actions results.

- [x] Run `deno check` on the new function and helper.
- [x] Run `deno test` for the new helper and existing classroom tests.
- [x] Run the PostgreSQL SFU migration/lease test.
- [x] Run the full repository validation workflow (latest run 1049 passed).
- [x] Verify the browser page contains no SFU App Secret and that SDP is not logged or returned in diagnostics.
- [x] Create draft PR #55; keep it unmerged and undeployed.
- [ ] Create the Cloudflare SFU App and add its ID/Secret directly in Supabase Edge Function Secrets.
- [ ] Merge only after the user explicitly approves.
- [ ] Deploy the migration and Edge Function, then test real audio/video with two devices on separate networks.
- [ ] Configure TURN before broad school use; current pilot is STUN-only.
- [ ] Design selective track/active-speaker subscription and run load tests before claiming 700/1000 concurrent participants.
