// Cloudflare Pages Function: API ของเกม (ต่อกับ D1 ผ่าน binding ชื่อ DB)
//   GET  /api/leaderboard?limit=200   อันดับทั้งหมด เรียงคะแนนมากไปน้อย
//   POST /api/signup                  สมัคร { username, password, nickname }
//   POST /api/login                   ล็อกอิน { username, password }
//   GET  /api/me                      ข้อมูลบัญชีที่ล็อกอินอยู่
//   POST /api/save                    บันทึกความคืบหน้า { data }
//   POST /api/score                   ส่งคะแนนจบเกม (ต้องล็อกอิน)
//   POST /api/logout                  ออกจากระบบ
// การยืนยันตัวตน: header  Authorization: Bearer <token>

const MAX_NAME = 16;
const MAX_USER = 20;
const MAX_SCORE = 100_000_000;
const MAX_DATA_BYTES = 20_000;
const SUBMIT_COOLDOWN_MS = 8_000;   // ส่งคะแนนได้ไม่ถี่กว่านี้ต่อคน
const PBKDF2_ITER = 20_000;         // ไม่สูงมาก เพื่อไม่ให้เกินเวลา CPU ของแผนฟรี

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS },
  });

const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const randomHex = bytes => hex(crypto.getRandomValues(new Uint8Array(bytes)));
const fromHex = h => new Uint8Array(h.match(/../g).map(x => parseInt(x, 16)));

async function hashPassword(password, saltHex) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations: PBKDF2_ITER }, key, 256);
  return hex(bits);
}

// คำที่ห้ามใช้ในชื่อเล่น (ต้องตรงกับ BAD_WORDS ในเกม)
const BAD_WORDS = ['ควย', 'เหี้ย', 'เหี้ย', 'สัส', 'เย็ด', 'แตด', 'ส้นตีน', 'ไอ้สัตว์', 'อีดอก', 'ระยำ', 'จัญไร',
  'fuck', 'shit', 'bitch', 'cunt', 'dick', 'pussy', 'asshole', 'nigga', 'nigger', 'porn'];
