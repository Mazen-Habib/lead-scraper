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
  // PostgREST (Supabase's REST/JS-client layer) caches the table schema in
  // memory and does NOT pick up DDL run over a raw connection like this one
  // automatically — without this, newly added/renamed columns 404 through
  // supabase-js ("column ... does not exist") until PostgREST happens to
  // restart, even though the migration applied correctly.
  await client.query("NOTIFY pgrst, 'reload schema';");
  console.log(`Applied ${file} (and asked PostgREST to reload its schema cache)`);
} finally {
  await client.end();
}
