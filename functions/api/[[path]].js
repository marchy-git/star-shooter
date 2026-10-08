// Cloudflare Pages Function: API ของเกม (ต่อกับ D1 ผ่าน binding ชื่อ DB)
//   GET  /api/leaderboard?limit=200   อันดับทั้งหมด เรียงคะแนนมากไปน้อย
//   POST /api/signup                  สมัคร { username, password, nickname }
//   POST /api/login                   ล็อกอิน { username, password }
//   GET  /api/me                      ข้อมูลบัญชีที่ล็อกอินอยู่
//   POST /api/ship                    เลือกยานที่ใช้ { ship }
//   POST /api/upgrade                 อัปเลเวลยานด้วยคริสตัล { ship }
//   POST /api/spin                    ใช้ตั๋วสุ่มยาน 1 ใบ
//   POST /api/run                     เริ่มรอบเล่น ได้ runId กลับไป
//   POST /api/boss                    ล้มบอสในรอบนี้ { runId } → server สุ่มเศษยาน 2%
//   POST /api/evolve                  แปลงร่างยาน (Lv10 + เศษครบ 5) { ship }
//   POST /api/shard/sell              ขายเศษยานเป็นคริสตัล { ship, n }
//   POST /api/score                   จบรอบ: ส่งคะแนน + ของที่เก็บได้ { runId, score, loop, coins, tickets, ... }
//   POST /api/logout                  ออกจากระบบ
//   GET  /api/notice                  ประกาศ update patch ที่กำลังจะมา (ตั้งโดย deploy.sh)
// การยืนยันตัวตน: header  Authorization: Bearer <token>
// กันโกง: คริสตัล ตั๋ว ยาน เลเวล คำนวณที่ server ทั้งหมด เครื่องผู้เล่นแก้ค่าเองไม่ได้
// ของที่เก็บในรอบถูกจำกัดเพดานตามเวลาที่เล่นจริง (นับจาก /api/run)

const MAX_NAME = 16;
const MAX_USER = 20;
const MAX_SCORE = 100_000_000;
const MIN_RUN_MS = 3_000;           // รอบที่สั้นกว่านี้ไม่นับ
const MAX_RUN_MS = 6 * 3600_000;    // รอบที่นานเกินนี้ถือว่าหมดอายุ
const LOOP_MIN_SEC = 30;            // 1 รอบ (4 wave + บอส + โบนัส) เล่นเร็วสุดไม่ต่ำกว่านี้แน่นอน
const COINS_PER_SEC = 6;            // เพดานคริสตัลที่เก็บได้ต่อวินาที (เผื่อไว้สูงกว่าจริงมาก)
const TICKETS_PER_LOOP = 5;         // ตั๋วหล่นได้สูงสุด 4 wave + บอส 1
const TICKET_MIN_SEC = 8;           // ตั๋วใบหนึ่งได้เร็วสุดทุกกี่วินาที (เคลียร์ wave เร็วสุด)
const SCORE_PER_SEC = 20_000;       // เพดานคะแนนต่อวินาที (เผื่อ FEVER/ON AIR ไว้สูงมาก)
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

// ----- ข้อมูลเกมฝั่ง server (ต้องตรงกับ SHIPS / TIERS / lvCost / PITY ในเกม) -----
const MAX_LV = 10;
const SHIP_TIER = {
  bolt: 'common', iron: 'common', magneto: 'rare', falcon: 'rare', comet: 'rare', storm: 'rare',
  phantom: 'epic', prism: 'epic', nova: 'legendary', phoenix: 'mythic',
};
const TIERS = {
  common:    { weight: 49.5, dupe: 150,  cost: 1 },
  rare:      { weight: 32,   dupe: 400,  cost: 1.3 },
  epic:      { weight: 14,   dupe: 900,  cost: 1.6 },
  legendary: { weight: 4,    dupe: 2000, cost: 2 },
  mythic:    { weight: 0.5,  dupe: 5000, cost: 2.5 },
};
const TIER_ORDER = ['common', 'rare', 'epic', 'legendary', 'mythic'];
const PITY_EPIC = 10, PITY_LEGEND = 40;
// เศษยาน / แปลงร่าง (ต้องตรงกับ SHARD_* ในเกม)
const SHARD_CHANCE = 0.02;          // ล้มบอส 1 ตัว มีโอกาสได้เศษ
const SHARD_NEED = 5;               // เศษที่ใช้แปลงร่าง
const SHARD_TIERS = ['rare', 'epic', 'legendary', 'mythic'];   // ยานธรรมดาไม่มีเศษ
const SHARD_PRICE = { rare: 80, epic: 180, legendary: 400, mythic: 1000 };
const lvCost = (id, lv) => Math.round(100 * Math.pow(1.5, lv - 1) * TIERS[SHIP_TIER[id]].cost / 10) * 10;

