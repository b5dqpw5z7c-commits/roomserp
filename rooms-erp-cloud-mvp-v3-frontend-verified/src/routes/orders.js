import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/async-handler.js';
import { badRequest, notFound, conflict } from '../errors.js';
import { audit } from '../services/audit.js';
import { postAccountTransaction } from '../services/accounting.js';
import { checkAndConsumeForOrder } from '../services/inventory.js';

export const ordersRouter = Router();
ordersRouter.use(requireAuth);

const stages = ['iskelet','beyazlama','konfeksiyon','doseme','montaj','depo'];
const productionStages = ['iskelet','beyazlama','konfeksiyon','doseme','montaj'];
const stageInProgressStatus = { iskelet: 'iskelette', beyazlama: 'beyazlamada', konfeksiyon: 'konfeksiyonda', doseme: 'dosemede', montaj: 'montaj-paket' };
const afterStageCompleteStatus = { iskelet: 'beyazlamada', beyazlama: 'konfeksiyonda', konfeksiyon: 'dosemede', doseme: 'montaj-paket', montaj: 'sevkiyata-hazir' };

ordersRouter.get('/', asyncHandler(async (req, res) => {
  const page = Math.max(Number(req.query.page || 1), 1);
  const limit = Math.min(Math.max(Number(req.query.limit || 25), 1), 100);
  const offset = (page - 1) * limit;
  const status = req.query.status;
  const params = [];
  let where = '';
  if (status) { params.push(status); where = `WHERE o.status=$${params.length}`; }
  const items = await query(`SELECT o.*, a.name AS account_name FROM orders o LEFT JOIN accounts a ON a.id=o.customer_account_id ${where} ORDER BY o.created_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`, [...params, limit, offset]);
  const count = await query(`SELECT COUNT(*)::int AS count FROM orders o ${where}`, params);
  res.json({ ok: true, page, limit, total: count.rows[0].count, items: items.rows.map(mapOrder) });
}));


ordersRouter.get('/:id', asyncHandler(async (req, res) => {
  const result = await query(`SELECT o.*, a.name AS account_name FROM orders o LEFT JOIN accounts a ON a.id=o.customer_account_id WHERE o.id=$1`, [req.params.id]);
  const order = result.rows[0];
  if (!order) throw notFound('Sipariş bulunamadı');
  res.json({ ok: true, item: mapOrder(order) });
}));

