// Cloudflare Pages Function: API ของเกม (ต่อกับ D1 ผ่าน binding ชื่อ DB)
//   GET  /api/leaderboard?limit=200   อันดับทั้งหมด เรียงคะแนนมากไปน้อย
//   POST /api/signup                  สมัคร { username, password, nickname }
//   POST /api/login                   ล็อกอิน { username, password }
//   GET  /api/me                      ข้อมูลบัญชีที่ล็อกอินอยู่
//   POST /api/ship                    เลือกยานที่ใช้ { ship }
//   POST /api/upgrade                 อัปเลเวลยานด้วยคริสตัล { ship }
//   POST /api/spin                    ใช้ตั๋วสุ่มยาน { n: 1 | 10 } (ไม่ส่ง = 1 ใบ)
//   POST /api/run                     เริ่มรอบเล่น ได้ runId กลับไป
//   POST /api/boss                    ล้มบอสในรอบนี้ { runId } → server สุ่มเศษยาน 2% + กุญแจดาว 6%
//   POST /api/evolve                  แปลงร่างยาน (Lv10 + เศษครบ 5) { ship }
//   POST /api/shard/sell              ขายเศษยานเป็นคริสตัล { ship, n }
//   POST /api/chest                   เปิดหีบสมบัติ { pay: 'coins' | 'key' | 'gold' } ได้สมบัติสุ่ม 1 ชิ้น
//   POST /api/treasure/up             ใช้คริสตัลอัปขั้นสมบัติ { id }
//   POST /api/treasure/slot           ปลดล็อกช่องสมบัติที่ 2 (คริสตัล 5,000)
//   POST /api/equip                   ใส่สมบัติ { slots: [id, id] } (ห้ามซ้ำ, ระดับไหนก็ได้, ช่อง 2 ต้องปลดล็อก)
//   POST /api/score                   จบรอบ: ส่งคะแนน + ของที่เก็บได้ { runId, score, loop, coins, tickets, ... }
//   POST /api/logout                  ออกจากระบบ
//   GET  /api/notice                  ประกาศ update patch ที่กำลังจะมา (ตั้งโดย deploy.sh)
//   GET  /api/pvp/me                  ถ้วย ชนะ แพ้ ของ PvP
//   POST /api/pvp/create              สร้างห้อง PvP ได้รหัส 4 หลัก
//   POST /api/pvp/announce            ประกาศเรียกคน { code } (1 ครั้ง / 2 นาที)
//   GET  /api/pvp/invites             ห้องที่เพิ่งประกาศ (หน้าแรกของเกมเช็กทุก 5 วิ)
//   POST /api/pvp/join                เข้าห้อง { code } (คนแรกได้เข้า)
//   POST /api/pvp/poll                ส่งสถานะตัวเอง รับสถานะคู่แข่ง { code, st }
//   POST /api/pvp/leave               ออกจากห้อง / ยอมแพ้ { code }
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
const SCORE_PER_LOOP = 3_000_000, SCORE_LOOP_BASE = 1_000_000;   // เพดานคะแนนตามรอบ (FRENZY + FEVER/ON AIR x12 ทำได้ ~1.3 ล้าน/รอบ)
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
// สมบัติ (ต้องตรงกับ TREASURES / TR_* ในเกม)
const TREASURE_RARITY = {
  heart: 'common', lens: 'common', lucky: 'common', bag: 'common',
  battery: 'rare', shield: 'rare', compass: 'rare', hourglass: 'epic', mirror: 'epic',
  feather: 'legendary', magnet: 'legendary', solar: 'legendary', nova: 'mythic',
};
const TREASURE_IDS = Object.keys(TREASURE_RARITY);
const TREASURE_MAX = 3, TREASURE_SLOTS = 2, CHEST_PRICE = 1500, SLOT2_PRICE = 5000;
const TR_TIERS = ['common', 'rare', 'epic', 'legendary', 'mythic'];
const TR_HIGH = ['epic', 'legendary', 'mythic'];                    // ระดับที่การันตีเอพิกให้
const TR_ODDS = { common: 55, rare: 30, epic: 11.5, legendary: 3, mythic: 0.5 };   // โอกาสจากหีบ (%)
const TR_GOLD_ODDS = { epic: 75, legendary: 20, mythic: 5 };        // หีบทอง: เอพิกขึ้นไปเท่านั้น
const TR_PITY_EPIC = 10, TR_PITY_LEGEND = 30;                       // การันตีของหีบ (นับแยกจากตั๋วสุ่มยาน)
const TR_DUPE = { common: 100, rare: 200, epic: 400, legendary: 800, mythic: 1600 };   // ได้ชิ้นที่มีแล้ว → คริสตัลคืน
const TR_UP_COST = {                                                // คริสตัลที่ใช้อัปขั้น 1→2, 2→3
  common: [2000, 4000], rare: [2500, 5000], epic: [3000, 6000], legendary: [4000, 8000], mythic: [5000, 10000],
};
const KEY_CHANCE = 0.06;                                            // ล้มบอส 1 ตัว มีโอกาสได้กุญแจดาว
const MILESTONES = { 3: { keys: 1 }, 5: { keys: 2 }, 8: { gold: 1 } };   // ถึงรอบใหม่ครั้งแรก (ครั้งเดียวต่อบัญชี)
const BAG_BONUS = [0, 0.1, 0.2, 0.3];   // กระเป๋าคริสตัล: คริสตัลที่เก็บได้ในรอบ +% ตามขั้น
const NOVA_BONUS = [0, 0.05, 0.1, 0.15]; // หัวใจซูเปอร์โนวา: แต้มท้ายเกม +% ตามขั้น (ขยายเพดานตรวจโกงตาม)
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
    ...treasureData(d),
  };
}

