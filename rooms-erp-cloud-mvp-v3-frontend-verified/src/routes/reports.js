import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/async-handler.js';

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

reportsRouter.get('/dashboard', asyncHandler(async (_req, res) => {
  const [orders, production, accounting, inventory, employees] = await Promise.all([
    query(`SELECT status, COUNT(*)::int count, COALESCE(SUM(total_amount),0)::numeric total FROM orders GROUP BY status`),
    query(`SELECT stage, event_type, COUNT(*)::int count, COALESCE(SUM(points),0)::numeric points FROM production_events WHERE created_at >= date_trunc('month', now()) GROUP BY stage, event_type`),
    query(`SELECT
      (SELECT COALESCE(SUM(amount),0) FROM account_transactions WHERE type='sales_invoice' AND reversed_by IS NULL AND date_trunc('month', document_date)=date_trunc('month', current_date)) AS sales,
      (SELECT COALESCE(SUM(amount),0) FROM account_transactions WHERE type='purchase_invoice' AND reversed_by IS NULL AND date_trunc('month', document_date)=date_trunc('month', current_date)) AS purchases,
      (SELECT COALESCE(SUM(amount),0) FROM expenses WHERE date_trunc('month', document_date)=date_trunc('month', current_date)) AS expenses,
      (WITH cash_lines AS (
        SELECT CASE WHEN flow='transfer' THEN channel ELSE channel END AS channel,
               CASE WHEN flow='in' THEN amount WHEN flow='out' THEN -amount WHEN flow='transfer' THEN -amount ELSE 0 END AS delta
        FROM cash_transactions WHERE reversed_by IS NULL AND date_trunc('month', document_date)=date_trunc('month', current_date)
        UNION ALL
        SELECT target_channel, amount
        FROM cash_transactions
        WHERE flow='transfer' AND target_channel IS NOT NULL AND reversed_by IS NULL AND date_trunc('month', document_date)=date_trunc('month', current_date)
      ) SELECT COALESCE(SUM(delta),0) FROM cash_lines) AS cash_flow`),
    query(`SELECT COUNT(*) FILTER (WHERE mv.stock <= m.critical_level)::int AS critical_variants FROM material_variants mv JOIN materials m ON m.id=mv.material_id`),
    query(`SELECT COUNT(*)::int active_employees FROM employees WHERE is_active=true`)
  ]);
  const acc = accounting.rows[0];
  res.json({ ok: true, dashboard: { orders: orders.rows, production: production.rows, accounting: { sales: Number(acc.sales), purchases: Number(acc.purchases), expenses: Number(acc.expenses), profit: Number(acc.sales)-Number(acc.purchases)-Number(acc.expenses), cashFlow: Number(acc.cash_flow) }, inventory: inventory.rows[0], employees: employees.rows[0] } });
}));
