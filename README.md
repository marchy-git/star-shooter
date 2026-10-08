# ศึกยานต่างดาว

เกมยิงยานอวกาศบนเบราว์เซอร์ เล่นฟรี ไม่ต้องล็อกอิน มีตารางอันดับออนไลน์
ใช้ Cloudflare ทั้งหมด: **Pages** ฝากเว็บ, **Pages Functions** เป็น API, **D1** เก็บคะแนน

```
space-shooter/
├─ public/index.html          ตัวเกมทั้งหมด (ไฟล์เดียว)
├─ functions/api/[[path]].js  API ตารางอันดับ (/api/leaderboard, /api/score)
├─ schema.sql                 โครงสร้างตารางใน D1
├─ wrangler.toml              ตั้งค่า Cloudflare
├─ Dockerfile, docker-compose.yml   ใช้ wrangler ผ่าน Docker โดยไม่ต้องลง Node.js
```

## ทดสอบในเครื่อง

```bash
docker compose up dev
```

แล้วเปิด http://localhost:8788 ทุกอย่างทำงานเหมือนของจริง รวมถึง D1 จำลอง (ข้อมูลอยู่ในโฟลเดอร์ `.wrangler/`)

แก้ `public/index.html` แล้วกด refresh ได้เลย แต่ถ้าแก้ไฟล์ใน `functions/` ต้อง restart ก่อน (บน Windows ตัว Docker ไม่เห็นว่าไฟล์เปลี่ยน):

```bash
docker compose restart dev
```

## Deploy ขึ้นเว็บจริง (ทำครั้งแรกครั้งเดียว)

### 1. เตรียมรหัสเข้าใช้ Cloudflare

1. เข้า Cloudflare dashboard → My Profile → API Tokens → Create Token → Create Custom Token
2. ให้สิทธิ์ 2 อย่าง ระดับ Account: **Cloudflare Pages: Edit** และ **D1: Edit**
3. ก๊อปไฟล์ `.env.example` เป็น `.env` แล้วใส่ token กับ Account ID (Account ID ดูได้ที่หน้า Workers & Pages ด้านขวา)

ไฟล์ `.env` ห้ามส่งขึ้น Git (มีใน `.gitignore` แล้ว)

### 2. สร้างฐานข้อมูล D1

```bash
docker compose run --rm tool d1 create star-shooter
```

คำสั่งนี้จะแสดง `database_id` ให้ก๊อปไปใส่แทนค่าศูนย์ใน `wrangler.toml` แล้วสร้างตาราง:

```bash
docker compose run --rm tool d1 execute star-shooter --remote --file=schema.sql
```

### 3. สร้างโปรเจกต์ Pages และ deploy

```bash
docker compose run --rm tool pages project create star-shooter --production-branch main
```

```bash
docker compose run --rm tool pages deploy
```

เสร็จแล้วจะได้ลิงก์ประมาณ `https://star-shooter.pages.dev` ส่งให้เพื่อนเล่นได้เลย

## อัปเดตเกมครั้งต่อไป

แก้ไฟล์แล้วรันแค่คำสั่งเดียว:

```bash
docker compose run --rm tool pages deploy
```

## ดูหรือจัดการคะแนน

```bash
docker compose run --rm tool d1 execute star-shooter --remote --command "SELECT name, best, games FROM players ORDER BY best DESC LIMIT 20"
```

ลบชื่อที่ไม่เหมาะสม (แทน `ชื่อ` ด้วยชื่อจริงในตาราง):

```bash
docker compose run --rm tool d1 execute star-shooter --remote --command "DELETE FROM players WHERE name = 'ชื่อ'"
```

## กันโกง (ระดับพื้นฐาน)

- ผู้เล่นแต่ละเครื่องมีรหัสลับใน localStorage ฝั่ง server เก็บแค่ SHA-256 ของรหัสนี้ คนอื่นจึงส่งคะแนนแทนไม่ได้
- ส่งคะแนนได้ไม่ถี่กว่า 8 วินาทีต่อคน และคะแนนต้องไม่เกินเพดานตามรอบที่ไปถึง
- เกมฝั่งเบราว์เซอร์ถูกแก้โค้ดได้เสมอ ถ้าเจอคะแนนแปลกให้ลบด้วยคำสั่งด้านบน

## ข้อจำกัด

- เหรียญ ยาน และอัปเกรดเก็บใน localStorage ของแต่ละเบราว์เซอร์ ล้างข้อมูลเว็บหรือเปลี่ยนเครื่องแล้วจะหาย
- ปุ่มคัดลอกรูปใช้ได้บน Chrome, Edge, Safari รุ่นใหม่ (ต้องเปิดผ่าน https) ถ้าคัดลอกไม่ได้จะเปิดรูปให้กดค้างบันทึกแทน
