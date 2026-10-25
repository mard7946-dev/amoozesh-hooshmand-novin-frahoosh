'use strict';

require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const crypto = require('node:crypto');
const path = require('node:path');
const { Pool } = require('pg');
const multer = require('multer');
const XLSX = require('xlsx');
const rateLimit = require('express-rate-limit');

const app = express();
const port = Number(process.env.PORT || 8080);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false } });
const sessions = new Map(); // Short-lived bootstrap fallback only; production uses DB sessions below.
app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean), credentials: false }));
app.use(express.json({ limit: '64kb' }));
const excelUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'تعداد تلاش‌ها زیاد است؛ کمی بعد دوباره امتحان کنید.' } });

const randomToken = () => crypto.randomBytes(32).toString('base64url');
const hashToken = value => crypto.createHash('sha256').update(value).digest('hex');
const normalizeDigits = value => String(value ?? '').replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/\s+/g, '');
const normalizeText = value => String(value ?? '').trim().replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\s+/g, ' ');
const normalizeNationalId = value => { const digits = normalizeDigits(value); return /^\d{1,10}$/.test(digits) ? digits.padStart(10, '0') : digits; };
const nationalIdHash = value => {
  if (!process.env.NATIONAL_ID_HMAC_SECRET || process.env.NATIONAL_ID_HMAC_SECRET.length < 32) throw new Error('NATIONAL_ID_HMAC_SECRET must be set to a random secret of at least 32 characters');
  return crypto.createHmac('sha256', process.env.NATIONAL_ID_HMAC_SECRET).update(normalizeNationalId(value)).digest('hex');
};
const workbookRows = buffer => {
  const book = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const result = {};
  for (const sheetName of book.SheetNames) result[normalizeText(sheetName).toLowerCase()] = XLSX.utils.sheet_to_json(book.Sheets[sheetName], { defval: '', raw: false });
  return result;
};
const field = (row, ...names) => {
  const entries = Object.entries(row).map(([k, v]) => [normalizeText(k).toLowerCase(), v]);
  const found = entries.find(([k]) => names.some(n => k === normalizeText(n).toLowerCase()));
  return found ? String(found[1] ?? '').trim() : '';
};
const dayAliases = value => {
  const d = normalizeText(value).toLowerCase();
  const map = { 'شنبه':'saturday','sat':'saturday','saturday':'saturday','یکشنبه':'sunday','يکشنبه':'sunday','sun':'sunday','sunday':'sunday','دوشنبه':'monday','mon':'monday','monday':'monday','سه‌شنبه':'tuesday','سه شنبه':'tuesday','tue':'tuesday','tuesday':'tuesday','چهارشنبه':'wednesday','wed':'wednesday','wednesday':'wednesday','پنجشنبه':'thursday','پنج‌شنبه':'thursday','thu':'thursday','thursday':'thursday','جمعه':'friday','fri':'friday','friday':'friday' };
  return map[d] || '';
};
const hashPassword = (password, salt = crypto.randomBytes(16).toString('hex')) => new Promise((resolve, reject) => {
  crypto.scrypt(password, salt, 64, (err, key) => err ? reject(err) : resolve({ salt, hash: key.toString('hex') }));
});
const verifyPassword = (password, salt, expected) => new Promise((resolve, reject) => {
  crypto.scrypt(password, salt, 64, (err, key) => {
    if (err) return reject(err);
    const actual = key.toString('hex');
    resolve(actual.length === expected.length && crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex')));
  });
});

async function ensureSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS classroom_users (
    id BIGSERIAL PRIMARY KEY, role TEXT NOT NULL CHECK (role IN ('manager','teacher','student','educational_deputy','executive_deputy','pastoral_deputy')),
    display_name TEXT NOT NULL, username TEXT UNIQUE, password_salt TEXT, password_hash TEXT,
    grade_class TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS classrooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), title TEXT NOT NULL, grade_class TEXT NOT NULL,
    teacher_user_id BIGINT NOT NULL REFERENCES classroom_users(id), room_code TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','active','ended')),
    starts_at TIMESTAMPTZ, ends_at TIMESTAMPTZ, created_by BIGINT NOT NULL REFERENCES classroom_users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query("ALTER TABLE classroom_users DROP CONSTRAINT IF EXISTS classroom_users_role_check");
  await pool.query("ALTER TABLE classroom_users ADD CONSTRAINT classroom_users_role_check CHECK (role IN ('manager','teacher','student','educational_deputy','executive_deputy','pastoral_deputy'))");
  await pool.query("ALTER TABLE classroom_users ADD COLUMN IF NOT EXISTS family_name TEXT");
  await pool.query("ALTER TABLE classroom_users ADD COLUMN IF NOT EXISTS national_id_hash TEXT");
  await pool.query("ALTER TABLE classroom_users ADD COLUMN IF NOT EXISTS grade_class TEXT");
  await pool.query("ALTER TABLE classroom_users ADD COLUMN IF NOT EXISTS password_salt TEXT");
  await pool.query("ALTER TABLE classroom_users ADD COLUMN IF NOT EXISTS password_hash TEXT");
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS classroom_users_national_id_hash_uidx ON classroom_users(national_id_hash) WHERE national_id_hash IS NOT NULL");
  await pool.query(`CREATE TABLE IF NOT EXISTS school_schedule (
    id BIGSERIAL PRIMARY KEY, day_of_week TEXT NOT NULL, period INTEGER NOT NULL CHECK(period BETWEEN 1 AND 12),
    grade_class TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '', teacher_user_id BIGINT NOT NULL REFERENCES classroom_users(id),
    classroom_id UUID REFERENCES classrooms(id) ON DELETE SET NULL, start_time TIME, end_time TIME,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(day_of_week,period,grade_class)
  )`);
  await pool.query("CREATE INDEX IF NOT EXISTS school_schedule_teacher_day_idx ON school_schedule(teacher_user_id,day_of_week,period)");
  await pool.query(`CREATE INDEX IF NOT EXISTS classrooms_teacher_status_idx ON classrooms(teacher_user_id,status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS classrooms_grade_status_idx ON classrooms(grade_class,status)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS classroom_sessions (
    token_hash TEXT PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES classroom_users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS classroom_events (
    id BIGSERIAL PRIMARY KEY, classroom_id UUID NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
    actor_user_id BIGINT REFERENCES classroom_users(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL, payload JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS classroom_events_room_time_idx ON classroom_events(classroom_id,created_at)');
  if (process.env.MANAGER_USERNAME && process.env.MANAGER_PASSWORD) {
    const existing = await pool.query('SELECT id FROM classroom_users WHERE username=$1', [process.env.MANAGER_USERNAME]);
    if (!existing.rowCount) {
      const cred = await hashPassword(process.env.MANAGER_PASSWORD);
      await pool.query("INSERT INTO classroom_users(role,display_name,username,password_salt,password_hash) VALUES('manager',$1,$2,$3,$4)",
        [process.env.MANAGER_DISPLAY_NAME || 'مدیریت مدرسه', process.env.MANAGER_USERNAME, cred.salt, cred.hash]);
      console.log('Initial manager account created from environment.');
    }
  }
}

async function auth(req, res, next) {
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return res.status(401).json({ error: 'برای ادامه وارد حساب شوید.' });
    const result = await pool.query(
      'SELECT u.id,u.role,u.display_name,u.username,u.grade_class FROM classroom_sessions s JOIN classroom_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()',
      [hashToken(token)]);
    if (!result.rowCount) return res.status(401).json({ error: 'نشست منقضی شده؛ دوباره وارد شوید.' });
    req.user = result.rows[0];
    next();
  } catch (e) { next(e); }
}
const allow = (...roles) => (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'اجازه انجام این کار را ندارید.' });
const text = (value, max = 120) => typeof value === 'string' ? value.trim().slice(0, max) : '';

app.get('/', (_req, res) => res.sendFile(path.resolve(__dirname, '../../index.html')));
app.get('/portal.html', (_req, res) => res.sendFile(path.resolve(__dirname, '../public/portal.html')));
app.get('/module.html', (_req, res) => res.sendFile(path.resolve(__dirname, '../public/module.html')));
app.get('/classroom.html', (_req, res) => res.sendFile(path.resolve(__dirname, '../../classroom.html')));

// Authenticated WebRTC configuration. Put TURN credentials in server environment, never in the repository.
app.get('/api/rtc-config', auth, (req, res) => {
  const defaults = [{ urls: ['stun:stun.l.google.com:19302'] }];
  let iceServers = defaults;
  const raw = process.env.RTC_ICE_SERVERS_JSON;
  if (raw) {
    try {
      const configured = JSON.parse(raw);
      if (!Array.isArray(configured) || !configured.length ||
          configured.some(server => !server || !(typeof server.urls === 'string' || (Array.isArray(server.urls) && server.urls.length)))) {
        return res.status(503).json({ error: 'RTC_ICE_SERVERS_JSON must be a non-empty array of ICE server objects.' });
      }
      iceServers = configured;
    } catch {
      return res.status(503).json({ error: 'RTC_ICE_SERVERS_JSON is not valid JSON.' });
    }
  }
  res.set('Cache-Control', 'no-store');
  res.json({ iceServers, turnConfigured: iceServers.some(server => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    return urls.some(url => typeof url === 'string' && url.toLowerCase().startsWith('turn'));
  }) });
});

app.get('/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true, service: 'frahoosh-classroom', database: 'connected' }); }
  catch { res.status(503).json({ ok: false, database: 'unavailable' }); }
});

app.post('/api/auth/login', loginLimiter, async (req, res, next) => {
  try {
    // Login must normalize Persian/Arabic numerals the same way Excel import does.
    const normalizeNumerals = value => String(value ?? '').replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
    const username = normalizeNumerals(text(req.body?.username, 80));
    const password = typeof req.body?.password === 'string' ? normalizeNumerals(req.body.password) : '';
    if (!username || !password) return res.status(400).json({ error: 'نام کاربری و رمز عبور الزامی است.' });
    const found = await pool.query('SELECT * FROM classroom_users WHERE username=$1', [username]);
    if (!found.rowCount || !found.rows[0].password_hash ||
        !(await verifyPassword(password, found.rows[0].password_salt, found.rows[0].password_hash))) {
      return res.status(401).json({ error: 'نام کاربری یا رمز عبور نادرست است.' });
    }
    const user = found.rows[0], token = randomToken();
    await pool.query(`INSERT INTO classroom_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '12 hours')`,
      [hashToken(token), user.id]);
    res.json({ token, expiresIn: 43200, user: { id: user.id, role: user.role, displayName: user.display_name, username: user.username, gradeClass: user.grade_class } });
  } catch (e) { next(e); }
});

app.get('/api/auth/me', auth, (req, res) => {
  res.json({ user: { id: req.user.id, role: req.user.role, displayName: req.user.display_name, username: req.user.username, gradeClass: req.user.grade_class } });
});

app.post('/api/auth/logout', auth, async (req, res, next) => {
  try { const token = req.headers.authorization.replace(/^Bearer\s+/i, '').trim(); await pool.query('DELETE FROM classroom_sessions WHERE token_hash=$1', [hashToken(token)]); res.json({ ok: true }); }
  catch (e) { next(e); }
});


app.post('/api/auth/student-login', loginLimiter, async (req, res, next) => {
  try {
    const firstName = text(req.body?.firstName), familyName = text(req.body?.familyName);
    const gradeClass = text(req.body?.gradeClass, 40), nationalId = normalizeNationalId(req.body?.nationalId);
    if (!firstName || !familyName || !gradeClass || !/^\d{10}$/.test(nationalId))
      return res.status(400).json({ error: 'نام، نام خانوادگی، کلاس و کد ملی کامل را وارد کنید.' });
    const result = await pool.query(
      "SELECT id,display_name || ' ' || family_name AS display_name,family_name,grade_class FROM classroom_users WHERE role='student' AND lower(display_name)=lower($1) AND lower(family_name)=lower($2) AND grade_class=$3 AND national_id_hash=$4",
      [firstName, familyName, gradeClass, nationalIdHash(nationalId)]);
    if (!result.rowCount) return res.status(401).json({ error: 'اطلاعات واردشده با فهرست مدرسه مطابقت ندارد.' });
    const user = result.rows[0], token = randomToken();
    await pool.query("INSERT INTO classroom_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '12 hours')", [hashToken(token), user.id]);
    res.json({ token, expiresIn: 43200, user: { id: user.id, role: 'student', displayName: user.display_name, gradeClass: user.grade_class } });
  } catch (e) { next(e); }
});

app.get('/api/schedule/today', auth, async (req, res, next) => {
  try {
    await pool.query("UPDATE classrooms SET status='ended',updated_at=now() WHERE status='active' AND ends_at<=now()");
    const today = dayAliases(new Intl.DateTimeFormat('fa-IR', { weekday: 'long', timeZone: 'Asia/Tehran' }).format(new Date()));
    const day = dayAliases(req.query.day || today);
    if (!day) return res.status(400).json({ error: 'روز انتخاب‌شده معتبر نیست.' });
    let sql, params;
    if (['teacher','educational_deputy','pastoral_deputy'].includes(req.user.role)) {
      sql = "SELECT s.id,s.day_of_week,s.period,s.grade_class,s.subject,s.start_time,s.end_time,c.id AS classroom_id,c.title AS classroom_title,c.room_code,c.status AS classroom_status,c.starts_at,c.ends_at FROM school_schedule s LEFT JOIN classrooms c ON c.id=s.classroom_id WHERE (s.teacher_user_id=$1 OR c.teacher_user_id=$1) AND s.day_of_week=$2 ORDER BY s.period";
      params = [req.user.id, day];
    } else if (req.user.role === 'student') {
      sql = "SELECT s.id,s.day_of_week,s.period,s.grade_class,s.subject,s.start_time,s.end_time,u.display_name AS teacher_name,c.id AS classroom_id,c.title AS classroom_title,c.room_code,c.status AS classroom_status,c.starts_at,c.ends_at FROM school_schedule s JOIN classroom_users u ON u.id=s.teacher_user_id LEFT JOIN classrooms c ON c.id=s.classroom_id WHERE s.grade_class=$1 AND s.day_of_week=$2 ORDER BY s.period";
      params = [req.user.grade_class, day];
    } else {
      sql = "SELECT s.id,s.day_of_week,s.period,s.grade_class,s.subject,s.start_time,s.end_time,u.display_name AS teacher_name,c.id AS classroom_id,c.title AS classroom_title,c.room_code,c.status AS classroom_status,c.starts_at,c.ends_at FROM school_schedule s JOIN classroom_users u ON u.id=s.teacher_user_id LEFT JOIN classrooms c ON c.id=s.classroom_id WHERE s.day_of_week=$1 ORDER BY s.grade_class,s.period";
      params = [day];
    }
    const result = await pool.query(sql, params);
    const now = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
    res.json({ day, currentTime: now, schedule: result.rows.map(row => ({ ...row, isPeriodActive: Boolean(day === today && row.start_time && row.end_time && now >= String(row.start_time).slice(0,5) && now < String(row.end_time).slice(0,5)), canEnter: row.classroom_status === 'active' && row.ends_at && new Date(row.ends_at) > new Date() })) });
  } catch (e) { next(e); }
});

app.post('/api/schedule', auth, allow('manager','educational_deputy'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const day = dayAliases(req.body?.day), period = Number(req.body?.period), gradeClass = text(req.body?.gradeClass,40);
    const subject = text(req.body?.subject,120), teacherId = Number(req.body?.teacherId), requestedClassroomId = req.body?.classroomId || null;
    const startTime = text(req.body?.startTime,5) || null, endTime = text(req.body?.endTime,5) || null;
    if (!day || !Number.isInteger(period) || period < 1 || period > 12 || !gradeClass || !Number.isSafeInteger(teacherId) || teacherId < 1)
      return res.status(400).json({ error: 'روز، زنگ، کلاس و دبیر الزامی است.' });
    if ((startTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) || (endTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)) || (startTime && endTime && startTime >= endTime))
      return res.status(400).json({ error: 'ساعت شروع و پایان معتبر نیست.' });
    const teacher = await client.query("SELECT id FROM classroom_users WHERE id=$1 AND role IN ('teacher','educational_deputy','pastoral_deputy')", [teacherId]);
    if (!teacher.rowCount) return res.status(400).json({ error: 'دبیر انتخاب‌شده معتبر نیست.' });
    await client.query('BEGIN');
    const existing = await client.query(
      "SELECT classroom_id FROM school_schedule WHERE day_of_week=$1 AND period=$2 AND grade_class=$3 FOR UPDATE",
      [day,period,gradeClass]
    );
    let linkedClassroomId = requestedClassroomId || existing.rows[0]?.classroom_id || null;
    if (linkedClassroomId) {
      const room = await client.query("SELECT id FROM classrooms WHERE id=$1", [linkedClassroomId]);
      if (!room.rowCount) throw Object.assign(new Error('کلاس انتخاب‌شده پیدا نشد.'), { status: 400 });
      await client.query(
        "UPDATE classrooms SET title=$1,grade_class=$2,teacher_user_id=$3,status='scheduled',starts_at=NULL,ends_at=NULL,updated_at=now() WHERE id=$4",
        [subject || ('کلاس '+gradeClass),gradeClass,teacherId,linkedClassroomId]
      );
    } else {
      const roomCode = crypto.randomBytes(5).toString('hex').toUpperCase();
      const room = await client.query(
        "INSERT INTO classrooms(title,grade_class,teacher_user_id,room_code,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id",
        [subject || ('کلاس '+gradeClass),gradeClass,teacherId,roomCode,req.user.id]
      );
      linkedClassroomId = room.rows[0].id;
    }
    const result = await client.query(
      "INSERT INTO school_schedule(day_of_week,period,grade_class,subject,teacher_user_id,classroom_id,start_time,end_time) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(day_of_week,period,grade_class) DO UPDATE SET subject=EXCLUDED.subject,teacher_user_id=EXCLUDED.teacher_user_id,classroom_id=EXCLUDED.classroom_id,start_time=EXCLUDED.start_time,end_time=EXCLUDED.end_time RETURNING *",
      [day,period,gradeClass,subject,teacherId,linkedClassroomId,startTime,endTime]
    );
    await client.query('COMMIT');
    res.status(201).json({ schedule: result.rows[0], classroom: { id: linkedClassroomId }, message: 'برنامه به کلاس مشترک دبیر و دانش‌آموز متصل شد.' });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    next(e);
  } finally {
    client.release();
  }
});

app.post('/api/import/excel', auth, allow('manager'), excelUpload.single('file'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    if (!req.file) return res.status(400).json({ error: 'فایل Excel انتخاب نشده است.' });
    const sheets = workbookRows(req.file.buffer);
    const teachers = sheets['دبیران'] || sheets['teachers'] || sheets['teacher'] || [];
    const students = sheets['دانش آموزان'] || sheets['دانش‌آموزان'] || sheets['students'] || sheets['student'] || [];
    const schedules = sheets['برنامه'] || sheets['برنامه هفتگی'] || sheets['schedule'] || sheets['timetable'] || [];
    let teacherCount = 0, studentCount = 0, scheduleCount = 0;
    const teacherIds = new Map();
    await client.query('BEGIN');
    for (const row of teachers) {
      const first = field(row,'نام','نام دبیر','firstName','first_name','name'), family = field(row,'نام خانوادگی','نام‌خانوادگی','familyName','family_name','surname');
      const displayName = [first,family].filter(Boolean).join(' ') || field(row,'نام کامل','نام و نام خانوادگی','displayName','display_name');
      const username = field(row,'نام کاربری','کد پرسنلی','username','user_name','employeeCode');
      const password = normalizeDigits(field(row,'رمز','رمز عبور','password','passcode'));
      if (!displayName || !username || !/^\d{8,12}$/.test(password)) continue;
      const cred = await hashPassword(password);
      const saved = await client.query("INSERT INTO classroom_users(role,display_name,username,password_salt,password_hash) VALUES('teacher',$1,$2,$3,$4) ON CONFLICT(username) DO UPDATE SET role='teacher',display_name=EXCLUDED.display_name,password_salt=EXCLUDED.password_salt,password_hash=EXCLUDED.password_hash RETURNING id,display_name,username",
        [displayName,username,cred.salt,cred.hash]);
      teacherIds.set(normalizeText(displayName), saved.rows[0].id);
      teacherIds.set(normalizeText(username), saved.rows[0].id);
      teacherCount++;
    }
    // Existing staff accounts are authoritative: resolve schedule rows by their actual usernames
    // or exact display names without requiring a second teacher-account import.
    const existingTeachers = await client.query(
      "SELECT id,display_name,username FROM classroom_users WHERE role IN ('teacher','educational_deputy','pastoral_deputy')"
    );
    for (const teacher of existingTeachers.rows) {
      const displayKey = normalizeText(teacher.display_name);
      const usernameKey = normalizeText(teacher.username);
      if (displayKey && !teacherIds.has(displayKey)) teacherIds.set(displayKey, teacher.id);
      if (usernameKey && !teacherIds.has(usernameKey)) teacherIds.set(usernameKey, teacher.id);
    }
    let skippedScheduleRows = 0;
    for (const row of students) {
      const first = field(row,'نام','firstName','first_name'), family = field(row,'نام خانوادگی','نام‌خانوادگی','familyName','family_name','surname');
      const gradeClass = field(row,'کلاس','پایه و کلاس','gradeClass','grade_class','class');
      const nationalId = normalizeNationalId(field(row,'کد ملی','کدملی','nationalId','national_id','national code'));
      const username = field(row,'نام کاربری','username') || ('stu-' + crypto.createHash('sha256').update(first+'|'+family+'|'+gradeClass+'|'+nationalId).digest('hex').slice(0,16));
      if (!first || !family || !gradeClass || !/^\d{10}$/.test(nationalId)) continue;
      const saved = await client.query("INSERT INTO classroom_users(role,display_name,family_name,username,national_id_hash,grade_class) VALUES('student',$1,$2,$3,$4,$5) ON CONFLICT(username) DO UPDATE SET role='student',display_name=EXCLUDED.display_name,family_name=EXCLUDED.family_name,national_id_hash=EXCLUDED.national_id_hash,grade_class=EXCLUDED.grade_class RETURNING id,display_name,family_name,username,grade_class",
        [first,family,username,nationalIdHash(nationalId),gradeClass]);
      studentCount++;
    }
    for (const row of schedules) {
      const day = dayAliases(field(row,'روز','day','day_of_week')), period = Number(normalizeDigits(field(row,'زنگ','شماره زنگ','period','lesson')));
      const gradeClass = field(row,'کلاس','پایه و کلاس','gradeClass','grade_class','class'), subject = field(row,'درس','عنوان درس','subject');
      // Prefer the explicit username column; names are only a fallback for exact matches.
      const teacherKey = field(row,'نام کاربری دبیر','teacherUsername','teacher_username','username','نام دبیر','دبیر','teacher','teacherName','teacher_name');
      const teacherId = teacherIds.get(normalizeText(teacherKey));
      const startTime = field(row,'شروع','ساعت شروع','startTime','start_time') || null, endTime = field(row,'پایان','ساعت پایان','endTime','end_time') || null;
      if (!day || !Number.isInteger(period) || period < 1 || period > 12 || !gradeClass || !teacherId || !subject) {
        skippedScheduleRows++;
        continue;
      }
      const existing = await client.query(
        "SELECT classroom_id FROM school_schedule WHERE day_of_week=$1 AND period=$2 AND grade_class=$3 FOR UPDATE",
        [day,period,gradeClass]
      );
      let classroomId = existing.rows[0]?.classroom_id || null;
      if (classroomId) {
        await client.query(
          "UPDATE classrooms SET title=$1,grade_class=$2,teacher_user_id=$3,status='scheduled',starts_at=NULL,ends_at=NULL,updated_at=now() WHERE id=$4",
          [subject || ('کلاس '+gradeClass),gradeClass,teacherId,classroomId]
        );
      } else {
        const roomCode = crypto.randomBytes(5).toString('hex').toUpperCase();
        const room = await client.query(
          "INSERT INTO classrooms(title,grade_class,teacher_user_id,room_code,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id",
          [subject || ('کلاس '+gradeClass),gradeClass,teacherId,roomCode,req.user.id]
        );
        classroomId = room.rows[0].id;
      }
      await client.query(
        "INSERT INTO school_schedule(day_of_week,period,grade_class,subject,teacher_user_id,classroom_id,start_time,end_time) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(day_of_week,period,grade_class) DO UPDATE SET subject=EXCLUDED.subject,teacher_user_id=EXCLUDED.teacher_user_id,classroom_id=EXCLUDED.classroom_id,start_time=EXCLUDED.start_time,end_time=EXCLUDED.end_time",
        [day,period,gradeClass,subject,teacherId,classroomId,startTime,endTime]
      );
      scheduleCount++;
    }
    await client.query('COMMIT');
    res.json({ ok: true, imported: { teachers: teacherCount, students: studentCount, scheduleRows: scheduleCount }, skipped: { scheduleRows: skippedScheduleRows }, note: 'حساب‌های دبیر موجود با نام کاربری واقعی یا نام نمایشی دقیق شناسایی می‌شوند؛ کد ملی خام ذخیره نمی‌شود.' });
  } catch (e) { await client.query('ROLLBACK'); next(e); }
  finally { client.release(); }
});

app.get('/api/import/template', (_req, res) => {
  const wb = XLSX.utils.book_new();
  const teachers = XLSX.utils.aoa_to_sheet([['نام','نام خانوادگی','نام کاربری','رمز عبور'],['علی','نمونه','teacher01','12345678']]);
  const students = XLSX.utils.aoa_to_sheet([['نام','نام خانوادگی','کلاس','کد ملی'],['آرمان','نمونه','۷/۱','0012345678']]);
  const schedule = XLSX.utils.aoa_to_sheet([['روز','زنگ','کلاس','درس','نام کاربری دبیر','ساعت شروع','ساعت پایان'],['شنبه','1','۷/۱','ریاضی','teacher01','08:00','08:50']]);
  XLSX.utils.book_append_sheet(wb,teachers,'دبیران');
  XLSX.utils.book_append_sheet(wb,students,'دانش آموزان');
  XLSX.utils.book_append_sheet(wb,schedule,'برنامه');
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition','attachment; filename="frahoosh-import-template.xlsx"');
  res.send(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}));
});

app.get('/api/me', auth, (req, res) => res.json({ user: req.user }));

app.post('/api/teachers', auth, allow('manager'), async (req, res, next) => {
  try {
    const displayName = text(req.body?.displayName), username = text(req.body?.username, 80), password = typeof req.body?.password === 'string' ? req.body.password : '';
    const numericPassword = normalizeDigits(password);
    if (!displayName || !username || !/^\d{8,12}$/.test(numericPassword)) return res.status(400).json({ error: 'نام، نام کاربری و رمز عددی ۸ تا ۱۲ رقمی لازم است.' });
    const cred = await hashPassword(numericPassword);
    const result = await pool.query("INSERT INTO classroom_users(role,display_name,username,password_salt,password_hash) VALUES('teacher',$1,$2,$3,$4) RETURNING id,display_name,username",
      [displayName, username, cred.salt, cred.hash]);
    res.status(201).json({ teacher: result.rows[0] });
  } catch (e) { if (e.code === '23505') return res.status(409).json({ error: 'این نام کاربری قبلاً ثبت شده است.' }); next(e); }
});

app.post('/api/students', auth, allow('manager'), async (req, res, next) => {
  try {
    const firstName = text(req.body?.firstName), familyName = text(req.body?.familyName), username = text(req.body?.username, 80);
    const gradeClass = text(req.body?.gradeClass, 40), nationalId = normalizeNationalId(req.body?.nationalId);
    if (!firstName || !familyName || !username || !gradeClass || !/^\d{10}$/.test(nationalId))
      return res.status(400).json({ error: 'نام، نام خانوادگی، نام کاربری، کلاس و کد ملی ۱۰ رقمی لازم است.' });
    const displayName = firstName + ' ' + familyName;
    const result = await pool.query("INSERT INTO classroom_users(role,display_name,family_name,username,national_id_hash,grade_class) VALUES('student',$1,$2,$3,$4,$5) RETURNING id,display_name,family_name,username,grade_class",
      [firstName, familyName, username, nationalIdHash(nationalId), gradeClass]);
    res.status(201).json({ student: result.rows[0] });
  } catch (e) { if (e.code === '23505') return res.status(409).json({ error: 'این نام کاربری قبلاً ثبت شده است.' }); next(e); }
});

app.post('/api/account/credentials', auth, allow('manager'), async (req, res, next) => {
  try {
    const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
    const username = normalizeDigits(text(req.body?.username, 80));
    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
    if (!currentPassword || !username || newPassword.length < 10 || newPassword.length > 72) {
      return res.status(400).json({ error: 'رمز فعلی، نام کاربری و رمز جدید حداقل ۱۰ نویسه‌ای الزامی است.' });
    }
    const current = await pool.query("SELECT password_salt,password_hash FROM classroom_users WHERE id=$1 AND role='manager'", [req.user.id]);
    if (!current.rowCount || !current.rows[0].password_hash ||
        !(await verifyPassword(currentPassword, current.rows[0].password_salt, current.rows[0].password_hash))) {
      return res.status(401).json({ error: 'رمز فعلی صحیح نیست.' });
    }
    const cred = await hashPassword(newPassword);
    const saved = await pool.query("UPDATE classroom_users SET username=$1,password_salt=$2,password_hash=$3 WHERE id=$4 AND role='manager' RETURNING id,username",
      [username,cred.salt,cred.hash,req.user.id]);
    res.json({ ok: true, account: saved.rows[0], message: 'اطلاعات ورود به‌روزرسانی شد. نشست فعلی تا زمان خروج فعال می‌ماند.' });
  } catch (e) { if (e.code === '23505') return res.status(409).json({ error: 'این نام کاربری قبلاً استفاده شده است.' }); next(e); }
});

app.post('/api/staff', auth, allow('manager'), async (req, res, next) => {
  try {
    const displayName = text(req.body?.displayName, 120);
    const username = normalizeDigits(text(req.body?.username, 80));
    const role = text(req.body?.role, 40);
    const password = typeof req.body?.password === 'string' ? req.body.password.replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))) : '';
    const permittedRoles = ['teacher','educational_deputy','executive_deputy','pastoral_deputy'];
    if (!displayName || !username || !permittedRoles.includes(role) || password.length < 8 || password.length > 72) {
      return res.status(400).json({ error: 'نام، نام کاربری، نقش مجاز و رمز اولیه ۸ تا ۷۲ نویسه‌ای لازم است.' });
    }
    const cred = await hashPassword(password);
    const result = await pool.query(
      'INSERT INTO classroom_users(role,display_name,username,password_salt,password_hash) VALUES($1,$2,$3,$4,$5) RETURNING id,role,display_name,username',
      [role,displayName,username,cred.salt,cred.hash]);
    res.status(201).json({ staff: result.rows[0] });
  } catch (e) { if (e.code === '23505') return res.status(409).json({ error: 'این نام کاربری قبلاً ثبت شده است.' }); next(e); }
});

app.get('/api/teachers', auth, allow('manager','educational_deputy'), async (_req, res, next) => {
  try { const result = await pool.query("SELECT id,display_name,username,role FROM classroom_users WHERE role IN ('teacher','educational_deputy','pastoral_deputy') ORDER BY display_name"); res.json({ teachers: result.rows }); }
  catch (e) { next(e); }
});

app.post('/api/classes', auth, allow('manager','educational_deputy'), async (req, res, next) => {
  try {
    const title = text(req.body?.title), gradeClass = text(req.body?.gradeClass, 40), teacherId = Number(req.body?.teacherId);
    const day = dayAliases(req.body?.day), period = Number(req.body?.period);
    if (!title || !gradeClass || !Number.isSafeInteger(teacherId) || teacherId < 1 || !day || !Number.isInteger(period) || period < 1 || period > 12)
      return res.status(400).json({ error: 'عنوان، پایه/کلاس، دبیر، روز و زنگ الزامی است.' });
    const teacher = await pool.query("SELECT id FROM classroom_users WHERE id=$1 AND role IN ('teacher','educational_deputy','pastoral_deputy')", [teacherId]);
    if (!teacher.rowCount) return res.status(400).json({ error: 'دبیر انتخاب‌شده معتبر نیست.' });
    const scheduled = await pool.query("SELECT id FROM school_schedule WHERE day_of_week=$1 AND period=$2 AND grade_class=$3 AND teacher_user_id=$4", [day,period,gradeClass,teacherId]);
    if (!scheduled.rowCount) return res.status(400).json({ error: 'در فایل برنامه، این دبیر برای این کلاس و زنگ ثبت نشده است.' });
    const roomCode = crypto.randomBytes(5).toString('hex').toUpperCase();
    const result = await pool.query(
      "INSERT INTO classrooms(title,grade_class,teacher_user_id,room_code,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id,title,grade_class,teacher_user_id,room_code,status,created_at",
      [title, gradeClass, teacherId, roomCode, req.user.id]);
    await pool.query("UPDATE school_schedule SET classroom_id=$1 WHERE day_of_week=$2 AND period=$3 AND grade_class=$4 AND teacher_user_id=$5", [result.rows[0].id,day,period,gradeClass,teacherId]);
    res.status(201).json({ classroom: { ...result.rows[0], day, period } });
  } catch (e) { next(e); }
});

app.get('/api/classes', auth, async (req, res, next) => {
  try {
    let result;
    if (['manager','educational_deputy','executive_deputy'].includes(req.user.role)) {
      result = await pool.query('SELECT c.*,u.display_name AS teacher_name FROM classrooms c JOIN classroom_users u ON u.id=c.teacher_user_id ORDER BY c.created_at DESC');
    } else if (['teacher','pastoral_deputy'].includes(req.user.role)) {
      result = await pool.query('SELECT c.*,u.display_name AS teacher_name FROM classrooms c JOIN classroom_users u ON u.id=c.teacher_user_id WHERE c.teacher_user_id=$1 ORDER BY c.created_at DESC', [req.user.id]);
    } else {
      result = await pool.query("SELECT c.*,u.display_name AS teacher_name FROM classrooms c JOIN classroom_users u ON u.id=c.teacher_user_id WHERE c.grade_class=$1 AND c.status='active' ORDER BY c.starts_at DESC", [req.user.grade_class || '']);
    }
    res.json({ classrooms: result.rows });
  } catch (e) { next(e); }
});

app.get('/api/classes/:id/access', auth, async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT c.id,c.room_code,c.grade_class,c.status,c.ends_at,c.teacher_user_id FROM classrooms c WHERE c.id=$1",
      [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'کلاس پیدا نشد.' });
    const room = result.rows[0];
    const manager = ['manager','educational_deputy'].includes(req.user.role);
    const assignedTeacher = ['teacher','pastoral_deputy'].includes(req.user.role) && String(room.teacher_user_id) === String(req.user.id);
    const enrolledStudent = req.user.role === 'student' && room.grade_class === req.user.grade_class && room.status === 'active' && room.ends_at && new Date(room.ends_at) > new Date();
    if (!manager && !assignedTeacher && !enrolledStudent) return res.status(403).json({ error: 'این حساب اجازه ورود به این کلاس را ندارد.' });
    if (room.status !== 'active' || !room.ends_at || new Date(room.ends_at) <= new Date()) return res.status(403).json({ error: 'کلاس هنوز شروع نشده یا پایان یافته است.' });
    res.json({ classroom: { id: room.id, roomCode: room.room_code, gradeClass: room.grade_class, status: room.status, endsAt: room.ends_at } });
  } catch (e) { next(e); }
});

app.post('/api/classes/:id/start', auth, allow('manager','educational_deputy','teacher','pastoral_deputy'), async (req, res, next) => {
  try {
    // Management can start any classroom for support; teachers remain restricted
    // to their assigned room and the currently scheduled lesson period.
    if (['teacher','pastoral_deputy'].includes(req.user.role)) {
      const scheduled = await pool.query("SELECT id FROM school_schedule WHERE classroom_id=$1 AND teacher_user_id=$2 AND day_of_week=$3 AND start_time <= (now() AT TIME ZONE 'Asia/Tehran')::time AND end_time > (now() AT TIME ZONE 'Asia/Tehran')::time LIMIT 1",
        [req.params.id, req.user.id, dayAliases(new Intl.DateTimeFormat('fa-IR', { weekday: 'long', timeZone: 'Asia/Tehran' }).format(new Date()))]);
      if (!scheduled.rowCount) return res.status(403).json({ error: 'این زنگ طبق برنامه روزانه هنوز فعال نیست.' });
    }
    const result = ['manager','educational_deputy'].includes(req.user.role)
      ? await pool.query("UPDATE classrooms SET status='active',starts_at=now(),ends_at=now()+interval '50 minutes',updated_at=now() WHERE id=$1 AND status IN ('scheduled','ended') RETURNING id,title,grade_class,room_code,status,starts_at,ends_at", [req.params.id])
      : await pool.query("UPDATE classrooms SET status='active',starts_at=now(),ends_at=now()+interval '50 minutes',updated_at=now() WHERE id=$1 AND teacher_user_id=$2 AND status IN ('scheduled','ended') RETURNING id,title,grade_class,room_code,status,starts_at,ends_at", [req.params.id, req.user.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'کلاس برای این حساب پیدا نشد یا قبلاً شروع شده است.' });
    await pool.query("INSERT INTO classroom_events(classroom_id,actor_user_id,event_type) VALUES($1,$2,'class-started')", [req.params.id, req.user.id]);
    res.json({ classroom: result.rows[0] });
  } catch (e) { next(e); }
});

app.post('/api/classes/:id/end', auth, async (req, res, next) => {
  try {
    const result = ['manager','educational_deputy'].includes(req.user.role)
      ? await pool.query("UPDATE classrooms SET status='ended',ends_at=now(),updated_at=now() WHERE id=$1 AND status='active' RETURNING id,status,ends_at", [req.params.id])
      : ['teacher','pastoral_deputy'].includes(req.user.role)
        ? await pool.query("UPDATE classrooms SET status='ended',ends_at=now(),updated_at=now() WHERE id=$1 AND teacher_user_id=$2 AND status='active' RETURNING id,status,ends_at", [req.params.id, req.user.id])
        : { rowCount: 0, rows: [] };
    if (!result.rowCount) return res.status(404).json({ error: 'کلاس فعال برای پایان دادن پیدا نشد.' });
    await pool.query("INSERT INTO classroom_events(classroom_id,actor_user_id,event_type) VALUES($1,$2,'class-ended')", [req.params.id, req.user.id]);
    res.json({ classroom: result.rows[0] });
  } catch (e) { next(e); }
});

app.get('/api/classes/active', auth, allow('student'), async (req, res, next) => {
  try {
    if (!req.user.grade_class) return res.status(400).json({ error: 'پایه و کلاس دانش‌آموز در حساب ثبت نشده است.' });
    const result = await pool.query("SELECT c.id,c.title,c.grade_class,c.room_code,c.starts_at,c.ends_at,u.display_name AS teacher_name FROM classrooms c JOIN classroom_users u ON u.id=c.teacher_user_id WHERE c.grade_class=$1 AND c.status='active' AND c.ends_at>now() ORDER BY c.starts_at DESC",
      [req.user.grade_class]);
    res.json({ classrooms: result.rows });
  } catch (e) { next(e); }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'خطای داخلی سرور رخ داد.' });
});

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required. Configure a dedicated PostgreSQL database.');
  await ensureSchema();
  const server = app.listen(port, () => console.log('Frahoosh classroom API listening on port ' + port));
  const shutdown = async () => { server.close(); await pool.end(); process.exit(0); };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
}
main().catch(error => { console.error(error); process.exit(1); });