const randFloat = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;

// ทำข้อมูลผู้เล่นให้อยู่ในรูปที่ถูกต้องเสมอ
function normalizeData(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const nat = v => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0; };
  const chars = {};
  for (const [k, v] of Object.entries(d.chars || {})) {
    if (SHIP_TIER[k]) { const lv = Math.min(MAX_LV, nat(v)); if (lv) chars[k] = lv; }
  }
  if (!chars.bolt) chars.bolt = 1;
  return {
    coins: nat(d.coins),
    tickets: d.tickets === undefined ? 1 : nat(d.tickets),
    chars,
    ship: chars[d.ship] ? d.ship : 'bolt',
    best: nat(d.best),
    pity: { e: nat(d.pity && d.pity.e), l: nat(d.pity && d.pity.l) },
    shards: Object.fromEntries(Object.entries(d.shards || {})
      .filter(([k]) => SHARD_TIERS.includes(SHIP_TIER[k])).map(([k, v]) => [k, nat(v)]).filter(([, v]) => v > 0)),
    evo: Object.fromEntries(Object.keys(d.evo || {}).filter(k => SHARD_TIERS.includes(SHIP_TIER[k]) && d.evo[k]).map(k => [k, true])),
  };
}

// สุ่มเศษยาน: เลือกระดับตามโอกาสแบบเดียวกับตั๋วสุ่ม (ไม่รวมระดับธรรมดา) แล้วสุ่มยานในระดับนั้น
function rollShard() {
  let r = randFloat() * SHARD_TIERS.reduce((sum, k) => sum + TIERS[k].weight, 0);
  let tier = SHARD_TIERS[0];
  for (const k of SHARD_TIERS) { r -= TIERS[k].weight; if (r <= 0) { tier = k; break; } }
  const pool = Object.keys(SHIP_TIER).filter(id => SHIP_TIER[id] === tier);
  return pool[Math.floor(randFloat() * pool.length)];
}
const dataOf = u => { try { return normalizeData(JSON.parse(u.data || '{}')); } catch { return normalizeData({}); } };

async function writeData(env, userId, data) {
  await env.DB.prepare(`UPDATE users SET data = ?1, updated_at = ?2 WHERE id = ?3`)
    .bind(JSON.stringify(data), Date.now(), userId).run();
}

