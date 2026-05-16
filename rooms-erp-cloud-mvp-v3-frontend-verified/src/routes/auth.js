import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query, tx } from '../db.js';
import { asyncHandler } from '../utils/async-handler.js';
import { badRequest, unauthorized } from '../errors.js';
import { requireAuth, signToken } from '../middleware/auth.js';
import { audit } from '../services/audit.js';

export const authRouter = Router();

const loginSchema = z.object({ username: z.string().min(1).max(80), password: z.string().min(1).max(200) });

authRouter.post('/login', asyncHandler(async (req, res) => {
  const body = loginSchema.parse(req.body || {});
  const userResult = await query(`SELECT * FROM users WHERE lower(username)=lower($1) AND is_active=true`, [body.username]);
  const user = userResult.rows[0];
  if (!user) throw unauthorized('Kullanıcı adı veya şifre hatalı');
  const ok = await bcrypt.compare(body.password, user.password_hash);
  if (!ok) throw unauthorized('Kullanıcı adı veya şifre hatalı');

  const session = await tx(async (client) => {
    const s = await client.query(
      `INSERT INTO sessions(user_id, expires_at) VALUES($1, now() + interval '12 hours') RETURNING id`,
      [user.id]
    );
    await client.query(`UPDATE users SET last_login_at=now(), updated_at=now() WHERE id=$1`, [user.id]);
    await audit(client, { actorUserId: user.id, action: 'login', entityType: 'user', entityId: user.id, ipAddress: req.ip });
    return s.rows[0];
  });

  const token = signToken(user, session.id);
  res.cookie('rooms_token', token, { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true', maxAge: 12 * 60 * 60 * 1000 });
  res.json({ ok: true, token, user: publicUser(user) });
}));

authRouter.get('/me', requireAuth, asyncHandler(async (req, res) => {
  res.json({ ok: true, user: publicUser(req.user) });
}));

authRouter.post('/logout', requireAuth, asyncHandler(async (req, res) => {
  await tx(async (client) => {
    await client.query(`UPDATE sessions SET revoked_at=now() WHERE id=$1`, [req.sessionId]);
    await audit(client, { actorUserId: req.user.id, action: 'logout', entityType: 'session', entityId: req.sessionId, ipAddress: req.ip });
  });
  res.clearCookie('rooms_token');
  res.json({ ok: true });
}));

authRouter.post('/change-password', requireAuth, asyncHandler(async (req, res) => {
  const schema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8).max(200) });
  const body = schema.parse(req.body || {});
  const result = await query(`SELECT password_hash FROM users WHERE id=$1`, [req.user.id]);
  const ok = await bcrypt.compare(body.currentPassword, result.rows[0]?.password_hash || '');
  if (!ok) throw badRequest('Mevcut şifre hatalı');
  const hash = await bcrypt.hash(body.newPassword, 12);
  await tx(async (client) => {
    await client.query(`UPDATE users SET password_hash=$1, must_change_password=false, updated_at=now() WHERE id=$2`, [hash, req.user.id]);
    await audit(client, { actorUserId: req.user.id, action: 'change_password', entityType: 'user', entityId: req.user.id, ipAddress: req.ip });
  });
  res.json({ ok: true });
}));

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    subRole: user.sub_role || null,
    department: user.department || null,
    language: user.language || 'tr',
    mustChangePassword: !!user.must_change_password
  };
}
