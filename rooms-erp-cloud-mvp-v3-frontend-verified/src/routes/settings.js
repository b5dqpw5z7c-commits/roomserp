import { Router } from 'express';
import { query, tx } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../utils/async-handler.js';
import { audit } from '../services/audit.js';

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

settingsRouter.get('/', asyncHandler(async (_req, res) => {
  const result = await query(`SELECT key, value FROM app_settings ORDER BY key`);
  const settings = Object.fromEntries(result.rows.map((r) => [r.key, r.value]));
  res.json({ ok: true, settings });
}));

settingsRouter.put('/:key', requireRole('Yönetim'), asyncHandler(async (req, res) => {
  const item = await tx(async (client) => {
    const before = (await client.query(`SELECT * FROM app_settings WHERE key=$1`, [req.params.key])).rows[0];
    const result = await client.query(
      `INSERT INTO app_settings(key, value, updated_at) VALUES($1,$2,now())
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=now()
       RETURNING *`,
      [req.params.key, req.body || {}]
    );
    await audit(client, { actorUserId: req.user.id, action: 'update_setting', entityType: 'app_setting', entityId: null, beforeData: before, afterData: result.rows[0], ipAddress: req.ip });
    return result.rows[0];
  });
  res.json({ ok: true, item });
}));
