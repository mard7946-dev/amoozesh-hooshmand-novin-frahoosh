export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/** Reject oversized base64 before decoding it into a second in-memory copy. */
export function isAttachmentBase64WithinLimit(base64: string, maxBytes = MAX_ATTACHMENT_BYTES): boolean {
  const normalized = base64.replace(/\s/g, "");
  if (!normalized || !Number.isFinite(maxBytes) || maxBytes <= 0) return false;
  return normalized.length <= Math.ceil(maxBytes / 3) * 4;
}
