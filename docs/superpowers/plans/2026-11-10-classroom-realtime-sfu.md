# Classroom Realtime SFU Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an isolated, testable Cloudflare Realtime SFU pilot for Frahoosh online classes without changing the existing RealtimeKit path.

**Architecture:** A new static pilot page uses separate producer and consumer WebRTC PeerConnections. A new Supabase Edge Function authenticates users, reuses `classroom-authorize` for scheduled-room admission, calls the Cloudflare Realtime SFU Connection API, and stores participant/publication discovery in a service-role-only table.

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

- [ ] Write tests for role normalization, excluding self/invalid/duplicate publications, and sanitizing provider errors.
- [ ] Run `deno test tests/classroom-sfu.test.ts`; verify the expected missing-module failure.
- [ ] Implement the minimal pure helpers.
- [ ] Run the focused test and the existing classroom schedule tests.

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
- POST actions: `join`, `snapshot`, `publish`, `subscribe`, `renegotiate`, `leave`.
- Environment: `CLOUDFLARE_SFU_APP_ID`, `CLOUDFLARE_SFU_APP_SECRET`.
- Browser response contains only short-lived room/session identifiers and SDP needed for negotiation; never provider credentials.

- [ ] Validate bearer token with Supabase Auth.
- [ ] For scheduled classes, invoke `classroom-authorize` with room ID, schedule entry ID, and active role.
- [ ] Verify current user owns the active participant row for every post-join action.
- [ ] Implement SFU session creation, local track publication, remote track subscription, renegotiation, snapshot, and cleanup.
- [ ] Check HTTP status and each track result; sanitize errors and do not log SDP.
- [ ] Add Deno type-check for the new function to CI.

### Task 4: Isolated browser pilot page

**Files:**
- Create: `classroom/sfu-pilot.html`

- [ ] Reuse the current Supabase session-storage contract and the existing `classroom-authorize` room list.
- [ ] Render only authorized schedule entries; retain the active-bell gate.
- [ ] Create producer and consumer PeerConnections with Cloudflare STUN.
- [ ] Capture local audio/video only after explicit user action; publish with the actual transceiver mids.
- [ ] Subscribe to authorized participants' active publications and map received mids to remote video elements.
- [ ] Queue per-session mutations; send mutation IDs, hold publisher lock until the browser applies the answer, and hold subscriber lock through `renegotiate`.
- [ ] Poll room snapshots with bounded intervals and reconcile subscriptions without duplicates.
- [ ] Implement explicit leave and cleanup; keep the current class page unchanged.

### Task 5: Verification and handoff

**Files:**
- Review: all files above and GitHub Actions results.

- [ ] Run `deno check` on the new function and helper.
- [ ] Run `deno test` for the new helper and existing classroom tests.
- [ ] Run the PostgreSQL SFU migration/lease test.
- [ ] Run the full repository `Validate classroom prototype` workflow.
- [ ] Verify no secret strings or SDP are emitted to browser logs or responses.
- [ ] Create a draft PR; do not merge or deploy until the user completes the SFU App and Secret setup and real two-device testing passes.
