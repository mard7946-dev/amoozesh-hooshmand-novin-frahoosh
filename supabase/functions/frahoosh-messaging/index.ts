import { MAX_ATTACHMENT_BYTES, isAttachmentBase64WithinLimit } from "./attachment.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY")!;
const BUCKET = "frahoosh-message-files";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-api-version, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
  "Content-Type": "application/json; charset=utf-8",
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: cors });
const fail = (message: string, status = 400) => json({ error: message }, status);

async function rest(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("apikey", SERVICE_KEY);
  headers.set("Authorization", "Bearer " + SERVICE_KEY);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(SUPABASE_URL + "/rest/v1/" + path, { ...init, headers });
  const raw = await response.text();
  let data: any = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!response.ok) throw new Error((data && (data.message || data.error || data.hint)) || "خطا در پایگاه داده");
  return data;
}
async function storage(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("apikey", SERVICE_KEY);
  headers.set("Authorization", "Bearer " + SERVICE_KEY);
  const response = await fetch(SUPABASE_URL + "/storage/v1/" + path, { ...init, headers });
  const raw = await response.text();
  let data: any = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!response.ok) throw new Error((data && (data.message || data.error)) || "خطای فایل");
  return data;
}
function safeName(name: string) {
  return (name || "attachment").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100) || "attachment";
}
function publicRole(role: string) {
  if (["educational", "executive", "cultural", "deputy"].includes(role)) return "deputy";
  if (["advisor", "counselor"].includes(role)) return "counselor";
  return role;
}
async function currentUser(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("نشست ورود پیدا نشد؛ دوباره وارد پنل شوید.");
  const response = await fetch(SUPABASE_URL + "/auth/v1/user", { headers: { apikey: ANON_KEY, Authorization: "Bearer " + token } });
  if (!response.ok) throw new Error("نشست ورود معتبر نیست؛ دوباره وارد شوید.");
  const authUser = await response.json();
  const profiles = await rest("account_settings?auth_user_id=eq." + encodeURIComponent(authUser.id) + "&select=username,display_name,role,tenant_school_id,auth_user_id&limit=1");
  const profile = profiles?.[0];
  if (!profile || !profile.tenant_school_id || !profile.role) throw new Error("برای این حساب، نقش و مدرسه در پروفایل ثبت نشده است.");
  const memberships = await rest("school_memberships?auth_user_id=eq." + encodeURIComponent(authUser.id) + "&school_id=eq." + encodeURIComponent(profile.tenant_school_id) + "&is_active=eq.true&select=role,school_id&limit=1");
  if (!memberships?.length) throw new Error("عضویت فعال این حساب در مدرسه تأیید نشد.");
  return {
    id: authUser.id,
    email: authUser.email || "",
    name: profile.display_name || profile.username || authUser.email || "کاربر",
    role: String(profile.role).toLowerCase(),
    schoolId: profile.tenant_school_id,
  };
}
async function event(messageId: string, schoolId: string, user: any, type: string, details = "") {
  await rest("portal_message_events", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ message_id: messageId, school_id: schoolId, actor_user_id: user.id, actor_role: user.role, event_type: type, details }),
  });
}
async function visibleMessage(user: any, id: string) {
  const rows = await rest("portal_messages?id=eq." + encodeURIComponent(id) + "&school_id=eq." + encodeURIComponent(user.schoolId) + "&limit=1");
  const m = rows?.[0];
  if (!m) throw new Error("پیام پیدا نشد.");
  const isSender = m.sender_user_id === user.id;
  const isRecipient = m.recipient_user_id === user.id && m.status === "delivered";
  const isDeputyReviewer = m.status === "pending_deputy" && m.approval_deputy_role === user.role;
  const isManagerReviewer = m.status === "pending_manager" && user.role === "manager";
  if (!(isSender || isRecipient || isDeputyReviewer || isManagerReviewer)) throw new Error("برای این پیام دسترسی ندارید.");
  return m;
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("فقط درخواست POST مجاز است.", 405);
  try {
    const user = await currentUser(req);
    const input = await req.json().catch(() => ({}));
    const action = String(input.action || "list");
    if (action === "directory") {
      const school = encodeURIComponent(user.schoolId);
      const [rows, managerRows] = await Promise.all([
        rest("account_settings?tenant_school_id=eq." + school + "&select=auth_user_id,username,display_name,role&order=display_name.asc&limit=500"),
        rest("account_settings?tenant_school_id=eq." + school + "&role=eq.manager&select=auth_user_id,username,display_name,role&limit=20")
      ]);
      const combined = [...(managerRows || []), ...(rows || [])];
      const seen = new Set<string>();
      const users = combined.filter((r: any) => {
        if (!r.auth_user_id || r.auth_user_id === user.id || !r.role || seen.has(r.auth_user_id)) return false;
        seen.add(r.auth_user_id); return true;
      }).map((r: any) => {
        const role = String(r.role).trim().toLowerCase();
        return { id: r.auth_user_id, name: r.display_name || r.username || (role === "manager" ? "مدیر مدرسه" : "کاربر"), role, role_label: publicRole(role) };
      });
      users.sort((a: any, b: any) => (a.role === "manager" ? -1 : b.role === "manager" ? 1 : String(a.name).localeCompare(String(b.name), "fa")));
      return json({ users });
    }
    if (action === "list") {
      const rows = await rest("portal_messages?school_id=eq." + encodeURIComponent(user.schoolId) + "&select=*&order=created_at.desc&limit=200");
      const messages = (rows || []).filter((m: any) =>
        m.sender_user_id === user.id ||
        (m.recipient_user_id === user.id && m.status === "delivered") ||
        (m.status === "pending_deputy" && m.approval_deputy_role === user.role) ||
        (m.status === "pending_manager" && user.role === "manager")
      ).map((m: any) => ({ ...m, attachment_path: undefined, can_approve:
        (m.status === "pending_deputy" && m.approval_deputy_role === user.role) ||
        (m.status === "pending_manager" && user.role === "manager"),
        can_read: m.recipient_user_id === user.id && m.status === "delivered"
      }));
      return json({ user: { id: user.id, name: user.name, role: user.role, role_label: publicRole(user.role) }, messages });
    }
    if (action === "send") {
      const recipientId = String(input.recipient_user_id || "");
      const body = String(input.body || "").trim();
      const subject = String(input.subject || "").trim().slice(0, 160);
      const topic = ["educational", "executive", "cultural"].includes(input.topic) ? input.topic : "educational";
      if (!recipientId || recipientId === user.id) return fail("گیرنده معتبر انتخاب کنید.");
      if (!body && !input.attachment) return fail("متن پیام یا فایل ضمیمه لازم است.");
      if (body.length > 10000) return fail("متن پیام بیش از حد طولانی است.");
      const recipients = await rest("account_settings?auth_user_id=eq." + encodeURIComponent(recipientId) + "&tenant_school_id=eq." + encodeURIComponent(user.schoolId) + "&select=auth_user_id,username,display_name,role,tenant_school_id&limit=1");
      const recipient = recipients?.[0];
      if (!recipient || !recipient.role) return fail("گیرنده در همین مدرسه پیدا نشد.");
      const id = crypto.randomUUID();
      let attachmentPath: string | null = null, attachmentName: string | null = null, attachmentMime: string | null = null, attachmentSize: number | null = null;
      if (input.attachment) {
        const a = input.attachment;
        const mime = String(a.mime || "application/octet-stream");
        const allowed = ["application/pdf","image/jpeg","image/png","image/webp","text/plain","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];
        if (!allowed.includes(mime)) return fail("نوع فایل مجاز نیست. PDF، تصویر، متن یا فایل Office انتخاب کنید.");
        const base64 = String(a.data || "").replace(/^data:[^;]+;base64,/, "");
        if (!isAttachmentBase64WithinLimit(base64)) return fail("حجم فایل باید کمتر از ۵ مگابایت باشد.");
        const binary = atob(base64);
        attachmentSize = binary.length;
        if (!attachmentSize || attachmentSize > MAX_ATTACHMENT_BYTES) return fail("حجم فایل باید کمتر از ۵ مگابایت باشد.");
        const bytes = new Uint8Array(attachmentSize);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        attachmentName = String(a.name || "attachment").slice(0, 180);
        attachmentMime = mime;
        attachmentPath = user.schoolId + "/" + id + "/" + crypto.randomUUID() + "-" + safeName(attachmentName);
        await storage("object/" + BUCKET + "/" + attachmentPath, { method: "POST", headers: { "Content-Type": mime, "x-upsert": "false" }, body: bytes });
      }
      const isManager = user.role === "manager";
      const needsDeputy = ["student", "parent", "teacher"].includes(user.role);
      const directToManager = recipient.role === "manager";
      const status = directToManager ? "delivered" : needsDeputy ? "pending_deputy" : "pending_manager";
      const row = {
        id, school_id: user.schoolId, sender_user_id: user.id, sender_role: user.role, sender_name: user.name,
        recipient_user_id: recipientId, recipient_role: recipient.role,
        recipient_name: recipient.display_name || recipient.username || "کاربر",
        subject, body, topic, approval_deputy_role: directToManager ? null : needsDeputy ? topic : null, status,
        attachment_path: attachmentPath, attachment_name: attachmentName, attachment_mime: attachmentMime, attachment_size: attachmentSize,
        
      };
      try {
        await rest("portal_messages", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(row) });
      } catch (e) {
        if (attachmentPath) await storage("object/" + BUCKET + "/" + attachmentPath, { method: "DELETE" }).catch(() => {});
        throw e;
      }
      await event(id, user.schoolId, user, "message_sent", directToManager ? "پیام مستقیم به مدیریت تحویل شد" : status === "pending_deputy" ? "در انتظار تأیید معاون مربوطه" : "در انتظار تأیید مدیریت");
      return json({ ok: true, id, status });
    }
    if (action === "approve" || action === "reject") {
      const id = String(input.message_id || "");
      const m = await visibleMessage(user, id);
      if (action === "approve") {
        if (m.status === "pending_deputy" && m.approval_deputy_role === user.role) {
          await rest("portal_messages?id=eq." + encodeURIComponent(id) + "&school_id=eq." + encodeURIComponent(user.schoolId), {
            method: "PATCH", headers: { Prefer: "return=minimal" },
            body: JSON.stringify({ status: "pending_manager", deputy_approved_by: user.id, deputy_approved_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
          });
          await event(id, user.schoolId, user, "deputy_approved", "تأیید معاون؛ در انتظار تأیید نهایی مدیریت");
          return json({ ok: true, status: "pending_manager" });
        }
        if (m.status === "pending_manager" && user.role === "manager") {
          await rest("portal_messages?id=eq." + encodeURIComponent(id) + "&school_id=eq." + encodeURIComponent(user.schoolId), {
            method: "PATCH", headers: { Prefer: "return=minimal" },
            body: JSON.stringify({ status: "delivered", manager_approved_by: user.id, manager_approved_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
          });
          await event(id, user.schoolId, user, "manager_approved", "تأیید نهایی مدیریت؛ پیام به گیرنده تحویل شد");
          return json({ ok: true, status: "delivered" });
        }
        return fail("این پیام در مرحله‌ای نیست که این حساب بتواند تأیید کند.", 403);
      }
      const reason = String(input.reason || "").trim().slice(0, 1000);
      if (!reason) return fail("برای رد پیام، علت رد را وارد کنید.");
      if (m.status === "pending_deputy" && m.approval_deputy_role === user.role) {
        await rest("portal_messages?id=eq." + encodeURIComponent(id) + "&school_id=eq." + encodeURIComponent(user.schoolId), {
          method: "PATCH", headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ status: "rejected_deputy", rejected_by: user.id, rejection_reason: reason, updated_at: new Date().toISOString() }),
        });
      } else if (m.status === "pending_manager" && user.role === "manager") {
        await rest("portal_messages?id=eq." + encodeURIComponent(id) + "&school_id=eq." + encodeURIComponent(user.schoolId), {
          method: "PATCH", headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ status: "rejected_manager", rejected_by: user.id, rejection_reason: reason, updated_at: new Date().toISOString() }),
        });
      } else return fail("این پیام در مرحله‌ای نیست که این حساب بتواند رد کند.", 403);
      await event(id, user.schoolId, user, "message_rejected", reason);
      return json({ ok: true, status: m.status === "pending_deputy" ? "rejected_deputy" : "rejected_manager" });
    }
    if (action === "read") {
      const id = String(input.message_id || "");
      const m = await visibleMessage(user, id);
      if (m.recipient_user_id !== user.id || m.status !== "delivered") return fail("فقط گیرنده می‌تواند پیام تحویل‌شده را علامت‌گذاری کند.", 403);
      await rest("portal_messages?id=eq." + encodeURIComponent(id) + "&recipient_user_id=eq." + encodeURIComponent(user.id), {
        method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ read_at: new Date().toISOString() }),
      });
      await event(id, user.schoolId, user, "message_read", "گیرنده پیام را مشاهده کرد");
      return json({ ok: true });
    }
    if (action === "download") {
      const id = String(input.message_id || "");
      const m = await visibleMessage(user, id);
      if (!m.attachment_path) return fail("این پیام فایل ضمیمه ندارد.");
      const signed = await storage("object/sign/" + BUCKET + "/" + m.attachment_path, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 300 }),
      });
      const signedPath = signed?.signedURL || signed?.signedUrl;
      if (!signedPath) throw new Error("پیوند امن فایل ساخته نشد.");
      return json({ url: signedPath.startsWith("http") ? signedPath : SUPABASE_URL + "/storage/v1" + signedPath, name: m.attachment_name || "attachment" });
    }
    return fail("عملیات ناشناخته است.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "خطای غیرمنتظره";
    return fail(message, /نشست|عضویت|پروفایل|دسترسی ندارید|مجوز/.test(message) ? 403 : 500);
  }
});
