// Keeps free-nextjs-admin-dashboard-main/src/lib/shared-data/*.json in sync
// with shared/*.json at the repo root.
//
// Why a copy exists at all (see commit 72f9aca): the dashboard imports these
// files from src/lib/facets.ts to build filter dropdown options, but Vercel's
// configured Root Directory for that project is the dashboard's own folder —
// the deployed build has no access to files above it, even though a local
// checkout does. So the dashboard keeps a local copy instead of importing
// ../../../shared/*.json directly.
//
// That copy is manual, which means shared/taxonomy.json (the single
// definition src/quality/classifier.js and the dashboard both need to agree
// on) can silently drift from the dashboard's filter options if someone edits
// the root file and forgets to re-copy it. This script is the fix: run it
// after editing shared/*.json, or run it with --check in CI to fail loudly
// instead of shipping a drifted copy.
//
// Usage:
//   node scripts/sync-shared-data.js          # copy root -> dashboard, report what changed
//   node scripts/sync-shared-data.js --check  # verify only, exit 1 on drift, writes nothing
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');

const FILES = [
  {
    source: resolve(root, 'shared/taxonomy.json'),
    target: resolve(root, 'free-nextjs-admin-dashboard-main/src/lib/shared-data/taxonomy.json'),
  },
  {
    source: resolve(root, 'shared/regions.json'),
    target: resolve(root, 'free-nextjs-admin-dashboard-main/src/lib/shared-data/regions.json'),
  },
  {
    source: resolve(root, 'shared/geo.json'),
    target: resolve(root, 'free-nextjs-admin-dashboard-main/src/lib/shared-data/geo.json'),
  },
];

let drifted = false;
let copied = false;

for (const { source, target } of FILES) {
  if (!existsSync(source)) {
    console.error(`  !! source missing: ${source}`);
    process.exitCode = 1;
    continue;
  }

  const sourceContent = readFileSync(source, 'utf8');
  const targetContent = existsSync(target) ? readFileSync(target, 'utf8') : null;
  const label = source.replace(root + '\\', '').replace(root + '/', '');

  if (targetContent === sourceContent) {
    console.log(`  ${label}: already in sync`);
    continue;
  }

  drifted = true;
  if (checkOnly) {
    console.error(`  !! ${label}: OUT OF SYNC with the dashboard's copy — run \`node scripts/sync-shared-data.js\` to fix`);
    process.exitCode = 1;
    continue;
  }

  writeFileSync(target, sourceContent, 'utf8');
  copied = true;
  console.log(`  ${label}: copied -> ${target.replace(root + '\\', '').replace(root + '/', '')}`);
}

if (checkOnly && drifted) {
  console.error('\nshared-data is stale. Run: node scripts/sync-shared-data.js');
} else if (copied) {
  console.log('\nDone — remember to commit the updated file(s) under free-nextjs-admin-dashboard-main/src/lib/shared-data/.');
} else if (!drifted) {
  console.log('\nAll shared data already in sync — nothing to do.');
}
