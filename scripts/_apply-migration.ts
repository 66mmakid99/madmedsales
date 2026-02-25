import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: 'public' } }
);

async function runSQL(sql: string, label: string): Promise<boolean> {
  const { error } = await supabase.rpc('exec_sql', { sql_string: sql });
  if (error) {
    // Try via pg_query if exec_sql doesn't exist
    console.log(`  ⚠️ ${label}: ${error.message}`);
    return false;
  }
  console.log(`  ✅ ${label}`);
  return true;
}

async function main(): Promise<void> {
  console.log('=== Migration 021: recrawl v3 schema ===\n');

  // Try individual SQL statements via Supabase query
  const statements: Array<{ sql: string; label: string }> = [
    {
      label: 'CREATE hospital_crawl_pages',
      sql: `CREATE TABLE IF NOT EXISTS hospital_crawl_pages (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        hospital_id UUID REFERENCES hospitals(id),
        url TEXT NOT NULL,
        page_type TEXT NOT NULL,
        markdown TEXT NOT NULL,
        char_count INTEGER NOT NULL,
        crawled_at TIMESTAMPTZ DEFAULT now(),
        gemini_analyzed BOOLEAN DEFAULT false,
        tenant_id UUID DEFAULT '00000000-0000-0000-0000-000000000001'
      )`
    },
    {
      label: 'INDEX crawl_pages_hospital',
      sql: 'CREATE INDEX IF NOT EXISTS idx_crawl_pages_hospital ON hospital_crawl_pages(hospital_id)'
    },
    {
      label: 'INDEX crawl_pages_tenant',
      sql: 'CREATE INDEX IF NOT EXISTS idx_crawl_pages_tenant ON hospital_crawl_pages(tenant_id)'
    },
    {
      label: 'RLS crawl_pages',
      sql: 'ALTER TABLE hospital_crawl_pages ENABLE ROW LEVEL SECURITY'
    },
    {
      label: 'POLICY crawl_pages',
      sql: `CREATE POLICY "tenant_isolation_crawl_pages" ON hospital_crawl_pages USING (tenant_id = '00000000-0000-0000-0000-000000000001')`
    },
    {
      label: 'CREATE hospital_events',
      sql: `CREATE TABLE IF NOT EXISTS hospital_events (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        hospital_id UUID REFERENCES hospitals(id),
        title TEXT NOT NULL,
        description TEXT,
        discount_type TEXT,
        discount_value TEXT,
        related_treatments TEXT[],
        source_url TEXT,
        source TEXT DEFAULT 'firecrawl_gemini_v3',
        crawled_at TIMESTAMPTZ DEFAULT now(),
        tenant_id UUID DEFAULT '00000000-0000-0000-0000-000000000001'
      )`
    },
    {
      label: 'INDEX events_hospital',
      sql: 'CREATE INDEX IF NOT EXISTS idx_events_hospital ON hospital_events(hospital_id)'
    },
    {
      label: 'RLS events',
      sql: 'ALTER TABLE hospital_events ENABLE ROW LEVEL SECURITY'
    },
    {
      label: 'POLICY events',
      sql: `CREATE POLICY "tenant_isolation_events" ON hospital_events USING (tenant_id = '00000000-0000-0000-0000-000000000001')`
    },
    {
      label: 'ADD academic_activity to doctors',
      sql: 'ALTER TABLE hospital_doctors ADD COLUMN IF NOT EXISTS academic_activity TEXT'
    },
    {
      label: 'ADD price_note to treatments',
      sql: 'ALTER TABLE hospital_treatments ADD COLUMN IF NOT EXISTS price_note TEXT'
    },
    {
      label: 'ADD combo_with to treatments',
      sql: 'ALTER TABLE hospital_treatments ADD COLUMN IF NOT EXISTS combo_with TEXT'
    },
  ];

  let rpcWorks = true;
  for (const { sql, label } of statements) {
    const ok = await runSQL(sql, label);
    if (!ok) {
      rpcWorks = false;
      break;
    }
  }

  if (!rpcWorks) {
    console.log('\n❌ exec_sql RPC not available.');
    console.log('Run the SQL manually in Supabase SQL Editor:');
    console.log('File: supabase/migrations/021_recrawl_v3_schema.sql');
    console.log('\nOr run: supabase db push (if Supabase CLI is set up)');
  }

  // Verify
  console.log('\n=== Verification ===');
  const { error: e1 } = await supabase.from('hospital_crawl_pages').select('*').limit(0);
  console.log('hospital_crawl_pages:', e1 ? '❌ ' + e1.message : '✅');

  const { error: e2 } = await supabase.from('hospital_events').select('*').limit(0);
  console.log('hospital_events:', e2 ? '❌ ' + e2.message : '✅');

  const { data: dr } = await supabase.from('hospital_doctors').select('academic_activity').limit(0);
  console.log('doctors.academic_activity:', dr !== null ? '✅' : '❌');

  const { data: tr } = await supabase.from('hospital_treatments').select('price_note, combo_with').limit(0);
  console.log('treatments.price_note/combo_with:', tr !== null ? '✅' : '❌');
}

main().catch(console.error);
