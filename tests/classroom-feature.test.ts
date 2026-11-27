import { assertEquals } from "jsr:@std/assert";
import { canEnterOnlineClass } from "../supabase/functions/_shared/classroom-feature.ts";

Deno.test("new school stays blocked while global service is enabled", () => {
  assertEquals(canEnterOnlineClass(true, false), false);
});

Deno.test("legacy school remains available when both switches are enabled", () => {
  assertEquals(canEnterOnlineClass(true, true), true);
});

Deno.test("global master switch blocks ordinary users even when school is enabled", () => {
  assertEquals(canEnterOnlineClass(false, true), false);
});

Deno.test("platform admin retains emergency access regardless of school switch", () => {
  assertEquals(canEnterOnlineClass(false, false, true), true);
});
