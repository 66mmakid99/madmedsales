import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Extract project ref from URL
const projectRef = new URL(SUPABASE_URL).hostname.split('.')[0];

async function executeSqlViaManagementApi(sql: string): Promise<void> {
  // Use the Supabase Management API
  const url = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({ query: sql }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.log(`Management API failed (${res.status}): ${text.substring(0, 200)}`);
    return;
  }

  const data = await res.json();
  console.log('Result:', JSON.stringify(data).substring(0, 200));
}

async function main(): Promise<void> {
  console.log('Project ref:', projectRef);

  const sqlFile = fs.readFileSync(
    path.resolve(__dirname, '../supabase/migrations/021_recrawl_v3_schema.sql'),
    'utf-8'
  );

  // Split by semicolons, filter empty and comment-only
  const statements = sqlFile
    .split(';')
    .map(s => s.trim())
    .filter(s => s && !s.match(/^--/));

  console.log(`\nExecuting ${statements.length} statements...\n`);

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const label = stmt.substring(0, 60).replace(/\n/g, ' ');
    console.log(`[${i + 1}/${statements.length}] ${label}...`);

    try {
      await executeSqlViaManagementApi(stmt);
    } catch (err) {
      console.log(`  Error: ${err}`);
    }
  }
}

main().catch(console.error);
