const IPV4_DENY_CIDRS = [
  "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8",
  "169.254.0.0/16", "172.16.0.0/12", "192.0.0.0/24", "192.0.2.0/24",
  "192.88.99.0/24", "192.168.0.0/16", "198.18.0.0/15",
  "198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4",
];

const ipv4Number = (value: string): number | null => {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map(part => Number(part));
  if (octets.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3]) >>> 0;
};

const cidrContains = (ip: number, cidr: string): boolean => {
  const [base, bitsText] = cidr.split("/");
  const bits = Number(bitsText);
  const baseNumber = ipv4Number(base);
  if (baseNumber === null || !Number.isInteger(bits)) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ip & mask) === (baseNumber & mask);
};

export const ipv4Public = (value: string): boolean => {
  const ip = ipv4Number(value);
  return ip !== null && !IPV4_DENY_CIDRS.some(cidr => cidrContains(ip, cidr));
};

export const publicHttpsUrl = (value: string): URL | null => {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (url.protocol !== "https:" || (url.port && url.port !== "443") ||
        url.username || url.password || !host ||
        host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return null;
    if (/^\d+(?:\.\d+){0,3}$/.test(host) || host.includes(":")) return null;
    return url;
  } catch {
    return null;
  }
};

const resolvePublicIpv4 = async (hostname: string): Promise<string[]> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const answers = await Deno.resolveDns(hostname, "A", { signal: controller.signal });
    if (!answers.length || answers.some(address => !ipv4Public(address))) {
      throw new Error("PUBLIC_HOST_VALIDATION_FAILED");
    }
    return [...new Set(answers)].slice(0, 8);
  } catch (error) {
    if (error instanceof Error && error.message === "PUBLIC_HOST_VALIDATION_FAILED") throw error;
    throw new Error("DNS_RESOLUTION_FAILED");
  } finally {
    clearTimeout(timer);
  }
};

const concat = (chunks: Uint8Array[], total: number): Uint8Array => {
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
};

const findSequence = (bytes: Uint8Array, sequence: number[], start = 0): number => {
  outer: for (let i = start; i <= bytes.length - sequence.length; i++) {
    for (let j = 0; j < sequence.length; j++) if (bytes[i + j] !== sequence[j]) continue outer;
    return i;
  }
  return -1;
};

const decodeChunked = (input: Uint8Array, maxBytes: number): Uint8Array => {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  let total = 0;
  while (offset < input.length) {
    const lineEnd = findSequence(input, [13, 10], offset);
    if (lineEnd < 0 || lineEnd - offset > 128) throw new Error("INVALID_CHUNKED_RESPONSE");
    const sizeLine = new TextDecoder().decode(input.subarray(offset, lineEnd)).split(";")[0].trim();
    if (!/^[0-9a-f]+$/i.test(sizeLine)) throw new Error("INVALID_CHUNKED_RESPONSE");
    const size = Number.parseInt(sizeLine, 16);
    offset = lineEnd + 2;
    if (size === 0) return concat(chunks, total);
    if (!Number.isSafeInteger(size) || size < 0 || total + size > maxBytes) throw new Error("RESPONSE_TOO_LARGE");
    if (offset + size + 2 > input.length || input[offset + size] !== 13 || input[offset + size + 1] !== 10) {
      throw new Error("INVALID_CHUNKED_RESPONSE");
    }
    chunks.push(input.subarray(offset, offset + size));
    total += size;
    offset += size + 2;
  }
  throw new Error("INCOMPLETE_CHUNKED_RESPONSE");
};

export type ParsedHttpResponse = { status: number; headers: Headers; body: Uint8Array };

