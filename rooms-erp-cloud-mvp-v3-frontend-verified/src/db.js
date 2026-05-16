import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;
export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseUrl?.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.PG_POOL_MAX || 8),
  idleTimeoutMillis: 30000
});

export async function query(text, params = []) {
  return pool.query(text, params);
}

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function closeDb() {
  await pool.end();
}
