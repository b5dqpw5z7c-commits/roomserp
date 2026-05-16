import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db.js';
import { requireAuth, requireFinance } from '../middleware/auth.js';
import { asyncHandler } from '../utils/async-handler.js';
import { badRequest } from '../errors.js';
import { audit } from '../services/audit.js';
import { loadAccountForOperation, postAccountTransaction, postCashTransaction, splitVat } from '../services/accounting.js';

export const purchasesRouter = Router();
purchasesRouter.use(requireAuth);

const purchaseSchema = z.object({
  supplierId: z.string().uuid(),
  items: z.array(z.object({
    materialId: z.string().uuid(),
    variantId: z.string().uuid().optional().nullable(),
    qty: z.coerce.number().positive(),
    unitCost: z.coerce.number().min(0),
    vatRate: z.coerce.number().min(0).max(100).optional().default(0)
  })).min(1),
  documentNo: z.string().max(80).optional().nullable(),
  documentDate: z.string().max(10).optional(),
  dueDate: z.string().max(10).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  vatRate: z.coerce.number().min(0).max(100).default(20),
  payNow: z.boolean().default(false),
  channel: z.string().max(40).default('cash')
});

purchasesRouter.post('/', requireFinance, asyncHandler(async (req, res) => {
  const body = purchaseSchema.parse(req.body || {});
  const documentDate = body.documentDate || new Date().toISOString().slice(0, 10);

  const result = await tx(async (client) => {
    await loadAccountForOperation(client, body.supplierId, ['supplier']);

    const normalizedItems = [];
    let grossTotal = 0;
    let netTotal = 0;
    let vatTotal = 0;

    for (const inputItem of body.items) {
      const material = (await client.query(`SELECT * FROM materials WHERE id=$1 AND is_active=true FOR UPDATE`, [inputItem.materialId])).rows[0];
      if (!material) throw badRequest('Satın alma kaleminde malzeme bulunamadı');

      const variantId = await ensureVariant(client, inputItem.materialId, inputItem.variantId);
      const gross = Number(inputItem.qty) * Number(inputItem.unitCost);
      const vatRate = inputItem.vatRate ?? body.vatRate;
      const split = splitVat(gross, vatRate);
      grossTotal += split.grossAmount;
      netTotal += split.netAmount;
      vatTotal += split.vatAmount;
      normalizedItems.push({ ...inputItem, variantId, grossAmount: split.grossAmount, netAmount: split.netAmount, vatAmount: split.vatAmount, vatRate });
    }

    grossTotal = Math.round(grossTotal * 100) / 100;
    netTotal = Math.round(netTotal * 100) / 100;
    vatTotal = Math.round(vatTotal * 100) / 100;

    const purchaseDoc = (await client.query(
      `INSERT INTO purchase_documents(supplier_id, document_no, document_date, due_date, gross_amount, net_amount, vat_amount, vat_rate, payment_status, notes, created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [body.supplierId, body.documentNo || null, documentDate, body.dueDate || null, grossTotal, netTotal, vatTotal, body.vatRate, body.payNow ? 'paid' : 'unpaid', body.notes || null, req.user.id]
    )).rows[0];

    const invoiceTx = await postAccountTransaction(client, {
      accountId: body.supplierId,
      type: 'purchase_invoice',
      amount: grossTotal,
      vatRate: body.vatRate,
      documentNo: body.documentNo,
      documentDate,
      dueDate: body.dueDate,
      description: body.notes || 'Hammadde alımı',
      relatedType: 'purchase_document',
      relatedId: purchaseDoc.id,
      actorUserId: req.user.id,
      ipAddress: req.ip
    });

    await client.query(`UPDATE purchase_documents SET account_transaction_id=$1 WHERE id=$2`, [invoiceTx.id, purchaseDoc.id]);

    const movements = [];
    for (const item of normalizedItems) {
      await client.query(
        `INSERT INTO purchase_items(purchase_document_id, material_id, variant_id, qty, unit_cost, gross_amount, net_amount, vat_amount, vat_rate)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [purchaseDoc.id, item.materialId, item.variantId, item.qty, item.unitCost, item.grossAmount, item.netAmount, item.vatAmount, item.vatRate]
      );
      await client.query(
        `UPDATE material_variants SET stock=stock+$1, unit_cost=CASE WHEN $2>0 THEN $2 ELSE unit_cost END WHERE id=$3`,
        [item.qty, item.unitCost, item.variantId]
      );
      const movement = (await client.query(
        `INSERT INTO stock_movements(material_id, variant_id, type, direction, qty, unit_cost, reference_type, reference_id, note, created_by)
         VALUES($1,$2,'purchase_entry','in',$3,$4,'purchase_document',$5,$6,$7) RETURNING *`,
        [item.materialId, item.variantId, item.qty, item.unitCost, purchaseDoc.id, body.notes || 'Satın alma', req.user.id]
      )).rows[0];
      movements.push(movement);
    }

    let paymentTx = null;
    let cashTx = null;
    if (body.payNow && grossTotal > 0) {
      paymentTx = await postAccountTransaction(client, {
        accountId: body.supplierId,
        type: 'payment',
        amount: grossTotal,
        documentNo: body.documentNo,
        documentDate,
        description: 'Peşin satın alma ödemesi',
        relatedType: 'purchase_document',
        relatedId: purchaseDoc.id,
        actorUserId: req.user.id,
        ipAddress: req.ip
      });
      cashTx = await postCashTransaction(client, {
        flow: 'out',
        channel: body.channel,
        amount: grossTotal,
        documentNo: body.documentNo,
        documentDate,
        description: body.notes || 'Hammadde alımı ödemesi',
        accountTransactionId: paymentTx.id,
        relatedType: 'purchase_document',
        relatedId: purchaseDoc.id,
        actorUserId: req.user.id,
        ipAddress: req.ip
      });
      await client.query(`UPDATE purchase_documents SET payment_account_transaction_id=$1, cash_transaction_id=$2 WHERE id=$3`, [paymentTx.id, cashTx.id, purchaseDoc.id]);
    }

    await audit(client, {
      actorUserId: req.user.id,
      action: 'create_purchase_document',
      entityType: 'purchase_document',
      entityId: purchaseDoc.id,
      afterData: { purchaseDoc, itemCount: normalizedItems.length, grossTotal, payNow: body.payNow },
      ipAddress: req.ip
    });

    return { purchaseDocument: purchaseDoc, invoiceTransaction: invoiceTx, movements, paymentTransaction: paymentTx, cashTransaction: cashTx };
  });

  res.status(201).json({ ok: true, ...result });
}));

