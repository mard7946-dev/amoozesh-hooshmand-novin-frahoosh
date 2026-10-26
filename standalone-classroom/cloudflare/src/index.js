import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";

const json = (value, status = 200, extra = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extra,
    },
  });

const normalize = value => String(value ?? "").trim().replace(/[\s\u200c]+/g, " ").replace(/[يى]/g, "ی").replace(/ك/g, "ک");
const normalizeDigits = value => String(value ?? "")
  .replace(/[۰-۹]/g, d => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
  .replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
  .replace(/\s+/g, "");
const normalizeUsername = value => normalizeDigits(value).replace(/[يى]/g, "ی").replace(/ك/g, "ک").trim();
const normalizeGradeClass = value => normalizeDigits(value).replace(/[\s\u200c_-]+/g, "").replace(/[\\-]/g, "/").trim();
const randomToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
};
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
const digest = async value => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
const hashPassword = async (password, salt = randomToken(), setStage = () => {}) => {
  // Use a portable PBKDF2 implementation instead of WebCrypto deriveBits:
  // some Worker/runtime combinations fail at bootstrap while deriving bits.
  setStage("password-derive-bits");
  const bits = await pbkdf2Async(
    sha256,
    utf8ToBytes(password),
    utf8ToBytes(salt),
    { c: 100000, dkLen: 32 }
  );
  setStage("password-encode-hash");
  return { salt, hash: hex(bits) };
};
const verifyPassword = async (password, salt, expected) => {
  // New accounts use 100,000 rounds because Cloudflare WebCrypto rejects
  // iteration counts above that limit. Existing accounts may use 150,000.
  const current = await hashPassword(password, salt);
  if (current.hash.length === expected.length && current.hash === expected) return true;

  // Verify legacy 150k PBKDF2 hashes without WebCrypto's 100k iteration cap.
  // Do not reset or rewrite any stored credentials during verification.
  const legacy = await pbkdf2Async(
    sha256,
    utf8ToBytes(password),
    utf8ToBytes(salt),
    { c: 150000, dkLen: 32 }
  );
  const legacyHash = hex(legacy);
  return legacyHash.length === expected.length && legacyHash === expected;
};
const body = async request => {
  try { return await request.json(); } catch { return {}; }
};
const fail = (message, status = 400, headers = {}) => json({ error: message }, status, headers);
const normalizeDay = value => {
  const day = normalize(value).toLowerCase().replace(/ي/g, "ی").replace(/‌/g, " ");
  const aliases = {
    "شنبه": "saturday", "sat": "saturday", "saturday": "saturday",
    "یکشنبه": "sunday", "sun": "sunday", "sunday": "sunday",
    "دوشنبه": "monday", "mon": "monday", "monday": "monday",
    "سه شنبه": "tuesday", "tue": "tuesday", "tuesday": "tuesday",
    "چهارشنبه": "wednesday", "wed": "wednesday", "wednesday": "wednesday",
    "پنجشنبه": "thursday", "پنج شنبه": "thursday", "thu": "thursday", "thursday": "thursday",
    "جمعه": "friday", "fri": "friday", "friday": "friday"
  };
  return aliases[day] || day;
};
const tehranDate = value => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Tehran",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(value).map(part=>[part.type,part.value]));
  return parts.year+"-"+parts.month+"-"+parts.day;
};
const managerRoles = ["manager", "educational_deputy"];
const staffRoles = ["manager", "educational_deputy", "executive_deputy", "pastoral_deputy"];
const accessRoles = [...staffRoles, "teacher"];

