import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isAttachmentBase64WithinLimit } from "../supabase/functions/frahoosh-messaging/attachment.ts";

Deno.test("accepts base64 payloads within the decoded byte limit", () => {
  assertEquals(isAttachmentBase64WithinLimit("AAAA", 3), true);
  assertEquals(isAttachmentBase64WithinLimit("AAAAAA==", 4), true);
});

Deno.test("rejects oversized and empty payloads before decoding", () => {
  assertEquals(isAttachmentBase64WithinLimit("AAAAA", 3), false);
  assertEquals(isAttachmentBase64WithinLimit("", 3), false);
});
