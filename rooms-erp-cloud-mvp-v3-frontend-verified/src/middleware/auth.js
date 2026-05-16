import jwt from 'jsonwebtoken';
import { query } from '../db.js';
import { config } from '../config.js';
import { forbidden, unauthorized } from '../errors.js';

export function signToken(user, sessionId) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role, sessionId },
    config.jwtSecret,
    { expiresIn: '12h' }
  );
}

export async function requireAuth(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : req.cookies?.rooms_token;
    if (!token) throw unauthorized();
    const payload = jwt.verify(token, config.jwtSecret);
    const result = await query(
      `SELECT u.id, u.username, u.name, u.role, u.sub_role, u.department, u.language, u.must_change_password, s.revoked_at, s.expires_at
       FROM users u JOIN sessions s ON s.user_id = u.id
       WHERE u.id = $1 AND s.id = $2 AND u.is_active = true`,
      [payload.sub, payload.sessionId]
    );
    const row = result.rows[0];
    if (!row || row.revoked_at || new Date(row.expires_at) < new Date()) throw unauthorized('Oturum süresi doldu');
    req.user = row;
    req.sessionId = payload.sessionId;
    next();
  } catch (error) {
    next(error.status ? error : unauthorized('Geçersiz oturum'));
  }
}

const roleRank = { 'Yönetim': 100, 'Muhasebe': 80, 'Satınalma': 70, 'Depo': 60, 'Üretim': 50, 'Sevkiyat': 50, 'Satış': 50 };
export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (roles.includes(req.user.role)) return next();
    return next(forbidden());
  };
}

export function requireAnyRole(...roles) {
  return requireRole(...roles);
}

export function canManageFinance(user) {
  return ['Yönetim', 'Muhasebe'].includes(user?.role);
}

export function requireFinance(req, _res, next) {
  if (canManageFinance(req.user)) return next();
  return next(forbidden('Finans işlemi için yönetim/muhasebe yetkisi gerekli'));
}
