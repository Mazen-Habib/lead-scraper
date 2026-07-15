import { readFileSync } from 'fs';
import { Client } from 'pg';

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) {
  console.error('Set SUPABASE_DB_URL to run this script.');
  process.exit(1);
}

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/apply-migration.js <path/to.sql>');
  process.exit(1);
}

const sql = readFileSync(file, 'utf8');
const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });

await client.connect();
try {
  await client.query(sql);
  console.log(`Applied ${file}`);
} finally {
  await client.end();
}
