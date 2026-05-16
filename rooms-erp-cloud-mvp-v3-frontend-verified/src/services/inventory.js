import { conflict } from '../errors.js';
import { audit } from './audit.js';

export async function checkAndConsumeForOrder(client, { order, stage, actorUserId, ipAddress }) {
  // MVP: consumption rules are based on product_type. If no rule exists, no automatic stock consumption happens.
  const products = Array.isArray(order.products) ? order.products : JSON.parse(order.products || '[]');
  const needs = new Map();
  for (const p of products) {
    const qty = Number(p.qty || p.adet || 1);
    const type = p.type || p.productType || p.model || p.name;
    if (!type) continue;
    const rules = (await client.query(`SELECT * FROM consumption_rules WHERE product_type=$1`, [type])).rows;
    for (const rule of rules) {
      const key = rule.variant_id || `material:${rule.material_id}`;
      const existing = needs.get(key) || { materialId: rule.material_id, variantId: rule.variant_id, qty: 0 };
      existing.qty += Number(rule.qty_per_unit) * qty;
      needs.set(key, existing);
    }
  }
  if (!needs.size) return { consumed: [] };

  const shortages = [];
  for (const need of needs.values()) {
    if (!need.variantId) continue;
    const variant = (await client.query(`SELECT mv.*, m.name AS material_name FROM material_variants mv JOIN materials m ON m.id=mv.material_id WHERE mv.id=$1 FOR UPDATE`, [need.variantId])).rows[0];
    if (!variant || Number(variant.stock) < need.qty) {
      shortages.push({ material: variant?.material_name || need.materialId, variant: variant?.name || need.variantId, available: Number(variant?.stock || 0), required: need.qty });
    }
  }
  if (shortages.length) throw conflict('Yetersiz stok nedeniyle üretim tamamlanamadı', { shortages });

  const consumed = [];
  for (const need of needs.values()) {
    if (!need.variantId) continue;
    await client.query(`UPDATE material_variants SET stock=stock-$1 WHERE id=$2`, [need.qty, need.variantId]);
    const movement = (await client.query(
      `INSERT INTO stock_movements(material_id, variant_id, type, direction, qty, reference_type, reference_id, note, created_by)
       VALUES($1,$2,'production_consume','out',$3,'order',$4,$5,$6) RETURNING *`,
      [need.materialId, need.variantId, need.qty, order.id, `${stage} tamamlandı`, actorUserId]
    )).rows[0];
    consumed.push(movement);
  }
  await audit(client, { actorUserId, action: 'consume_stock_for_order', entityType: 'order', entityId: order.id, afterData: consumed, ipAddress });
  return { consumed };
}
