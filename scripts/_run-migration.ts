import { supabase } from './utils/supabase.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  // 1. Check current state
  const { error: e1 } = await supabase.from('hospital_crawl_pages').select('*').limit(0);
  console.log('hospital_crawl_pages:', e1 ? 'NOT EXISTS' : 'EXISTS');

  const { error: e2 } = await supabase.from('hospital_events').select('*').limit(0);
  console.log('hospital_events:', e2 ? 'NOT EXISTS' : 'EXISTS');

  // 2. Check columns on hospital_doctors
  const { data: dr } = await supabase.from('hospital_doctors').select('*').limit(1);
  const drCols = dr && dr[0] ? Object.keys(dr[0]) : [];
  console.log('hospital_doctors cols:', drCols.join(', '));
  console.log('  has academic_activity:', drCols.includes('academic_activity'));

  // 3. Check columns on hospital_treatments
  const { data: tr } = await supabase.from('hospital_treatments').select('*').limit(1);
  const trCols = tr && tr[0] ? Object.keys(tr[0]) : [];
  console.log('hospital_treatments cols:', trCols.join(', '));
  console.log('  has price_note:', trCols.includes('price_note'));
  console.log('  has combo_with:', trCols.includes('combo_with'));

  if (!e1 && !e2 && drCols.includes('academic_activity') && trCols.includes('price_note')) {
    console.log('\n✅ All schema changes already applied!');
  } else {
    console.log('\n⚠️ Schema changes needed. Run migration SQL in Supabase SQL Editor:');
    console.log('   supabase/migrations/021_recrawl_v3_schema.sql');
  }
}

main().catch(console.error);
