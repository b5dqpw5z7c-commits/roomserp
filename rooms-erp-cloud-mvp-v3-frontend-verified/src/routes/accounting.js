import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db.js';
import { requireAuth, requireFinance } from '../middleware/auth.js';
import { asyncHandler } from '../utils/async-handler.js';
import { badRequest } from '../errors.js';
import { audit } from '../services/audit.js';
import { loadAccountForOperation, postAccountTransaction, postCashTransaction, reverseAccountTransaction } from '../services/accounting.js';

export const accountingRouter = Router();
accountingRouter.use(requireAuth);

const docSchema = z.object({
  accountId: z.string().uuid(),
  amount: z.coerce.number().positive(),
  vatRate: z.coerce.number().min(0).max(100).default(0),
  documentNo: z.string().max(80).optional().nullable(),
  documentDate: z.string().max(10).optional(),
  dueDate: z.string().max(10).optional().nullable(),
  description: z.string().max(500).optional().nullable(),
  channel: z.string().max(40).default('cash')
});

accountingRouter.post('/customer-collection', requireFinance, asyncHandler(async (req, res) => {
  const body = docSchema.parse(req.body || {});
  const result = await tx(async (client) => {
    await loadAccountForOperation(client, body.accountId, ['customer']);
    const at = await postAccountTransaction(client, { accountId: body.accountId, type: 'collection', amount: body.amount, vatRate: 0, documentNo: body.documentNo, documentDate: body.documentDate, dueDate: body.dueDate, description: body.description || 'Müşteri tahsilatı / avans', actorUserId: req.user.id, ipAddress: req.ip });
    const ct = await postCashTransaction(client, { flow: 'in', channel: body.channel, amount: body.amount, documentNo: body.documentNo, documentDate: body.documentDate, description: body.description || 'Müşteri tahsilatı / avans', accountTransactionId: at.id, actorUserId: req.user.id, ipAddress: req.ip });
    return { accountTransaction: at, cashTransaction: ct };
  });
  res.status(201).json({ ok: true, ...result });
}));

accountingRouter.post('/supplier-invoice', requireFinance, asyncHandler(async (req, res) => {
  const body = docSchema.parse(req.body || {});
  const item = await tx(async (client) => {
    await loadAccountForOperation(client, body.accountId, ['supplier']);
    return postAccountTransaction(client, { accountId: body.accountId, type: 'purchase_invoice', amount: body.amount, vatRate: body.vatRate, documentNo: body.documentNo, documentDate: body.documentDate, dueDate: body.dueDate, description: body.description || 'Tedarikçi faturası', actorUserId: req.user.id, ipAddress: req.ip });
  });
  res.status(201).json({ ok: true, item });
}));

accountingRouter.post('/supplier-payment', requireFinance, asyncHandler(async (req, res) => {
  const body = docSchema.parse(req.body || {});
  const result = await tx(async (client) => {
    await loadAccountForOperation(client, body.accountId, ['supplier']);
    const at = await postAccountTransaction(client, { accountId: body.accountId, type: 'payment', amount: body.amount, documentNo: body.documentNo, documentDate: body.documentDate, description: body.description || 'Tedarikçi ödemesi / avans', actorUserId: req.user.id, ipAddress: req.ip });
    const ct = await postCashTransaction(client, { flow: 'out', channel: body.channel, amount: body.amount, documentNo: body.documentNo, documentDate: body.documentDate, description: body.description || 'Tedarikçi ödemesi / avans', accountTransactionId: at.id, actorUserId: req.user.id, ipAddress: req.ip });
    return { accountTransaction: at, cashTransaction: ct };
  });
  res.status(201).json({ ok: true, ...result });
}));

