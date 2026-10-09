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
