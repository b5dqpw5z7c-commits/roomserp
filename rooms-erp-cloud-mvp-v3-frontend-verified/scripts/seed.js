import bcrypt from 'bcryptjs';
import { config, assertConfig } from '../src/config.js';
import { query, tx, closeDb } from '../src/db.js';

assertConfig();
await tx(async (client) => {
  const exists = (await client.query(`SELECT id FROM users WHERE username=$1`, [config.seedAdminUsername])).rows[0];
  if (!exists) {
    const hash = await bcrypt.hash(config.seedAdminPassword, 12);
    await client.query(
      `INSERT INTO users(username, name, role, language, password_hash, must_change_password)
       VALUES($1,$2,'Yönetim','tr',$3,true)`,
      [config.seedAdminUsername, config.seedAdminName, hash]
    );
    console.log(`Seeded admin user: ${config.seedAdminUsername}`);
  }
});
await closeDb();