async function ensureColumn(env, table, column, definition) {
  const info = await env.DB.prepare("PRAGMA table_info(" + table + ")").all();
  if (!(info.results || []).some(c => c.name === column)) await env.DB.prepare("ALTER TABLE " + table + " ADD COLUMN " + column + " " + definition).run();
}
async function bootstrap(env, setStage = () => {}) {
  setStage("bootstrap-binding");
  if (!env.DB) throw new Error("D1 binding DB is not configured");
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS schools (id INTEGER PRIMARY KEY AUTOINCREMENT, school_name TEXT NOT NULL, school_code TEXT NOT NULL UNIQUE, school_level TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '', manager_name TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
  await env.DB.prepare("INSERT OR IGNORE INTO schools(id,school_name,school_code,school_level,city,manager_name) VALUES(1,'مدرسه پیش‌فرض فراهوش','FRAH001','','','مدیریت مدرسه')").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS classroom_settings (setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL, updated_by INTEGER, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS classroom_sso_tickets (ticket_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES classroom_users(id) ON DELETE CASCADE, role TEXT NOT NULL, entry TEXT NOT NULL CHECK(entry IN ('class','schedule')), expires_at TEXT NOT NULL, used_at TEXT)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS classroom_sso_tickets_expiry_idx ON classroom_sso_tickets(expires_at)").run();
  await ensureColumn(env, "classroom_users", "school_id", "INTEGER NOT NULL DEFAULT 1");
  await ensureColumn(env, "classrooms", "school_id", "INTEGER NOT NULL DEFAULT 1");
  const sessionColumns = await env.DB.prepare("PRAGMA table_info(classroom_sessions)").all();
  if ((sessionColumns.results || []).length && !(sessionColumns.results || []).some(c => c.name === "role_override")) await env.DB.prepare("ALTER TABLE classroom_sessions ADD COLUMN role_override TEXT").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS school_schedule_v2 (id INTEGER PRIMARY KEY AUTOINCREMENT, school_id INTEGER NOT NULL DEFAULT 1, day_of_week TEXT NOT NULL, period INTEGER NOT NULL CHECK(period BETWEEN 1 AND 12), grade_class TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '', teacher_user_id INTEGER NOT NULL REFERENCES classroom_users(id), classroom_id TEXT REFERENCES classrooms(id) ON DELETE SET NULL, start_time TEXT, end_time TEXT, UNIQUE(school_id,day_of_week,period,grade_class))").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS school_schedule_v3 (id INTEGER PRIMARY KEY AUTOINCREMENT, school_id INTEGER NOT NULL DEFAULT 1 REFERENCES schools(id), day_of_week TEXT NOT NULL, period INTEGER NOT NULL CHECK(period BETWEEN 1 AND 12), grade_class TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '', teacher_user_id INTEGER NOT NULL REFERENCES classroom_users(id), classroom_id TEXT REFERENCES classrooms(id) ON DELETE SET NULL, start_time TEXT, end_time TEXT, activation_mode TEXT NOT NULL DEFAULT 'scheduled' CHECK(activation_mode IN ('scheduled','manual')), UNIQUE(school_id,day_of_week,period,grade_class,subject,teacher_user_id))").run();
  await env.DB.prepare("INSERT OR IGNORE INTO school_schedule_v3(school_id,day_of_week,period,grade_class,subject,teacher_user_id,classroom_id,start_time,end_time,activation_mode) SELECT school_id,day_of_week,period,grade_class,subject,teacher_user_id,classroom_id,start_time,end_time,CASE WHEN lower(subject) LIKE '%علوم%' OR lower(subject) LIKE '%مطالعات%' THEN 'manual' ELSE 'scheduled' END FROM school_schedule_v2").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS schedule_v3_school_teacher_day_idx ON school_schedule_v3(school_id,teacher_user_id,day_of_week,period)").run();
  await env.DB.prepare("INSERT OR IGNORE INTO school_schedule_v2(id,school_id,day_of_week,period,grade_class,subject,teacher_user_id,classroom_id,start_time,end_time) SELECT id,1,day_of_week,period,grade_class,subject,teacher_user_id,classroom_id,start_time,end_time FROM school_schedule").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS schedule_v2_school_teacher_day_idx ON school_schedule_v2(school_id,teacher_user_id,day_of_week,period)").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS classroom_attendance (id INTEGER PRIMARY KEY AUTOINCREMENT, school_id INTEGER NOT NULL, classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE, student_user_id INTEGER NOT NULL REFERENCES classroom_users(id) ON DELETE CASCADE, session_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'joined' CHECK(status IN ('joined','prompted','present','unconfirmed','left')), joined_at TEXT NOT NULL, prompt_due_at TEXT NOT NULL, prompted_at TEXT, response_deadline TEXT, confirmed_at TEXT, left_at TEXT, UNIQUE(classroom_id,student_user_id,session_date))").run();
  await ensureColumn(env, "classroom_attendance", "duration_seconds", "INTEGER NOT NULL DEFAULT 0");
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS classroom_attendance_school_date_idx ON classroom_attendance(school_id,session_date,status)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS classroom_attendance_room_date_idx ON classroom_attendance(classroom_id,session_date)").run();
  const unlinkedSchedule = await env.DB.prepare("SELECT id,school_id,grade_class,subject,teacher_user_id FROM school_schedule_v3 WHERE classroom_id IS NULL").all();
  for (const row of (unlinkedSchedule.results || [])) {
    const id = crypto.randomUUID(), code = roomCode();
    await env.DB.prepare("INSERT INTO classrooms(id,title,grade_class,teacher_user_id,room_code,status,created_by,school_id) VALUES(?,?,?,?,?,'scheduled',?,?)")
      .bind(id,row.subject ? row.subject+" · "+row.grade_class : "کلاس "+row.grade_class,row.grade_class,row.teacher_user_id,code,row.teacher_user_id,row.school_id).run();
    await env.DB.prepare("UPDATE school_schedule_v3 SET classroom_id=? WHERE id=? AND classroom_id IS NULL").bind(id,row.id).run();
  }
  setStage("bootstrap-manager-lookup");
  const exists = await env.DB.prepare("SELECT id FROM classroom_users WHERE role='manager' LIMIT 1").first();
  if (exists || !env.MANAGER_USERNAME || !env.MANAGER_PASSWORD) return;
  setStage("bootstrap-password-hash");
  const cred = await hashPassword(env.MANAGER_PASSWORD, randomToken(), stage => setStage("bootstrap-" + stage));
  setStage("bootstrap-manager-create");
  await env.DB.prepare("INSERT INTO classroom_users(role,display_name,username,password_salt,password_hash,school_id) VALUES('manager',?,?,?,?,1)")
    .bind(env.MANAGER_DISPLAY_NAME || "مدیریت مدرسه", env.MANAGER_USERNAME, cred.salt, cred.hash).run();
}
async function authenticate(request, env) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  return env.DB.prepare(
    "SELECT u.id,COALESCE(s.role_override,u.role) AS role,u.display_name,u.username,u.grade_class,u.school_id,sc.school_name,sc.school_code FROM classroom_sessions s JOIN classroom_users u ON u.id=s.user_id LEFT JOIN schools sc ON sc.id=u.school_id WHERE s.token_hash=? AND s.expires_at>?"
  ).bind(await digest(token), new Date().toISOString()).first();
}
async function audit(env, classroomId, actorId, type, payload = {}) {
  await env.DB.prepare("INSERT INTO classroom_events(classroom_id,actor_user_id,event_type,payload_json) VALUES(?,?,?,?)")
    .bind(classroomId, actorId || null, type, JSON.stringify(payload)).run();
}
function userShape(user) {
  return { id: user.id, role: user.role, displayName: user.display_name, username: user.username, gradeClass: user.grade_class, schoolId: user.school_id || 1, schoolName: user.school_name || "", schoolCode: user.school_code || "" };
}
function roomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const allowed = [...new Set([...(env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean), "https://frahoosh-six-icon-portal.mard7946.workers.dev"])];
    const origin = request.headers.get("origin");
    const corsHeaders = {};
    if (origin && allowed.includes(origin)) {
      corsHeaders["access-control-allow-origin"] = origin;
      corsHeaders["access-control-allow-methods"] = "GET,POST,OPTIONS";
      corsHeaders["access-control-allow-headers"] = "authorization,content-type";
      corsHeaders["vary"] = "Origin";
    }
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (origin && allowed.length && !allowed.includes(origin)) return fail("مبدأ درخواست مجاز نیست.", 403);
    if (request.method === "GET" && url.pathname === "/health") {
      if (!env.DB) return json({ ok: false, service: "frahoosh-classroom-edge", database: "not_configured" }, 503, corsHeaders);
      try {
        await env.DB.prepare("SELECT 1").first();
        const expected = {
          schools: ["id", "school_name", "school_code", "school_level", "city", "manager_name"],
          classroom_users: ["id", "role", "display_name", "username", "password_salt", "password_hash", "family_name", "grade_class", "national_id_hash", "school_id"],
          classroom_sessions: ["token_hash", "user_id", "expires_at"],
          classrooms: ["id", "title", "grade_class", "teacher_user_id", "room_code", "status", "created_by", "starts_at", "ends_at", "updated_at", "school_id"],
          school_schedule: ["id", "day_of_week", "period", "grade_class", "subject", "teacher_user_id", "classroom_id", "start_time", "end_time"],
          school_schedule_v2: ["id", "school_id", "day_of_week", "period", "grade_class", "subject", "teacher_user_id", "classroom_id", "start_time", "end_time"],
          school_schedule_v3: ["id", "school_id", "day_of_week", "period", "grade_class", "subject", "teacher_user_id", "classroom_id", "start_time", "end_time", "activation_mode"],
          classroom_events: ["id", "classroom_id", "actor_user_id", "event_type", "payload_json"],
          classroom_attendance: ["id", "school_id", "classroom_id", "student_user_id", "session_date", "status", "joined_at", "prompt_due_at", "prompted_at", "response_deadline", "confirmed_at", "left_at"]
        };
        const tables = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
        const available = new Set((tables.results || []).map(row => row.name));
        const missingTables = Object.keys(expected).filter(name => !available.has(name));
        const missingColumns = [];
        for (const name of Object.keys(expected)) {
          if (!available.has(name)) continue;
          const info = await env.DB.prepare("PRAGMA table_info(" + name + ")").all();
          const columns = new Set((info.results || []).map(row => row.name));
          for (const column of expected[name]) if (!columns.has(column)) missingColumns.push(name + "." + column);
        }
        const complete = missingTables.length === 0 && missingColumns.length === 0;
        return json({
          ok: true,
          service: "frahoosh-classroom-edge",
          database: "connected",
          apiMigrationComplete: complete,
          ...(complete ? {} : { schemaIssues: { missingTables, missingColumns } })
        }, 200, corsHeaders);
      } catch (error) {
        console.error("health_check_failed", String(error));
        return json({ ok: false, database: "unavailable" }, 503, corsHeaders);
      }
    }
    let failureStage = "bootstrap";
    try {
      await bootstrap(env, stage => { failureStage = stage; });
      const path = url.pathname;
      failureStage = "route-dispatch";
      if (request.method === "POST" && path === "/api/schools/register") {
        // Public self-registration is intentionally disabled. A new school must be licensed
        // by the program owner; never trust a client-side button or client-supplied approval.
        return fail("ثبت‌نام مدیر جدید قفل است. برای دریافت مجوز فعال‌سازی و خرید اشتراک با دارنده برنامه، آقای جهان‌تیغ، به شماره ۰۹۳۷۷۳۲۹۹۱۲ تماس بگیرید.", 403, corsHeaders);
      }
      if (request.method === "POST" && path === "/api/auth/login") {
        failureStage = "login-parse";
        const data = await body(request);
        const username = normalizeUsername(data.username);
        const password = String(data.password || "");
        const selectedRole = String(data.role || "");
        const expectedRole = selectedRole === "educational_deputy" || selectedRole === "executive_deputy" || selectedRole === "pastoral_deputy"
          ? "deputy" : selectedRole;
        if (!username || !password || !["manager", "deputy", "teacher"].includes(expectedRole)) {
          return fail("نام کاربری، رمز عبور و نقش را کامل وارد کنید.", 400, corsHeaders);
        }
        const localRows = await env.DB.prepare("SELECT u.*,sc.school_name,sc.school_code FROM classroom_users u LEFT JOIN schools sc ON sc.id=u.school_id WHERE u.username IS NOT NULL AND u.password_hash IS NOT NULL").all();
        const localMatches = (localRows.results || []).filter(row => normalizeUsername(row.username) === username);
        if (localMatches.length > 1) return fail("نام کاربری تکراری است؛ اطلاعات حساب‌ها باید بررسی شود.",409,corsHeaders);
        if (localMatches.length === 1) {
          const local = localMatches[0];
          const roleOK = local.role === expectedRole || (expectedRole === "deputy" && ["educational_deputy","executive_deputy","pastoral_deputy"].includes(local.role)) || (selectedRole === "teacher" && ["manager","educational_deputy","pastoral_deputy"].includes(local.role));
          if (!roleOK) return fail("نقش این حساب با بخش انتخاب‌شده مطابقت ندارد.",403,corsHeaders);
          if (!(await verifyPassword(password,local.password_salt,local.password_hash))) return fail("نام کاربری یا رمز عبور نادرست است.",401,corsHeaders);
          const sessionRole = selectedRole === "teacher" && ["manager","educational_deputy","pastoral_deputy"].includes(local.role) ? "teacher" : local.role;
          const token = randomToken();
          await env.DB.prepare("INSERT INTO classroom_sessions(token_hash,user_id,expires_at,role_override) VALUES(?,?,?,?)").bind(await digest(token),local.id,new Date(Date.now()+12*60*60*1000).toISOString(),sessionRole===local.role?null:sessionRole).run();
          return json({token,expiresIn:43200,user:userShape({...local,role:sessionRole})},200,corsHeaders);
        }
        if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return fail("نام کاربری یا رمز عبور نادرست است.",401,corsHeaders);

        // Supabase is authoritative for credentials. D1 only keeps the local,
        // stable classroom identity used by existing schedule/room foreign keys.
        failureStage = "supabase-login";
        let authResponse;
        try {
          authResponse = await fetch(String(env.SUPABASE_URL).replace(/\/$/, "") + "/functions/v1/classroom-login", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              apikey: env.SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({ username, password, role: expectedRole }),
          });
        } catch {
          return fail("ارتباط با سرویس ورود برقرار نشد؛ کمی بعد دوباره تلاش کنید.", 503, corsHeaders);
        }
        let authResult = await authResponse.json().catch(() => ({}));
        if (!authResponse.ok && selectedRole === "teacher") {
          try {
            authResponse = await fetch(String(env.SUPABASE_URL).replace(/\/$/, "") + "/functions/v1/classroom-login", {
              method: "POST",
              headers: { "content-type": "application/json", apikey: env.SUPABASE_ANON_KEY },
              body: JSON.stringify({ username, password, role: "deputy" }),
            });
            authResult = await authResponse.json().catch(() => ({}));
          } catch {}
        }
        if (!authResponse.ok || !authResult.profile || !authResult.session?.access_token) {
          const status = authResponse.status === 403 ? 403 : authResponse.status === 401 ? 401 : 503;
          return fail(authResult.message || (status === 401 ? "نام کاربری یا رمز عبور نادرست است." : "ورود از طریق سامانه مرکزی تأیید نشد."), status, corsHeaders);
        }

        const profile = authResult.profile;
        const profileRole = normalize(profile.role).toLowerCase();
        const roleMap = {
          manager: "manager",
          "مدیر": "manager",
          educational: "educational_deputy",
          educational_deputy: "educational_deputy",
          "معاون آموزشی": "educational_deputy",
          executive: "executive_deputy",
          executive_deputy: "executive_deputy",
          "معاون اجرایی": "executive_deputy",
          cultural: "pastoral_deputy",
          pastoral: "pastoral_deputy",
          pastoral_deputy: "pastoral_deputy",
          "معاون پرورشی": "pastoral_deputy",
          "معاونت": "educational_deputy",
          "معاون": "educational_deputy",
          deputy: selectedRole === "executive_deputy" || selectedRole === "pastoral_deputy" ? selectedRole : "educational_deputy",
          teacher: "teacher",
          "دبیر": "teacher",
          student: "student",
          "دانش‌آموز": "student",
        };
        const role = roleMap[profileRole];
        const selectedDeputyRole = selectedRole === "deputy" && ["educational_deputy", "executive_deputy", "pastoral_deputy"].includes(role);
        const dualRoleTeacher = selectedRole === "teacher" && ["educational_deputy", "pastoral_deputy"].includes(role);
        if (!role || (role !== selectedRole && !selectedDeputyRole && !dualRoleTeacher)) {
          return fail("نقش این حساب با بخش انتخاب‌شده مطابقت ندارد.", 403, corsHeaders);
        }
        const sessionRole = dualRoleTeacher ? "teacher" : role;

        failureStage = "login-local-identity";
        const canonicalUsername = normalizeUsername(profile.username || username);
        let user = null;
        const candidates = await env.DB.prepare(
          "SELECT * FROM classroom_users WHERE school_id=1 AND username IS NOT NULL AND role IN ('manager','teacher','educational_deputy','executive_deputy','pastoral_deputy')"
        ).all();
        const matches = (candidates.results || []).filter(row => normalizeUsername(row.username) === canonicalUsername);
        if (matches.length > 1) return fail("برای این حساب بیش از یک شناسه محلی پیدا شد؛ مدیریت باید اطلاعات را بررسی کند.", 409, corsHeaders);
        if (matches.length === 1) {
          user = matches[0];
          if (user.role !== role) return fail("نقش حساب مرکزی با نقش ثبت‌شده در کلاس‌ها متفاوت است؛ اطلاعات حساب باید بررسی شود.", 409, corsHeaders);
        } else if (role === "manager") {
          const managers = await env.DB.prepare("SELECT * FROM classroom_users WHERE school_id=1 AND role='manager' LIMIT 2").all();
          if ((managers.results || []).length === 1) user = managers.results[0];
        }

        // Create only a non-secret local identity after successful Supabase
        // authentication. Never copy the password or Supabase access token to D1.
        if (!user) {
          failureStage = "login-local-identity-create";
          const displayName = normalize(profile.display_name) || canonicalUsername;
          const gradeClass = normalize(profile.class_name);
          user = await env.DB.prepare(
            "INSERT INTO classroom_users(role,display_name,username,grade_class,school_id) VALUES(?,?,?,?,1) RETURNING *"
          ).bind(role, displayName, canonicalUsername, gradeClass || null).first();
        }

        failureStage = "login-session-create";
        const token = randomToken();
        await env.DB.prepare("INSERT INTO classroom_sessions(token_hash,user_id,expires_at,role_override) VALUES(?,?,?,?)")
          .bind(await digest(token), user.id, new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(), sessionRole === user.role ? null : sessionRole).run();
        return json({ token, expiresIn: 43200, user: userShape({ ...user, role: sessionRole }) }, 200, corsHeaders);
      }
      if (request.method === "POST" && path === "/api/auth/student-login") {
        const data = await body(request);
        const first = normalize(data.firstName), family = normalize(data.familyName), grade = normalizeGradeClass(data.gradeClass);
        const schoolCode = normalize(data.schoolCode || "FRAH001").toUpperCase();
        if (!first || !family || !grade) return fail("نام، نام خانوادگی و کلاس را وارد کنید.", 400, corsHeaders);
        const school = await env.DB.prepare("SELECT id FROM schools WHERE upper(school_code)=?").bind(schoolCode).first();
        if (!school) return fail("کد مدرسه معتبر نیست.",401,corsHeaders);
        // Match against the imported roster, tolerating a shortened family name
        // (e.g. "شفق" for the roster value "شفق عنبران"). Older imports can
        // contain repeated identical rows, so collapse exact duplicate identities.
        const matches = await env.DB.prepare("SELECT id,role,display_name,family_name,grade_class,username,school_id FROM classroom_users WHERE school_id=? AND role='student' AND lower(trim(display_name))=lower(trim(?)) AND grade_class=?")
          .bind(school.id,first,grade).all();
        const rosterMatches = (matches.results || []).filter(row => {
          const storedFamily = normalize(row.family_name);
          return storedFamily === family || storedFamily.startsWith(family + " ");
        });
        if (rosterMatches.length === 0) return fail("این دانش‌آموز در فهرست اکسل مدرسه پیدا نشد. نام، نام خانوادگی و کلاس را بررسی کنید.", 401, corsHeaders);
        const uniqueMatches = [...new Map(rosterMatches.map(row => [normalize(row.display_name) + "|" + normalize(row.family_name) + "|" + normalizeGradeClass(row.grade_class), row])).values()];
        if (uniqueMatches.length > 1) return fail("چند دانش‌آموز با این مشخصات در فهرست وجود دارد؛ مدیر مدرسه باید فهرست اکسل را بررسی کند.", 409, corsHeaders);
        const user = uniqueMatches[0];
        const token = randomToken();
        await env.DB.prepare("INSERT INTO classroom_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)")
          .bind(await digest(token), user.id, new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()).run();
        return json({ token, expiresIn: 43200, user: { ...userShape(user), displayName: [user.display_name, user.family_name].filter(Boolean).join(" ") } }, 200, corsHeaders);
      }
      if (request.method === "POST" && path === "/api/auth/sso-exchange") {
        const data = await body(request);
        const ticket = String(data.ticket || "").trim();
        if (!ticket) return fail("پیوند ورود یکپارچه ناقص است؛ از پنل مدرسه دوباره وارد شوید.", 400, corsHeaders);
        const ticketHash = await digest(ticket);
        const now = new Date().toISOString();
        const record = await env.DB.prepare("SELECT t.ticket_hash,t.user_id,t.role,t.entry,t.expires_at,t.used_at,u.id,u.role AS account_role,u.display_name,u.username,u.grade_class,u.school_id,sc.school_name,sc.school_code FROM classroom_sso_tickets t JOIN classroom_users u ON u.id=t.user_id LEFT JOIN schools sc ON sc.id=u.school_id WHERE t.ticket_hash=?").bind(ticketHash).first();
        if (!record || record.used_at || record.expires_at <= now) return fail("پیوند ورود یکپارچه منقضی یا قبلاً استفاده شده است؛ از پنل مدرسه دوباره وارد شوید.", 401, corsHeaders);
        const roleAllowed = record.role === record.account_role ||
          (record.account_role === "manager" && record.role === "teacher") ||
          (["educational_deputy","executive_deputy","pastoral_deputy"].includes(record.account_role) && record.role === "deputy");
        if (!roleAllowed || !["class","schedule"].includes(record.entry)) return fail("نقش یا مقصد ورود یکپارچه معتبر نیست.", 403, corsHeaders);
        const consumed = await env.DB.prepare("UPDATE classroom_sso_tickets SET used_at=? WHERE ticket_hash=? AND used_at IS NULL AND expires_at>?").bind(now,ticketHash,now).run();
        if (!consumed.meta || consumed.meta.changes !== 1) return fail("پیوند ورود یکپارچه قبلاً استفاده شده یا منقضی است؛ دوباره از پنل مدرسه وارد شوید.", 401, corsHeaders);
        const token = randomToken();
        await env.DB.prepare("INSERT INTO classroom_sessions(token_hash,user_id,expires_at,role_override) VALUES(?,?,?,?)")
          .bind(await digest(token),record.user_id,new Date(Date.now()+12*60*60*1000).toISOString(),record.role===record.account_role?null:record.role).run();
        const sessionUser = {...record,role:record.role};
        return json({token,expiresIn:43200,user:userShape(sessionUser),entry:record.entry},200,corsHeaders);
      }
      const user = await authenticate(request, env);
      if (path === "/api/auth/me" && request.method === "GET") return user ? json({ user: userShape(user) }, 200, corsHeaders) : fail("برای ادامه وارد حساب شوید.", 401, corsHeaders);
      if (path === "/api/auth/logout" && request.method === "POST") {
        if (!user) return fail("برای ادامه وارد حساب شوید.", 401, corsHeaders);
        const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
        await env.DB.prepare("DELETE FROM classroom_sessions WHERE token_hash=?").bind(await digest(token)).run();
        return json({ ok: true }, 200, corsHeaders);
      }
      if (!user) return fail("برای ادامه وارد حساب شوید.", 401, corsHeaders);
      if (request.method === "POST" && path === "/api/auth/sso-ticket") {
        const data = await body(request);
        const entry = data.entry === "schedule" ? "schedule" : data.entry === "class" ? "class" : "";
        const requestedRole = String(data.role || user.role);
        const roleAllowed = requestedRole === user.role ||
          (user.role === "manager" && requestedRole === "teacher") ||
          (["educational_deputy","executive_deputy","pastoral_deputy"].includes(user.role) && requestedRole === "deputy");
        if (!entry || !roleAllowed) return fail("نقش یا مقصد ورود یکپارچه مجاز نیست.", 403, corsHeaders);
        const ticket = randomToken();
        const expiresAt = new Date(Date.now()+60*1000).toISOString();
        await env.DB.prepare("INSERT INTO classroom_sso_tickets(ticket_hash,user_id,role,entry,expires_at) VALUES(?,?,?,?,?)")
          .bind(await digest(ticket),user.id,requestedRole,entry,expiresAt).run();
        return json({ticket,expiresIn:60,entry},200,corsHeaders);
      }
      if (path === "/api/me" && request.method === "GET") return json({ user: userShape(user) }, 200, corsHeaders);
      if (path === "/api/school" && request.method === "GET") {
        if (user.role !== "manager") return fail("فقط مدیر مدرسه می‌تواند اطلاعات مدرسه را مشاهده کند.",403,corsHeaders);
        const school = await env.DB.prepare("SELECT id,school_name,school_code,school_level,city,manager_name,created_at FROM schools WHERE id=?").bind(user.school_id || 1).first();
        return json({school},200,corsHeaders);
      }
      if (path === "/api/school" && request.method === "POST") {
        if (user.role !== "manager") return fail("فقط مدیر مدرسه می‌تواند اطلاعات مدرسه را ویرایش کند.",403,corsHeaders);
        const data=await body(request),schoolName=normalize(data.schoolName),schoolLevel=normalize(data.schoolLevel||""),city=normalize(data.city||""),managerName=normalize(data.managerName||user.display_name);
        if(!schoolName||schoolName.length>180||schoolLevel.length>100||city.length>100||managerName.length>120)return fail("نام مدرسه و اطلاعات واردشده را بررسی کنید.",400,corsHeaders);
        const school=await env.DB.prepare("UPDATE schools SET school_name=?,school_level=?,city=?,manager_name=? WHERE id=? RETURNING id,school_name,school_code,school_level,city,manager_name").bind(schoolName,schoolLevel,city,managerName,user.school_id||1).first();
        return json({school},200,corsHeaders);
      }
      if (path === "/api/students" && request.method === "POST") {
        if (user.role !== "manager") return fail("ثبت دانش‌آموز فقط با دسترسی مدیر امکان‌پذیر است.", 403, corsHeaders);
        const data = await body(request);
        const firstName = normalize(data.firstName), familyName = normalize(data.familyName);
        const gradeClass = normalizeGradeClass(data.gradeClass), studentCode = normalizeDigits(data.studentCode ?? data.nationalId);
        if (!firstName || !familyName || !gradeClass || !/^\d{8,12}$/.test(studentCode)) {
          return fail("نام، نام خانوادگی، کلاس و کد دانش‌آموزی ۸ تا ۱۲ رقمی الزامی است.", 400, corsHeaders);
        }
        if (!env.NATIONAL_ID_HMAC_SECRET || env.NATIONAL_ID_HMAC_SECRET.length < 32) {
          return fail("تنظیم امن ثبت دانش‌آموز انجام نشده است.", 503, corsHeaders);
        }
        const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.NATIONAL_ID_HMAC_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
        const studentCodeInput = (user.school_id || 1) === 1 ? studentCode : String(user.school_id)+":"+studentCode;
        const nationalHash = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(studentCodeInput)));
        try {
          const saved = await env.DB.prepare("INSERT INTO classroom_users(role,display_name,family_name,grade_class,national_id_hash,school_id) VALUES('student',?,?,?,?,?) RETURNING id,role,display_name,family_name,grade_class")
            .bind(firstName, familyName, gradeClass, nationalHash, user.school_id || 1).first();
          return json({ student: saved }, 201, corsHeaders);
        } catch (e) {
          if (String(e).includes("UNIQUE")) return fail("این کد ملی قبلاً ثبت شده است.", 409, corsHeaders);
          throw e;
        }
      }
      if (path === "/api/students/import" && request.method === "POST") {
        if (user.role !== "manager") return fail("ورود گروهی دانش‌آموزان فقط توسط مدیر مدرسه مجاز است.",403,corsHeaders);
        const data = await body(request), rows = Array.isArray(data.students) ? data.students : [];
        if (!rows.length || rows.length > 50) return fail("فایل باید بین ۱ تا ۵۰ دانش‌آموز داشته باشد؛ فایل بزرگ‌تر را در چند بخش وارد کنید.",400,corsHeaders);
        if (!env.NATIONAL_ID_HMAC_SECRET || env.NATIONAL_ID_HMAC_SECRET.length < 32) return fail("تنظیم امن ثبت دانش‌آموز انجام نشده است.",503,corsHeaders);
        const key = await crypto.subtle.importKey("raw",new TextEncoder().encode(env.NATIONAL_ID_HMAC_SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
        const results = [];
        for (let index=0; index<rows.length; index++) {
          const row = rows[index] || {};
          const firstName = normalize(row.firstName ?? row.name ?? row["نام"]);
          const familyName = normalize(row.familyName ?? row.family ?? row["نام خانوادگی"]);
          const gradeClass = normalizeGradeClass(row.gradeClass ?? row.grade ?? row.class ?? row["پایه و کلاس"] ?? row["کلاس"]);
          const studentCode = normalizeDigits(row.studentCode ?? row.student_code ?? row.code ?? row["کد دانش آموزی"] ?? row["کد دانش‌آموزی"] ?? row.nationalId ?? row.national_id ?? row["کد ملی"]);
          if (!firstName || !familyName || !gradeClass || !/^\d{8,12}$/.test(studentCode) || firstName.length>80 || familyName.length>100 || gradeClass.length>30) {
            results.push({row:index+2,ok:false,message:"نام، نام خانوادگی، کلاس و کد دانش‌آموزی ۸ تا ۱۲ رقمی معتبر الزامی است."}); continue;
          }
          const studentCodeInput = (user.school_id||1) === 1 ? studentCode : String(user.school_id)+":"+studentCode;
          const nationalHash = hex(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(studentCodeInput)));
          try {
            const saved = await env.DB.prepare("INSERT INTO classroom_users(role,display_name,family_name,grade_class,national_id_hash,school_id) VALUES('student',?,?,?,?,?) RETURNING id,display_name,family_name,grade_class")
              .bind(firstName,familyName,gradeClass,nationalHash,user.school_id||1).first();
            results.push({row:index+2,ok:true,student:saved});
          } catch (error) {
            results.push({row:index+2,ok:false,message:String(error).includes("UNIQUE")?"این کد ملی قبلاً در سامانه ثبت شده است.":"ثبت این ردیف ناموفق بود."});
          }
        }
        return json({results,created:results.filter(item=>item.ok).length,failed:results.filter(item=>!item.ok).length},200,corsHeaders);
      }
      if (path === "/api/schedule" && request.method === "GET") {
        if (!staffRoles.includes(user.role) && user.role !== "teacher") return fail("اجازه مشاهده برنامه را ندارید.", 403, corsHeaders);
        const day = normalizeDay(url.searchParams.get("day"));
        const grade = normalize(url.searchParams.get("gradeClass"));
        const period = Number(url.searchParams.get("period"));
        let sql = "SELECT s.*,u.display_name AS teacher_name FROM school_schedule_v3 s JOIN classroom_users u ON u.id=s.teacher_user_id WHERE s.school_id=?";
        const args = [user.school_id || 1];
        if (day) { args.push(day); sql += " AND s.day_of_week=?" + args.length; }
        if (grade) { args.push(grade); sql += " AND s.grade_class=?" + args.length; }
        if (Number.isInteger(period) && period > 0) { args.push(period); sql += " AND s.period=?" + args.length; }
        if (user.role === "teacher") { args.push(user.id); sql += " AND s.teacher_user_id=?" + args.length; }
        sql += " ORDER BY s.day_of_week,s.period,s.grade_class";
        const result = await env.DB.prepare(sql).bind(...args).all();
        return json({ schedule: result.results }, 200, corsHeaders);
      }
      if (path === "/api/schedule/today" && request.method === "GET") {
        if (!staffRoles.includes(user.role) && user.role !== "teacher" && user.role !== "student") return fail("اجازه مشاهده برنامه را ندارید.", 403, corsHeaders);
        const currentDay = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "Asia/Tehran" }).format(new Date()).toLowerCase();
        const day = normalizeDay(url.searchParams.get("day") || currentDay);
        const localTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tehran", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
        await env.DB.prepare("UPDATE classrooms SET status='ended',updated_at=CURRENT_TIMESTAMP WHERE school_id=? AND status='active' AND ends_at IS NOT NULL AND ends_at<=?").bind(user.school_id||1,new Date().toISOString()).run();
        let sql = "SELECT s.*,u.display_name AS teacher_name,c.title AS classroom_title,c.id AS classroom_id,c.room_code,c.status AS classroom_status,c.ends_at AS classroom_ends_at,CASE WHEN c.status='active' AND (c.ends_at IS NULL OR c.ends_at>?) AND (?!='student' OR s.grade_class=?) THEN 1 ELSE 0 END AS canEnter,CASE WHEN ?=? AND s.start_time IS NOT NULL AND s.end_time IS NOT NULL AND ? >= s.start_time AND ? < s.end_time THEN 1 ELSE 0 END AS isPeriodActive FROM school_schedule_v3 s JOIN classroom_users u ON u.id=s.teacher_user_id LEFT JOIN classrooms c ON c.id=s.classroom_id WHERE s.school_id=? AND s.day_of_week=?";
        const args = [new Date().toISOString(), user.role, user.grade_class || "", currentDay, day, localTime, localTime, user.school_id || 1, day];
        if (user.role === "student") { args.push(user.grade_class || ""); sql += " AND s.grade_class=?"; }
        if (user.role === "teacher") { args.push(user.id); sql += " AND s.teacher_user_id=?"; }
        sql += " ORDER BY s.period,s.grade_class";
        const result = await env.DB.prepare(sql).bind(...args).all();
        return json({ day, schedule: result.results.map(row => ({ ...row, canEnter: Boolean(row.canEnter), isPeriodActive: Boolean(row.isPeriodActive) })) }, 200, corsHeaders);
      }
      if (path === "/api/schedule" && request.method === "POST") {
        if (!managerRoles.includes(user.role)) return fail("فقط مدیر و معاون آموزشی می‌توانند برنامه را ثبت کنند.", 403, corsHeaders);
        const data = await body(request);
        const day = normalizeDay(data.day), period = Number(data.period);
        const grade = normalize(data.gradeClass), subject = normalize(data.subject || "");
        const teacherId = Number(data.teacherId), startTime = normalize(data.startTime || ""), endTime = normalize(data.endTime || "");
        const validDays = ["saturday", "sunday", "monday", "tuesday", "wednesday", "thursday", "friday"];
        if (!validDays.includes(day) || !Number.isInteger(period) || period < 1 || period > 12 || !grade || !Number.isSafeInteger(teacherId) || teacherId < 1) {
          return fail("روز، زنگ، کلاس و دبیر را به‌درستی وارد کنید.", 400, corsHeaders);
        }
        if ((startTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) || (endTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime))) {
          return fail("ساعت شروع و پایان باید به شکل ساعت:دقیقه باشد.", 400, corsHeaders);
        }
        const teacher = await env.DB.prepare("SELECT id FROM classroom_users WHERE id=? AND school_id=? AND role IN ('teacher','educational_deputy','pastoral_deputy','manager')").bind(teacherId,user.school_id || 1).first();
        if (!teacher) return fail("دبیر انتخاب‌شده معتبر نیست.", 400, corsHeaders);
        const activationMode = /علوم|مطالعات/.test(subject) ? "manual" : "scheduled";
        let saved = await env.DB.prepare("INSERT INTO school_schedule_v3(school_id,day_of_week,period,grade_class,subject,teacher_user_id,start_time,end_time,activation_mode) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(school_id,day_of_week,period,grade_class,subject,teacher_user_id) DO UPDATE SET start_time=excluded.start_time,end_time=excluded.end_time,activation_mode=excluded.activation_mode RETURNING *")
          .bind(user.school_id || 1,day,period,grade,subject,teacherId,startTime||null,endTime||null,activationMode).first();
        let classroom = saved.classroom_id
          ? await env.DB.prepare("SELECT * FROM classrooms WHERE id=? AND school_id=?").bind(saved.classroom_id,user.school_id||1).first()
          : null;
        if (classroom) {
          await env.DB.prepare("UPDATE classrooms SET title=?,grade_class=?,teacher_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND school_id=?")
            .bind(subject ? subject+" · "+grade : "کلاس "+grade,grade,teacherId,classroom.id,user.school_id||1).run();
          classroom = await env.DB.prepare("SELECT * FROM classrooms WHERE id=? AND school_id=?").bind(classroom.id,user.school_id||1).first();
        }
        if (!classroom) {
          const id = crypto.randomUUID(), code = roomCode();
          classroom = await env.DB.prepare("INSERT INTO classrooms(id,title,grade_class,teacher_user_id,room_code,status,created_by,school_id) VALUES(?,?,?,?,?,'scheduled',?,?) RETURNING *")
            .bind(id,subject ? subject+" · "+grade : "کلاس "+grade,grade,teacherId,code,user.id,user.school_id||1).first();
          await env.DB.prepare("UPDATE school_schedule_v3 SET classroom_id=? WHERE school_id=? AND id=?").bind(id,user.school_id||1,saved.id).run();
          saved = {...saved,classroom_id:id};
          await audit(env,id,user.id,"class-created-from-schedule",{title:classroom.title,gradeClass:grade,day,period});
        }
        return json({ schedule: saved, classroom: { id: classroom.id, title: classroom.title, room_code: classroom.room_code, status: classroom.status } }, 200, corsHeaders);
      }
      if (path === "/api/teachers" && request.method === "GET") {
        if (!staffRoles.includes(user.role)) return fail("اجازه انجام این کار را ندارید.", 403, corsHeaders);
        const result = await env.DB.prepare("SELECT id,display_name,username,role FROM classroom_users WHERE school_id=? AND role IN ('teacher','educational_deputy','pastoral_deputy','manager') ORDER BY display_name").bind(user.school_id || 1).all();
        return json({ teachers: result.results }, 200, corsHeaders);
      }
      if (path === "/api/staff/import" && request.method === "POST") {
        if (user.role !== "manager") return fail("ورود گروهی دبیران فقط توسط مدیر مجاز است.", 403, corsHeaders);
        const data = await body(request);
        const rows = Array.isArray(data.staff) ? data.staff : [];
        if (!rows.length || rows.length > 50) return fail("فایل باید بین ۱ تا ۵۰ ردیف معتبر داشته باشد؛ فایل‌های بزرگ‌تر را در چند بخش وارد کنید.", 400, corsHeaders);
        const allowedRoles = ["teacher", "educational_deputy", "executive_deputy", "pastoral_deputy"];
        const results = [];
        for (let index = 0; index < rows.length; index++) {
          const row = rows[index] || {};
          const displayName = normalize(row.displayName ?? row.name ?? row["نام و نام خانوادگی"]);
          const username = normalizeUsername(row.username ?? row["نام کاربری"] ?? row.phone);
          const password = String(row.password ?? row["رمز عبور"] ?? "");
          const rawRole = normalize(row.role ?? row["نقش"] ?? "teacher").toLowerCase();
          const roleAliases = {
            "دبیر": "teacher", "معلم": "teacher", "teacher": "teacher",
            "معاون آموزشی": "educational_deputy", "educational": "educational_deputy", "educational_deputy": "educational_deputy",
            "معاون اجرایی": "executive_deputy", "executive": "executive_deputy", "executive_deputy": "executive_deputy",
            "معاون پرورشی": "pastoral_deputy", "معاون فرهنگی": "pastoral_deputy", "cultural": "pastoral_deputy", "pastoral": "pastoral_deputy", "pastoral_deputy": "pastoral_deputy"
          };
          const role = roleAliases[rawRole] || rawRole;
          if (!displayName || !username || password.length < 8 || password.length > 72 || !allowedRoles.includes(role)) {
            results.push({ row: index + 2, ok: false, message: "نام، نام کاربری، نقش معتبر و رمز ۸ تا ۷۲ نویسه‌ای الزامی است." });
            continue;
          }
          try {
            const schoolId = user.school_id || 1;
            const cred = await hashPassword(password);
            let saved = await env.DB.prepare("SELECT id,role,display_name,username,password_hash FROM classroom_users WHERE school_id=? AND username=? LIMIT 1")
              .bind(schoolId,username).first();
            if (saved) {
              // Re-importing the same person is idempotent and does not silently reset an existing password.
              if (normalize(saved.display_name) !== displayName || saved.role !== role) {
                results.push({ row: index + 2, ok: false, message: "این نام کاربری متعلق به حساب دیگری است؛ نام یا نقش را بررسی کنید." });
                continue;
              }
              if (!saved.password_hash) {
                saved = await env.DB.prepare("UPDATE classroom_users SET password_salt=?,password_hash=? WHERE id=? RETURNING id,role,display_name,username")
                  .bind(cred.salt,cred.hash,saved.id).first();
              } else {
                saved = { id: saved.id, role: saved.role, display_name: saved.display_name, username: saved.username };
              }
              results.push({ row: index + 2, ok: true, staff: saved, alreadyExists: true, linkedExistingTimetable: role === "teacher" });
              continue;
            }
            // Reuse an existing timetable placeholder by exact name and role, including deputy roles.
            const placeholder = await env.DB.prepare("SELECT id,role,display_name,username,password_hash FROM classroom_users WHERE school_id=? AND role=? AND display_name=? LIMIT 1")
              .bind(schoolId,role,displayName).first();
            if (placeholder) {
              if (placeholder.username) {
                results.push({ row: index + 2, ok: false, message: "این همکار قبلاً با نام کاربری دیگری ثبت شده است؛ برای جلوگیری از حساب تکراری، اطلاعات را بررسی کنید." });
                continue;
              }
              saved = await env.DB.prepare("UPDATE classroom_users SET username=?,password_salt=?,password_hash=? WHERE id=? RETURNING id,role,display_name,username")
                .bind(username,cred.salt,cred.hash,placeholder.id).first();
            } else {
              saved = await env.DB.prepare("INSERT INTO classroom_users(role,display_name,username,password_salt,password_hash,school_id) VALUES(?,?,?,?,?,?) RETURNING id,role,display_name,username")
                .bind(role,displayName,username,cred.salt,cred.hash,schoolId).first();
            }
            results.push({ row: index + 2, ok: true, staff: saved, linkedExistingTimetable: Boolean(saved && role === "teacher") });
          } catch (error) {
            results.push({ row: index + 2, ok: false, message: String(error).includes("UNIQUE") ? "نام کاربری قبلاً ثبت شده است." : "ثبت این ردیف ناموفق بود." });
          }
        }
        return json({ results, created: results.filter(item => item.ok).length, failed: results.filter(item => !item.ok).length }, 200, corsHeaders);
      }
      if (path === "/api/staff" && request.method === "POST") {
        if (user.role !== "manager") return fail("ثبت حساب کارکنان فقط توسط مدیر مجاز است.", 403, corsHeaders);
        const data = await body(request), displayName = normalize(data.displayName), username = normalizeUsername(data.username), password = String(data.password || ""), role = String(data.role || "");
        if (!displayName || !username || password.length < 8 || !["teacher", "educational_deputy", "executive_deputy", "pastoral_deputy"].includes(role)) return fail("نام، نام کاربری، رمز حداقل ۸ حرفی و نقش معتبر لازم است.", 400, corsHeaders);
        const cred = await hashPassword(password);
        try {
          const saved = await env.DB.prepare("INSERT INTO classroom_users(role,display_name,username,password_salt,password_hash,school_id) VALUES(?,?,?,?,?,?) RETURNING id,role,display_name,username")
            .bind(role,displayName,username,cred.salt,cred.hash,user.school_id || 1).first();
          return json({ staff: saved }, 201, corsHeaders);
        } catch (e) { if (String(e).includes("UNIQUE")) return fail("این نام کاربری قبلاً ثبت شده است.", 409, corsHeaders); throw e; }
      }
      if (path === "/api/classes" && request.method === "GET") {
        if (!staffRoles.includes(user.role) && user.role !== "teacher") return fail("اجازه انجام این کار را ندارید.", 403, corsHeaders);
        const result = user.role === "manager" || user.role === "educational_deputy" || user.role === "executive_deputy"
          ? await env.DB.prepare("SELECT c.*,u.display_name AS teacher_name FROM classrooms c JOIN classroom_users u ON u.id=c.teacher_user_id WHERE c.school_id=? ORDER BY c.created_at DESC").bind(user.school_id || 1).all()
          : await env.DB.prepare("SELECT c.*,u.display_name AS teacher_name FROM classrooms c JOIN classroom_users u ON u.id=c.teacher_user_id WHERE c.school_id=? AND c.teacher_user_id=? ORDER BY c.created_at DESC").bind(user.school_id || 1,user.id).all();
        return json({ classes: result.results }, 200, corsHeaders);
      }
      if (path === "/api/class-creation-permission" && request.method === "GET") {
        if (user.role !== "manager") return fail("فقط مدیر می‌تواند مجوز ساخت کلاس را مشاهده کند.", 403, corsHeaders);
        const setting = await env.DB.prepare("SELECT setting_value FROM classroom_settings WHERE setting_key=?").bind("school:"+(user.school_id||1)+":educational_deputy_create_class").first();
        return json({ enabled: setting?.setting_value === "true" }, 200, corsHeaders);
      }
      if (path === "/api/class-creation-permission" && request.method === "POST") {
        if (user.role !== "manager") return fail("فقط مدیر می‌تواند مجوز ساخت کلاس را تغییر دهد.", 403, corsHeaders);
        const data = await body(request);
        if (typeof data.enabled !== "boolean") return fail("وضعیت مجوز نامعتبر است.", 400, corsHeaders);
        await env.DB.prepare("INSERT INTO classroom_settings(setting_key,setting_value,updated_by,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP")
          .bind("school:"+(user.school_id||1)+":educational_deputy_create_class",String(data.enabled),user.id).run();
        return json({ enabled: data.enabled }, 200, corsHeaders);
      }
      if (path === "/api/classes" && request.method === "POST") {
        if (user.role !== "manager") {
          if (user.role !== "educational_deputy") return fail("اجازه ساخت کلاس ندارید.", 403, corsHeaders);
          const permission = await env.DB.prepare("SELECT setting_value FROM classroom_settings WHERE setting_key=?").bind("school:"+(user.school_id||1)+":educational_deputy_create_class").first();
          if (permission?.setting_value !== "true") return fail("مدیر مدرسه هنوز مجوز ساخت کلاس را برای معاون آموزشی فعال نکرده است.", 403, corsHeaders);
        }
        const data = await body(request), title = normalize(data.title), grade = normalize(data.gradeClass), teacherId = Number(data.teacherId);
        const day = normalizeDay(data.day), period = Number(data.period);
        if (!title || !grade || !Number.isSafeInteger(teacherId) || teacherId < 1 || !day || !Number.isInteger(period) || period < 1) {
          return fail("عنوان، کلاس، دبیر، روز و زنگ مطابق برنامه الزامی است.", 400, corsHeaders);
        }
        const teacher = await env.DB.prepare("SELECT id FROM classroom_users WHERE id=? AND school_id=? AND role IN ('teacher','educational_deputy','pastoral_deputy','manager')").bind(teacherId,user.school_id||1).first();
        if (!teacher) return fail("دبیر انتخاب‌شده معتبر نیست.", 400, corsHeaders);
        const scheduled = await env.DB.prepare("SELECT id,classroom_id,subject,activation_mode FROM school_schedule_v3 WHERE school_id=? AND day_of_week=? AND period=? AND grade_class=? AND teacher_user_id=? AND (subject=? OR ?=subject || ' · ' || grade_class)")
          .bind(user.school_id||1,day,period,grade,teacherId,title,title).first();
        if (!scheduled) return fail("برای این دبیر، کلاس، روز و زنگ برنامهٔ هفتگی ثبت نشده است.", 409, corsHeaders);
        if (scheduled.classroom_id) {
          const existing = await env.DB.prepare("SELECT * FROM classrooms WHERE id=? AND school_id=?").bind(scheduled.classroom_id,user.school_id||1).first();
          if (existing) return json({ classroom: existing, reused: true }, 200, corsHeaders);
        }
        const id = crypto.randomUUID(), code = roomCode();
        const saved = await env.DB.prepare("INSERT INTO classrooms(id,title,grade_class,teacher_user_id,room_code,status,created_by,school_id) VALUES(?,?,?,?,?,'scheduled',?,?) RETURNING *")
          .bind(id,title,grade,teacherId,code,user.id,user.school_id||1).first();
        await env.DB.prepare("UPDATE school_schedule_v3 SET classroom_id=? WHERE school_id=? AND id=?").bind(id,user.school_id||1,scheduled.id).run();
        await audit(env, id, user.id, "class-created", { title, gradeClass: grade });
        return json({ classroom: saved }, 201, corsHeaders);
      }
      const accessMatch = path.match(/^\/api\/classes\/([^/]+)\/access$/);
      const startMatch = path.match(/^\/api\/classes\/([^/]+)\/start$/);
      const endMatch = path.match(/^\/api\/classes\/([^/]+)\/end$/);
      if (accessMatch && request.method === "GET") {
        const classroom = await env.DB.prepare("SELECT * FROM classrooms WHERE id=? AND school_id=?").bind(accessMatch[1],user.school_id||1).first();
        if (!classroom) return fail("کلاس پیدا نشد.", 404, corsHeaders);
        const privileged = accessRoles.includes(user.role) && (user.role !== "teacher" || classroom.teacher_user_id === user.id);
        const endedByTime = classroom.ends_at && new Date(classroom.ends_at).getTime() <= Date.now();
        if (endedByTime && classroom.status !== "ended") return fail("زمان این کلاس به پایان رسیده است.", 403, corsHeaders);
        if (!privileged && !(user.role === "student" && classroom.grade_class === user.grade_class && classroom.status === "active")) return fail("اجازه ورود به این کلاس را ندارید.", 403, corsHeaders);
        if (classroom.status !== "active" && !privileged) return fail("کلاس هنوز توسط دبیر شروع نشده است.", 403, corsHeaders);
        return json({ classroom: { id: classroom.id, title: classroom.title, gradeClass: classroom.grade_class, roomCode: classroom.room_code, status: classroom.status, startsAt: classroom.starts_at, endsAt: classroom.ends_at } }, 200, corsHeaders);
      }
      if (startMatch && request.method === "POST") {
        const target = await env.DB.prepare("SELECT c.id,c.teacher_user_id,c.status,c.starts_at,c.ends_at,c.grade_class,s.activation_mode,s.day_of_week,s.period,s.start_time,s.end_time FROM classrooms c LEFT JOIN school_schedule_v3 s ON s.classroom_id=c.id AND s.school_id=c.school_id WHERE c.id=? AND c.school_id=?").bind(startMatch[1],user.school_id||1).first();
        if (!target) return fail("کلاس پیدا نشد.", 404, corsHeaders);
        const teachingRoles = ["teacher", "educational_deputy", "pastoral_deputy"];
        const mayStart = managerRoles.includes(user.role) || (teachingRoles.includes(user.role) && target.teacher_user_id === user.id);
        if (!mayStart) return fail("شروع کلاس فقط برای مدیر، معاون آموزشی یا دبیر همان کلاس مجاز است.", 403, corsHeaders);
        if (target.activation_mode === "manual") {
          const competing = await env.DB.prepare("SELECT c.title FROM school_schedule_v3 s JOIN classrooms c ON c.id=s.classroom_id WHERE s.school_id=? AND s.day_of_week=? AND s.period=? AND s.grade_class=? AND s.activation_mode='manual' AND c.status='active' AND c.id!=? AND (c.ends_at IS NULL OR c.ends_at>?) LIMIT 1")
            .bind(user.school_id||1,target.day_of_week,target.period,target.grade_class,target.id,new Date().toISOString()).first();
          if (competing) return fail("برای این پایه و زنگ، درس علوم یا مطالعات دیگری فعال است؛ ابتدا همان کلاس را پایان دهید.",409,corsHeaders);
        }
        const now = new Date();
        const todayTehran = tehranDate(now);
        const currentDay = new Intl.DateTimeFormat("en-US",{weekday:"long",timeZone:"Asia/Tehran"}).format(now).toLowerCase();
        const localTime = new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Tehran",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(now);
        if (target.day_of_week !== currentDay || !target.start_time || !target.end_time || localTime < target.start_time || localTime >= target.end_time) {
          return fail("این درس فقط در روز و ساعت ثبت‌شدهٔ برنامه هفتگی قابل شروع است.",409,corsHeaders);
        }
        const previousStartDay = target.starts_at ? tehranDate(new Date(target.starts_at)) : "";
        if (target.status === "ended" && previousStartDay === todayTehran) return fail("این کلاس امروز پایان یافته است.", 409, corsHeaders);
        const startValue = now.toISOString();
        let durationMs = 50*60*1000;
        if (target.end_time) {
          const [endHour,endMinute] = target.end_time.split(":").map(Number);
          const timeParts = new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Tehran",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(now).reduce((out,p)=>{if(["hour","minute","second"].includes(p.type))out[p.type]=Number(p.value);return out;},{});
          durationMs = Math.max(1000,((endHour*3600+endMinute*60)-(timeParts.hour*3600+timeParts.minute*60+timeParts.second))*1000);
        }
        const result = await env.DB.prepare("UPDATE classrooms SET status='active',starts_at=?,ends_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND school_id=? RETURNING *")
          .bind(startValue,new Date(now.getTime()+durationMs).toISOString(),startMatch[1],user.school_id||1).first();
        if (!result) return fail("کلاس پیدا نشد یا پایان یافته است.", 404, corsHeaders);
        await audit(env, result.id, user.id, "class-started");
        return json({ classroom: result }, 200, corsHeaders);
      }
      if (endMatch && request.method === "POST") {
        const target = await env.DB.prepare("SELECT id,teacher_user_id,status FROM classrooms WHERE id=? AND school_id=?").bind(endMatch[1],user.school_id||1).first();
        if (!target) return fail("کلاس پیدا نشد.", 404, corsHeaders);
        const teachingRoles = ["teacher", "educational_deputy", "pastoral_deputy"];
        const mayEnd = managerRoles.includes(user.role) || (teachingRoles.includes(user.role) && target.teacher_user_id === user.id);
        if (!mayEnd) return fail("پایان کلاس فقط برای مدیر، معاون آموزشی یا دبیر همان کلاس مجاز است.", 403, corsHeaders);
        if (target.status === "ended") return fail("کلاس قبلاً پایان یافته است.", 409, corsHeaders);
        const result = await env.DB.prepare("UPDATE classrooms SET status='ended',ends_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND school_id=? AND status!='ended' RETURNING id,status,ends_at")
          .bind(new Date().toISOString(),endMatch[1],user.school_id||1).first();
        if (!result) return fail("کلاس پیدا نشد یا قبلاً پایان یافته است.", 404, corsHeaders);
        await env.DB.prepare("UPDATE classroom_attendance SET status='unconfirmed',duration_seconds=MAX(duration_seconds,CAST(MAX(0,(julianday(?) - julianday(joined_at))*86400) AS INTEGER)) WHERE classroom_id=? AND session_date=? AND status IN ('joined','prompted')")
          .bind(result.ends_at || new Date().toISOString(),result.id,tehranDate(new Date())).run();
        await audit(env, result.id, user.id, "class-ended");
        return json({ classroom: result }, 200, corsHeaders);
      }
      if (path === "/api/attendance/daily" && request.method === "GET") {
        if (!["manager","educational_deputy"].includes(user.role)) return fail("گزارش حضور و غیاب فقط برای مدیر و معاون آموزشی مجاز است.",403,corsHeaders);
        const requestedDate = normalize(url.searchParams.get("date") || "");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate) || !Number.isFinite(Date.parse(requestedDate+"T12:00:00+03:30"))) return fail("تاریخ گزارش معتبر نیست.",400,corsHeaders);
        const dateObj = new Date(requestedDate+"T12:00:00+03:30");
        const day = new Intl.DateTimeFormat("en-US",{weekday:"long",timeZone:"Asia/Tehran"}).format(dateObj).toLowerCase();
        const result = await env.DB.prepare("SELECT s.day_of_week,s.period,s.grade_class,s.subject,s.start_time,s.end_time,c.id AS classroom_id,c.title AS classroom_title,t.display_name AS teacher_name,stu.id AS student_id,stu.display_name AS student_name,stu.family_name,a.status,a.joined_at,a.prompted_at,a.confirmed_at,a.response_deadline,a.left_at,a.duration_seconds FROM school_schedule_v3 s JOIN classrooms c ON c.id=s.classroom_id AND c.school_id=s.school_id JOIN classroom_users t ON t.id=s.teacher_user_id JOIN classroom_users stu ON stu.school_id=s.school_id AND stu.role='student' AND stu.grade_class=s.grade_class LEFT JOIN classroom_attendance a ON a.classroom_id=c.id AND a.student_user_id=stu.id AND a.session_date=? WHERE s.school_id=? AND s.day_of_week=? AND date(datetime(c.starts_at,'+3 hours','+30 minutes'))=? ORDER BY s.period,s.grade_class,s.subject,stu.family_name,stu.display_name").bind(requestedDate,user.school_id||1,day,requestedDate).all();
        const rows = (result.results||[]).map(row=>({...row,attendanceStatus:row.status || "absent",durationSeconds:Number(row.duration_seconds||0)}));
        return json({date:requestedDate,day,rows,summary:{total:rows.length,present:rows.filter(r=>r.attendanceStatus==="present").length,unconfirmed:rows.filter(r=>r.attendanceStatus==="unconfirmed"||r.attendanceStatus==="left").length,absent:rows.filter(r=>r.attendanceStatus==="absent").length,waiting:rows.filter(r=>r.attendanceStatus==="joined"||r.attendanceStatus==="prompted").length}},200,corsHeaders);
      }
      const attendanceMatch = path.match(/^\/api\/classes\/([^/]+)\/attendance\/(join|status|confirm|leave)$/);
      if (attendanceMatch) {
        const classroomId = attendanceMatch[1], action = attendanceMatch[2];
        const classroom = await env.DB.prepare("SELECT id,school_id,grade_class,status,starts_at,ends_at FROM classrooms WHERE id=? AND school_id=?").bind(classroomId,user.school_id||1).first();
        if (!classroom) return fail("کلاس پیدا نشد.",404,corsHeaders);
        if (action === "join" && request.method === "POST") {
          if (user.role !== "student" || (classroom.grade_class !== user.grade_class && classroom.grade_class !== "*")) return fail("فقط دانش‌آموز همین کلاس می‌تواند حضور خود را ثبت کند.",403,corsHeaders);
          if (classroom.status !== "active" || (classroom.ends_at && Date.parse(classroom.ends_at)<=Date.now())) return fail("این کلاس اکنون فعال نیست.",403,corsHeaders);
          const sessionDate = tehranDate(new Date());
          const now = new Date(), nowIso = now.toISOString();
          const endMs = classroom.ends_at ? Date.parse(classroom.ends_at) : now.getTime()+50*60*1000;
          const maxOffset = Math.max(0,Math.min(30*60*1000,endMs-now.getTime()-60*1000));
          const minOffset = Math.min(5*60*1000,maxOffset);
          const offset = minOffset + Math.floor(Math.random()*(Math.max(0,maxOffset-minOffset)+1));
          const due = new Date(now.getTime()+offset).toISOString();
          await env.DB.prepare("INSERT OR IGNORE INTO classroom_attendance(school_id,classroom_id,student_user_id,session_date,status,joined_at,prompt_due_at) VALUES(?,?,?,?,'joined',?,?)")
            .bind(user.school_id||1,classroomId,user.id,sessionDate,nowIso,due).run();
          const record = await env.DB.prepare("SELECT status,session_date,joined_at,prompt_due_at,response_deadline,confirmed_at FROM classroom_attendance WHERE classroom_id=? AND student_user_id=? AND session_date=?")
            .bind(classroomId,user.id,sessionDate).first();
          if (record?.status === "unconfirmed" || record?.status === "left") return fail("تأیید حضور این زنگ انجام نشده و ورود دوباره بسته است.",403,corsHeaders);
          await audit(env,classroomId,user.id,"student-joined",{sessionDate});
          return json({attendance:record},200,corsHeaders);
        }
        if (action === "leave" && request.method === "POST") {
          if (user.role !== "student" || classroom.grade_class !== user.grade_class) return fail("اجازه ثبت خروج را ندارید.",403,corsHeaders);
          const sessionDate = tehranDate(new Date()), leftAt = new Date().toISOString();
          await env.DB.prepare("UPDATE classroom_attendance SET status='left',left_at=?,duration_seconds=MAX(duration_seconds,CAST(MAX(0,(julianday(?) - julianday(joined_at))*86400) AS INTEGER)) WHERE classroom_id=? AND student_user_id=? AND session_date=? AND status IN ('joined','prompted')")
            .bind(leftAt,leftAt,classroomId,user.id,sessionDate).run();
          await audit(env,classroomId,user.id,"student-left-before-confirmation",{sessionDate,leftAt});
          return json({ok:true},200,corsHeaders);
        }
        if (action === "status" && request.method === "GET") {
          if (user.role !== "student" || classroom.grade_class !== user.grade_class) return fail("اجازه مشاهده وضعیت حضور را ندارید.",403,corsHeaders);
          const sessionDate = tehranDate(new Date());
          let record = await env.DB.prepare("SELECT status,session_date,joined_at,prompt_due_at,prompted_at,response_deadline,confirmed_at FROM classroom_attendance WHERE classroom_id=? AND student_user_id=? AND session_date=?")
            .bind(classroomId,user.id,sessionDate).first();
          if (!record) return fail("ثبت ورود به کلاس پیدا نشد؛ از برنامه مدرسه دوباره وارد شوید.",404,corsHeaders);
          const now = Date.now();
          if (record.status === "joined" && Date.parse(record.prompt_due_at)<=now) {
            const deadline = new Date(Math.min(now+60*1000,classroom.ends_at?Date.parse(classroom.ends_at):now+60*1000)).toISOString();
            await env.DB.prepare("UPDATE classroom_attendance SET status='prompted',prompted_at=?,response_deadline=? WHERE classroom_id=? AND student_user_id=? AND session_date=? AND status='joined'")
              .bind(new Date(now).toISOString(),deadline,classroomId,user.id,sessionDate).run();
            record = await env.DB.prepare("SELECT status,session_date,joined_at,prompt_due_at,prompted_at,response_deadline,confirmed_at FROM classroom_attendance WHERE classroom_id=? AND student_user_id=? AND session_date=?")
              .bind(classroomId,user.id,sessionDate).first();
            await audit(env,classroomId,user.id,"attendance-prompted",{sessionDate,deadline:record.response_deadline});
          }
          if (record.status === "prompted" && Date.parse(record.response_deadline)<=now) {
            await env.DB.prepare("UPDATE classroom_attendance SET status='unconfirmed' WHERE classroom_id=? AND student_user_id=? AND session_date=? AND status='prompted'")
              .bind(classroomId,user.id,sessionDate).run();
            await audit(env,classroomId,user.id,"attendance-unconfirmed",{sessionDate});
            return json({status:"unconfirmed",closed:true},200,corsHeaders);
          }
          return json({status:record.status,sessionDate:record.session_date,promptedAt:record.prompted_at,responseDeadline:record.response_deadline,confirmedAt:record.confirmed_at,closed:record.status==="unconfirmed"||record.status==="left"},200,corsHeaders);
        }
        if (action === "confirm" && request.method === "POST") {
          if (user.role !== "student" || classroom.grade_class !== user.grade_class) return fail("اجازه تأیید حضور را ندارید.",403,corsHeaders);
          const sessionDate = tehranDate(new Date());
          const record = await env.DB.prepare("SELECT status,response_deadline,joined_at FROM classroom_attendance WHERE classroom_id=? AND student_user_id=? AND session_date=?")
            .bind(classroomId,user.id,sessionDate).first();
          if (!record || record.status !== "prompted") return fail("درخواست تأیید حضور فعال نیست.",409,corsHeaders);
          if (!record.response_deadline || Date.parse(record.response_deadline)<=Date.now()) {
            await env.DB.prepare("UPDATE classroom_attendance SET status='unconfirmed' WHERE classroom_id=? AND student_user_id=? AND session_date=? AND status='prompted'").bind(classroomId,user.id,sessionDate).run();
            return fail("مهلت تأیید حضور به پایان رسیده است؛ ورود این زنگ بسته شد.",409,corsHeaders);
          }
          const confirmedAt = new Date().toISOString();
          const durationSeconds = Math.max(0, Math.floor((Date.parse(confirmedAt) - Date.parse(record.joined_at)) / 1000));
          await env.DB.prepare("UPDATE classroom_attendance SET status='present',confirmed_at=?,duration_seconds=? WHERE classroom_id=? AND student_user_id=? AND session_date=? AND status='prompted'")
            .bind(confirmedAt,durationSeconds,classroomId,user.id,sessionDate).run();
          await audit(env,classroomId,user.id,"attendance-confirmed",{sessionDate,confirmedAt});
          return json({status:"present",confirmedAt},200,corsHeaders);
        }
        return fail("روش درخواست حضور معتبر نیست.",405,corsHeaders);
      }
      if (path === "/api/classes/active" && request.method === "GET") {
        const result = await env.DB.prepare("SELECT id,title,grade_class,room_code,status,starts_at,ends_at FROM classrooms WHERE school_id=? AND status='active' AND (ends_at IS NULL OR ends_at>?) AND (grade_class=? OR grade_class='*') ORDER BY starts_at DESC").bind(user.school_id||1,new Date().toISOString(),user.grade_class||"").all();
        return json({ classes: result.results }, 200, corsHeaders);
      }
      return fail("مسیر در سرور مستقل پیاده‌سازی نشده است.", 404, corsHeaders);
    } catch (error) {
      // Keep details in Worker logs, never expose database errors or secrets to visitors.
      console.error("worker_request_failed", {
        method: request.method,
        path: url.pathname,
        stage: failureStage,
        error: String(error),
      });
      // A safe stage identifier helps diagnose failures without exposing secrets or SQL details.
      const safeCode = String(error?.message || "").match(/^PASSWORD_DERIVE_BITS_FAILED:([A-Za-z]+)/)?.[1];
      return json({ error: "خطای داخلی سرور.", stage: failureStage, ...(safeCode ? { errorCode: safeCode } : {}) }, 500, corsHeaders);
    }
  },
};
