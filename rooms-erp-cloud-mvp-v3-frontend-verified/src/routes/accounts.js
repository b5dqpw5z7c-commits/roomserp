import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db.js';
import { requireAuth, requireFinance } from '../middleware/auth.js';
import { asyncHandler } from '../utils/async-handler.js';
import { audit } from '../services/audit.js';

export const accountsRouter = Router();
accountsRouter.use(requireAuth);

accountsRouter.get('/', asyncHandler(async (req, res) => {
  const type = req.query.type;
  const params = [];
  let where = 'WHERE is_active=true';
  if (type === 'customer' || type === 'supplier') { params.push(type); where += ` AND type=$${params.length}`; }
  const result = await query(`
    SELECT a.*, COALESCE(SUM(CASE WHEN at.direction='debit' THEN at.amount ELSE -at.amount END),0) AS raw_balance
    FROM accounts a
    LEFT JOIN account_transactions at ON at.account_id=a.id AND at.reversed_by IS NULL
    ${where}
    GROUP BY a.id
    ORDER BY a.created_at DESC`, params);
  res.json({ ok: true, items: result.rows.map(mapAccount) });
}));

accountsRouter.get('/:id', asyncHandler(async (req, res) => {
  const account = (await query(`SELECT * FROM accounts WHERE id=$1`, [req.params.id])).rows[0];
  if (!account) {
    res.status(404).json({ ok: false, message: 'Cari/tedarikçi kartı bulunamadı' });
    return;
  }
  const balanceRow = (await query(`SELECT COALESCE(SUM(CASE WHEN direction='debit' THEN amount ELSE -amount END),0) AS raw_balance FROM account_transactions WHERE account_id=$1 AND reversed_by IS NULL`, [req.params.id])).rows[0];
  const txs = await query(`SELECT * FROM account_transactions WHERE account_id=$1 ORDER BY document_date DESC, created_at DESC LIMIT 200`, [req.params.id]);
  res.json({ ok: true, item: mapAccount({ ...account, raw_balance: balanceRow.raw_balance }), transactions: txs.rows.map(mapAccountTx) });
}));

accountsRouter.post('/', requireFinance, asyncHandler(async (req, res) => {
  const schema = z.object({ type: z.enum(['customer','supplier']), code: z.string().max(40).optional(), name: z.string().min(2).max(180), title: z.string().max(220).optional().nullable(), address: z.string().max(500).optional().nullable(), taxOffice: z.string().max(120).optional().nullable(), taxNo: z.string().max(40).optional().nullable(), phone: z.string().max(60).optional().nullable(), contactPerson: z.string().max(120).optional().nullable(), priceList: z.string().max(120).optional().nullable(), discountRate: z.coerce.number().min(0).max(100).default(0), specialTerms: z.string().max(1000).optional().nullable() });
  const body = schema.parse(req.body || {});
  const code = body.code || `${body.type === 'customer' ? 'C' : 'S'}-${Date.now().toString().slice(-8)}`;
  const item = await tx(async (client) => {
    const result = await client.query(
      `INSERT INTO accounts(type, code, name, title, address, tax_office, tax_no, phone, contact_person, price_list, discount_rate, special_terms, created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [body.type, code, body.name, body.title, body.address, body.taxOffice, body.taxNo, body.phone, body.contactPerson, body.priceList, body.discountRate, body.specialTerms, req.user.id]
    );
    await audit(client, { actorUserId: req.user.id, action: 'create_account', entityType: 'account', entityId: result.rows[0].id, afterData: result.rows[0], ipAddress: req.ip });
    return result.rows[0];
  });
  res.status(201).json({ ok: true, item: mapAccount(item) });
}));

function mapAccount(row) {
  if (!row) return null;
  const raw = Number(row.raw_balance || 0);
  const balance = row.type === 'supplier' ? -raw : raw;
  return { ...row, balance };
}
function mapAccountTx(row) { return row; }