ordersRouter.post('/', asyncHandler(async (req, res) => {
  const schema = z.object({ customerAccountId: z.string().uuid().optional().nullable(), customerName: z.string().max(180).optional().nullable(), dealerName: z.string().max(180).optional().nullable(), orderDate: z.string().optional(), dueDate: z.string().optional().nullable(), products: z.array(z.any()).default([]), notes: z.string().max(1000).optional().nullable(), deliveryAddress: z.string().max(500).optional().nullable(), totalAmount: z.coerce.number().min(0).default(0) });
  const body = schema.parse(req.body || {});
  const order = await tx(async (client) => {
    const no = `RM-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${String(Date.now()).slice(-5)}`;
    const result = await client.query(
      `INSERT INTO orders(order_no, customer_account_id, customer_name, dealer_name, order_date, due_date, products, notes, delivery_address, total_amount, created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [no, body.customerAccountId || null, body.customerName || null, body.dealerName || null, body.orderDate || new Date().toISOString().slice(0,10), body.dueDate || null, JSON.stringify(body.products), body.notes || null, body.deliveryAddress || null, body.totalAmount, req.user.id]
    );
    await audit(client, { actorUserId: req.user.id, action: 'create_order', entityType: 'order', entityId: result.rows[0].id, afterData: result.rows[0], ipAddress: req.ip });
    return result.rows[0];
  });
  res.status(201).json({ ok: true, item: mapOrder(order) });
}));

ordersRouter.post('/:id/stages/:stage/accept', asyncHandler(async (req, res) => {
  const stage = req.params.stage;
  if (!stages.includes(stage)) throw badRequest('Geçersiz aşama');
  const result = await tx(async (client) => {
    const order = await getOrderForUpdate(client, req.params.id);
    const employeeId = await employeeIdForUser(client, req.user.id);
    const progress = order.stage_progress || {};
    assertStageCanStart(progress, stage);
    if (progress[stage]?.acceptedAt) throw conflict('Bu iş daha önce kabul edilmiş');
    progress[stage] = { ...(progress[stage] || {}), acceptedAt: new Date().toISOString(), acceptedBy: req.user.id };
    const nextStatus = stageInProgressStatus[stage] || order.status;
    const updated = (await client.query(`UPDATE orders SET stage_progress=$1, status=$2, updated_at=now() WHERE id=$3 RETURNING *`, [JSON.stringify(progress), nextStatus, order.id])).rows[0];
    const event = await client.query(`INSERT INTO production_events(order_id, stage, event_type, user_id, employee_id, points, note) VALUES($1,$2,'accept',$3,$4,0,$5) RETURNING *`, [order.id, stage, req.user.id, employeeId, 'İş kabul edildi']);
    await audit(client, { actorUserId: req.user.id, action: 'accept_stage', entityType: 'order', entityId: order.id, beforeData: order, afterData: updated, ipAddress: req.ip });
    return { order: updated, event: event.rows[0] };
  });
  res.json({ ok: true, item: mapOrder(result.order), event: result.event });
}));

ordersRouter.post('/:id/stages/:stage/complete', asyncHandler(async (req, res) => {
  const stage = req.params.stage;
  if (!stages.includes(stage) || stage === 'depo') throw badRequest('Geçersiz üretim aşaması');
  const result = await tx(async (client) => {
    const order = await getOrderForUpdate(client, req.params.id);
    const employeeId = await employeeIdForUser(client, req.user.id);
    const progress = order.stage_progress || {};
    assertStageCanStart(progress, stage);
    if (progress[stage]?.completedAt) throw conflict('Bu aşama zaten tamamlanmış');
    if (progress[stage]?.acceptedBy && progress[stage].acceptedBy !== req.user.id && req.user.role !== 'Yönetim') throw conflict('Bu iş başka personel tarafından kabul edilmiş');
    await checkAndConsumeForOrder(client, { order, stage, actorUserId: req.user.id, ipAddress: req.ip });
    progress[stage] = { ...(progress[stage] || {}), acceptedAt: progress[stage]?.acceptedAt || new Date().toISOString(), acceptedBy: progress[stage]?.acceptedBy || req.user.id, completedAt: new Date().toISOString(), completedBy: req.user.id };
    let status = afterStageCompleteStatus[stage] || order.status;
    let factoryCompletedAt = order.factory_completed_at;
    if (stage === 'montaj') { status = 'sevkiyata-hazir'; factoryCompletedAt = new Date(); progress.depo = progress.depo || { readyAt: new Date().toISOString() }; }
    const updated = (await client.query(`UPDATE orders SET stage_progress=$1, status=$2, factory_completed_at=$3, updated_at=now() WHERE id=$4 RETURNING *`, [JSON.stringify(progress), status, factoryCompletedAt, order.id])).rows[0];
    const event = (await client.query(`INSERT INTO production_events(order_id, stage, event_type, user_id, employee_id, points, note) VALUES($1,$2,'complete',$3,$4,$5,$6) RETURNING *`, [order.id, stage, req.user.id, employeeId, Number(req.body?.points || 0), 'İş tamamlandı'])).rows[0];
    await audit(client, { actorUserId: req.user.id, action: 'complete_stage', entityType: 'order', entityId: order.id, beforeData: order, afterData: updated, ipAddress: req.ip });
    return { order: updated, event };
  });
  res.json({ ok: true, item: mapOrder(result.order), event: result.event });
}));

ordersRouter.post('/:id/warehouse-accept', asyncHandler(async (req, res) => {
  const result = await tx(async (client) => {
    const order = await getOrderForUpdate(client, req.params.id);
    const employeeId = await employeeIdForUser(client, req.user.id);
    if (!order.factory_completed_at) throw conflict('Ürün montajdan çıkmadan depoya alınamaz');
    if (order.warehouse_accepted_at) throw conflict('Ürün zaten depoya alınmış');
    const progress = order.stage_progress || {};
    progress.depo = { ...(progress.depo || {}), acceptedAt: new Date().toISOString(), acceptedBy: req.user.id };
    const updated = (await client.query(`UPDATE orders SET stage_progress=$1, warehouse_accepted_at=now(), updated_at=now() WHERE id=$2 RETURNING *`, [JSON.stringify(progress), order.id])).rows[0];
    const event = (await client.query(`INSERT INTO production_events(order_id, stage, event_type, user_id, employee_id, note) VALUES($1,'depo','warehouse_accept',$2,$3,'Depoya kabul edildi') RETURNING *`, [order.id, req.user.id, employeeId])).rows[0];
    await audit(client, { actorUserId: req.user.id, action: 'warehouse_accept', entityType: 'order', entityId: order.id, beforeData: order, afterData: updated, ipAddress: req.ip });
    return { order: updated, event };
  });
  res.json({ ok: true, item: mapOrder(result.order), event: result.event });
}));

ordersRouter.post('/:id/ship', asyncHandler(async (req, res) => {
  const result = await tx(async (client) => {
    const order = await getOrderForUpdate(client, req.params.id);
    const employeeId = await employeeIdForUser(client, req.user.id);
    if (!order.warehouse_accepted_at) throw conflict('Ürün depoya alınmadan sevk edilemez');
    if (order.shipped_at) throw conflict('Sipariş zaten sevk edilmiş');
    const updated = (await client.query(`UPDATE orders SET status='sevk-edildi', shipped_at=now(), updated_at=now() WHERE id=$1 RETURNING *`, [order.id])).rows[0];
    let salesTx = null;
    if (order.customer_account_id && !order.sales_posted_at && Number(order.total_amount) > 0) {
      salesTx = await postAccountTransaction(client, { accountId: order.customer_account_id, type: 'sales_invoice', amount: Number(order.total_amount), documentNo: order.order_no, documentDate: new Date().toISOString().slice(0,10), description: `Sevk satış tahakkuku: ${order.order_no}`, relatedType: 'order', relatedId: order.id, actorUserId: req.user.id, ipAddress: req.ip });
      await client.query(`UPDATE orders SET sales_posted_at=now() WHERE id=$1`, [order.id]);
    }
    const event = (await client.query(`INSERT INTO production_events(order_id, stage, event_type, user_id, employee_id, note) VALUES($1,'depo','ship',$2,$3,'Sevk edildi') RETURNING *`, [order.id, req.user.id, employeeId])).rows[0];
    await audit(client, { actorUserId: req.user.id, action: 'ship_order', entityType: 'order', entityId: order.id, beforeData: order, afterData: updated, ipAddress: req.ip });
    return { order: updated, event, salesTransaction: salesTx };
  });
  res.json({ ok: true, item: mapOrder(result.order), event: result.event, salesTransaction: result.salesTransaction });
}));

async function getOrderForUpdate(client, id) {
  const order = (await client.query(`SELECT * FROM orders WHERE id=$1 FOR UPDATE`, [id])).rows[0];
  if (!order) throw notFound('Sipariş bulunamadı');
  if (typeof order.stage_progress === 'string') order.stage_progress = JSON.parse(order.stage_progress || '{}');
  if (typeof order.products === 'string') order.products = JSON.parse(order.products || '[]');
  return order;
}
async function employeeIdForUser(client, userId) {
  return (await client.query(`SELECT id FROM employees WHERE linked_user_id=$1 AND is_active=true LIMIT 1`, [userId])).rows[0]?.id || null;
}
function assertStageCanStart(progress, stage) {
  const index = productionStages.indexOf(stage);
  if (index <= 0) return;
  const prev = productionStages[index - 1];
  if (!progress[prev]?.completedAt) throw conflict(`${stage} aşaması için önce ${prev} aşaması tamamlanmalı`);
}
function mapOrder(row) { return { ...row, products: row.products || [], stageProgress: row.stage_progress || {} }; }
