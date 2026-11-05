import { isAttachmentBase64WithinLimit } from "../supabase/functions/frahoosh-messaging/attachment.ts";

function assertEqual(actual: boolean, expected: boolean, label: string) {
  if (actual !== expected) throw new Error(label + ": expected " + expected + ", received " + actual);
}

Deno.test("accepts base64 payloads within the decoded byte limit", () => {
  assertEqual(isAttachmentBase64WithinLimit("AAAA", 3), true, "3-byte payload");
  assertEqual(isAttachmentBase64WithinLimit("AAAAAA==", 4), true, "4-byte payload");
});

Deno.test("rejects oversized and empty payloads before decoding", () => {
  assertEqual(isAttachmentBase64WithinLimit("AAAAA", 3), false, "oversized payload");
  assertEqual(isAttachmentBase64WithinLimit("", 3), false, "empty payload");
});