accountingRouter.post('/expense', requireFinance, asyncHandler(async (req, res) => {
  const schema = z.object({ title: z.string().min(2).max(180), category: z.string().min(1).max(80), amount: z.coerce.number().positive(), vatRate: z.coerce.number().min(0).max(100).default(0), paymentStatus: z.enum(['paid','unpaid']).default('paid'), channel: z.string().max(40).default('cash'), documentNo: z.string().max(80).optional().nullable(), documentDate: z.string().max(10).optional(), description: z.string().max(500).optional().nullable() });
  const body = schema.parse(req.body || {});
  const result = await tx(async (client) => {
    let cash = null;
    if (body.paymentStatus === 'paid') {
      cash = await postCashTransaction(client, { flow: 'out', channel: body.channel, amount: body.amount, documentNo: body.documentNo, documentDate: body.documentDate, description: body.description || body.title, relatedType: 'expense', actorUserId: req.user.id, ipAddress: req.ip });
    }
    const exp = (await client.query(
      `INSERT INTO expenses(category, title, amount, vat_rate, payment_status, cash_transaction_id, document_no, document_date, description, created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [body.category, body.title, body.amount, body.vatRate, body.paymentStatus, cash?.id || null, body.documentNo || null, body.documentDate || new Date().toISOString().slice(0,10), body.description || null, req.user.id]
    )).rows[0];
    if (cash) await client.query(`UPDATE cash_transactions SET related_id=$1 WHERE id=$2`, [exp.id, cash.id]);
    await audit(client, { actorUserId: req.user.id, action: 'create_expense', entityType: 'expense', entityId: exp.id, afterData: exp, ipAddress: req.ip });
    return { expense: exp, cashTransaction: cash };
  });
  res.status(201).json({ ok: true, ...result });
}));

accountingRouter.post('/cash-transfer', requireFinance, asyncHandler(async (req, res) => {
  const schema = z.object({ fromChannel: z.string().min(1), toChannel: z.string().min(1), amount: z.coerce.number().positive(), documentNo: z.string().optional().nullable(), documentDate: z.string().optional(), description: z.string().optional().nullable() });
  const body = schema.parse(req.body || {});
  if (body.fromChannel === body.toChannel) throw badRequest('Kaynak ve hedef kanal aynı olamaz');
  const item = await tx(async (client) => postCashTransaction(client, { flow: 'transfer', channel: body.fromChannel, targetChannel: body.toChannel, amount: body.amount, documentNo: body.documentNo, documentDate: body.documentDate, description: body.description || 'Virman', actorUserId: req.user.id, ipAddress: req.ip }));
  res.status(201).json({ ok: true, item });
}));

accountingRouter.post('/transactions/:id/reverse', requireFinance, asyncHandler(async (req, res) => {
  const item = await tx(async (client) => reverseAccountTransaction(client, { transactionId: req.params.id, actorUserId: req.user.id, ipAddress: req.ip }));
  res.json({ ok: true, item });
}));

accountingRouter.get('/cashbook', requireFinance, asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 100), 500);
  const result = await query(`SELECT * FROM cash_transactions ORDER BY document_date DESC, created_at DESC LIMIT $1`, [limit]);
  res.json({ ok: true, items: result.rows });
}));

accountingRouter.get('/summary', requireFinance, asyncHandler(async (_req, res) => {
  const [sales, purchases, expenses, cash] = await Promise.all([
    query(`SELECT COALESCE(SUM(amount),0) value FROM account_transactions WHERE type='sales_invoice' AND reversed_by IS NULL AND date_trunc('month', document_date)=date_trunc('month', current_date)`),
    query(`SELECT COALESCE(SUM(amount),0) value FROM account_transactions WHERE type='purchase_invoice' AND reversed_by IS NULL AND date_trunc('month', document_date)=date_trunc('month', current_date)`),
    query(`SELECT COALESCE(SUM(amount),0) value FROM expenses WHERE date_trunc('month', document_date)=date_trunc('month', current_date)`),
    query(`
      WITH cash_lines AS (
        SELECT channel, CASE WHEN flow='in' THEN amount WHEN flow='out' THEN -amount WHEN flow='transfer' THEN -amount ELSE 0 END AS delta
        FROM cash_transactions WHERE reversed_by IS NULL
        UNION ALL
        SELECT target_channel AS channel, amount AS delta
        FROM cash_transactions
        WHERE flow='transfer' AND target_channel IS NOT NULL AND reversed_by IS NULL
      )
      SELECT channel, COALESCE(SUM(delta),0) balance
      FROM cash_lines
      GROUP BY channel
      ORDER BY channel`)
  ]);
  const monthlySales = Number(sales.rows[0].value || 0);
  const monthlyPurchases = Number(purchases.rows[0].value || 0);
  const monthlyExpenses = Number(expenses.rows[0].value || 0);
  res.json({ ok: true, summary: { monthlySales, monthlyPurchases, monthlyExpenses, accrualProfit: monthlySales - monthlyPurchases - monthlyExpenses, cashByChannel: cash.rows } });
}));
