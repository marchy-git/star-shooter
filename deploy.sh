#!/usr/bin/env bash
# deploy ขึ้นเว็บจริง พร้อมประกาศให้ผู้เล่นรู้ล่วงหน้า (รันใน Git Bash จากโฟลเดอร์นี้)
#   ./deploy.sh          ประกาศ "จะ update patch ในอีก 1 นาที" → รอ 60 วิ → deploy → ปิดประกาศ
#   ./deploy.sh 120      รอ 120 วิ
#   ./deploy.sh 0        deploy ทันที (ยังเปลี่ยนเวอร์ชันให้ผู้เล่นโหลดใหม่ตอนจบรอบ)
# ถ้าแก้ schema.sql ให้รัน schema ขึ้น remote ก่อนเสมอ (สคริปต์นี้ทำให้อัตโนมัติ)
set -euo pipefail
cd "$(dirname "$0")"

WAIT=${1:-60}
export MSYS_NO_PATHCONV=1
d1() { docker compose run --rm tool d1 execute star-shooter --remote --command "$1" > /dev/null; }
now_ms() { echo $(( $(date +%s) * 1000 )); }

echo "== อัปเดตตารางในฐานข้อมูลจริง (schema.sql)"
docker compose run --rm tool d1 execute star-shooter --remote --file=schema.sql > /dev/null

if [ "$WAIT" -gt 0 ]; then
  deploy_at=$(( $(now_ms) + WAIT * 1000 ))
  expires_at=$(( deploy_at + 10 * 60 * 1000 ))
  echo "== เปิดประกาศ: update patch ในอีก $WAIT วินาที"
  d1 "INSERT INTO notice (id, deploy_at, expires_at) VALUES (1, $deploy_at, $expires_at)
      ON CONFLICT(id) DO UPDATE SET deploy_at = excluded.deploy_at, expires_at = excluded.expires_at"
  # จบสคริปต์ไม่ว่าจะสำเร็จหรือพัง ให้ปิดประกาศเสมอ
  trap 'echo "== ปิดประกาศ"; d1 "DELETE FROM notice WHERE id = 1" || true' EXIT
  while [ "$(now_ms)" -lt "$deploy_at" ]; do
    printf '\r   รออีก %3d วินาที ' $(( (deploy_at - $(now_ms)) / 1000 ))
    sleep 1
  done
  echo
fi

echo "== deploy"
echo "{\"build\":\"$(now_ms)\"}" > public/version.json
docker compose run --rm tool pages deploy --branch=main --commit-dirty=true
echo "== เสร็จแล้ว ผู้เล่นที่เปิดเกมอยู่จะได้เวอร์ชันใหม่ตอนจบรอบ"
