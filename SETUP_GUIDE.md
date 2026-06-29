# Panduan Setup — Dashboard K3 Factory 2026 (Supabase + Netlify)

Panduan ini untuk memindahkan dashboard dari file HTML statis menjadi
aplikasi online dengan database (Supabase), hosting (Netlify), PIN
keamanan (Viewer vs Admin), dan form CRUD langsung di dashboard.

Anda sudah punya akun Supabase & Netlify, jadi panduan ini langsung ke
langkah konfigurasinya.

---

## 1. Setup Database di Supabase

1. Buka project Supabase Anda → menu **SQL Editor** → **New query**.
2. Buka file `supabase/schema.sql`, copy semua isinya, paste ke SQL
   Editor, lalu klik **Run**.
   - Ini membuat tabel `kecelakaan` dan `jam_kerja_bulanan`, plus
     mengisi data jam kerja Jan–Jun 2026.
3. Buka file `supabase/seed_data.sql`, copy semua isinya, paste ke
   query baru, klik **Run**.
   - Ini memasukkan 56 data kecelakaan lama (migrasi dari dashboard
     HTML sebelumnya) ke database.
4. Cek hasilnya: menu **Table Editor** → pilih tabel `kecelakaan` →
   harus muncul 56 baris data.

### Ambil kredensial Supabase yang dibutuhkan nanti

Masih di project Supabase Anda:

1. Klik ikon ⚙️ **Project Settings** → **API**.
2. Catat 2 hal ini (akan dipakai di langkah 3):
   - **Project URL** → contoh: `https://abcdefgh.supabase.co`
   - **service_role key** (di bagian "Project API keys", BUKAN yang
     "anon public") → ini kunci rahasia, jangan pernah dibagikan atau
     dimasukkan ke kode yang bisa dilihat publik.

⚠️ **Penting soal keamanan:** `service_role key` ini punya akses penuh
ke database tanpa terikat aturan RLS. Kunci ini **hanya** akan kita
taruh di Environment Variables Netlify (lihat langkah 3), tidak pernah
ditaruh di file HTML/JS yang dikirim ke browser pengguna.

---

## 2. Push Project ke GitHub (atau langsung drag-drop ke Netlify)

Netlify butuh source code untuk di-deploy. Ada 2 cara:

### Cara A — Drag & drop (paling cepat, tanpa GitHub)
1. Compress folder project ini jadi `.zip` ATAU langsung buka dashboard
   Netlify Anda.
2. Buka **Netlify Dashboard** → **Add new site** → **Deploy manually**.
3. Drag folder project (yang berisi `netlify.toml`, `netlify/`, dan
   `public/`) ke area upload.
4. Tunggu proses deploy selesai.

> Catatan: dengan cara drag & drop, setiap kali Anda mengubah
> `index.html` atau function-nya, Anda harus upload ulang manual.
> Kalau ingin auto-deploy setiap ada perubahan, pakai Cara B.

### Cara B — Lewat GitHub (auto-deploy)
1. Buat repository baru di GitHub, upload semua isi folder project ini.
2. Di Netlify: **Add new site** → **Import an existing project** →
   pilih GitHub → pilih repository tadi.
3. Build settings akan otomatis terbaca dari `netlify.toml` (publish
   folder `public`, functions folder `netlify/functions`). Klik **Deploy**.

---

## 3. Set Environment Variables di Netlify

Ini langkah **paling penting** — tanpa ini, dashboard tidak akan bisa
terhubung ke Supabase maupun memvalidasi PIN.

1. Di Netlify Dashboard, masuk ke site yang baru dideploy.
2. Buka **Site configuration** → **Environment variables** → **Add a
   variable** (atau **Add environment variables**).
3. Tambahkan 4 variable berikut satu per satu:

| Key | Value | Contoh |
|---|---|---|
| `SUPABASE_URL` | Project URL dari Supabase (langkah 1) | `https://abcdefgh.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key dari Supabase (langkah 1) | `eyJhbGci...` (panjang) |
| `PIN_ADMIN` | PIN untuk akses penuh (tambah/edit/hapus) | `K3admin99` |
| `SESSION_SECRET` | Teks rahasia acak (bukan PIN), untuk menandatangani token sesi | `g7$kP9!xQ2mZ...` (buat sendiri, sembarang, makin panjang & random makin aman) |

   **Tips membuat `SESSION_SECRET`:** ketik sembarang campuran huruf
   besar/kecil/angka/simbol sepanjang minimal 24 karakter. Ini tidak
   perlu diingat/diketik manual oleh siapa pun — hanya dibaca otomatis
   oleh server.

   > **Catatan:** PIN Viewer **tidak** diset di sini. PIN Viewer awal
   > sudah ditentukan lewat `schema.sql` (langkah 1, bagian "2c PIN
   > VIEWER AWAL" — defaultnya `123456`, sebaiknya diganti sebelum
   > menjalankan query). Setelah itu, PIN Viewer diganti lewat tombol
   > di dashboard (lihat bagian 6 di bawah), bukan lewat Netlify.

4. Setelah semua variable tersimpan, **redeploy** site (Netlify →
   **Deploys** → **Trigger deploy** → **Deploy site**), supaya
   environment variables yang baru ditambahkan terpakai oleh function.

---

## 4. Tes Dashboard

1. Buka URL Netlify Anda (contoh: `https://nama-site-anda.netlify.app`).
2. Anda akan disambut layar PIN. Coba masukkan PIN Viewer awal Anda
   (yang diisi di `schema.sql`, default `123456` kalau belum diganti) →
   harus masuk ke dashboard, tapi **tidak ada** tombol "+ Tambah
   Kasus" atau "⚙️ Jam Kerja", dan **tidak ada** tombol Edit/Hapus
   di tabel.
3. Klik **Keluar**, lalu masuk lagi dengan `PIN_ADMIN` → semua
   tombol CRUD harus muncul (FAB "+ Tambah Kasus" di kanan bawah,
   tombol Edit/Hapus di setiap baris, tombol "⚙️ Jam Kerja" di
   header).
4. Coba tambah 1 kasus dummy lewat form, lalu cek:
   - Apakah KPI (FR, SR, jumlah LTI, HKO) di bagian atas ikut berubah?
   - Apakah kasus baru muncul di tabel "Log Lengkap"?
   - Kalau tanggalnya termasuk 7 hari terakhir, apakah muncul juga di
     "Highlight Kasus Minggu Ini"?
5. Hapus kasus dummy tadi untuk membersihkan data testing.

---

## 5. Cara Pakai Sehari-hari

### Sebagai Admin (input data mingguan)
1. Buka URL dashboard, masuk dengan PIN Admin.
2. Klik **+ Tambah Kasus** (pojok kanan bawah).
3. Isi tanggal, nama, sub-departemen, jenis kejadian, lokasi,
   kronologi, dan HKO hilang (hari kerja hilang).
   - Kalau HKO ≥ 0,5 → otomatis terhitung sebagai **LTI**.
   - Kalau HKO = 0 → otomatis terhitung sebagai **Non-LTI**.
4. Klik **Simpan** → seluruh dashboard (KPI, chart, tabel) langsung
   ter-update otomatis.

### Update Jam Kerja Bulanan
1. Sebagai Admin, klik **⚙️ Jam Kerja** di header.
2. Untuk bulan yang sudah ada, edit angkanya lalu klik **Simpan**.
3. Untuk bulan baru (misal mulai Juli), pilih bulan di bagian "Tambah
   bulan", isi jam kerja, centang "Estimasi" kalau datanya masih
   sementara, klik **Tambah**.
4. FR dan SR seluruh dashboard akan otomatis dihitung ulang berdasarkan
   jam kerja yang sudah diisi ini.

### Sebagai Viewer (tim/atasan yang hanya perlu melihat)
1. Bagikan URL dashboard + PIN Viewer.
2. Mereka bisa melihat semua KPI, chart, dan log, tapi tidak bisa
   mengubah data apa pun.

### Sesi Login
PIN hanya perlu dimasukkan sekali per sesi browser. Begitu tab/browser
ditutup, sesi otomatis hilang dan PIN harus dimasukkan lagi saat
dibuka kembali (sesuai permintaan Anda — bukan login permanen).

---

## 6. Mengganti PIN di Kemudian Hari

PIN Viewer dan PIN Admin punya cara ganti yang berbeda — ini disengaja,
supaya PIN Viewer (yang lebih sering dibagikan ke banyak orang) bisa
dirotasi cepat tanpa ribet, sementara PIN Admin tetap paling aman.