const badName = n => {
  const k = n.toLowerCase().replace(/[\s._\-*!@#$%^&()+=0-9]/g, '');
  return BAD_WORDS.some(w => k.includes(w));
};

function cleanName(raw, max = MAX_NAME) {
  return String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

const int = (v, min, max) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

const profileOf = u => {
  let data = {};
  try { data = JSON.parse(u.data || '{}'); } catch {}
  return { id: u.id, username: u.username, nickname: u.nickname, data };
};

async function currentUser(env, request) {
  const m = (request.headers.get('authorization') || '').match(/^Bearer ([a-f0-9]{48})$/);
  if (!m) return null;
  return env.DB.prepare(
    `SELECT u.id, u.username, u.nickname, u.data FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?1`
  ).bind(m[1]).first();
}

async function newSession(env, userId) {
  const token = randomHex(24);
  await env.DB.prepare(`INSERT INTO sessions (token, user_id, created_at) VALUES (?1, ?2, ?3)`)
    .bind(token, userId, Date.now()).run();
  return token;
}

// ----- บัญชี -----
async function signup(env, request) {
  const body = await readJson(request);
  if (!body) return json({ error: 'bad_json' }, 400);
  const username = cleanName(body.username, MAX_USER);
  const password = String(body.password ?? '');
  const nickname = cleanName(body.nickname);
  if (!username || !password || !nickname) return json({ error: 'missing' }, 400);
  if (password.length > 200) return json({ error: 'missing' }, 400);
  if (badName(nickname)) return json({ error: 'bad_name' }, 400);

  const key = username.toLowerCase();
  const exists = await env.DB.prepare(`SELECT 1 FROM users WHERE username_key = ?1`).bind(key).first();
  if (exists) return json({ error: 'username_taken' }, 409);

  const id = randomHex(8);
  const salt = randomHex(16);
  const passHash = await hashPassword(password, salt);
  const now = Date.now();
  try {
    await env.DB.prepare(
      `INSERT INTO users (id, username, username_key, salt, pass_hash, nickname, data, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, '{}', ?7, ?7)`
    ).bind(id, username, key, salt, passHash, nickname, now).run();
  } catch (err) {
    if (String(err).includes('UNIQUE')) return json({ error: 'username_taken' }, 409);
    throw err;
  }
  const token = await newSession(env, id);
  return json({ token, profile: { id, username, nickname, data: {} } });
}

async function login(env, request) {
  const body = await readJson(request);
  if (!body) return json({ error: 'bad_json' }, 400);
  const key = cleanName(body.username, MAX_USER).toLowerCase();
  const password = String(body.password ?? '');
  const u = await env.DB.prepare(`SELECT * FROM users WHERE username_key = ?1`).bind(key).first();
  if (!u || (await hashPassword(password, u.salt)) !== u.pass_hash) return json({ error: 'bad_login' }, 401);
  const token = await newSession(env, u.id);
  return json({ token, profile: profileOf(u) });
}

async function me(env, request) {
  const u = await currentUser(env, request);
  if (!u) return json({ error: 'unauthorized' }, 401);
  return json(profileOf(u));
}

async function logout(env, request) {
  const m = (request.headers.get('authorization') || '').match(/^Bearer ([a-f0-9]{48})$/);
  if (m) await env.DB.prepare(`DELETE FROM sessions WHERE token = ?1`).bind(m[1]).run();
  return json({ ok: true });
}

async function save(env, request) {
  const u = await currentUser(env, request);
  if (!u) return json({ error: 'unauthorized' }, 401);
  const body = await readJson(request);
  if (!body || typeof body.data !== 'object' || body.data === null || Array.isArray(body.data)) return json({ error: 'bad_data' }, 400);
  const text = JSON.stringify(body.data);
  if (text.length > MAX_DATA_BYTES) return json({ error: 'too_large' }, 413);
  await env.DB.prepare(`UPDATE users SET data = ?1, updated_at = ?2 WHERE id = ?3`).bind(text, Date.now(), u.id).run();
  return json({ ok: true });
}

// ----- คะแนน -----
async function leaderboard(env, url) {
  const limit = int(url.searchParams.get('limit'), 1, 500) ?? 200;
  const rows = await env.DB.prepare(
    `SELECT id, name, best, loop, max_combo, ship FROM players
     WHERE best > 0 ORDER BY best DESC, updated_at ASC LIMIT ?1`
  ).bind(limit).all();
  const total = await env.DB.prepare(`SELECT COUNT(*) AS n FROM players WHERE best > 0`).first();
  return json({
    total: total?.n ?? 0,
    entries: (rows.results || []).map(r => ({
      pid: r.id, name: r.name, score: r.best, loop: r.loop, maxCombo: r.max_combo, ship: r.ship,
    })),
  });
}

async function submit(env, request) {
  const u = await currentUser(env, request);
  if (!u) return json({ error: 'unauthorized' }, 401);
  const body = await readJson(request);
  if (!body) return json({ error: 'bad_json' }, 400);

  const score = int(body.score, 0, MAX_SCORE);
  const loop = int(body.loop, 1, 999) ?? 1;
  const maxCombo = int(body.maxCombo, 0, 1_000_000) ?? 0;
  if (score === null) return json({ error: 'bad_score' }, 400);
  // กันคะแนนเวอร์เกินจริงแบบหยาบๆ: คะแนนต้องสัมพันธ์กับรอบที่ไปถึง
  if (score > 600_000 * loop + 400_000) return json({ error: 'implausible' }, 400);
  const ship = cleanName(body.ship).slice(0, 12) || null;
  const now = Date.now();

  const prev = await env.DB.prepare(`SELECT best, last_submit FROM players WHERE id = ?1`).bind(u.id).first();
  if (prev && now - prev.last_submit < SUBMIT_COOLDOWN_MS) return json({ error: 'too_fast' }, 429);

  await env.DB.prepare(
    `INSERT INTO players (id, name, best, loop, max_combo, ship, games, updated_at, last_submit)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?7)
     ON CONFLICT(id) DO UPDATE SET
       name        = excluded.name,
       games       = games + 1,
       last_submit = excluded.last_submit,
       best        = MAX(best, excluded.best),
       loop        = CASE WHEN excluded.best > best THEN excluded.loop ELSE loop END,
       ship        = CASE WHEN excluded.best > best THEN excluded.ship ELSE ship END,
       updated_at  = CASE WHEN excluded.best > best THEN excluded.updated_at ELSE updated_at END,
       max_combo   = MAX(max_combo, excluded.max_combo)`
  ).bind(u.id, u.nickname, score, loop, maxCombo, ship, now).run();

  const mine = await env.DB.prepare(`SELECT best FROM players WHERE id = ?1`).bind(u.id).first();
  const above = await env.DB.prepare(`SELECT COUNT(*) AS n FROM players WHERE best > ?1`).bind(mine.best).first();
  const total = await env.DB.prepare(`SELECT COUNT(*) AS n FROM players WHERE best > 0`).first();

  return json({
    pid: u.id,
    best: mine.best,
    newBest: !prev || score > prev.best,
    rank: (above?.n ?? 0) + 1,
    total: total?.n ?? 1,
  });
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!env.DB) return json({ error: 'db_not_bound' }, 500);

  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
  const m = request.method;
  try {
    if (route === 'leaderboard' && m === 'GET') return await leaderboard(env, url);
    if (route === 'score' && m === 'POST') return await submit(env, request);
    if (route === 'signup' && m === 'POST') return await signup(env, request);
    if (route === 'login' && m === 'POST') return await login(env, request);
    if (route === 'me' && m === 'GET') return await me(env, request);
    if (route === 'save' && m === 'POST') return await save(env, request);
    if (route === 'logout' && m === 'POST') return await logout(env, request);
    return json({ error: 'not_found' }, 404);
  } catch (err) {
    return json({ error: 'server_error' }, 500);
  }
}
