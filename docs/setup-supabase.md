# ตั้งค่าเผยแพร่เว็บและระบบบัญชี

ขั้นตอนเหล่านี้ต้องใช้บัญชีของเจ้าของโปรเจคเอง ทำครั้งเดียว ถ้ายังไม่ทำ เว็บก็ใช้งานได้ครบ แค่ไม่มีปุ่มบัญชี (ไอคอนรูปคน) ให้ล็อกอิน

เหตุผลที่เลือก Supabase และเก็บข้อมูลในเครื่องเป็นหลัก ดูได้ที่ [ADR 0002](adr/0002-supabase-local-first.md)

## 1. เผยแพร่บน GitHub Pages

1. สร้าง repository บน GitHub แล้ว push โปรเจคนี้ขึ้นไป (branch `main`)
2. ใน repository ไปที่ **Settings → Pages** ตรง **Source** เลือก **GitHub Actions**
3. ทุกครั้งที่ push ขึ้น `main` workflow `.github/workflows/pages.yml` จะเผยแพร่โฟลเดอร์ `web/` ให้เอง
4. ที่อยู่เว็บจะเป็น `https://<ชื่อผู้ใช้>.github.io/<ชื่อ repo>/` จดไว้ใช้ในขั้นต่อไป

## 2. สร้างโปรเจค Supabase

1. สมัครที่ [supabase.com](https://supabase.com) แล้วสร้างโปรเจคใหม่ เลือก region ที่ใกล้ที่สุด เช่น Singapore
2. เปิด **SQL Editor** วางเนื้อหาทั้งหมดจาก `supabase/schema.sql` แล้วกด **Run**
3. ไปที่ **Project Settings → API** คัดลอก **Project URL** และ **anon public key** ไปใส่ใน `web/config.js`

   ```js
   window.TT_CONFIG = {
     supabaseUrl: "https://xxxx.supabase.co",
     supabaseAnonKey: "eyJ...",
   };
   ```

   สองค่านี้เปิดเผยได้ ข้อมูลของแต่ละคนปลอดภัยเพราะ row level security ที่ตั้งไว้ใน `schema.sql` **ห้ามใช้ service_role key ในเว็บเด็ดขาด**

4. ไปที่ **Authentication → URL Configuration**
   - **Site URL** ใส่ที่อยู่เว็บจากขั้นที่ 1
   - **Redirect URLs** ใส่ที่อยู่เว็บเดียวกัน และถ้าจะทดสอบในเครื่อง ให้เพิ่ม `http://localhost:8000/` ด้วย

## 3. ล็อกอินด้วยอีเมลและรหัสผ่าน

1. **Authentication → Providers → Email** ต้องเปิด **Enable Email provider** และ **Confirm email** ไว้
2. ระบบส่งอีเมลที่ Supabase มีให้ส่งได้เฉพาะอีเมลของทีมโปรเจค จึงต้องใช้ Gmail ส่งแทน:
   1. สร้างบัญชี Gmail ใหม่สำหรับโปรเจคนี้โดยเฉพาะ
   2. เปิด **การยืนยันแบบ 2 ขั้นตอน** ของบัญชีนั้น แล้วสร้าง **App password** ที่ [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
   3. ใน Supabase ไปที่ **Project Settings → Authentication → SMTP Settings** เปิด **Enable Custom SMTP** แล้วใส่
      - Host `smtp.gmail.com` · Port `465`
      - Username = อีเมล Gmail นั้น · Password = App password
      - Sender email = อีเมล Gmail นั้น · Sender name = `ฝึกพิมพ์ไทย`
3. (ถ้าต้องการ) แปลอีเมลยืนยันและอีเมลรีเซ็ตรหัสผ่านเป็นภาษาไทยที่ **Authentication → Email Templates**

## 4. ล็อกอินด้วย Google

1. เปิด [Google Cloud Console](https://console.cloud.google.com) สร้างโปรเจคใหม่
2. **APIs & Services → OAuth consent screen** เลือก **External** ใส่ชื่อแอป `ฝึกพิมพ์ไทย` และอีเมลติดต่อ แล้วกด Publish
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**
   - **Authorized redirect URIs** ใส่ `https://<project-ref>.supabase.co/auth/v1/callback` (ดูค่าที่ถูกต้องได้ในหน้าตั้งค่า Google ของ Supabase)
4. คัดลอก **Client ID** และ **Client secret** ไปใส่ใน Supabase ที่ **Authentication → Providers → Google** แล้วเปิดใช้งาน

## 5. กันโปรเจคถูกพัก

Supabase แพ็กเกจฟรีจะพักโปรเจคถ้าไม่มีการใช้งาน 7 วัน workflow `.github/workflows/keepalive.yml` จะอ่านข้อมูลหนึ่งแถวทุก 3 วันเพื่อกันไว้

1. ใน repository ไปที่ **Settings → Secrets and variables → Actions** เพิ่ม secret สองตัว
   - `SUPABASE_URL` = Project URL
   - `SUPABASE_ANON_KEY` = anon public key
2. ไปที่แท็บ **Actions** เลือก **keep Supabase awake** แล้วกด **Run workflow** หนึ่งครั้งเพื่อทดสอบว่าผ่าน

## 6. ทดสอบ

1. commit `web/config.js` แล้ว push รอ workflow เผยแพร่เสร็จ
2. เปิดเว็บ จะเห็นไอคอนรูปคนที่มุมขวาบน ลองสมัครด้วยอีเมล ล็อกอินด้วย Google และฝึกหนึ่งรอบ แล้วเปิดในอีกเครื่องเพื่อดูว่าข้อมูลตามมา
3. ถ้าจะทดสอบในเครื่องก่อน ให้รัน `python -m http.server 8000` ในโฟลเดอร์ `web/` แล้วเปิด `http://localhost:8000/` (ล็อกอินไม่ทำงานเมื่อเปิดไฟล์ตรงๆ ผ่าน `file://`)
