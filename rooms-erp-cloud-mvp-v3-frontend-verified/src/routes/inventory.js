import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/async-handler.js';
import { badRequest } from '../errors.js';
import { audit } from '../services/audit.js';

export const inventoryRouter = Router();
inventoryRouter.use(requireAuth);

inventoryRouter.get('/materials', asyncHandler(async (_req, res) => {
  const result = await query(`SELECT m.*, COALESCE(json_agg(mv.*) FILTER (WHERE mv.id IS NOT NULL),'[]') AS variants FROM materials m LEFT JOIN material_variants mv ON mv.material_id=m.id WHERE m.is_active=true GROUP BY m.id ORDER BY m.name`);
  res.json({ ok: true, items: result.rows });
}));

inventoryRouter.post('/materials', asyncHandler(async (req, res) => {
  const schema = z.object({ name: z.string().min(2).max(180), category: z.string().max(100).optional().nullable(), unit: z.string().max(20).default('adet'), criticalLevel: z.coerce.number().min(0).default(0), unitCost: z.coerce.number().min(0).default(0), variants: z.array(z.object({ name: z.string().min(1), stock: z.coerce.number().min(0).default(0), unitCost: z.coerce.number().min(0).default(0) })).default([]) });
  const body = schema.parse(req.body || {});
  const item = await tx(async (client) => {
    const material = (await client.query(`INSERT INTO materials(name, category, unit, critical_level, unit_cost) VALUES($1,$2,$3,$4,$5) RETURNING *`, [body.name, body.category, body.unit, body.criticalLevel, body.unitCost])).rows[0];
    const variants = body.variants.length ? body.variants : [{ name: 'Standart', stock: 0, unitCost: body.unitCost }];
    for (const v of variants) {
      await client.query(`INSERT INTO material_variants(material_id, name, stock, unit_cost) VALUES($1,$2,$3,$4)`, [material.id, v.name, v.stock, v.unitCost]);
    }
    await audit(client, { actorUserId: req.user.id, action: 'create_material', entityType: 'material', entityId: material.id, afterData: material, ipAddress: req.ip });
    return material;
  });
  res.status(201).json({ ok: true, item });
}));

inventoryRouter.post('/stock-entry', asyncHandler(async (req, res) => {
  const schema = z.object({ materialId: z.string().uuid(), variantId: z.string().uuid().optional().nullable(), qty: z.coerce.number().positive(), unitCost: z.coerce.number().min(0).default(0), note: z.string().max(500).optional().nullable() });
  const body = schema.parse(req.body || {});
  const item = await tx(async (client) => {
    const material = (await client.query(`SELECT id FROM materials WHERE id=$1 AND is_active=true FOR UPDATE`, [body.materialId])).rows[0];
    if (!material) throw badRequest('Malzeme bulunamadı');
    let variantId = body.variantId;
    if (!variantId) {
      const v = (await client.query(`SELECT id FROM material_variants WHERE material_id=$1 ORDER BY name LIMIT 1 FOR UPDATE`, [body.materialId])).rows[0];
      if (v) variantId = v.id;
      else variantId = (await client.query(`INSERT INTO material_variants(material_id, name, stock, unit_cost) VALUES($1,'Standart',0,$2) RETURNING id`, [body.materialId, body.unitCost])).rows[0].id;
    }
    await client.query(`UPDATE material_variants SET stock=stock+$1, unit_cost=CASE WHEN $2>0 THEN $2 ELSE unit_cost END WHERE id=$3`, [body.qty, body.unitCost, variantId]);
    const movement = (await client.query(
      `INSERT INTO stock_movements(material_id, variant_id, type, direction, qty, unit_cost, note, created_by)
       VALUES($1,$2,'purchase_entry','in',$3,$4,$5,$6) RETURNING *`,
      [body.materialId, variantId, body.qty, body.unitCost, body.note || null, req.user.id]
    )).rows[0];
    await audit(client, { actorUserId: req.user.id, action: 'stock_entry', entityType: 'stock_movement', entityId: movement.id, afterData: movement, ipAddress: req.ip });
    return movement;
  });
  res.status(201).json({ ok: true, item });
}));

inventoryRouter.get('/movements', asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 100), 500);
  const result = await query(`SELECT sm.*, m.name AS material_name, mv.name AS variant_name FROM stock_movements sm LEFT JOIN materials m ON m.id=sm.material_id LEFT JOIN material_variants mv ON mv.id=sm.variant_id ORDER BY sm.created_at DESC LIMIT $1`, [limit]);
  res.json({ ok: true, items: result.rows });
}));