// สุ่มยาน: เลือกระดับตามโอกาสก่อน แล้วสุ่มตัวในระดับนั้น · มีระบบการันตี
function rollGacha(d) {
  let tiers = TIER_ORDER;
  if (d.pity.l >= PITY_LEGEND - 1) tiers = tiers.slice(3);
  else if (d.pity.e >= PITY_EPIC - 1) tiers = tiers.slice(2);
  let r = randFloat() * tiers.reduce((sum, k) => sum + TIERS[k].weight, 0);
  let tier = tiers[tiers.length - 1];
  for (const k of tiers) { r -= TIERS[k].weight; if (r <= 0) { tier = k; break; } }
  const rank = TIER_ORDER.indexOf(tier);
  d.pity.e = rank >= 2 ? 0 : d.pity.e + 1;
  d.pity.l = rank >= 3 ? 0 : d.pity.l + 1;
  const pool = Object.keys(SHIP_TIER).filter(id => SHIP_TIER[id] === tier);
  return pool[Math.floor(randFloat() * pool.length)];
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

const profileOf = u => ({ id: u.id, username: u.username, nickname: u.nickname, data: dataOf(u) });

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
  return json({ token, profile: { id, username, nickname, data: normalizeData({}) } });
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

// ----- ร้านยาน -----
async function chooseShip(env, request) {
  const u = await currentUser(env, request);
  if (!u) return json({ error: 'unauthorized' }, 401);
  const body = await readJson(request);
  const d = dataOf(u);
  if (!body || !d.chars[body.ship]) return json({ error: 'not_owned' }, 400);
  d.ship = body.ship;
  await writeData(env, u.id, d);
  return json({ data: d });
}

// เขียนแบบมีเงื่อนไขว่าข้อมูลยังเป็นของเดิม กันกดรัวๆ หลายคำขอพร้อมกันแล้วใช้คริสตัล/ตั๋วซ้ำ
async function writeDataIfSame(env, u, data) {
  const res = await env.DB.prepare(`UPDATE users SET data = ?1, updated_at = ?2 WHERE id = ?3 AND data = ?4`)
    .bind(JSON.stringify(data), Date.now(), u.id, u.data).run();
  return !!res.meta && res.meta.changes === 1;
}

async function upgrade(env, request) {
  const u = await currentUser(env, request);
  if (!u) return json({ error: 'unauthorized' }, 401);
  const body = await readJson(request);
  const d = dataOf(u);
  const id = body && body.ship, lv = d.chars[id];
  if (!lv) return json({ error: 'not_owned' }, 400);
  if (lv >= MAX_LV) return json({ error: 'max_level' }, 400);
  const cost = lvCost(id, lv);
  if (d.coins < cost) return json({ error: 'not_enough', need: cost - d.coins }, 400);
  d.coins -= cost;
  d.chars[id] = lv + 1;
  if (!(await writeDataIfSame(env, u, d))) return json({ error: 'busy' }, 409);
  return json({ data: d });
}

async function spin(env, request) {
  const u = await currentUser(env, request);
  if (!u) return json({ error: 'unauthorized' }, 401);
  const d = dataOf(u);
  if (d.tickets < 1) return json({ error: 'no_ticket' }, 400);
  const id = rollGacha(d);
  const isNew = !d.chars[id];
  const refund = isNew ? 0 : TIERS[SHIP_TIER[id]].dupe;
  d.tickets -= 1;
  if (isNew) d.chars[id] = 1; else d.coins += refund;
  if (!(await writeDataIfSame(env, u, d))) return json({ error: 'busy' }, 409);
  return json({ ship: id, isNew, refund, data: d });
}

// ----- เศษยาน / แปลงร่าง -----
async function evolve(env, request) {
  const u = await currentUser(env, request);
  if (!u) return json({ error: 'unauthorized' }, 401);
  const body = await readJson(request);
  const d = dataOf(u);
  const id = body && body.ship;
  if (!SHARD_TIERS.includes(SHIP_TIER[id])) return json({ error: 'not_evolvable' }, 400);
  if ((d.chars[id] || 0) < MAX_LV) return json({ error: 'need_max_level' }, 400);
  if (d.evo[id]) return json({ error: 'already' }, 400);
  if ((d.shards[id] || 0) < SHARD_NEED) return json({ error: 'need_shards' }, 400);
  d.shards[id] -= SHARD_NEED;
  if (!d.shards[id]) delete d.shards[id];
  d.evo[id] = true;
  if (!(await writeDataIfSame(env, u, d))) return json({ error: 'busy' }, 409);
  return json({ data: d });
}

async function sellShard(env, request) {
  const u = await currentUser(env, request);
  if (!u) return json({ error: 'unauthorized' }, 401);
  const body = await readJson(request);
  const d = dataOf(u);
  const id = body && body.ship, n = int(body && body.n, 1, 999) ?? 1;
  if ((d.shards[id] || 0) < n) return json({ error: 'not_enough_shards' }, 400);
  const coins = SHARD_PRICE[SHIP_TIER[id]] * n;
  d.shards[id] -= n;
  if (!d.shards[id]) delete d.shards[id];
  d.coins += coins;
  if (!(await writeDataIfSame(env, u, d))) return json({ error: 'busy' }, 409);
  return json({ coins, data: d });
}

// ล้มบอส: นับต่อรอบ จำกัดตามเวลาที่เล่นจริง (บอสมาได้ไม่เกิน 1 ตัวต่อ LOOP_MIN_SEC) แล้วสุ่มเศษ
async function bossDown(env, request) {
  const u = await currentUser(env, request);
  if (!u) return json({ error: 'unauthorized' }, 401);
  const body = await readJson(request);
  const runId = body && typeof body.runId === 'string' ? body.runId : '';
  const run = await env.DB.prepare(`SELECT started_at FROM runs WHERE user_id = ?1 AND run_id = ?2`).bind(u.id, runId).first();
  if (!run) return json({ error: 'no_run' }, 400);
  const prev = await env.DB.prepare(`SELECT run_id, count FROM run_bosses WHERE user_id = ?1`).bind(u.id).first();
  const count = (prev && prev.run_id === runId ? prev.count : 0) + 1;
  if ((Date.now() - run.started_at) / 1000 < count * LOOP_MIN_SEC) return json({ error: 'too_fast' }, 429);
  await env.DB.prepare(
    `INSERT INTO run_bosses (user_id, run_id, count) VALUES (?1, ?2, ?3)
     ON CONFLICT(user_id) DO UPDATE SET run_id = excluded.run_id, count = excluded.count`
  ).bind(u.id, runId, count).run();
  if (randFloat() >= SHARD_CHANCE) return json({ shard: null });
  const id = rollShard();
  const d = dataOf(u);
  d.shards[id] = (d.shards[id] || 0) + 1;
  await writeData(env, u.id, d);
  return json({ shard: id, data: d });
}

// ----- รอบเล่น -----
async function startRun(env, request) {
  const u = await currentUser(env, request);
  if (!u) return json({ error: 'unauthorized' }, 401);
  const runId = randomHex(12);
  await env.DB.prepare(
    `INSERT INTO runs (user_id, run_id, started_at) VALUES (?1, ?2, ?3)
     ON CONFLICT(user_id) DO UPDATE SET run_id = excluded.run_id, started_at = excluded.started_at`
  ).bind(u.id, runId, Date.now()).run();
  return json({ runId });
}

// ----- ประกาศ: deploy.sh ใส่เวลาที่จะ deploy ไว้ เกมดึงไปแสดงแถบเลื่อนนับถอยหลัง -----
async function notice(env) {
  const now = Date.now();
  const n = await env.DB.prepare(`SELECT deploy_at FROM notice WHERE id = 1 AND expires_at > ?1`).bind(now).first();
  return json({ now, deployAt: n ? n.deploy_at : null });
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
  const ship = cleanName(body.ship).slice(0, 12) || null;
  const now = Date.now();

  // ต้องมีรอบที่เริ่มจาก /api/run และใช้ได้ครั้งเดียว (ลบทิ้งทันที กันส่งซ้ำ)
  const runId = typeof body.runId === 'string' ? body.runId : '';
  const run = await env.DB.prepare(`DELETE FROM runs WHERE user_id = ?1 AND run_id = ?2 RETURNING started_at`)
    .bind(u.id, runId).first();
  if (!run) return json({ error: 'no_run' }, 400);
  const ms = now - run.started_at;
  if (ms < MIN_RUN_MS) return json({ error: 'too_fast' }, 429);
  if (ms > MAX_RUN_MS) return json({ error: 'run_expired' }, 400);
  const sec = ms / 1000;

  // รอบที่ไปถึงต้องสัมพันธ์กับเวลาที่เล่นจริง และคะแนนต้องสัมพันธ์กับรอบ
  if (loop > 1 + Math.floor(sec / LOOP_MIN_SEC)) return json({ error: 'implausible' }, 400);
  if (score > 600_000 * loop + 400_000 || score > 50_000 + sec * SCORE_PER_SEC) return json({ error: 'implausible' }, 400);

  // รางวัล: ของที่เก็บได้ถูกจำกัดเพดาน, โบนัสจากคะแนน 1 คริสตัลต่อ 1,000 แต้ม
  const coins = Math.min(int(body.coins, 0, 1_000_000) ?? 0, Math.floor(sec * COINS_PER_SEC));
  const tickets = Math.min(int(body.tickets, 0, 10_000) ?? 0, loop * TICKETS_PER_LOOP, 1 + Math.floor(sec / TICKET_MIN_SEC));
  const scoreBonus = Math.floor(score / 1000);
  const d = dataOf(u);
  d.coins += coins + scoreBonus;
  d.tickets += tickets;
  if (score > d.best) d.best = score;
  await writeData(env, u.id, d);

  const prev = await env.DB.prepare(`SELECT best FROM players WHERE id = ?1`).bind(u.id).first();
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
    reward: { coins, tickets, scoreBonus },
    data: d,
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
    if (route === 'notice' && m === 'GET') return await notice(env);
    if (route === 'score' && m === 'POST') return await submit(env, request);
    if (route === 'signup' && m === 'POST') return await signup(env, request);
    if (route === 'login' && m === 'POST') return await login(env, request);
    if (route === 'me' && m === 'GET') return await me(env, request);
    if (route === 'ship' && m === 'POST') return await chooseShip(env, request);
    if (route === 'upgrade' && m === 'POST') return await upgrade(env, request);
    if (route === 'spin' && m === 'POST') return await spin(env, request);
    if (route === 'run' && m === 'POST') return await startRun(env, request);
    if (route === 'boss' && m === 'POST') return await bossDown(env, request);
    if (route === 'evolve' && m === 'POST') return await evolve(env, request);
    if (route === 'shard/sell' && m === 'POST') return await sellShard(env, request);
    if (route === 'logout' && m === 'POST') return await logout(env, request);
    return json({ error: 'not_found' }, 404);
  } catch (err) {
    return json({ error: 'server_error' }, 500);
  }
}