### PIN Viewer — ganti sendiri lewat dashboard, kapan saja
1. Login sebagai Admin di dashboard.
2. Klik **🔄 Ganti PIN Viewer** di header.
3. Klik **Generate PIN Baru** → sistem membuat PIN 6 digit acak.
4. PIN baru ditampilkan **satu kali saja** di layar — langsung catat
   atau screenshot untuk dibagikan ke tim.
5. PIN Viewer **lama otomatis tidak berlaku lagi** begitu PIN baru
   dibuat (tidak ada masa tenggang).
6. Cocok dipakai rutin (misalnya tiap minggu) untuk membatasi risiko
   PIN yang sudah tersebar terlalu luas.

> PIN Viewer tidak disimpan sebagai teks biasa di mana pun — hanya
> hash (sidik digital satu arah) yang tersimpan di Supabase. Bahkan
> dengan akses ke database, PIN aslinya tidak bisa dibaca ulang;
> satu-satunya cara melihatnya adalah generate baru.

### PIN Admin — ganti lewat Netlify (sengaja lebih sulit, untuk keamanan ekstra)
1. Netlify → **Site configuration** → **Environment variables**.
2. Edit value `PIN_ADMIN`.
3. **Redeploy** site agar perubahan berlaku (lihat langkah 3 bagian
   akhir). Tanpa redeploy, PIN lama masih akan diterima karena
   function belum membaca ulang environment variable yang baru.

---

## 7. Struktur File Project Ini

```
project/
├── netlify.toml                   ← konfigurasi routing & build Netlify
├── public/
│   └── index.html                 ← dashboard utama (PIN gate + UI + chart + form CRUD)
├── netlify/functions/
│   ├── verify-pin.js              ← cek PIN, keluarkan token sesi
│   ├── _auth.js                   ← helper validasi token (dipakai data.js)
│   └── data.js                    ← satu-satunya pintu CRUD ke Supabase
└── supabase/
    ├── schema.sql                 ← bikin tabel + RLS (jalankan sekali di awal)
    └── seed_data.sql              ← migrasi 56 data lama (jalankan sekali di awal)
```

**Kenapa harus lewat Netlify Function, tidak langsung dari browser ke
Supabase?** Supaya `service_role key` Supabase (yang punya akses
penuh baca/tulis tanpa batas) tidak pernah terkirim atau terlihat di
browser pengguna. Browser hanya bicara dengan Netlify Function lewat
`/api/data` dan `/api/verify-pin`; Netlify Function yang bicara ke
Supabase di belakang layar, dengan kunci rahasia yang hanya hidup di
server.

---

## 8. Yang Perlu Diperhatikan / Keterbatasan

- **"Σ Sigma Kakal"** sekarang dihitung otomatis dengan rumus
  `NORMSINV((1.000.000 − Jumlah LTI) / 1.000.000) + 1,5`, berbasis
  jumlah kasus LTI akumulatif (YTD). `NORMSINV` diimplementasikan
  manual di JavaScript (algoritma Acklam, akurasi tinggi ~1e-9) karena
  tidak ada fungsi bawaan setara di browser.
- **Klasifikasi LTI/Non-LTI** otomatis dari nilai HKO (≥ 0,5 hari =
  LTI), sesuai keputusan Anda — tidak perlu dipilih manual saat input.
- **Target FR (6,20) dan Target SR (40,00)** masih ditulis tetap di
  dalam kode (`index.html`, cari `TARGET_FR` dan `TARGET_SR`). Kalau
  target ini berubah di kemudian hari, perlu edit manual di situ —
  beri tahu saya kalau Anda ingin ini juga dibuat editable lewat
  form seperti jam kerja.
- **Backup data**: karena semua data sekarang hidup di Supabase
  (bukan lagi di file HTML), pastikan sesekali export CSV (tombol
  "⬇ Export CSV" di dashboard) sebagai cadangan, atau gunakan fitur
  backup otomatis Supabase (Project Settings → Database → Backups).
- **PIN Viewer yang baru di-generate hanya tampil sekali.** Kalau
  modal ditutup sebelum dicatat, PIN tidak bisa dilihat ulang —
  satu-satunya cara adalah generate PIN baru lagi lewat tombol
  "🔄 Ganti PIN Viewer". Pastikan langsung catat/screenshot saat
  modal PIN baru muncul.