function treasureData(d) {
  const nat = v => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0; };
  const treasures = {};
  for (const id of TREASURE_IDS) { const lv = Math.min(TREASURE_MAX, nat(d.treasures && d.treasures[id])); if (lv) treasures[id] = lv; }
  const ms = Object.keys(MILESTONES).map(Number).filter(n => Array.isArray(d.ms) && d.ms.includes(n));
  const t = {
    treasures, keys: nat(d.keys), gold: nat(d.gold), ms, slot2: !!d.slot2,
    tpity: { e: nat(d.tpity && d.tpity.e), l: nat(d.tpity && d.tpity.l) },
  };
  t.equip = cleanEquip(Array.isArray(d.equip) ? d.equip : [], t);
  return t;
}
const slotCount = d => (d.slot2 ? TREASURE_SLOTS : 1);
// สมบัติที่ใส่ได้จริง: มีอยู่, ไม่ซ้ำ, เอพิก/ตำนานไม่เกิน 1, ไม่เกินช่องที่ปลดล็อก
function cleanEquip(list, d) {
  const out = [];
  for (const id of list) {
    if (!d.treasures[id] || out.includes(id)) continue;
    out.push(id);
  }
  return out.slice(0, slotCount(d));
}

// สุ่มสมบัติจากหีบ: เลือกระดับตามโอกาส (หีบทอง = เอพิกขึ้นไป) แล้วสุ่มชิ้นในระดับนั้น · มีระบบการันตี
function rollTreasure(d, gold) {
  const odds = gold ? TR_GOLD_ODDS : TR_ODDS;
  let tiers = Object.keys(odds);
  if (d.tpity.l >= TR_PITY_LEGEND - 1) tiers = ['legendary', 'mythic'];
  else if (d.tpity.e >= TR_PITY_EPIC - 1) tiers = TR_HIGH;
  let r = randFloat() * tiers.reduce((sum, k) => sum + odds[k], 0);
  let tier = tiers[tiers.length - 1];
  for (const k of tiers) { r -= odds[k]; if (r <= 0) { tier = k; break; } }
  const rank = TR_TIERS.indexOf(tier);
  d.tpity.e = rank >= 2 ? 0 : d.tpity.e + 1;
  d.tpity.l = rank >= 3 ? 0 : d.tpity.l + 1;
  const pool = TREASURE_IDS.filter(id => TREASURE_RARITY[id] === tier);
  return pool[Math.floor(randFloat() * pool.length)];
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
  const body = await readJson(request);
  const n = body && body.n === 10 ? 10 : 1;
  const d = dataOf(u);
  if (d.tickets < n) return json({ error: 'no_ticket' }, 400);
  // สุ่มทีละใบตามลำดับ (การันตีนับต่อกัน · ได้ลำเดิมซ้ำในชุดเดียวกัน = คริสตัลคืน)
  const results = [];
  for (let i = 0; i < n; i++) {
    const id = rollGacha(d);
    const isNew = !d.chars[id];
    const refund = isNew ? 0 : TIERS[SHIP_TIER[id]].dupe;
    d.tickets -= 1;
    if (isNew) d.chars[id] = 1; else d.coins += refund;
    results.push({ ship: id, isNew, refund });
  }
  if (!(await writeDataIfSame(env, u, d))) return json({ error: 'busy' }, 409);
  return json({ ...results[0], results, data: d });
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
  const gotShard = randFloat() < SHARD_CHANCE, key = randFloat() < KEY_CHANCE;
  if (!gotShard && !key) return json({ shard: null, key: false });
  const d = dataOf(u);
  const id = gotShard ? rollShard() : null;
  if (id) d.shards[id] = (d.shards[id] || 0) + 1;
  if (key) d.keys += 1;
  await writeData(env, u.id, d);
  return json({ shard: id, key, data: d });
}

