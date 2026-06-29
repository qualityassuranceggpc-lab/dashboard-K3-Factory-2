// netlify/functions/_auth.js
//
// Helper untuk memverifikasi token sesi yang dibuat oleh verify-pin.js.
// Dipakai oleh data.js sebelum mengizinkan baca/tulis ke Supabase.

const crypto = require('crypto');

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * @param {string} token - token base64 dari header Authorization
 * @returns {{ok:true, role:'admin'|'viewer'} | {ok:false, error:string}}
 */
function verifyToken(token) {
  const SECRET = process.env.SESSION_SECRET || '';
  if (!token) return { ok: false, error: 'Token tidak ada' };
  if (!SECRET) return { ok: false, error: 'Server belum dikonfigurasi' };

  let decoded;
  try {
    decoded = Buffer.from(token, 'base64').toString('utf8');
  } catch {
    return { ok: false, error: 'Token tidak valid' };
  }

  const parts = decoded.split(':');
  if (parts.length !== 3) return { ok: false, error: 'Token tidak valid' };
  const [role, expiryStr, sig] = parts;

  const expectedSig = sign(`${role}:${expiryStr}`, SECRET);
  if (sig !== expectedSig) return { ok: false, error: 'Token tidak valid' };

  const expiry = parseInt(expiryStr, 10);
  if (!expiry || Date.now() > expiry) return { ok: false, error: 'Sesi sudah habis, silakan masukkan PIN lagi' };

  if (role !== 'admin' && role !== 'viewer') return { ok: false, error: 'Role tidak dikenal' };

  return { ok: true, role };
}

module.exports = { verifyToken };
