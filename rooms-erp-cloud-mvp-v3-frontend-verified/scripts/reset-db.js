import { assertConfig } from '../src/config.js';
import { query, closeDb } from '../src/db.js';
assertConfig();
if (process.env.NODE_ENV === 'production') throw new Error('Refusing to reset production database');
await query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
await closeDb();
console.log('Database reset. Run npm run migrate && npm run seed.');