purchasesRouter.get('/', requireFinance, asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 60), 300);
  const result = await query(
    `SELECT pd.*, a.name AS supplier_name, at.id AS invoice_transaction_id
     FROM purchase_documents pd
     LEFT JOIN accounts a ON a.id=pd.supplier_id
     LEFT JOIN account_transactions at ON at.id=pd.account_transaction_id
     ORDER BY pd.document_date DESC, pd.created_at DESC
     LIMIT $1`,
    [limit]
  );
  res.json({ ok: true, items: result.rows });
}));

purchasesRouter.get('/:id', requireFinance, asyncHandler(async (req, res) => {
  const doc = (await query(
    `SELECT pd.*, a.name AS supplier_name FROM purchase_documents pd LEFT JOIN accounts a ON a.id=pd.supplier_id WHERE pd.id=$1`,
    [req.params.id]
  )).rows[0];
  if (!doc) throw badRequest('Satın alma belgesi bulunamadı');
  const items = (await query(
    `SELECT pi.*, m.name AS material_name, mv.name AS variant_name, m.unit
     FROM purchase_items pi
     LEFT JOIN materials m ON m.id=pi.material_id
     LEFT JOIN material_variants mv ON mv.id=pi.variant_id
     WHERE pi.purchase_document_id=$1
     ORDER BY pi.created_at`,
    [req.params.id]
  )).rows;
  res.json({ ok: true, item: doc, items });
}));

async function ensureVariant(client, materialId, variantId) {
  if (variantId) {
    const exists = (await client.query(`SELECT id FROM material_variants WHERE id=$1 AND material_id=$2 FOR UPDATE`, [variantId, materialId])).rows[0];
    if (!exists) throw badRequest('Varyant bu malzemeye ait değil');
    return exists.id;
  }
  const existing = (await client.query(`SELECT id FROM material_variants WHERE material_id=$1 ORDER BY name LIMIT 1 FOR UPDATE`, [materialId])).rows[0];
  if (existing) return existing.id;
  const created = (await client.query(`INSERT INTO material_variants(material_id, name, stock, unit_cost) VALUES($1,'Standart',0,0) RETURNING id`, [materialId])).rows[0];
  return created.id;
}