// ----- สมบัติ -----
async function openChest(env, request) {
  const u = await currentUser(env, request);
  if (!u) return json({ error: 'unauthorized' }, 401);
  const body = await readJson(request);
  const pay = body && ['key', 'gold'].includes(body.pay) ? body.pay : 'coins';
  const d = dataOf(u);
  if (pay === 'key') { if (d.keys < 1) return json({ error: 'no_key' }, 400); d.keys -= 1; }
  else if (pay === 'gold') { if (d.gold < 1) return json({ error: 'no_gold' }, 400); d.gold -= 1; }
  else { if (d.coins < CHEST_PRICE) return json({ error: 'not_enough', need: CHEST_PRICE - d.coins }, 400); d.coins -= CHEST_PRICE; }
  const id = rollTreasure(d, pay === 'gold');
  // ได้ชิ้นใหม่ = ขั้น 1 · ได้ชิ้นที่มีแล้ว = คริสตัลคืนเล็กน้อย (อัปขั้นด้วยคริสตัลแยกต่างหาก)
  const isNew = !d.treasures[id];
  const refund = isNew ? 0 : TR_DUPE[TREASURE_RARITY[id]];
  if (isNew) d.treasures[id] = 1; else d.coins += refund;
  if (!(await writeDataIfSame(env, u, d))) return json({ error: 'busy' }, 409);
  return json({ treasure: id, level: d.treasures[id], isNew, refund, data: d });
}

async function treasureUp(env, request) {
  const u = await currentUser(env, request);
  if (!u) return json({ error: 'unauthorized' }, 401);
  const body = await readJson(request);
  const d = dataOf(u);
  const id = body && body.id, lv = d.treasures[id] || 0;
  if (!lv) return json({ error: 'not_owned_tr' }, 400);
  if (lv >= TREASURE_MAX) return json({ error: 'max_level' }, 400);
  const cost = TR_UP_COST[TREASURE_RARITY[id]][lv - 1];
  if (d.coins < cost) return json({ error: 'not_enough', need: cost - d.coins }, 400);
  d.coins -= cost;
  d.treasures[id] = lv + 1;
  if (!(await writeDataIfSame(env, u, d))) return json({ error: 'busy' }, 409);
  return json({ treasure: id, level: lv + 1, cost, data: d });
}

async function unlockSlot(env, request) {
  const u = await currentUser(env, request);
  if (!u) return json({ error: 'unauthorized' }, 401);
  const d = dataOf(u);
  if (d.slot2) return json({ error: 'slot_owned' }, 400);
  if (d.coins < SLOT2_PRICE) return json({ error: 'not_enough', need: SLOT2_PRICE - d.coins }, 400);
  d.coins -= SLOT2_PRICE;
  d.slot2 = true;
  if (!(await writeDataIfSame(env, u, d))) return json({ error: 'busy' }, 409);
  return json({ data: d });
}

