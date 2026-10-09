# HANDOFF — ศึกยานต่างดาว (Neon Star Shooter)

อัปเดตล่าสุด: 2026-10-09 (หลัง deploy DANGER ZONE + รูหนอน) · เริ่มแชทใหม่ให้อ่านไฟล์นี้ก่อน

## ภาพรวม
เกมยิงยานอวกาศแนวตั้ง ธีมนีออนเวกเตอร์ เล่นบนเบราว์เซอร์ทั้งคอมและมือถือ
- **โค้ดเกม:** ไฟล์เดียว `public/index.html` (Phaser 3.80.1 จาก cdnjs) วาดภาพและสร้างเสียงด้วยโค้ดทั้งหมด
- **Backend:** Cloudflare Pages Functions `functions/api/[[path]].js` + D1 (binding `DB`, ฐานข้อมูล `star-shooter`)
- **เว็บจริง:** https://star-shooter.pages.dev · **GitHub:** https://github.com/marchy-git/star-shooter (branch `main`)
- **ผู้ commit:** `marchy-git` <rcash.claude@gmail.com> (local git config) · ท้าย commit ใส่ `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## กฎที่ผู้ใช้ตั้งไว้ (สำคัญที่สุด)
1. **ห้าม deploy หรือ push เอง** ต้องรอผู้ใช้สั่งในข้อความนั้นๆ (คำสั่งครั้งก่อนไม่นับต่อ) ถ้าไม่ได้สั่ง: แก้ + ทดสอบ local + commit บนเครื่อง แล้วบอกว่ารอคำสั่ง deploy
2. **อัปเดต `README.md` ให้เป็นปัจจุบันเสมอ** ทุกครั้งที่ทำงานเสร็จ · **`HANDOFF.md` ทำเฉพาะตอนผู้ใช้สั่ง** (เช่นก่อนย้ายแชท)
3. **สีกระสุนฝั่งเราห้ามแดง/ชมพู** เพราะกระสุนศัตรูเป็นแดง (ใช้ ฟ้า/ม่วง/เขียว/ทอง)
4. งานภาพ/ดีไซน์ใหม่: ทำ **หน้าพรีวิวให้ผู้ใช้เลือกก่อน** (ไฟล์ใน `design/`) แล้วค่อยใส่เกม
5. ผู้ใช้ชอบให้เสนอทางเลือก + บอกข้อแนะนำ แล้วตอบ "เอาตามแนะนำ"

## สถานะตอนนี้
- **เว็บจริง = commit `fea1dce`** (push แล้ว) มีทุกอย่างในหัวข้อ "ระบบในเกม" ยกเว้นระบบสมบัติ
- **บนเครื่องเท่านั้น (ยังไม่ push/deploy):**
  - `0c3965f` ระบบสมบัติ 10 ชิ้น — ผู้ใช้บอก **ยังไม่เอาขึ้น ต้องปรับ UX/UI ก่อน**
  - commit อัปเดต HANDOFF/README ฉบับนี้
- **ตารางอันดับรีเซ็ตแล้ว** (2026-10-09) สำรองของเดิมไว้ที่ `backups/players-before-reset-2026-10-09.json` (ไม่ขึ้น git)

### ถ้าจะ deploy โดยไม่เอาสมบัติ (ทำมาแล้ว 3 รอบ)
งานใหม่ๆ commit ต่อจาก commit สมบัติ จึงต้องแยก:
1. `git checkout -b release origin/main` แล้ว `git cherry-pick` เฉพาะ commit ที่ไม่ใช่สมบัติ
2. HANDOFF ชนทุกครั้ง: ใช้ `git checkout --ours HANDOFF.md` แล้วเขียนสถานะใหม่ทีหลัง
3. `index.html` ชนตรงที่อ้าง `this.tr` / `trv()` / `TREASURES` / `crystalShield` → ตัดส่วนสมบัติออก เก็บส่วนอื่น · ตรวจด้วย `grep "this\.tr\.\|trv(\|TREASURE"` ต้องว่าง
4. syntax check + ทดสอบในเกม → `./deploy.sh` → `git push origin release:main`
5. สร้าง main ใหม่ = release + commit สมบัติ: `git checkout -B main release` แล้ว `git checkout <main เดิม> -- public/index.html "functions/api/[[path]].js"` + เอาหัวข้อสมบัติกลับเข้า HANDOFF แล้ว commit (ตรวจ `git diff <main เดิม> main -- public functions` ต้องว่าง)

## วิธีทำงาน (เครื่องไม่มี Node.js ใช้ Docker)
โฟลเดอร์ `D:\OnAir\space-shooter`
- **รัน local:** `docker compose up dev` → http://localhost:8788 (มือถือ Wi-Fi เดียวกัน: http://192.168.1.176:8788) · แก้ `functions/` ต้อง `docker compose restart dev`
- **schema local:** `docker compose run --rm tool d1 execute star-shooter --local --file=schema.sql`
- **deploy (ใช้สคริปต์นี้เสมอ):** `./deploy.sh` → รัน schema remote → ประกาศในเกม (แถบเลื่อนวิ่งผ่าน 2 ครั้ง ตอนเหลือ 1 นาที และ 30 วิ) → รอ 60 วิ → เขียน `public/version.json` → deploy → ปิดประกาศ · `./deploy.sh 0` = ทันที
  - deploy ไม่ทำให้ใครหลุด เกมเห็น `version.json` เปลี่ยนแล้วโหลดใหม่ตอนผู้เล่นจบรอบ (รอส่งคะแนนก่อน)
  - token อยู่ใน `.env` (อย่าแสดง/commit) · wrangler 3.80 มี warning ว่าเก่า ใช้ได้ปกติ
- **syntax check:** ดึง `<script>` สุดท้ายของ index.html ไป `.wrangler/check.js` แล้ว
  `MSYS_NO_PATHCONV=1 docker run --rm -v "D:/OnAir/space-shooter/.wrangler:/w" node:20-bookworm-slim node --check /w/check.js` (API: copy ไป `.wrangler/api.mjs` แล้ว check แบบเดียวกัน)
- **ทดสอบใน Browser pane ของแอป:**
  - pane ซ่อนแล้วเกมไม่เดิน → หมุนลูปเอง `App.game.loop.step(t)` (t += 16.7) · viewport emulation ทำภาพครอป → `resize_window` preset desktop
  - **ห้ามแทน `Math.random` ด้วยค่าคงที่** ระหว่างเกมรัน (Phaser ใช้สร้างชื่อ texture ของข้อความ → ชื่อซ้ำ → ข้อความทั้งเกมพัง) รูหนอนใช้ `enterPortal(true/false)` บังคับแทน
  - ตั้งข้อมูลบัญชีทดสอบ: `docker compose run --rm tool d1 execute star-shooter --local --command "UPDATE users SET data=json_set(data,'$.coins',20000) WHERE username_key='...'"` (บัญชีบนเครื่องมีคริสตัล 20,000 อยู่แล้ว)
- **หน้าพรีวิวดีไซน์ (`design/*.html`):** เปิดตรงๆ ได้ แต่ใน pane ให้ copy ไป `public/dev/` ชั่วคราว ดูที่ localhost แล้วลบทิ้ง (อย่าให้ `public/dev` ติด deploy)
- **แก้โค้ดใหญ่:** เขียนสคริปต์ Python (`str.replace` + `assert count==1`) ใน scratchpad แล้วรันด้วย `python -I`

## โครงสร้างไฟล์
```
public/index.html          ตัวเกมทั้งหมด (CSS + HTML UI + JS)
public/manifest.webmanifest, icon-*.png   เพิ่มลงหน้าจอโฮม
public/version.json        เลขเวอร์ชัน (deploy.sh เขียน · ไม่ขึ้น git)
functions/api/[[path]].js  API ทั้งหมด (ดูรายการด้านบนของไฟล์)
schema.sql                 players, users, sessions, runs, notice, run_bosses
deploy.sh                  deploy พร้อมประกาศในเกม
design/                    หน้าพรีวิวดีไซน์ (ไม่ขึ้นเว็บ): evo, bullet, player-color, maxlv, gimmick
backups/                   สำรองข้อมูล (ไม่ขึ้น git)
wrangler.toml              name=star-shooter, D1 id f0b29469-0512-4905-82b1-a738e70b6fa2
Dockerfile, docker-compose.yml   wrangler ใน Docker (service: dev, tool)
```

## ระบบในเกม
**บัญชี + กันโกง** — ต้องล็อกอินก่อนเล่น · ข้อมูลใน `users.data` (JSON: coins, tickets, chars{id:lv}, ship, best, pity, shards, evo [+ treasures, equip บนเครื่อง]) **server แก้เท่านั้น** เกมเรียก `Save.act(path)` แล้วรับ data ใหม่
- รอบเล่น: `POST /api/run` ได้ runId → จบเกม `POST /api/score` (runId ใช้ครั้งเดียว) · เพดาน: รอบ ≤ 1+วิ/30, คะแนน ≤ 50k+20k×วิ และ ≤ 600k×รอบ+400k (เกิน=ปฏิเสธ), คริสตัล ≤ 6×วิ, ตั๋ว ≤ 5×รอบ และ ≤ 1+วิ/8 (เกิน=ตัด)
- ค่าใน API ต้องตรงกับเกม: `SHIP_TIER`, `TIERS`, `lvCost`, `PITY_*`, `SHARD_*`, `BAD_WORDS`
- หยุดเกมแล้วกดเริ่มใหม่/หน้าแรก ถ้ามีแต้ม = จบรอบ ขึ้นสรุปผลและบันทึกคะแนน

**ลำดับด่าน (วนไม่รู้จบ)** — wave 1–4 → **DANGER ZONE** → WARNING → บอส → ด่าน CHALLENGE → รอบถัดไป (ฉากเปลี่ยน 5 แบบ) · รอบแรกง่ายกว่า (getter `easy`)
- **DANGER ZONE** (`startPreStage`): 20 วิ (รอบแรก 14) สุ่มจาก ทางเดิน/ประตูเลเซอร์/ม่านกระสุน/เขตเตือนภัย ผ่านได้ 3000×รอบ
- **รูหนอน** (`spawnPortal/enterPortal/exitPortal`): รอบละครั้ง 60% โผล่หลังเคลียร์ wave 2–4 ค้าง 6 วิ · ข้างใน 20 วิ
  - ดี 60%: ธีมม่วง ยานโบนัส `bonusShip` (ยิงไม่ตาย 5×รอบ/นัด) + กิมมิค ไม่มีกระสุนศัตรู · ไม่ชนเลย = แต้ม x2 (ชนแม้เกราะกัน = อด)
  - ไม่ดี 40%: ธีมส้มแดง อุกกาบาต + ยานพุ่งชน + กิมมิค · รอดได้คริสตัล + ตั๋ว 30%
- **สิ่งกีดขวาง 7 แบบ** (`startHazard/updateHazard/clearHazard`, ยิงไม่แตก แตะ = `playerHit`, ความยาก `hz.d` ตามรอบ): corridor ทางขั้นบันได, gates, curtain (กระสุนศัตรูจริง), zones, mines (กระสุนกระเด็น ลอยเข้าหายาน), blackhole (ดูด), rocks (บังกระสุนเรา) · ระหว่างนี้คอมโบไม่หลุดเอง
- **ด่าน CHALLENGE**: มอน 40 ตัว 5 กลุ่ม ห่างกัน `BONUS_GROUP_GAP` 1.5 วิ · นับด้วย data `inBonus` + ตัวกันค้าง · ยิงไม่เข้าตอนนอกจอ/โผล่ใหม่ `BONUS_GRACE_MS` · คะแนน 100×รอบ/ตัว + PERFECT 6000×รอบ

**อาวุธ (ซ้อนกันได้)** — `this.mods` แทนอาวุธเดียว: กระจาย = พัด, เลเซอร์ = ทะลุ (มีทั้งคู่ = เลเซอร์พัด 60%/ลำ), ติดตาม = จรวดเสริม (รวมกับอื่น: น้อยลง แรง 75%) · เก็บแบบใหม่ = รวม + เลเวล +1 · ตาย: หลายแบบเสียแบบล่าสุด / แบบเดียวเลเวล −1 · ครบ 3 กระสุนจางลง
- เลเวล 1–5 จำนวนนัด, 6–10 โอเวอร์ชาร์จ (แรง +20%/ขั้น กระสุนทอง)
- **Lv10:** เลเซอร์ = ลำแสงชาร์จ (`updateBeam/beamTick`, ดาเมจเท่าเลเซอร์ Lv10 เดิม) · จรวด = ม่วงนีออนหางรุ้ง
- สี: เลเซอร์ม่วง `LASER_COLOR`, พลาสมามิธิค `PLASMA_COLOR`, FEVER `feverShotColor` (ฟ้า-ม่วง)
- **กระสุนศัตรู:** หัวลูกศรแดงขอบดำมีหาง ชี้ทิศวิ่ง hitbox วงกลม r7 ที่หัว · ศัตรูนอกจอยิงไม่โดน จรวดเล็งเฉพาะในจอ

**คะแนน** — ตัวคูณคอมโบตัน x3 (`COMBO_MUL_MAX`) แล้วคูณ FEVER x2 / ON AIR x2 (สูงสุด x12) · ตัวอักษร O N A I R ครบ = ON AIR

**บอส 3 ตัว** (เลือดฐาน 150/210/180, +60%/รอบ และ +60%/รอบเพิ่มตั้งแต่รอบ 3) ยานแม่ปักเสาฐานทัพ · ป้อมปราการปักเสาฮีล · ดาวพิฆาตแช่น้ำแข็ง · รอบ 4+ ใช้ 2 กลไก

**ยาน 10 ลำ** ได้จากตั๋วสุ่ม (49.5/32/14/4/0.5% การันตีเอพิก 10 ครั้ง ตำนาน 40) อัปเลเวลด้วยคริสตัล
| ระดับ | ยาน |
|---|---|
| ธรรมดา | สายฟ้า, ดาวเหล็ก |
| หายาก | แม็กเนโต (เกราะกันหลายครั้ง + อมตะหลังแตก 1–2 วิ), เหยี่ยว (เก็บชีวิต/เกราะ → อมตะ), ดาวหาง (3%/Lv อาวุธ+1, ตันแล้ว OVERDRIVE), พายุ (ฆ่าครบได้ดาวอมตะ, ระเบิดทั้งจอ บอส 1%/Lv) |
| เอพิก | แฟนทอม, ปริซึม |
| ตำนาน | โนวา |
| มิธิค | ฟีนิกซ์ |

**แปลงร่าง (ร่าง 2)** — ยานฟ้า/ม่วง/ทอง/แดง: Lv10 + เศษยานครบ 5 → `POST /api/evolve` · เศษได้ตอนล้มบอส (server สุ่ม 2% `POST /api/boss`, จำกัดตามเวลาด้วย `run_bosses`) · ขายเศษ 80/180/400/1,000 (`/api/shard/sell`) · ร่าง 2 สกิลเท่า Lv13 ภาพ `ship2_*` วงแหวน+แสง+ไอพ่นคู่ กระสุนหัวเพชรสีประจำยาน (`EVO[id].shot`) + กระสุนปีก · scene `Evolve` เล่นฉากแปลงร่าง/ดูตัวอย่าง

**ไอเท็ม** — อาวุธ 3, เกราะ, อมตะ (Space/ปุ่มดาว), แม่เหล็ก, ชีวิต, ตั๋ว · ครบ 3 อาวุธ + Lv10 แล้ว อาวุธ 75% กลายเป็นคริสตัล · ตั๋วตอนเคลียร์ wave 15%

**อื่นๆ** — ป้ายคู่แข่ง/แจ้งแซง · การ์ดแชร์ 1080×1350 · หยุดเกม P/Esc นับถอยหลัง 3 วิ · คีย์บอร์ดใช้ได้ทั้งแป้นอังกฤษ/ไทย

## ระบบสมบัติ (บนเครื่องเท่านั้น `0c3965f`)
ปุ่ม "สมบัติ" หน้าแรก · หีบ 1,500 คริสตัล สุ่ม 1 ใน 10 (ซ้ำ = อัปขั้น สูงสุด 3, ขั้นเต็มคืน 500) · ใส่ 2 ช่อง · `POST /api/chest`, `POST /api/equip` · กระเป๋าคริสตัลคิดโบนัสที่ server
ขนนกคืนชีพ, หัวใจสำรอง, แบตเตอรี่สำรอง, โล่ผลึก, เข็มทิศล่าบอส, เลนส์เวลา, นาฬิกาทราย, ดาวนำโชค, กระจกสะท้อน, กระเป๋าคริสตัล (`TREASURES`, `applyTreasures`, `trv(id)`)
**ค้าง:** ปรับ UX/UI · แหล่งได้สมบัติอื่น · ผลต่อความยุติธรรมของตารางอันดับ

## ค่าที่ปรับบ่อย (บนสุดของ script ใน index.html)
`WAVES_PER_LOOP`, `COMBO_MUL_MAX`, `FEVER_AT`, `BOSS_HP_GROW(_LATE)`, `MAXED_WEAPON_TO_COIN`, `WAVE_TICKET_CHANCE`, `BONUS_GROUP_GAP`, `BONUS_GRACE_MS`, `LASER_SPREAD_DMG`, `MISSILE_COMBO_DMG`, `BEAM_VOLLEY_DMG`, `PRE_MS`, `PORTAL_*`, `SHARD_NEED`, `EVO_LV`, `BOSSES`, `ITEMS`, `TIERS`, `SHIPS`, `EVO`

## เรื่องที่ตัดสินใจแล้ว / ข้อควรรู้
- ยานไม่ต้องเอียงตามทิศ · ยานธรรมดาแปลงร่างไม่ได้
- กันโกงทำระดับหนึ่ง: ยังโกงแบบ "รอเวลาแล้วส่งตัวเลขใต้เพดาน" ได้ จะกันหมดต้องให้ server จำลองเกม (ไม่คุ้ม)
- บัญชี peaw (ชื่อ "123456") ที่ผู้ใช้เคยเจอใน Chrome: มีคนล็อกอินด้วยรหัสจริง ไม่ใช่บัค (ผู้ใช้หาปุ่มออกจากระบบเจอแล้ว)
- โค้ดเก่าที่ไม่ใช้แล้ว: `stormRing`, `dashUntil`, `superMagnetUntil` ปลอดภัย
- บัญชีทดสอบอยู่ใน D1 บนเครื่องเท่านั้น

## งานที่อาจทำต่อ (ผู้ใช้ยังไม่ได้สั่ง)
- **กันบอทเล่นทั้งวัน:** เสนอแล้ว แนะนำ (1) ลดรางวัลตามเวลาเล่นต่อวัน + (4) ตารางอันดับรายสัปดาห์ · ยังไม่ได้เลือก
- ปรับ UX/UI ระบบสมบัติ แล้ว deploy
- ล็อกอินด้วย Google · บันทึกสถิติว่าตายที่ wave ไหน · อัปเกรด wrangler 4
- ทำปุ่มออกจากระบบให้เด่นขึ้น / ซิงก์การล็อกอินระหว่างแท็บ (เสนอแล้ว ผู้ใช้บอกเจอปุ่มแล้ว)
