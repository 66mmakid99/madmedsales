import { readFileSync } from 'fs';
import { join } from 'path';

const TOKEN = 'sbp_1e4f40a94489a5df58a8cbd8031f17f3aad8883c';
const PROJECT_REF = 'grtkcrzgwapsjcqkxlmj';
const API_URL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

const migrations = [
  '001_hospitals.sql',
  '002_scoring.sql',
  '003_leads.sql',
  '004_emails.sql',
  '005_demos.sql',
  '006_kakao_commission_settings.sql',
  '007_api_usage_logs.sql',
  '008_enhanced_crawling.sql',
  '009_multi_product_tables.sql',
  '010_add_product_id_columns.sql',
  '011_seed_products.sql',
];

async function run() {
  for (const file of migrations) {
    const sql = readFileSync(join('supabase', 'migrations', file), 'utf8');
    process.stdout.write(`Running ${file}... `);

    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    });

    if (res.ok) {
      console.log('OK');
    } else {
      const text = await res.text();
      console.log(`ERROR (${res.status}): ${text.substring(0, 300)}`);
    }
  }

  // Verify
  console.log('\nVerifying...');
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename" }),
  });
  const tables = await res.json();
  console.log('Tables:', JSON.stringify(tables, null, 2));
}

run();
