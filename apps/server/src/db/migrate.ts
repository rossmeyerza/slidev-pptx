import dotenv from 'dotenv';
import { loadConfig } from '../core/config.js';
import { createPgPool, runMigrations, setupLangGraphCheckpointer } from './db.js';

dotenv.config({ path: '.env' });
if (process.env.SKIP_ENV_LOCAL !== 'true') {
  dotenv.config({ path: '.env.local', override: true });
}

const config = loadConfig();
const pool = createPgPool(config);

if (!pool) {
  console.log('DATABASE_URL is not set; no migrations applied.');
  process.exit(0);
}

try {
  await runMigrations(config, pool);
  await setupLangGraphCheckpointer(config);
  console.log('Database migrations applied.');
} finally {
  await pool.end();
}
