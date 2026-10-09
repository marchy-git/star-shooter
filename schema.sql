-- ตารางคะแนน: 1 แถวต่อผู้เล่น 1 คน เก็บเฉพาะคะแนนสูงสุด (id = id ของบัญชีผู้ใช้)
CREATE TABLE IF NOT EXISTS players (
  id          TEXT PRIMARY KEY,
  name        TEXT    NOT NULL,
  best        INTEGER NOT NULL DEFAULT 0,
  loop        INTEGER NOT NULL DEFAULT 1,
  max_combo   INTEGER NOT NULL DEFAULT 0,
  ship        TEXT,
  games       INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL,
  last_submit INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_players_best ON players (best DESC, updated_at ASC);

-- บัญชีผู้ใช้แบบง่าย: username ห้ามซ้ำ (เทียบแบบไม่สนตัวพิมพ์เล็กใหญ่)
-- รหัสผ่านเก็บเป็น PBKDF2-SHA256 + salt ไม่เก็บรหัสผ่านจริง
-- data = ความคืบหน้าในเกม (คริสตัล ตั๋ว ยานและเลเวล) เป็น JSON
CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  username     TEXT    NOT NULL,
  username_key TEXT    NOT NULL UNIQUE,
  salt         TEXT    NOT NULL,
  pass_hash    TEXT    NOT NULL,
  nickname     TEXT    NOT NULL,
  data         TEXT    NOT NULL DEFAULT '{}',
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

-- session ที่ล็อกอินอยู่ (token สุ่ม เก็บในเครื่องผู้เล่น)
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);

-- รอบเล่นที่กำลังเล่นอยู่ (1 คนมีได้ 1 รอบ) ใช้จับเวลาเล่นจริงเพื่อจำกัดรางวัล ส่งผลแล้วลบทิ้ง
CREATE TABLE IF NOT EXISTS runs (
  user_id    TEXT PRIMARY KEY,
  run_id     TEXT    NOT NULL,
  started_at INTEGER NOT NULL
);

-- ประกาศ update patch (มีได้แถวเดียว) deploy.sh ใส่ตอนเริ่มและลบตอนเสร็จ
-- expires_at กันประกาศค้าง ถ้าสคริปต์พังกลางทาง ประกาศจะหายเอง
CREATE TABLE IF NOT EXISTS notice (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  deploy_at  INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- นับบอสที่ล้มในรอบเล่นปัจจุบัน (ใช้จำกัดการสุ่มเศษยานตามเวลาที่เล่นจริง)
CREATE TABLE IF NOT EXISTS run_bosses (
  user_id TEXT PRIMARY KEY,
  run_id  TEXT    NOT NULL,
  count   INTEGER NOT NULL DEFAULT 0
);

-- สมบัติที่ผู้เล่นใส่ตอนทำคะแนนสูงสุด (โชว์ในตารางอันดับ) gear = "feather:3,mirror:2"
CREATE TABLE IF NOT EXISTS player_gear (
  id   TEXT PRIMARY KEY,
  gear TEXT NOT NULL DEFAULT ''
);

-- คะแนนที่เกินเพดานตรวจโกง (ไม่ขึ้นตาราง) เก็บไว้ให้ผู้ดูแลดูแล้วเพิ่มให้เองถ้าเป็นของจริง
CREATE TABLE IF NOT EXISTS flagged_runs (
  user_id TEXT    NOT NULL,
  name    TEXT,
  score   INTEGER NOT NULL,
  loop    INTEGER NOT NULL,
  sec     INTEGER NOT NULL,
  ship    TEXT,
  at      INTEGER NOT NULL
);

-- PvP 1 ต่อ 1 แบบสร้างห้อง: เครื่องผู้เล่นส่งสถานะ (แต้ม ชีวิต หลอดชาร์จ การโจมตีที่ส่ง) ผ่าน /api/pvp/poll ทุก ~0.7 วิ
-- status: open = รอคนเข้า · play = กำลังแข่ง · done = จบแล้ว (result = JSON ผล) · closed = เจ้าของปิดห้อง
CREATE TABLE IF NOT EXISTS pvp_rooms (
  code         TEXT PRIMARY KEY,
  host_id      TEXT    NOT NULL,
  host_name    TEXT    NOT NULL,
  host_ship    TEXT    NOT NULL,
  guest_id     TEXT,
  guest_name   TEXT,
  guest_ship   TEXT,
  status       TEXT    NOT NULL,
  created_at   INTEGER NOT NULL,
  announced_at INTEGER NOT NULL DEFAULT 0,
  start_at     INTEGER NOT NULL DEFAULT 0,
  host_state   TEXT    NOT NULL DEFAULT '{}',
  guest_state  TEXT    NOT NULL DEFAULT '{}',
  host_seen    INTEGER NOT NULL DEFAULT 0,
  guest_seen   INTEGER NOT NULL DEFAULT 0,
  result       TEXT
);
CREATE INDEX IF NOT EXISTS idx_pvp_rooms_announce ON pvp_rooms (status, announced_at);

-- ถ้วยรางวัล PvP (เริ่ม 1000) แยกจากข้อมูลเกมหลัก
CREATE TABLE IF NOT EXISTS pvp_stats (
  user_id    TEXT PRIMARY KEY,
  name       TEXT    NOT NULL,
  trophy     INTEGER NOT NULL DEFAULT 1000,
  wins       INTEGER NOT NULL DEFAULT 0,
  losses     INTEGER NOT NULL DEFAULT 0,
  streak     INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

-- EPISODE: ตารางอันดับแยกด่าน EP2-5 (EP1 ใช้ตาราง players เดิม)
CREATE TABLE IF NOT EXISTS ep_players (
  id         TEXT    NOT NULL,
  ep         INTEGER NOT NULL,
  name       TEXT    NOT NULL,
  best       INTEGER NOT NULL DEFAULT 0,
  loop       INTEGER NOT NULL DEFAULT 1,
  max_combo  INTEGER NOT NULL DEFAULT 0,
  ship       TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (id, ep)
);
CREATE INDEX IF NOT EXISTS idx_ep_players_best ON ep_players (ep, best DESC, updated_at ASC);

-- รอบเล่นนี้อยู่ด่านไหน (คู่กับ runs)
CREATE TABLE IF NOT EXISTS run_ep (
  user_id TEXT PRIMARY KEY,
  run_id  TEXT    NOT NULL,
  ep      INTEGER NOT NULL
);
