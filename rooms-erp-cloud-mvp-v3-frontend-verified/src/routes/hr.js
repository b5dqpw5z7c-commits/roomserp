import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { query, tx } from '../db.js';
import { requireAuth, requireFinance } from '../middleware/auth.js';
import { asyncHandler } from '../utils/async-handler.js';
import { badRequest, notFound, conflict } from '../errors.js';
import { audit } from '../services/audit.js';
import { postCashTransaction, round2 } from '../services/accounting.js';

export const hrRouter = Router();
hrRouter.use(requireAuth);

hrRouter.get('/employees', asyncHandler(async (_req, res) => {
  const result = await query(`SELECT e.*, u.username AS linked_username FROM employees e LEFT JOIN users u ON u.id=e.linked_user_id WHERE e.is_active=true ORDER BY e.name`);
  res.json({ ok: true, items: result.rows });
}));

hrRouter.post('/employees', asyncHandler(async (req, res) => {
  const schema = z.object({ linkedUserId: z.string().uuid().optional().nullable(), name: z.string().min(2), department: z.string().min(1), role: z.string().optional().nullable(), salary: z.coerce.number().min(0).default(0), weeklyTarget: z.coerce.number().min(0).default(4500), monthlyTarget: z.coerce.number().min(0).default(18000) });
  const body = schema.parse(req.body || {});
  const item = await tx(async (client) => {
    const result = await client.query(`INSERT INTO employees(linked_user_id, name, department, role, salary, weekly_target, monthly_target) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [body.linkedUserId, body.name, body.department, body.role, body.salary, body.weeklyTarget, body.monthlyTarget]);
    await audit(client, { actorUserId: req.user.id, action: 'create_employee', entityType: 'employee', entityId: result.rows[0].id, afterData: result.rows[0], ipAddress: req.ip });
    return result.rows[0];
  });
  res.status(201).json({ ok: true, item });
}));

hrRouter.post('/attendance-scan', asyncHandler(async (req, res) => {
  const schema = z.object({ gateQr: z.string().min(1) });
  const body = schema.parse(req.body || {});
  const settings = (await query(`SELECT value FROM app_settings WHERE key='attendance_rules'`)).rows[0]?.value || {};
  if (body.gateQr !== settings.gateQr) throw badRequest('Geçersiz puantaj QR kodu');
  const employee = (await query(`SELECT * FROM employees WHERE linked_user_id=$1 AND is_active=true`, [req.user.id])).rows[0];
  if (!employee) throw notFound('Bu kullanıcıya bağlı personel kartı yok');

  const timezone = settings.timezone || config.businessTimezone || 'Europe/Istanbul';
  const now = new Date();
  const todayKey = localDateKey(now, timezone);

  const result = await tx(async (client) => {
    const open = (await client.query(
      `SELECT * FROM attendance_logs
       WHERE employee_id=$1 AND check_out_at IS NULL
       ORDER BY check_in_at DESC LIMIT 1 FOR UPDATE`,
      [employee.id]
    )).rows[0];

    if (open) {
      const openDay = localDateKey(open.check_in_at, timezone);
      if (openDay !== todayKey) {
        await audit(client, { actorUserId: req.user.id, action: 'attendance_open_previous_day_blocked', entityType: 'attendance_log', entityId: open.id, beforeData: open, ipAddress: req.ip });
        throw conflict('Önceki günden açık puantaj kaydı var. Önce yönetici bu kaydı kapatmalı/düzeltmeli.');
      }
      const earlyLeaveMinutes = calcEarlyLeaveMinutes(now, settings.workEnd || '18:00', Number(settings.earlyLeaveToleranceMinutes || 10), timezone);
      const penaltyPoints = Number(open.penalty_points || 0) + earlyLeaveMinutes * Number(settings.penaltyPointsPerMinute || 2);
      const log = (await client.query(`UPDATE attendance_logs SET check_out_at=now(), early_leave_minutes=$1, penalty_points=$2 WHERE id=$3 RETURNING *`, [earlyLeaveMinutes, penaltyPoints, open.id])).rows[0];
      await audit(client, { actorUserId: req.user.id, action: 'attendance_check_out', entityType: 'attendance_log', entityId: log.id, afterData: log, ipAddress: req.ip });
      return { action: 'check_out', log };
    }

    const alreadyClosedToday = (await client.query(
      `SELECT id FROM attendance_logs WHERE employee_id=$1 AND check_in_at >= $2::date AND check_in_at < ($2::date + interval '1 day') AND check_out_at IS NOT NULL LIMIT 1`,
      [employee.id, todayKey]
    )).rows[0];
    if (alreadyClosedToday && settings.preventMultipleShifts !== false) {
      throw conflict('Bugün giriş-çıkış kaydı zaten kapanmış. İkinci vardiya gerekiyorsa ayarlardan izin verilmeli.');
    }

    const lateMinutes = calcLateMinutes(now, settings.workStart || '08:00', Number(settings.lateToleranceMinutes || 15), timezone);
    const penaltyPoints = lateMinutes * Number(settings.penaltyPointsPerMinute || 2);
    const log = (await client.query(`INSERT INTO attendance_logs(employee_id, check_in_at, late_minutes, penalty_points, created_by) VALUES($1,now(),$2,$3,$4) RETURNING *`, [employee.id, lateMinutes, penaltyPoints, req.user.id])).rows[0];
    await audit(client, { actorUserId: req.user.id, action: 'attendance_check_in', entityType: 'attendance_log', entityId: log.id, afterData: log, ipAddress: req.ip });
    return { action: 'check_in', log };
  });
  res.json({ ok: true, ...result });
}));

hrRouter.post('/employee-payment', requireFinance, asyncHandler(async (req, res) => {
  const schema = z.object({ employeeId: z.string().uuid(), type: z.enum(['payment','advance']), amount: z.coerce.number().positive(), channel: z.string().default('cash'), documentNo: z.string().optional().nullable(), documentDate: z.string().optional(), description: z.string().optional().nullable() });
  const body = schema.parse(req.body || {});
  const result = await tx(async (client) => {
    const employee = (await client.query(`SELECT * FROM employees WHERE id=$1 AND is_active=true FOR UPDATE`, [body.employeeId])).rows[0];
    if (!employee) throw notFound('Personel bulunamadı');
    const cash = await postCashTransaction(client, { flow: 'out', channel: body.channel, amount: body.amount, documentNo: body.documentNo, documentDate: body.documentDate, description: body.description || (body.type === 'advance' ? 'Personel avans' : 'Personel ödeme'), relatedType: 'employee_transaction', actorUserId: req.user.id, ipAddress: req.ip });
    const txrow = (await client.query(`INSERT INTO employee_transactions(employee_id, type, direction, amount, document_no, document_date, description, cash_transaction_id, created_by) VALUES($1,$2,'debit',$3,$4,$5,$6,$7,$8) RETURNING *`, [body.employeeId, body.type, body.amount, body.documentNo || null, body.documentDate || new Date().toISOString().slice(0,10), body.description || null, cash.id, req.user.id])).rows[0];
    await client.query(`UPDATE cash_transactions SET related_id=$1 WHERE id=$2`, [txrow.id, cash.id]);
    await audit(client, { actorUserId: req.user.id, action: body.type === 'advance' ? 'employee_advance' : 'employee_payment', entityType: 'employee_transaction', entityId: txrow.id, afterData: txrow, ipAddress: req.ip });
    return { employeeTransaction: txrow, cashTransaction: cash };
  });
  res.status(201).json({ ok: true, ...result });
}));

hrRouter.get('/employees/:id/payroll-preview', requireFinance, asyncHandler(async (req, res) => {
  const yr = Number(req.query.year || new Date().getFullYear());
  const mo = Number(req.query.month || (new Date().getMonth() + 1));
  const preview = await calculatePayrollPreview(req.params.id, yr, mo);
  res.json({ ok: true, preview });
}));

hrRouter.post('/employees/:id/payroll-run', requireFinance, asyncHandler(async (req, res) => {
  const schema = z.object({ year: z.coerce.number(), month: z.coerce.number(), channel: z.string().default('cash'), notes: z.string().optional().nullable() });
  const body = schema.parse(req.body || {});

  const result = await tx(async (client) => {
    const preview = await calculatePayrollPreview(req.params.id, body.year, body.month, client);
    if (preview.alreadyPaid) throw conflict('Bu dönem maaşı zaten ödenmiş');
    const netAmount = Number(preview.calculation.netSalary || 0);
    if (netAmount <= 0) throw badRequest('Ödenecek net maaş sıfır veya negatif');

    const docDate = new Date().toISOString().slice(0, 10);
    const desc = body.notes || `${preview.employee.name} — ${body.year}/${String(body.month).padStart(2,'0')} maaş`;
    const cash = await postCashTransaction(client, { flow: 'out', channel: body.channel, amount: netAmount, documentDate: docDate, description: desc, relatedType: 'employee_transaction', actorUserId: req.user.id, ipAddress: req.ip });
    const txrow = (await client.query(
      `INSERT INTO employee_transactions(employee_id, type, direction, amount, document_date, description, cash_transaction_id, created_by, payroll_year, payroll_month)
       VALUES($1,'earning','debit',$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.params.id, netAmount, docDate, desc, cash.id, req.user.id, body.year, body.month]
    )).rows[0];
    await client.query(`UPDATE cash_transactions SET related_id=$1 WHERE id=$2`, [txrow.id, cash.id]);
    await audit(client, { actorUserId: req.user.id, action: 'payroll_run', entityType: 'employee', entityId: req.params.id, afterData: { netAmount, period: `${body.year}/${body.month}`, calculation: preview.calculation }, ipAddress: req.ip });
    return { preview, employeeTransaction: txrow, cashTransaction: cash };
  });

  res.status(201).json({ ok: true, ...result });
}));

