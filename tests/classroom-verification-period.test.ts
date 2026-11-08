import { bellPosition, formatMinutes, sessionCheckpointMinutes } from "../supabase/functions/_shared/classroom-verification-period.ts";

Deno.test("bell-level checkpoints preserve exact clock times for a full-length session", () => {
  const first = bellPosition("13:40", 13 * 60 + 30, 14 * 60 + 20);
  const second = bellPosition("14:10", 13 * 60 + 30, 14 * 60 + 20);
  if (first === null || second === null) throw new Error("Expected valid bell positions");
  const checkpoints = sessionCheckpointMinutes("13:30", "14:20", first, second);
  if (!checkpoints || formatMinutes(checkpoints[0]) !== "13:40" || formatMinutes(checkpoints[1]) !== "14:10") {
    throw new Error("Full-bell sessions must retain the manager's exact checkpoint times");
  }
});

Deno.test("same bell checkpoints scale to a first-half parallel session", () => {
  const first = bellPosition("13:40", 13 * 60 + 30, 14 * 60 + 20);
  const second = bellPosition("14:10", 13 * 60 + 30, 14 * 60 + 20);
  if (first === null || second === null) throw new Error("Expected valid bell positions");
  const checkpoints = sessionCheckpointMinutes("13:30", "13:55", first, second);
  if (!checkpoints || formatMinutes(checkpoints[0]) !== "13:35" || formatMinutes(checkpoints[1]) !== "13:50") {
    throw new Error("Parallel half-session checkpoints must be scaled within that session");
  }
});

Deno.test("same bell checkpoints scale to a second-half parallel session", () => {
  const first = bellPosition("13:40", 13 * 60 + 30, 14 * 60 + 20);
  const second = bellPosition("14:10", 13 * 60 + 30, 14 * 60 + 20);
  if (first === null || second === null) throw new Error("Expected valid bell positions");
  const checkpoints = sessionCheckpointMinutes("13:55", "14:20", first, second);
  if (!checkpoints || formatMinutes(checkpoints[0]) !== "14:00" || formatMinutes(checkpoints[1]) !== "14:15") {
    throw new Error("Second-half parallel sessions must receive both scaled checkpoints");
  }
});

Deno.test("checkpoint inputs outside the bell window are rejected", () => {
  if (bellPosition("13:20", 13 * 60 + 30, 14 * 60 + 20) !== null) throw new Error("Before-bell checkpoint must be rejected");
  if (bellPosition("14:20", 13 * 60 + 30, 14 * 60 + 20) !== null) throw new Error("End-boundary checkpoint must be rejected");
});