export const parseHttpResponse = (wire: Uint8Array, maxBytes: number): ParsedHttpResponse => {
  const headerEnd = findSequence(wire, [13, 10, 13, 10]);
  if (headerEnd < 0 || headerEnd > 32 * 1024) throw new Error("INVALID_HTTP_HEADERS");
  const headerText = new TextDecoder("latin1").decode(wire.subarray(0, headerEnd));
  const lines = headerText.split("\r\n");
  const statusMatch = lines.shift()?.match(/^HTTP\/1\.[01]\s+(\d{3})(?:\s|$)/);
  if (!statusMatch) throw new Error("INVALID_HTTP_STATUS");
  const status = Number(statusMatch[1]);
  const headers = new Headers();
  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (name && !/[\r\n]/.test(value)) headers.append(name, value);
  }

  const bodyWire = wire.subarray(headerEnd + 4);
  const contentEncoding = (headers.get("content-encoding") || "identity").toLowerCase();
  if (contentEncoding !== "identity") throw new Error("UNSUPPORTED_CONTENT_ENCODING");

  const transferEncoding = (headers.get("transfer-encoding") || "").toLowerCase();
  let body: Uint8Array;
  if (transferEncoding) {
    const encodings = transferEncoding.split(",").map(value => value.trim()).filter(Boolean);
    if (encodings.length !== 1 || encodings[0] !== "chunked") throw new Error("UNSUPPORTED_TRANSFER_ENCODING");
    body = decodeChunked(bodyWire, maxBytes);
  } else {
    const lengthHeader = headers.get("content-length");
    if (lengthHeader !== null) {
      if (!/^\d+$/.test(lengthHeader)) throw new Error("INVALID_CONTENT_LENGTH");
      const length = Number(lengthHeader);
      if (!Number.isSafeInteger(length) || length > maxBytes) throw new Error("RESPONSE_TOO_LARGE");
      if (bodyWire.byteLength < length) throw new Error("INCOMPLETE_HTTP_BODY");
      if (bodyWire.byteLength !== length) throw new Error("UNEXPECTED_HTTP_TRAILING_BYTES");
      body = bodyWire;
    } else {
      body = bodyWire;
    }
  }
  if (body.byteLength > maxBytes) throw new Error("RESPONSE_TOO_LARGE");
  return { status, headers, body };
};

const readAll = async (connection: Deno.Conn, maxWireBytes: number): Promise<Uint8Array> => {
  const chunks: Uint8Array[] = [];
  const buffer = new Uint8Array(16 * 1024);
  let total = 0;
  while (true) {
    const count = await connection.read(buffer);
    if (count === null) break;
    if (count === 0) continue;
    total += count;
    if (total > maxWireBytes) throw new Error("RESPONSE_TOO_LARGE");
    chunks.push(buffer.slice(0, count));
  }
  return concat(chunks, total);
};

const writeAll = async (connection: Deno.Conn, bytes: Uint8Array): Promise<void> => {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const written = await connection.write(bytes.subarray(offset));
    if (written <= 0) throw new Error("HTTP_WRITE_FAILED");
    offset += written;
  }
};

export const fetchPinnedHttps = async (target: URL, accept: string, maxBytes: number): Promise<Response> => {
  const validated = publicHttpsUrl(target.toString());
  if (!validated) throw new Error("INVALID_PUBLIC_HTTPS_URL");
  const addresses = await resolvePublicIpv4(validated.hostname);
  let lastError: unknown = new Error("OUTBOUND_CONNECTION_FAILED");

  for (const address of addresses) {
    const controller = new AbortController();
    let active: { close: () => void } | null = null;
    const timer = setTimeout(() => {
      controller.abort();
      active?.close();
    }, 15000);
    try {
      const tcp = await Deno.connect({ hostname: address, port: 443, signal: controller.signal });
      active = tcp;
      if (tcp.remoteAddr.hostname !== address) throw new Error("REMOTE_ADDRESS_MISMATCH");
      const tls = await Deno.startTls(tcp, { hostname: validated.hostname });
      active = tls;

      const requestTarget = (validated.pathname || "/") + validated.search;
      const request = [
        `GET ${requestTarget} HTTP/1.1`,
        `Host: ${validated.hostname}`,
        `Accept: ${accept}`,
        "Accept-Encoding: identity",
        "Connection: close",
        "User-Agent: FrahooshQuestionBank/1.0",
        "",
        "",
      ].join("\r\n");
      await writeAll(tls, new TextEncoder().encode(request));
      const wire = await readAll(tls, maxBytes + 128 * 1024);
      const parsed = parseHttpResponse(wire, maxBytes);
      const headers = new Headers();
      const contentType = parsed.headers.get("content-type");
      if (contentType) headers.set("content-type", contentType);
      headers.set("content-length", String(parsed.body.byteLength));
      const body = [204, 205, 304].includes(parsed.status) ? null : parsed.body;
      return new Response(body, { status: parsed.status, headers });
    } catch (error) {
      lastError = error;
      if (error instanceof Error && error.message === "RESPONSE_TOO_LARGE") throw error;
    } finally {
      clearTimeout(timer);
      active?.close();
    }
  }
  throw lastError instanceof Error ? lastError : new Error("OUTBOUND_CONNECTION_FAILED");
};
