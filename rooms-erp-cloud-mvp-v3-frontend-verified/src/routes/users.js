import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query, tx } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../utils/async-handler.js';
import { audit } from '../services/audit.js';

export const usersRouter = Router();
usersRouter.use(requireAuth);

usersRouter.get('/', requireRole('Yönetim'), asyncHandler(async (_req, res) => {
  const result = await query(`SELECT id, username, name, role, sub_role AS "subRole", department, language, must_change_password AS "mustChangePassword", is_active AS "isActive", last_login_at AS "lastLoginAt", created_at AS "createdAt" FROM users ORDER BY created_at DESC`);
  res.json({ ok: true, items: result.rows });
}));

usersRouter.post('/', requireRole('Yönetim'), asyncHandler(async (req, res) => {
  const schema = z.object({ username: z.string().min(2).max(80), name: z.string().min(2).max(160), password: z.string().min(8).max(200), role: z.string().min(1).max(80), subRole: z.string().max(80).optional().nullable(), department: z.string().max(80).optional().nullable(), language: z.string().default('tr') });
  const body = schema.parse(req.body || {});
  const hash = await bcrypt.hash(body.password, 12);
  const created = await tx(async (client) => {
    const result = await client.query(
      `INSERT INTO users(username, name, role, sub_role, department, language, password_hash, must_change_password)
       VALUES($1,$2,$3,$4,$5,$6,$7,true)
       RETURNING id, username, name, role, sub_role AS "subRole", department, language, must_change_password AS "mustChangePassword", is_active AS "isActive"`,
      [body.username, body.name, body.role, body.subRole || null, body.department || null, body.language || 'tr', hash]
    );
    await audit(client, { actorUserId: req.user.id, action: 'create_user', entityType: 'user', entityId: result.rows[0].id, afterData: result.rows[0], ipAddress: req.ip });
    return result.rows[0];
  });
  res.status(201).json({ ok: true, item: created });
}));

usersRouter.patch('/:id', requireRole('Yönetim'), asyncHandler(async (req, res) => {
  const schema = z.object({ name: z.string().min(2).max(160).optional(), role: z.string().max(80).optional(), subRole: z.string().max(80).optional().nullable(), department: z.string().max(80).optional().nullable(), isActive: z.boolean().optional() });
  const body = schema.parse(req.body || {});
  const updated = await tx(async (client) => {
    const before = (await client.query(`SELECT * FROM users WHERE id=$1`, [req.params.id])).rows[0];
    const result = await client.query(
      `UPDATE users SET
        name=COALESCE($2,name), role=COALESCE($3,role), sub_role=$4, department=$5,
        is_active=COALESCE($6,is_active), updated_at=now()
       WHERE id=$1
       RETURNING id, username, name, role, sub_role AS "subRole", department, language, is_active AS "isActive"`,
      [req.params.id, body.name, body.role, body.subRole ?? before?.sub_role ?? null, body.department ?? before?.department ?? null, body.isActive]
    );
    await audit(client, { actorUserId: req.user.id, action: 'update_user', entityType: 'user', entityId: req.params.id, beforeData: before, afterData: result.rows[0], ipAddress: req.ip });
    return result.rows[0];
  });
  res.json({ ok: true, item: updated });
}));
