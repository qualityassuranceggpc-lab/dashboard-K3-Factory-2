// netlify/functions/verify-pin.js
//
// Memeriksa PIN yang diketik user di browser, lalu mengeluarkan "token sesi"
// kalau benar. Token ini BUKAN PIN itu sendiri — jadi PIN asli tidak pernah
// terkirim balik ke browser atau tersimpan di sessionStorage.
//
// PIN Admin  -> dicek dari Environment Variable PIN_ADMIN (statis, hanya bisa
//               diganti lewat Netlify, supaya akses admin tetap paling aman).
// PIN Viewer -> dicek dari hash yang tersimpan di Supabase (tabel app_settings),
//               supaya Admin bisa merotasi PIN Viewer kapan saja lewat dashboard
//               tanpa perlu masuk ke Netlify.
//
// Token = base64( role + ":" + expiry_timestamp + ":" + signature )
// Signature dibuat dengan HMAC-SHA256 memakai SESSION_SECRET (rahasia, hanya di server).

const crypto = require('crypto');

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

async function getViewerPinHash() {
  const SUPABASE_URL = process.env.SUPABASE_URL || '';
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!SUPABASE_URL || !SERVICE_KEY) return null;

  const r = await fetch(`${SUPABASE_URL}/rest/v1/app_settings?id=eq.1&select=pin_viewer_hash`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows && rows[0] ? rows[0].pin_viewer_hash : null;
}

exports.handler = async function (event) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*', // boleh diperketat ke domain Netlify Anda sendiri
  };

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Body tidak valid' }) };
  }

  const pin = (body.pin || '').trim();
  const PIN_ADMIN = process.env.PIN_ADMIN || '';
  const SECRET = process.env.SESSION_SECRET || '';

  if (!PIN_ADMIN || !SECRET) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server belum dikonfigurasi (env vars PIN_ADMIN/SESSION_SECRET kosong)' }),
    };
  }

  if (!pin) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'PIN tidak boleh kosong' }) };
  }

  let role = null;

  if (pin === PIN_ADMIN) {
    role = 'admin';
  } else {
    // Cek ke Supabase: hash PIN yang diketik harus sama dengan pin_viewer_hash tersimpan
    const storedHash = await getViewerPinHash();
    if (storedHash && sha256(pin) === storedHash) {
      role = 'viewer';
    }
  }

  if (!role) {
    // Sengaja delay kecil untuk memperlambat brute-force PIN
    await new Promise((r) => setTimeout(r, 400));
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'PIN salah' }) };
  }

  // Token berlaku 12 jam (cukup untuk 1 sesi kerja; akan hilang juga saat tab ditutup
  // karena disimpan di sessionStorage sisi browser, bukan localStorage)
  const expiry = Date.now() + 12 * 60 * 60 * 1000;
  const payload = `${role}:${expiry}`;
  const sig = sign(payload, SECRET);
  const token = Buffer.from(`${payload}:${sig}`).toString('base64');

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ token, role }),
  };
};
