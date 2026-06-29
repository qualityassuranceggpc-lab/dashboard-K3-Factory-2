// netlify/functions/data.js
//
// Satu-satunya pintu antara browser dan Supabase.
// - GET    -> baca semua data kecelakaan + jam kerja bulanan (role: viewer ATAU admin)
// - POST   -> tambah kasus baru                              (role: admin saja)
// - PUT    -> edit kasus / update jam kerja bulanan          (role: admin saja)
// - DELETE -> hapus kasus                                    (role: admin saja)
//
// Service Role Key Supabase HANYA hidup di sini (env var), tidak pernah dikirim ke browser.

const { verifyToken } = require('./_auth');
const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function sbHeaders() {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body),
  };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
      body: '',
    };
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json(500, { error: 'Server belum dikonfigurasi (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY kosong)' });
  }

  // ── Ambil & verifikasi token dari header Authorization: Bearer <token> ──
  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const auth = verifyToken(token);
  if (!auth.ok) return json(401, { error: auth.error });

  const method = event.httpMethod;

  // Semua method butuh minimal role viewer; tulis (POST/PUT/DELETE) butuh admin.
  if (method !== 'GET' && auth.role !== 'admin') {
    return json(403, { error: 'PIN Anda hanya untuk melihat data (viewer), bukan untuk mengubah data.' });
  }

  try {
    // ══ GET — ambil semua data ══
    if (method === 'GET') {
      const [kecelakaanRes, jamRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/kecelakaan?select=*&order=tgl.asc`, { headers: sbHeaders() }),
        fetch(`${SUPABASE_URL}/rest/v1/jam_kerja_bulanan?select=*&order=tahun.asc,bulan.asc`, { headers: sbHeaders() }),
      ]);
      if (!kecelakaanRes.ok) return json(502, { error: 'Gagal mengambil data kecelakaan dari Supabase' });
      if (!jamRes.ok) return json(502, { error: 'Gagal mengambil data jam kerja dari Supabase' });

      const kecelakaan = await kecelakaanRes.json();
      const jamKerja = await jamRes.json();

      let pinViewerSetAt = null;
      if (auth.role === 'admin') {
        const settingsRes = await fetch(`${SUPABASE_URL}/rest/v1/app_settings?id=eq.1&select=pin_viewer_set_at`, { headers: sbHeaders() });
        if (settingsRes.ok) {
          const rows = await settingsRes.json();
          pinViewerSetAt = rows && rows[0] ? rows[0].pin_viewer_set_at : null;
        }
      }

      return json(200, { kecelakaan, jamKerja, role: auth.role, pinViewerSetAt });
    }

    const body = JSON.parse(event.body || '{}');

    // ══ POST — rotasi PIN Viewer (admin generate PIN baru, PIN lama langsung invalid) ══
    if (method === 'POST' && body.type === 'rotate_pin') {
      // Generate 6 digit acak (100000-999999), pakai crypto supaya acak yang aman
      const newPin = (100000 + crypto.randomInt(900000)).toString();
      const hash = crypto.createHash('sha256').update(newPin).digest('hex');

      const r = await fetch(`${SUPABASE_URL}/rest/v1/app_settings?id=eq.1`, {
        method: 'PATCH',
        headers: { ...sbHeaders(), Prefer: 'return=representation' },
        body: JSON.stringify({ pin_viewer_hash: hash, pin_viewer_set_at: new Date().toISOString() }),
      });
      if (!r.ok) return json(502, { error: 'Gagal menyimpan PIN baru: ' + (await r.text()) });

      // PIN plain-text HANYA dikirim sekali, di response ini saja — tidak pernah disimpan
      // sebagai plain text di Supabase maupun di tempat lain.
      return json(200, { newPin });
    }

    // ══ POST — tambah kasus baru ══
    if (method === 'POST') {
      if (body.type === 'jam_kerja') {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/jam_kerja_bulanan`, {
          method: 'POST',
          headers: { ...sbHeaders(), Prefer: 'return=representation' },
          body: JSON.stringify({
            tahun: body.tahun,
            bulan: body.bulan,
            jam_kerja: body.jam_kerja,
            is_estimasi: !!body.is_estimasi,
          }),
        });
        if (!r.ok) return json(502, { error: 'Gagal menyimpan jam kerja: ' + (await r.text()) });
        return json(201, await r.json());
      }

      const { error: validationError } = validateKasus(body);
      if (validationError) return json(400, { error: validationError });

      const r = await fetch(`${SUPABASE_URL}/rest/v1/kecelakaan`, {
        method: 'POST',
        headers: { ...sbHeaders(), Prefer: 'return=representation' },
        body: JSON.stringify(pickKasusFields(body)),
      });
      if (!r.ok) return json(502, { error: 'Gagal menyimpan kasus: ' + (await r.text()) });
      return json(201, await r.json());
    }

    // ══ PUT — edit kasus ATAU edit jam kerja bulanan ══
    if (method === 'PUT') {
      if (body.type === 'jam_kerja') {
        if (!body.id) return json(400, { error: 'id jam_kerja wajib diisi' });
        const r = await fetch(`${SUPABASE_URL}/rest/v1/jam_kerja_bulanan?id=eq.${encodeURIComponent(body.id)}`, {
          method: 'PATCH',
          headers: { ...sbHeaders(), Prefer: 'return=representation' },
          body: JSON.stringify({
            jam_kerja: body.jam_kerja,
            is_estimasi: !!body.is_estimasi,
          }),
        });
        if (!r.ok) return json(502, { error: 'Gagal mengubah jam kerja: ' + (await r.text()) });
        return json(200, await r.json());
      }

      if (!body.id) return json(400, { error: 'id kasus wajib diisi' });
      const { error: validationError } = validateKasus(body);
      if (validationError) return json(400, { error: validationError });

      const r = await fetch(`${SUPABASE_URL}/rest/v1/kecelakaan?id=eq.${encodeURIComponent(body.id)}`, {
        method: 'PATCH',
        headers: { ...sbHeaders(), Prefer: 'return=representation' },
        body: JSON.stringify(pickKasusFields(body)),
      });
      if (!r.ok) return json(502, { error: 'Gagal mengubah kasus: ' + (await r.text()) });
      return json(200, await r.json());
    }

    // ══ DELETE — hapus kasus ══
    if (method === 'DELETE') {
      const id = body.id || (event.queryStringParameters && event.queryStringParameters.id);
      if (!id) return json(400, { error: 'id wajib diisi' });

      const table = body.type === 'jam_kerja' ? 'jam_kerja_bulanan' : 'kecelakaan';
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: sbHeaders(),
      });
      if (!r.ok) return json(502, { error: 'Gagal menghapus data: ' + (await r.text()) });
      return json(200, { success: true });
    }

    return json(405, { error: 'Method tidak didukung' });
  } catch (err) {
    return json(500, { error: 'Terjadi kesalahan server: ' + err.message });
  }
};

function validateKasus(body) {
  if (!body.tgl) return { error: 'Tanggal wajib diisi' };
  if (!body.nama || !body.nama.trim()) return { error: 'Nama wajib diisi' };
  if (body.hko === undefined || body.hko === null || isNaN(parseFloat(body.hko))) {
    return { error: 'HKO wajib diisi dengan angka (boleh 0)' };
  }
  return {};
}

function pickKasusFields(body) {
  return {
    tgl: body.tgl,
    nama: (body.nama || '').trim(),
    subdep: body.subdep || '',
    jenis: body.jenis || 'Lain-lain',
    kronologi: body.kronologi || '',
    lokasi: body.lokasi || '',
    hko: parseFloat(body.hko) || 0,
  };
}
