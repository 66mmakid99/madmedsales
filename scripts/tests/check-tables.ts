import { supabase } from '../utils/supabase.js';

const tables = [
  'hospitals', 'hospital_equipments', 'hospital_treatments',
  'hospital_doctors', 'hospital_events', 'hospital_crawl_pages',
  'medical_devices', 'scv_crawl_pages', 'scv_crawl_snapshots',
];

for (const t of tables) {
  const { count, error } = await supabase.from(t).select('*', { count: 'exact', head: true });
  if (error) console.log(`  ❌ ${t}: ${error.message}`);
  else console.log(`  ✅ ${t}: ${count} rows`);
}
