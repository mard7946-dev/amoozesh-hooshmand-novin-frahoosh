const clean = (value: unknown) => String(value ?? "").trim();

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function encodeJson(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

async function signJwt(claims: Record<string, unknown>): Promise<string> {
  const apiKey = clean(Deno.env.get("LIVEKIT_API_KEY"));
  const apiSecret = clean(Deno.env.get("LIVEKIT_API_SECRET"));
  if (!apiKey || !apiSecret) {
    throw new Error("تنظیمات امن سرویس کلاس آنلاین (LiveKit) هنوز در سرور ثبت نشده است.");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = encodeJson({ alg: "HS256", typ: "JWT" });
  const payload = encodeJson({
    iss: apiKey,
    nbf: now - 5,
    ...claims,
  });
  const signingInput = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(apiSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signingInput),
  ));
  return `${signingInput}.${base64Url(signature)}`;
}

export function getLiveKitWsUrl(): string {
  const value = clean(Deno.env.get("LIVEKIT_URL"));
  if (!/^wss:\/\//i.test(value)) {
    throw new Error("نشانی امن سرور LiveKit باید با wss:// شروع شود.");
  }
  return value.replace(/\/$/, "");
}

function getLiveKitHttpUrl(): string {
  return getLiveKitWsUrl().replace(/^wss:\/\//i, "https://");
}

async function serverToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return await signJwt({
    sub: "frahoosh-server",
    exp: now + 120,
    video: { roomCreate: true },
  });
}

async function roomService(method: string, body: Record<string, unknown>): Promise<any> {
  const token = await serverToken();
  const response = await fetch(
    `${getLiveKitHttpUrl()}/twirp/livekit.RoomService/${method}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = clean(data?.msg || data?.message || data?.error || data?.code);
    if (response.status === 409 && /already exists|already_exists/i.test(detail)) return data;
    if (response.status === 404 && method === "DeleteRoom") return data;
    console.error("LiveKit RoomService error", method, response.status, detail.slice(0, 240));
    throw new Error("سرویس کلاس آنلاین در ایجاد یا مدیریت اتاق پاسخ معتبر نداد.");
  }
  return data;
}

export async function createLiveKitRoom(roomName: string): Promise<void> {
  if (!/^[a-zA-Z0-9_-]{3,128}$/.test(roomName)) {
    throw new Error("شناسه اتاق کلاس معتبر نیست.");
  }
  await roomService("CreateRoom", {
    name: roomName,
    empty_timeout: 600,
    departure_timeout: 20,
    max_participants: 1000,
  });
}

export async function deleteLiveKitRoom(roomName: string): Promise<void> {
  if (!roomName) return;
  try {
    await roomService("DeleteRoom", { room: roomName });
  } catch (error) {
    if (!String(error).includes("not found") && !String(error).includes("NotFound")) throw error;
  }
}

export async function createLiveKitParticipantToken(
  roomName: string,
  identity: string,
  displayName: string,
  options: { host?: boolean; screenShare?: boolean; ttlSeconds?: number; role?: string } = {},
): Promise<{ token: string; server_url: string; expires_at: string }> {
  if (!roomName || !identity) throw new Error("اطلاعات ورود به اتاق کامل نیست.");
  const ttl = Math.max(60, Math.min(Number(options.ttlSeconds) || 3600, 4 * 3600));
  const now = Math.floor(Date.now() / 1000);
  const token = await signJwt({
    sub: identity,
    name: clean(displayName).slice(0, 120),
    metadata: JSON.stringify({ role: clean(options.role).slice(0, 40) }),
    exp: now + ttl,
    video: {
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
      canPublishSources: options.screenShare ? ["camera", "microphone", "screen_share"] : ["camera", "microphone"],
      ...(options.host ? { roomAdmin: true } : {}),
    },
  });
  return {
    token,
    server_url: getLiveKitWsUrl(),
    expires_at: new Date((now + ttl) * 1000).toISOString(),
    can_share_screen: Boolean(options.screenShare),
  };
}
