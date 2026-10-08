-- ตารางคะแนน: 1 แถวต่อผู้เล่น 1 คน (1 เครื่อง) เก็บเฉพาะคะแนนสูงสุด
-- id = SHA-256 ของรหัสลับที่เก็บในเครื่องผู้เล่น (ไม่มีใครปลอมตัวเป็นคนอื่นได้ถ้าไม่รู้รหัสลับ)
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