async function equipTreasures(env, request) {
  const u = await currentUser(env, request);
  if (!u) return json({ error: 'unauthorized' }, 401);
  const body = await readJson(request);
  const d = dataOf(u);
  const slots = body && Array.isArray(body.slots) ? body.slots : null;
  if (!slots || !slots.every(id => d.treasures[id])) return json({ error: 'bad_equip' }, 400);
  if (new Set(slots).size !== slots.length) return json({ error: 'dup_equip' }, 400);
  if (slots.length > slotCount(d)) return json({ error: 'slot_locked' }, 400);
  d.equip = slots;
  await writeData(env, u.id, d);
  return json({ data: d });
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

// ----- PvP 1 ต่อ 1 (ห้อง + ประกาศเรียกคน) -----
// ไม่ใช้การเชื่อมต่อค้าง: เครื่องผู้เล่นเรียก /api/pvp/poll ทุก ~0.7 วิ ส่งสถานะตัวเองแล้วรับสถานะอีกฝ่ายกลับไป
// ผลแพ้ชนะคิดที่ server ครั้งเดียว (UPDATE ... WHERE status = 'play' กันคิดซ้ำ)
const PVP_MATCH_MS = 60_000;          // เวลาแข่ง
const PVP_START_DELAY = 5_000;        // เข้าห้องครบ → เริ่มแข่ง (ฉาก VS + นับ 3-2-1)
const PVP_ANNOUNCE_CD = 120_000;      // ประกาศได้ 1 ครั้งต่อ 2 นาที
const PVP_INVITE_MS = 30_000;         // ป้ายเชิญอยู่ได้ 30 วิ
const PVP_STALE_MS = 12_000;          // ไม่ส่งสถานะเกินนี้ระหว่างแข่ง = หลุด แพ้
const PVP_ROOM_TTL = 15 * 60_000;     // ห้องที่ไม่มีใครเข้าเกิน 15 นาที ถือว่าปิด
const PVP_WIN = 25, PVP_LOSE = 15, PVP_STREAK_BONUS = 5, PVP_BASE = 1000;
const PVP_SCORE_PER_SEC = 40_000;     // เพดานแต้มต่อวินาทีในโหมด PvP
const PVP_ATK = ['wall', 'swarm', 'curtain', 'fog'];

async function pvpStats(env, id) {
  const r = await env.DB.prepare(`SELECT trophy, wins, losses, streak FROM pvp_stats WHERE user_id = ?1`).bind(id).first();
  return r || { trophy: PVP_BASE, wins: 0, losses: 0, streak: 0 };
}
const pvpParse = s => { try { return JSON.parse(s || '{}') || {}; } catch { return {}; } };
// สถานะที่เครื่องผู้เล่นส่งมา: เก็บเฉพาะค่าที่รู้จัก จำกัดขนาด
function pvpCleanState(st, prev) {
  const n = (v, max) => Math.max(0, Math.min(max, Math.floor(Number(v)) || 0));
  const atk = Array.isArray(st.atk) ? st.atk.filter(t => PVP_ATK.includes(t)).slice(0, 60) : [];
  return {
    score: n(st.score, MAX_SCORE), lives: n(st.lives, 9), charge: n(st.charge, 100), x: Math.max(0, Math.min(1, Number(st.x) || 0.5)),
    dead: !!st.dead, fin: !!st.fin || !!prev.fin, atk: atk.length >= (prev.atk || []).length ? atk : prev.atk || [],
    sent: n(st.sent, 99), perfect: n(st.perfect, 999), fast: n(st.fast, 99), cancel: n(st.cancel, 99), kills: n(st.kills, 9999),
  };
}
function pvpView(r, uid, now) {
  const host = r.host_id === uid, me = host ? 'host' : 'guest', opp = host ? 'guest' : 'host';
  return {
    code: r.code, status: r.status, role: me, now, startAt: r.start_at, matchMs: PVP_MATCH_MS,
    host: { name: r.host_name, ship: r.host_ship }, guest: r.guest_id ? { name: r.guest_name, ship: r.guest_ship } : null,
    announcedAt: r.announced_at, opp: pvpParse(r[opp + '_state']), oppSeen: r[opp + '_seen'],
    result: r.result ? pvpParse(r.result) : null,
  };
}
async function pvpRoomOf(env, code) {
  if (!/^\d{4}$/.test(String(code || ''))) return null;
  return env.DB.prepare(`SELECT * FROM pvp_rooms WHERE code = ?1`).bind(String(code)).first();
}
async function pvpMe(env, request) {
  const u = await currentUser(env, request);
  if (!u) return json({ error: 'unauthorized' }, 401);
  return json({ stats: await pvpStats(env, u.id) });
}
async function pvpCreate(env, request) {
  const u = await currentUser(env, request);
  if (!u) return json({ error: 'unauthorized' }, 401);
  const now = Date.now(), d = dataOf(u);
  // ปิดห้องเก่าของคนนี้ที่ยังเปิดค้าง + ล้างห้องเก่าเกิน 1 วัน
  await env.DB.batch([
    env.DB.prepare(`UPDATE pvp_rooms SET status = 'closed' WHERE host_id = ?1 AND status = 'open'`).bind(u.id),
    env.DB.prepare(`DELETE FROM pvp_rooms WHERE created_at < ?1`).bind(now - 86_400_000),
  ]);
  for (let i = 0; i < 8; i++) {
    const code = String(1000 + Math.floor(randFloat() * 9000));
    const res = await env.DB.prepare(
      `INSERT INTO pvp_rooms (code, host_id, host_name, host_ship, status, created_at, host_seen)
       VALUES (?1, ?2, ?3, ?4, 'open', ?5, ?5)
       ON CONFLICT(code) DO UPDATE SET host_id = excluded.host_id, host_name = excluded.host_name, host_ship = excluded.host_ship,
         guest_id = NULL, guest_name = NULL, guest_ship = NULL, status = 'open', created_at = excluded.created_at, announced_at = 0,
         start_at = 0, host_state = '{}', guest_state = '{}', host_seen = excluded.host_seen, guest_seen = 0, result = NULL
       WHERE pvp_rooms.status IN ('done', 'closed') OR pvp_rooms.created_at < ?6`
    ).bind(code, u.id, u.nickname, d.ship, now, now - PVP_ROOM_TTL).run();
    if (res.meta.changes) {
      const r = await pvpRoomOf(env, code);
      return json({ room: pvpView(r, u.id, now), stats: await pvpStats(env, u.id) });
    }
  }
  return json({ error: 'busy' }, 503);
}
async function pvpAnnounce(env, request) {
  const u = await currentUser(env, request);
  if (!u) return json({ error: 'unauthorized' }, 401);
  const body = await readJson(request), now = Date.now();
  const r = await pvpRoomOf(env, body && body.code);
  if (!r || r.host_id !== u.id || r.status !== 'open') return json({ error: 'room_closed' }, 409);
  if (now - r.announced_at < PVP_ANNOUNCE_CD) return json({ error: 'cooldown', wait: PVP_ANNOUNCE_CD - (now - r.announced_at) }, 429);
  await env.DB.prepare(`UPDATE pvp_rooms SET announced_at = ?1, host_seen = ?1 WHERE code = ?2`).bind(now, r.code).run();
  return json({ announcedAt: now, cooldown: PVP_ANNOUNCE_CD });
}
async function pvpInvites(env, request) {
  const u = await currentUser(env, request);
  if (!u) return json({ invites: [] });
  const now = Date.now();
  const { results } = await env.DB.prepare(
    `SELECT r.code, r.host_name, r.host_ship, r.announced_at, COALESCE(s.trophy, ?3) AS trophy
     FROM pvp_rooms r LEFT JOIN pvp_stats s ON s.user_id = r.host_id
     WHERE r.status = 'open' AND r.announced_at > ?1 AND r.host_seen > ?2 AND r.host_id != ?4
     ORDER BY r.announced_at DESC LIMIT 3`
  ).bind(now - PVP_INVITE_MS, now - PVP_STALE_MS, PVP_BASE, u.id).all();
  return json({ now, invites: results.map(r => ({ code: r.code, name: r.host_name, ship: r.host_ship, trophy: r.trophy, until: r.announced_at + PVP_INVITE_MS })) });
}
async function pvpJoin(env, request) {
  const u = await currentUser(env, request);
  if (!u) return json({ error: 'unauthorized' }, 401);
  const body = await readJson(request), now = Date.now(), d = dataOf(u);
  const code = String((body && body.code) || '');
  if (!/^\d{4}$/.test(code)) return json({ error: 'room_not_found' }, 404);
  const res = await env.DB.prepare(
    `UPDATE pvp_rooms SET guest_id = ?1, guest_name = ?2, guest_ship = ?3, status = 'play', start_at = ?4, guest_seen = ?5
     WHERE code = ?6 AND status = 'open' AND guest_id IS NULL AND host_id != ?1 AND host_seen > ?7 AND created_at > ?8`
  ).bind(u.id, u.nickname, d.ship, now + PVP_START_DELAY, now, code, now - PVP_STALE_MS, now - PVP_ROOM_TTL).run();
  const r = await pvpRoomOf(env, code);
  if (!res.meta.changes) {
    if (!r) return json({ error: 'room_not_found' }, 404);
    if (r.host_id === u.id) return json({ error: 'own_room' }, 409);
    return json({ error: r.status === 'open' ? 'room_closed' : r.status === 'play' || r.status === 'done' ? 'room_full' : 'room_closed' }, 409);
  }
  return json({ room: pvpView(r, u.id, now), stats: await pvpStats(env, u.id) });
}
// คิดผล: หลุด/ยอมแพ้ แพ้ก่อน → ตายก่อนแพ้ → แต้มมากกว่าชนะ · เสมอไม่เปลี่ยนถ้วย
async function pvpFinalize(env, r, now) {
  const hs = pvpParse(r.host_state), gs = pvpParse(r.guest_state);
  const elapsed = now - r.start_at;
  const cap = Math.max(0, Math.floor(PVP_SCORE_PER_SEC * Math.min(PVP_MATCH_MS, Math.max(0, elapsed)) / 1000)) + 50_000;
  const hScore = Math.min(hs.score || 0, cap), gScore = Math.min(gs.score || 0, cap);
  const hGone = hs.left || (now - r.host_seen > PVP_STALE_MS), gGone = gs.left || (now - r.guest_seen > PVP_STALE_MS);
  let winner = null, why = '';
  if (hGone !== gGone) { winner = hGone ? 'guest' : 'host'; why = 'left'; }
  else if (!!hs.dead !== !!gs.dead) { winner = hs.dead ? 'guest' : 'host'; why = 'ko'; }
  else if (hScore !== gScore) { winner = hScore > gScore ? 'host' : 'guest'; why = 'score'; }
  const result = { winner, why, host: { score: hScore }, guest: { score: gScore } };
  const res = await env.DB.prepare(`UPDATE pvp_rooms SET status = 'done', result = ?1 WHERE code = ?2 AND status = 'play'`)
    .bind(JSON.stringify(result), r.code).run();
  if (!res.meta.changes) return;   // มีคนคิดผลไปแล้ว
  if (!winner) return;
  const wid = winner === 'host' ? r.host_id : r.guest_id, lid = winner === 'host' ? r.guest_id : r.host_id;
  const wname = winner === 'host' ? r.host_name : r.guest_name, lname = winner === 'host' ? r.guest_name : r.host_name;
  const ws = await pvpStats(env, wid), ls = await pvpStats(env, lid);
  const bonus = ws.streak + 1 >= 3 ? PVP_STREAK_BONUS : 0;
  result.host.delta = winner === 'host' ? PVP_WIN + bonus : -Math.min(PVP_LOSE, ls.trophy);
  result.guest.delta = winner === 'guest' ? PVP_WIN + bonus : -Math.min(PVP_LOSE, ls.trophy);
  result.bonus = bonus;
  const up = `INSERT INTO pvp_stats (user_id, name, trophy, wins, losses, streak, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
    ON CONFLICT(user_id) DO UPDATE SET name = excluded.name, trophy = excluded.trophy, wins = excluded.wins, losses = excluded.losses,
      streak = excluded.streak, updated_at = excluded.updated_at`;
  await env.DB.batch([
    env.DB.prepare(up).bind(wid, wname, ws.trophy + PVP_WIN + bonus, ws.wins + 1, ws.losses, ws.streak + 1, now),
    env.DB.prepare(up).bind(lid, lname, Math.max(0, ls.trophy - PVP_LOSE), ls.wins, ls.losses + 1, 0, now),
    env.DB.prepare(`UPDATE pvp_rooms SET result = ?1 WHERE code = ?2`).bind(JSON.stringify(result), r.code),
  ]);
}
async function pvpPoll(env, request) {
  const u = await currentUser(env, request);
  if (!u) return json({ error: 'unauthorized' }, 401);
  const body = await readJson(request), now = Date.now();
  let r = await pvpRoomOf(env, body && body.code);
  if (!r || (r.host_id !== u.id && r.guest_id !== u.id)) return json({ error: 'room_not_found' }, 404);
  const me = r.host_id === u.id ? 'host' : 'guest';
  if (r.status === 'open' || r.status === 'play') {
    let state = r[me + '_state'];
    if (r.status === 'play' && body.st && typeof body.st === 'object') state = JSON.stringify(pvpCleanState(body.st, pvpParse(state)));
    await env.DB.prepare(`UPDATE pvp_rooms SET ${me}_state = ?1, ${me}_seen = ?2 WHERE code = ?3`).bind(state, now, r.code).run();
    r = await pvpRoomOf(env, r.code);
  }
  if (r.status === 'open' && r.created_at < now - PVP_ROOM_TTL) {
    await env.DB.prepare(`UPDATE pvp_rooms SET status = 'closed' WHERE code = ?1 AND status = 'open'`).bind(r.code).run();
    r = await pvpRoomOf(env, r.code);
  }
  if (r.status === 'play') {
    const hs = pvpParse(r.host_state), gs = pvpParse(r.guest_state);
    const timeUp = now > r.start_at + PVP_MATCH_MS + 8_000;
    const stale = now > r.start_at && (now - r.host_seen > PVP_STALE_MS || now - r.guest_seen > PVP_STALE_MS);
    // จบเมื่อ: ทั้งคู่จบ · มีคนตาย (ตายก่อนแพ้ทันที) · หมดเวลา · มีคนหลุด/ออก
    if ((hs.fin && gs.fin) || hs.dead || gs.dead || timeUp || stale || hs.left || gs.left) { await pvpFinalize(env, r, now); r = await pvpRoomOf(env, r.code); }
  }
  const view = pvpView(r, u.id, now);
  if (r.status === 'done') view.stats = await pvpStats(env, u.id);
  return json({ room: view });
}
async function pvpLeave(env, request) {
  const u = await currentUser(env, request);
  if (!u) return json({ error: 'unauthorized' }, 401);
  const body = await readJson(request), now = Date.now();
  const r = await pvpRoomOf(env, body && body.code);
  if (!r) return json({ ok: true });
  if (r.status === 'open' && r.host_id === u.id) await env.DB.prepare(`UPDATE pvp_rooms SET status = 'closed' WHERE code = ?1`).bind(r.code).run();
  else if (r.status === 'play' && (r.host_id === u.id || r.guest_id === u.id)) {
    const me = r.host_id === u.id ? 'host' : 'guest', st = pvpParse(r[me + '_state']);
    st.left = true; st.fin = true;
    await env.DB.prepare(`UPDATE pvp_rooms SET ${me}_state = ?1 WHERE code = ?2`).bind(JSON.stringify(st), r.code).run();
    await pvpFinalize(env, await pvpRoomOf(env, r.code), now);
  }
  return json({ ok: true });
}

// ----- คะแนน -----
async function leaderboard(env, url) {
  const limit = int(url.searchParams.get('limit'), 1, 500) ?? 200;
  const rows = await env.DB.prepare(
    `SELECT p.id, p.name, p.best, p.loop, p.max_combo, p.ship, g.gear FROM players p
     LEFT JOIN player_gear g ON g.id = p.id
     WHERE p.best > 0 ORDER BY p.best DESC, p.updated_at ASC LIMIT ?1`
  ).bind(limit).all();
  const total = await env.DB.prepare(`SELECT COUNT(*) AS n FROM players WHERE best > 0`).first();
  return json({
    total: total?.n ?? 0,
    entries: (rows.results || []).map(r => ({
      pid: r.id, name: r.name, score: r.best, loop: r.loop, maxCombo: r.max_combo, ship: r.ship,
      gear: String(r.gear || '').split(',').map(s => s.split(':')).filter(([id]) => TREASURE_RARITY[id]).map(([id, lv]) => [id, Number(lv) || 1]),
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

  // รอบที่ไปถึงต้องสัมพันธ์กับเวลาที่เล่นจริง (เกิน = โกงแน่นอน ไม่ให้อะไรเลย)
  if (loop > 1 + Math.floor(sec / LOOP_MIN_SEC)) return json({ error: 'implausible' }, 400);
  // คะแนนเกินเพดาน: ไม่ขึ้นตาราง แต่ยังได้คริสตัล/ตั๋วที่เก็บ (จำกัดตามเวลาอยู่แล้ว) และบันทึกไว้ให้ผู้ดูแลตรวจ
  const d0 = dataOf(u);
  const novaMul = 1 + (d0.equip.includes('nova') ? NOVA_BONUS[d0.treasures.nova] || 0 : 0);
  const scoreCap = Math.min(SCORE_PER_LOOP * loop + SCORE_LOOP_BASE, 50_000 + sec * SCORE_PER_SEC) * novaMul;
  const flagged = score > scoreCap;

  // รางวัล: ของที่เก็บได้ถูกจำกัดเพดาน, โบนัสจากคะแนน 1 คริสตัลต่อ 1,000 แต้ม
  const bag = d0.equip.includes('bag') ? BAG_BONUS[d0.treasures.bag] || 0 : 0;
  const coins = Math.floor(Math.min(int(body.coins, 0, 1_000_000) ?? 0, Math.floor(sec * COINS_PER_SEC)) * (1 + bag));
  const tickets = Math.min(int(body.tickets, 0, 10_000) ?? 0, loop * TICKETS_PER_LOOP, 1 + Math.floor(sec / TICKET_MIN_SEC));
  const scoreBonus = flagged ? 0 : Math.floor(score / 1000);   // คะแนนที่ถูกตั้งธง ไม่ได้โบนัสจากแต้ม (ผู้ดูแลเพิ่มให้ทีหลังถ้าเป็นของจริง)
  const d = dataOf(u);
  d.coins += coins + scoreBonus;
  d.tickets += tickets;
  if (score > d.best && !flagged) d.best = score;
  // ถึงรอบใหม่ครั้งแรก: กุญแจ / หีบทอง
  const milestones = [];
  for (const [at, r] of Object.entries(MILESTONES)) {
    const n = Number(at);
    if (loop < n || d.ms.includes(n)) continue;
    d.ms.push(n);
    d.keys += r.keys || 0;
    d.gold += r.gold || 0;
    milestones.push({ loop: n, keys: r.keys || 0, gold: r.gold || 0 });
  }
  await writeData(env, u.id, d);

  const prev = await env.DB.prepare(`SELECT best FROM players WHERE id = ?1`).bind(u.id).first();
  if (flagged) {
    await env.DB.prepare(`INSERT INTO flagged_runs (user_id, name, score, loop, sec, ship, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`)
      .bind(u.id, u.nickname, score, loop, Math.round(sec), ship, now).run();
    const best = prev ? prev.best : 0;
    const above = await env.DB.prepare(`SELECT COUNT(*) AS n FROM players WHERE best > ?1`).bind(best).first();
    const total = await env.DB.prepare(`SELECT COUNT(*) AS n FROM players WHERE best > 0`).first();
    return json({ pid: u.id, flagged: true, best, newBest: false, rank: (above?.n ?? 0) + 1, total: total?.n ?? 1,
      reward: { coins, tickets, scoreBonus, milestones }, data: d });
  }
  // สมบัติที่ใส่ตอนทำคะแนนสูงสุด (โชว์ในตารางอันดับ)
  if (!prev || score > prev.best) {
    await env.DB.prepare(`INSERT INTO player_gear (id, gear) VALUES (?1, ?2) ON CONFLICT(id) DO UPDATE SET gear = excluded.gear`)
      .bind(u.id, d0.equip.map(id => `${id}:${d0.treasures[id]}`).join(',')).run();
  }
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
    reward: { coins, tickets, scoreBonus, milestones },
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
    if (route === 'chest' && m === 'POST') return await openChest(env, request);
    if (route === 'equip' && m === 'POST') return await equipTreasures(env, request);
    if (route === 'treasure/up' && m === 'POST') return await treasureUp(env, request);
    if (route === 'treasure/slot' && m === 'POST') return await unlockSlot(env, request);
    if (route === 'logout' && m === 'POST') return await logout(env, request);
    if (route === 'pvp/me' && m === 'GET') return await pvpMe(env, request);
    if (route === 'pvp/create' && m === 'POST') return await pvpCreate(env, request);
    if (route === 'pvp/announce' && m === 'POST') return await pvpAnnounce(env, request);
    if (route === 'pvp/invites' && m === 'GET') return await pvpInvites(env, request);
    if (route === 'pvp/join' && m === 'POST') return await pvpJoin(env, request);
    if (route === 'pvp/poll' && m === 'POST') return await pvpPoll(env, request);
    if (route === 'pvp/leave' && m === 'POST') return await pvpLeave(env, request);
    return json({ error: 'not_found' }, 404);
  } catch (err) {
    return json({ error: 'server_error' }, 500);
  }
}
