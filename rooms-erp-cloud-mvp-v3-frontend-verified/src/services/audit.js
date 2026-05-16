export async function audit(client, { actorUserId, action, entityType, entityId, beforeData, afterData, ipAddress }) {
  await client.query(
    `INSERT INTO audit_log(actor_user_id, action, entity_type, entity_id, before_data, after_data, ip_address)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [actorUserId || null, action, entityType, entityId || null, beforeData || null, afterData || null, ipAddress || null]
  );
}
