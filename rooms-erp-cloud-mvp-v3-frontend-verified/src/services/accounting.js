import { badRequest } from '../errors.js';
import { audit } from './audit.js';

export function accountDirection(accountType, operation) {
  const rules = {
    customer: {
      sales_invoice: 'debit',
      collection: 'credit',
      advance: 'credit',
      reversal: 'credit'
    },
    supplier: {
      purchase_invoice: 'credit',
      payment: 'debit',
      advance_payment: 'debit',
      reversal: 'debit'
    }
  };
  return rules[accountType]?.[operation];
}

export async function loadAccountForOperation(client, accountId, allowedTypes = []) {
  const account = (await client.query(`SELECT * FROM accounts WHERE id=$1 AND is_active=true FOR UPDATE`, [accountId])).rows[0];
  if (!account) throw badRequest('Cari/tedarikçi bulunamadı');
  if (allowedTypes.length && !allowedTypes.includes(account.type)) {
    throw badRequest(`Bu işlem yalnızca ${allowedTypes.join('/')} hesabı için yapılabilir`);
  }
  return account;
}

export function splitVat(grossAmount, vatRate = 0) {
  const gross = Number(grossAmount || 0);
  const rate = Number(vatRate || 0);
  const net = rate > 0 ? gross / (1 + rate / 100) : gross;
  const vat = gross - net;
  return {
    grossAmount: round2(gross),
    netAmount: round2(net),
    vatAmount: round2(vat)
  };
}

export function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

export async function postAccountTransaction(client, {
  accountId,
  type,
  amount,
  vatRate = 0,
  documentNo,
  documentDate,
  dueDate,
  description,
  relatedType,
  relatedId,
  actorUserId,
  ipAddress
}) {
  const account = await loadAccountForOperation(client, accountId);
  const direction = accountDirection(account.type, type);
  if (!direction) throw badRequest(`Bu cari tipi için işlem geçersiz: ${account.type}/${type}`);

  const result = await client.query(
    `INSERT INTO account_transactions(account_id, type, direction, amount, vat_rate, document_no, document_date, due_date, description, related_type, related_id, created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [accountId, type, direction, round2(amount), vatRate || 0, documentNo || null, documentDate || new Date().toISOString().slice(0,10), dueDate || null, description || null, relatedType || null, relatedId || null, actorUserId || null]
  );
  await audit(client, { actorUserId, action: 'post_account_transaction', entityType: 'account_transaction', entityId: result.rows[0].id, afterData: result.rows[0], ipAddress });
  return result.rows[0];
}

export async function postCashTransaction(client, {
  flow,
  channel = 'cash',
  targetChannel,
  amount,
  documentNo,
  documentDate,
  description,
  accountTransactionId,
  relatedType,
  relatedId,
  actorUserId,
  ipAddress
}) {
  if (!['in', 'out', 'transfer'].includes(flow)) throw badRequest('Geçersiz kasa hareket yönü');
  if (flow === 'transfer' && (!targetChannel || targetChannel === channel)) throw badRequest('Virman için farklı hedef kanal gerekli');
  const result = await client.query(
    `INSERT INTO cash_transactions(flow, channel, target_channel, amount, document_no, document_date, description, account_transaction_id, related_type, related_id, created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [flow, channel, targetChannel || null, round2(amount), documentNo || null, documentDate || new Date().toISOString().slice(0,10), description || null, accountTransactionId || null, relatedType || null, relatedId || null, actorUserId || null]
  );
  await audit(client, { actorUserId, action: 'post_cash_transaction', entityType: 'cash_transaction', entityId: result.rows[0].id, afterData: result.rows[0], ipAddress });
  return result.rows[0];
}

export async function reverseAccountTransaction(client, { transactionId, actorUserId, ipAddress }) {
  const original = (await client.query(`SELECT * FROM account_transactions WHERE id=$1 FOR UPDATE`, [transactionId])).rows[0];
  if (!original) throw badRequest('İptal edilecek hareket bulunamadı');
  if (original.reversed_by) throw badRequest('Bu hareket zaten iptal edilmiş');
  const reverseDirection = original.direction === 'debit' ? 'credit' : 'debit';
  const reverse = (await client.query(
    `INSERT INTO account_transactions(account_id, type, direction, amount, vat_rate, document_no, document_date, description, related_type, related_id, created_by)
     VALUES($1,'reversal',$2,$3,$4,$5,current_date,$6,$7,$8,$9) RETURNING *`,
    [original.account_id, reverseDirection, original.amount, original.vat_rate, original.document_no ? `REV-${original.document_no}` : null, `Ters kayıt: ${original.description || original.type}`, 'account_transaction', original.id, actorUserId || null]
  )).rows[0];
  await client.query(`UPDATE account_transactions SET reversed_by=$1 WHERE id=$2`, [reverse.id, original.id]);
  await audit(client, { actorUserId, action: 'reverse_account_transaction', entityType: 'account_transaction', entityId: original.id, beforeData: original, afterData: reverse, ipAddress });
  return reverse;
}