async function calculatePayrollPreview(employeeId, yr, mo, clientOverride) {
  const db = clientOverride || { query };
  const employee = (await db.query(`SELECT * FROM employees WHERE id=$1 AND is_active=true`, [employeeId])).rows[0];
  if (!employee) throw notFound('Personel bulunamadı');

  const settings = (await db.query(`SELECT value FROM app_settings WHERE key='payroll_rules'`)).rows[0]?.value || {};
  const tolerancePct = Number(settings.performanceTolerancePercent || 95);
  const lossMultiplier = Number(settings.lossMultiplier || 2);
  const attendancePenaltyValuePerPoint = Number(settings.attendancePenaltyValuePerPoint ?? settings.penaltyPointsRate ?? 0.1);

  const pStart = `${yr}-${String(mo).padStart(2,'0')}-01`;
  const pEnd = `${yr}-${String(mo).padStart(2,'0')}-${new Date(yr, mo, 0).getDate()}`;

  const [pointsRow, penaltyRow, advRow, paidRow] = await Promise.all([
    db.query(`SELECT COALESCE(SUM(points),0)::numeric pts FROM production_events WHERE employee_id=$1 AND created_at >= $2::date AND created_at < ($3::date + interval '1 day') AND event_type='complete'`, [employeeId, pStart, pEnd]),
    db.query(`SELECT COALESCE(SUM(penalty_points),0)::numeric pen FROM attendance_logs WHERE employee_id=$1 AND check_in_at >= $2::date AND check_in_at < ($3::date + interval '1 day')`, [employeeId, pStart, pEnd]),
    db.query(`SELECT COALESCE(SUM(amount),0)::numeric adv FROM employee_transactions WHERE employee_id=$1 AND type='advance' AND document_date BETWEEN $2 AND $3`, [employeeId, pStart, pEnd]),
    db.query(`SELECT id FROM employee_transactions WHERE employee_id=$1 AND type='earning' AND payroll_year=$2 AND payroll_month=$3 LIMIT 1`, [employeeId, yr, mo])
  ]);

  const totalPoints = Number(pointsRow.rows[0].pts);
  const attendancePenaltyPoints = Number(penaltyRow.rows[0].pen);
  const totalAdvance = Number(advRow.rows[0].adv);
  const alreadyPaid = paidRow.rows.length > 0;

  const baseSalary = Number(employee.salary || 0);
  const monthlyTarget = Number(employee.monthly_target || 18000);
  const performancePct = monthlyTarget > 0 ? Math.min(100, round2((totalPoints / monthlyTarget) * 100)) : 100;
  const lossPercent = performancePct < tolerancePct ? Math.max(0, 100 - performancePct) : 0;
  const performanceDeductionRate = round2(lossPercent * lossMultiplier);
  const performanceDeduction = round2(baseSalary * (performanceDeductionRate / 100));
  const attendancePenaltyDeduction = round2(attendancePenaltyPoints * attendancePenaltyValuePerPoint);
  const earnedSalary = Math.max(0, round2(baseSalary - performanceDeduction));
  const netSalary = Math.max(0, round2(earnedSalary - attendancePenaltyDeduction - totalAdvance));

  return {
    employee: { id: employee.id, name: employee.name, department: employee.department, salary: baseSalary },
    period: { year: yr, month: mo, start: pStart, end: pEnd },
    production: { totalPoints, monthlyTarget, performancePct, tolerancePct },
    deductions: { performanceDeductionRate, performanceDeduction, attendancePenaltyPoints, attendancePenaltyDeduction, totalAdvance },
    calculation: { baseSalary, earnedSalary, penaltyDeduction: attendancePenaltyDeduction, advanceDeduction: totalAdvance, netSalary },
    alreadyPaid
  };
}

function calcLateMinutes(now, startHHmm, tolerance, timezone) {
  const { hour, minute } = localTimeParts(now, timezone);
  const current = hour * 60 + minute;
  const [h, m] = startHHmm.split(':').map(Number);
  const start = h * 60 + m;
  return Math.max(0, current - start - tolerance);
}

function calcEarlyLeaveMinutes(now, endHHmm, tolerance, timezone) {
  const { hour, minute } = localTimeParts(now, timezone);
  const current = hour * 60 + minute;
  const [h, m] = endHHmm.split(':').map(Number);
  const end = h * 60 + m;
  return Math.max(0, end - current - tolerance);
}

function localDateKey(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(date));
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function localTimeParts(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(date));
  return {
    hour: Number(parts.find((p) => p.type === 'hour')?.value || 0),
    minute: Number(parts.find((p) => p.type === 'minute')?.value || 0)
  };
}
