// netlify/functions/dokumen.js
//
// Menangani upload, download (signed URL), dan hapus dokumen
// yang terlampir pada kasus kecelakaan kerja.
//
// Supabase Storage bucket: "dokumen-k3" (private, max 10MB per file)
// Format path file di bucket: {kasus_id}/{timestamp}_{nama_file}
//
// Routes:
//   POST   /api/dokumen?action=upload   → upload file baru, return path
//   GET    /api/dokumen?action=url&path=... → generate signed URL (60 menit)
//   DELETE /api/dokumen?action=hapus&path=... → hapus file dari storage + update DB

const { verifyToken } = require('./_auth');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const BUCKET       = 'dokumen-k3';

function sbHeaders(contentType) {
  const h = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
  if (contentType) h['Content-Type'] = contentType;
  return h;
}

function json(status, body) {
  return {
    statusCode: status,
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
        'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
      body: '',
    };
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json(500, { error: 'Server belum dikonfigurasi' });
  }

  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const auth = verifyToken(token);
  if (!auth.ok) return json(401, { error: auth.error });

  const params = event.queryStringParameters || {};
  const action = params.action || '';
  const method = event.httpMethod;

  try {
    // ══ GET: generate Signed URL untuk download (berlaku 1 jam) ══
    // Viewer maupun Admin boleh download dokumen
    if (method === 'GET' && action === 'url') {
      const filePath = params.path || '';
      if (!filePath) return json(400, { error: 'Parameter path wajib diisi' });

      const r = await fetch(
        `${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${encodeURIComponent(filePath)}`,
        {
          method: 'POST',
          headers: sbHeaders('application/json'),
          body: JSON.stringify({ expiresIn: 3600 }), // 1 jam
        }
      );
      if (!r.ok) return json(502, { error: 'Gagal membuat link download: ' + (await r.text()) });
      const data = await r.json();
      const signedUrl = `${SUPABASE_URL}/storage/v1${data.signedURL}`;
      return json(200, { url: signedUrl });
    }

    // Operasi write (upload/hapus) hanya untuk Admin
    if (auth.role !== 'admin') {
      return json(403, { error: 'Hanya Admin yang bisa upload/hapus dokumen' });
    }

    // ══ POST: Upload file baru ══
    if (method === 'POST' && action === 'upload') {
      const kasusId = params.kasusId || '';
      const namaFile = params.namaFile || 'dokumen';
      if (!kasusId) return json(400, { error: 'Parameter kasusId wajib diisi' });

      // File dikirim sebagai base64 di body JSON (supaya kompatibel dengan Netlify Function)
      let body;
      try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Body tidak valid' }); }

      const { base64, mimeType } = body;
      if (!base64 || !mimeType) return json(400, { error: 'base64 dan mimeType wajib diisi' });

      // Validasi mime type
      const allowedTypes = ['application/pdf','image/jpeg','image/jpg','image/png','image/webp'];
      if (!allowedTypes.includes(mimeType)) {
        return json(400, { error: 'Tipe file tidak didukung. Gunakan PDF, JPG, PNG, atau WEBP.' });
      }

      // Convert base64 ke buffer
      const fileBuffer = Buffer.from(base64, 'base64');

      // Cek ukuran (max 10MB)
      if (fileBuffer.length > 10 * 1024 * 1024) {
        return json(400, { error: 'Ukuran file melebihi batas 10MB' });
      }

      // Generate nama file unik: {kasusId}/{timestamp}_{namaFile}
      const timestamp = Date.now();
      const safeName = namaFile.replace(/[^a-zA-Z0-9._-]/g, '_');
      const filePath = `${kasusId}/${timestamp}_${safeName}`;

      // Upload ke Supabase Storage
      const uploadRes = await fetch(
        `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURIComponent(filePath)}`,
        {
          method: 'POST',
          headers: { ...sbHeaders(mimeType), 'x-upsert': 'false' },
          body: fileBuffer,
        }
      );
      if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        return json(502, { error: 'Gagal upload file: ' + errText });
      }

      // Simpan path ke array dokumen_paths di tabel kecelakaan
      // Pertama ambil paths yang sudah ada, lalu append
      const kasusRes = await fetch(
        `${SUPABASE_URL}/rest/v1/kecelakaan?id=eq.${encodeURIComponent(kasusId)}&select=dokumen_paths`,
        { headers: sbHeaders('application/json') }
      );
      if (!kasusRes.ok) return json(502, { error: 'Gagal membaca data kasus' });
      const kasusArr = await kasusRes.json();
      const existing = (kasusArr[0] && kasusArr[0].dokumen_paths) || [];
      const updatedPaths = [...existing, filePath];

      const updateRes = await fetch(
        `${SUPABASE_URL}/rest/v1/kecelakaan?id=eq.${encodeURIComponent(kasusId)}`,
        {
          method: 'PATCH',
          headers: { ...sbHeaders('application/json'), Prefer: 'return=minimal' },
          body: JSON.stringify({ dokumen_paths: updatedPaths }),
        }
      );
      if (!updateRes.ok) return json(502, { error: 'File terupload tapi gagal simpan ke database' });

      return json(200, {
        path: filePath,
        namaFile: safeName,
        ukuran: fileBuffer.length,
        paths: updatedPaths,
      });
    }

    // ══ DELETE: Hapus satu dokumen ══
    if (method === 'DELETE' && action === 'hapus') {
      const filePath = params.path || '';
      const kasusId  = params.kasusId || '';
      if (!filePath || !kasusId) return json(400, { error: 'Parameter path dan kasusId wajib diisi' });

      // Hapus dari Supabase Storage
      const delRes = await fetch(
        `${SUPABASE_URL}/storage/v1/object/${BUCKET}`,
        {
          method: 'DELETE',
          headers: sbHeaders('application/json'),
          body: JSON.stringify({ prefixes: [filePath] }),
        }
      );
      if (!delRes.ok) return json(502, { error: 'Gagal hapus file dari storage: ' + (await delRes.text()) });

      // Update dokumen_paths di tabel kecelakaan (hapus path ini dari array)
      const kasusRes = await fetch(
        `${SUPABASE_URL}/rest/v1/kecelakaan?id=eq.${encodeURIComponent(kasusId)}&select=dokumen_paths`,
        { headers: sbHeaders('application/json') }
      );
      if (kasusRes.ok) {
        const kasusArr = await kasusRes.json();
        const existing = (kasusArr[0] && kasusArr[0].dokumen_paths) || [];
        const updatedPaths = existing.filter(p => p !== filePath);
        await fetch(
          `${SUPABASE_URL}/rest/v1/kecelakaan?id=eq.${encodeURIComponent(kasusId)}`,
          {
            method: 'PATCH',
            headers: { ...sbHeaders('application/json'), Prefer: 'return=minimal' },
            body: JSON.stringify({ dokumen_paths: updatedPaths }),
          }
        );
      }

      return json(200, { success: true });
    }

    return json(400, { error: 'Action tidak dikenal: ' + action });
  } catch (err) {
    return json(500, { error: 'Terjadi kesalahan server: ' + err.message });
  }
};
