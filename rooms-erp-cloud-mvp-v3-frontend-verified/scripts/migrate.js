import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertConfig } from '../src/config.js';
import { query, tx, closeDb } from '../src/db.js';

assertConfig();
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(root, 'db', 'migrations');

await query(`CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
const files = (await fs.readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
for (const file of files) {
  const version = file.replace('.sql', '');
  const exists = (await query(`SELECT 1 FROM schema_migrations WHERE version=$1`, [version])).rowCount > 0;
  if (exists) continue;
  const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
  await tx(async (client) => {
    await client.query(sql);
    await client.query(`INSERT INTO schema_migrations(version) VALUES($1)`, [version]);
  });
  console.log(`Applied migration ${version}`);
}
await closeDb();
