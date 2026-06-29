-- ============================================================
-- SKEMA SUPABASE — Dashboard K3 Factory 2026
-- Jalankan seluruh isi file ini di Supabase SQL Editor
-- (Project Anda -> SQL Editor -> New Query -> paste -> Run)
-- ============================================================

-- 1) TABEL UTAMA: log kecelakaan kerja
create table if not exists kecelakaan (
  id          uuid primary key default gen_random_uuid(),
  tgl         date not null,
  nama        text not null,
  subdep      text not null default '',
  jenis       text not null default 'Lain-lain',   -- Jenis Kejadian (Terpeleset, Tertimpa Benda, dll.)
  kronologi   text not null default '',
  lokasi      text not null default '',
  hko         numeric not null default 0,           -- Hari Kerja Hilang. >=0.5 = LTI (dihitung otomatis di FE)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_kecelakaan_tgl on kecelakaan (tgl);

-- Trigger: auto-update updated_at setiap kali baris diubah
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_kecelakaan_updated_at on kecelakaan;
create trigger trg_kecelakaan_updated_at
  before update on kecelakaan
  for each row execute function set_updated_at();


-- 2) TABEL JAM KERJA PER BULAN (dipakai untuk hitung FR & SR)
create table if not exists jam_kerja_bulanan (
  id          uuid primary key default gen_random_uuid(),
  tahun       int not null,
  bulan       int not null check (bulan between 1 and 12),
  jam_kerja   numeric not null default 0,
  is_estimasi boolean not null default false,        -- true = masih sementara (tampil dengan tanda *)
  updated_at  timestamptz not null default now(),
  unique (tahun, bulan)
);

drop trigger if exists trg_jam_kerja_updated_at on jam_kerja_bulanan;
create trigger trg_jam_kerja_updated_at
  before update on jam_kerja_bulanan
  for each row execute function set_updated_at();


-- 2b) TABEL SETTINGS — menyimpan PIN Viewer yang bisa dirotasi Admin
-- (PIN Admin TIDAK di sini — tetap di Environment Variable Netlify, lebih aman
--  karena hanya bisa diubah lewat akses langsung ke Netlify, bukan dari dashboard)
create table if not exists app_settings (
  id              int primary key default 1,
  pin_viewer_hash text not null,             -- hash SHA-256 dari PIN Viewer (bukan plain text)
  pin_viewer_set_at timestamptz not null default now(),
  constraint single_row check (id = 1)        -- pastikan hanya ada 1 baris (singleton config)
);

drop trigger if exists trg_settings_updated_at on app_settings;
create trigger trg_settings_updated_at
  before update on app_settings
  for each row execute function set_updated_at();

-- Tambah kolom updated_at karena trigger di atas butuh kolom ini
alter table app_settings add column if not exists updated_at timestamptz not null default now();


-- 2c) PIN VIEWER AWAL
-- Ganti '123456' di bawah ini dengan PIN Viewer awal pilihan Anda SEBELUM menjalankan
-- query ini (boleh berapa digit saja, tidak harus 6 digit).
-- Hash dihitung otomatis oleh Postgres memakai SHA-256 (digest dari ekstensi pgcrypto).
create extension if not exists pgcrypto;

insert into app_settings (id, pin_viewer_hash, pin_viewer_set_at)
values (1, encode(digest('123456', 'sha256'), 'hex'), now())
on conflict (id) do nothing;


-- 3) ROW LEVEL SECURITY
-- Browser TIDAK PERNAH mengakses Supabase secara langsung.
-- Semua akses lewat Netlify Function memakai Service Role Key (bypass RLS).
-- RLS diaktifkan di sini sebagai lapisan pertahanan kedua (defense in depth),
-- supaya kalau suatu saat anon key bocor/terpakai, tabel tetap terkunci.
alter table kecelakaan enable row level security;
alter table jam_kerja_bulanan enable row level security;
alter table app_settings enable row level security;

-- Tidak ada policy untuk anon/authenticated -> otomatis semua akses publik DITOLAK.
-- Hanya Service Role Key (dipakai Netlify Function di server) yang bisa baca/tulis.


-- 4) DATA AWAL (baseline kecelakaan) — silakan jalankan INSERT ini SEKALI saja
-- setelah tabel dibuat, untuk migrasi 56 data lama dari dashboard HTML.
-- (Disediakan terpisah di file seed_data.sql agar SQL Editor tidak kepanjangan)

-- 5) DATA AWAL JAM KERJA 2026 (Jan-Jun, sesuai dashboard lama)
insert into jam_kerja_bulanan (tahun, bulan, jam_kerja, is_estimasi) values
  (2026, 1, 696945,  false),
  (2026, 2, 777315,  false),
  (2026, 3, 693259,  false),
  (2026, 4, 1148486, false),
  (2026, 5, 978680,  false),
  (2026, 6, 500000,  true)
on conflict (tahun, bulan) do nothing;
