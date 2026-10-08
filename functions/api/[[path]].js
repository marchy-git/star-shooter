// Cloudflare Pages Function: API ตารางอันดับ (ต่อกับ D1 ผ่าน binding ชื่อ DB)
//   GET  /api/leaderboard?limit=200   อันดับทั้งหมด เรียงคะแนนมากไปน้อย
//   POST /api/score                   ส่งคะแนนจบเกม (เก็บเฉพาะคะแนนสูงสุดของแต่ละคน)

const MAX_NAME = 16;
const MAX_SCORE = 100_000_000;
const SUBMIT_COOLDOWN_MS = 8_000;   // ส่งคะแนนได้ไม่ถี่กว่านี้ต่อคน

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS },
  });

async function sha256hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function cleanName(raw) {
  return String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME);
}

// คำที่ห้ามใช้ในชื่อ (ต้องตรงกับ BAD_WORDS ในเกม)
const BAD_WORDS = ['ควย', 'เหี้ย', 'เหี้ย', 'สัส', 'เย็ด', 'แตด', 'ส้นตีน', 'ไอ้สัตว์', 'อีดอก', 'ระยำ', 'จัญไร',
  'fuck', 'shit', 'bitch', 'cunt', 'dick', 'pussy', 'asshole', 'nigga', 'nigger', 'porn'];
const badName = n => {
  const k = n.toLowerCase().replace(/[\s._\-*!@#$%^&()+=0-9]/g, '');
  return BAD_WORDS.some(w => k.includes(w));
};

const int = (v, min, max) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

async function leaderboard(env, url) {
  const limit = int(url.searchParams.get('limit'), 1, 500) ?? 200;
  const rows = await env.DB.prepare(
    `SELECT id, name, best, loop, max_combo FROM players
     WHERE best > 0 ORDER BY best DESC, updated_at ASC LIMIT ?1`
  ).bind(limit).all();
  const total = await env.DB.prepare(`SELECT COUNT(*) AS n FROM players WHERE best > 0`).first();
  return json({
    total: total?.n ?? 0,
    // ส่งแค่ 16 ตัวแรกของ id ออกไป ใช้ระบุตัวในตาราง แต่เอาไปส่งคะแนนแทนคนอื่นไม่ได้
    entries: (rows.results || []).map(r => ({
      pid: r.id.slice(0, 16), name: r.name, score: r.best, loop: r.loop, maxCombo: r.max_combo,
    })),
  });
}

async function submit(env, request) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }

  const key = String(body.key ?? '');
  if (!/^[A-Za-z0-9-]{16,64}$/.test(key)) return json({ error: 'bad_key' }, 400);
  const name = cleanName(body.name);
  if (!name || badName(name)) return json({ error: 'bad_name' }, 400);
  const score = int(body.score, 0, MAX_SCORE);
  const loop = int(body.loop, 1, 999) ?? 1;
  const maxCombo = int(body.maxCombo, 0, 1_000_000) ?? 0;
  if (score === null) return json({ error: 'bad_score' }, 400);
  // กันคะแนนเวอร์เกินจริงแบบหยาบๆ: คะแนนต้องสัมพันธ์กับรอบที่ไปถึง
  if (score > 600_000 * loop + 400_000) return json({ error: 'implausible' }, 400);
  const ship = cleanName(body.ship).slice(0, 12) || null;

  const id = await sha256hex(key);
  const now = Date.now();

  const prev = await env.DB.prepare(`SELECT best, last_submit FROM players WHERE id = ?1`).bind(id).first();
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
  ).bind(id, name, score, loop, maxCombo, ship, now).run();

  const me = await env.DB.prepare(`SELECT best FROM players WHERE id = ?1`).bind(id).first();
  const above = await env.DB.prepare(`SELECT COUNT(*) AS n FROM players WHERE best > ?1`).bind(me.best).first();
  const total = await env.DB.prepare(`SELECT COUNT(*) AS n FROM players WHERE best > 0`).first();

  return json({
    pid: id.slice(0, 16),
    best: me.best,
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
  try {
    if (route === 'leaderboard' && request.method === 'GET') return await leaderboard(env, url);
    if (route === 'score' && request.method === 'POST') return await submit(env, request);
    return json({ error: 'not_found' }, 404);
  } catch (err) {
    return json({ error: 'server_error' }, 500);
  }
}
