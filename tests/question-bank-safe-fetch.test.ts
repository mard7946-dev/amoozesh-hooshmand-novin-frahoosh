import { assertEquals, assertThrows } from "jsr:@std/assert";
import { ipv4Public, parseHttpResponse, publicHttpsUrl } from "../supabase/functions/question-bank/safe-fetch.ts";

Deno.test("rejects non-public IPv4 ranges and accepts public addresses", () => {
  for (const address of ["0.0.0.1", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.1.1", "172.16.0.1", "192.0.0.5", "192.168.1.1", "198.18.0.1", "203.0.113.1", "224.0.0.1", "240.0.0.1"]) {
    assertEquals(ipv4Public(address), false, address + " must be rejected");
  }
  assertEquals(ipv4Public("1.1.1.1"), true);
  assertEquals(ipv4Public("8.8.8.8"), true);
});

Deno.test("accepts only HTTPS on the default secure port and rejects IP literals", () => {
  assertEquals(publicHttpsUrl("https://example.com/document.pdf")?.hostname, "example.com");
  assertEquals(publicHttpsUrl("http://example.com"), null);
  assertEquals(publicHttpsUrl("https://example.com:8443/file.pdf"), null);
  assertEquals(publicHttpsUrl("https://127.0.0.1/file.pdf"), null);
  assertEquals(publicHttpsUrl("https://localhost/file.pdf"), null);
  assertEquals(publicHttpsUrl("https://user:pass@example.com/file.pdf"), null);
});

Deno.test("parses a bounded HTTP response with content length", () => {
  const wire = new TextEncoder().encode("HTTP/1.1 200 OK\r\nContent-Type: application/pdf\r\nContent-Length: 5\r\n\r\n%PDF-");
  const parsed = parseHttpResponse(wire, 100);
  assertEquals(parsed.status, 200);
  assertEquals(parsed.headers.get("content-type"), "application/pdf");
  assertEquals(new TextDecoder().decode(parsed.body), "%PDF-");
});

Deno.test("decodes bounded chunked HTTP responses", () => {
  const wire = new TextEncoder().encode("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nabc\r\n2\r\nde\r\n0\r\n\r\n");
  const parsed = parseHttpResponse(wire, 10);
  assertEquals(new TextDecoder().decode(parsed.body), "abcde");
  assertThrows(() => parseHttpResponse(wire, 4), Error, "RESPONSE_TOO_LARGE");
});

Deno.test("rejects compressed or malformed responses rather than parsing them unsafely", () => {
  const compressed = new TextEncoder().encode("HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nContent-Length: 1\r\n\r\nx");
  assertThrows(() => parseHttpResponse(compressed, 10), Error, "UNSUPPORTED_CONTENT_ENCODING");
});
