import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '.env') });

import { createClient } from '@supabase/supabase-js';

console.log('URL:', process.env.SUPABASE_URL ? 'SET' : 'UNSET');
console.log('KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'SET' : 'UNSET');

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main(): Promise<void> {
  const ids = [
    '1267b395-1132-4511-a8ba-1afc228a8867',
    '7b169807-6d76-4796-a31b-7b35f0437899',
    '92f7b52a-66e9-4b1c-a118-6058f89db92e',
  ];

  for (const id of ids) {
    const { data, error } = await supabase.from('hospitals').select('*').eq('id', id).single();
    if (error) { console.log('hospitals error for', id, ':', error.message); continue; }
    console.log('=== HOSPITAL', data?.name, '===');
    console.log('Keys:', Object.keys(data));
    console.log('website:', data?.website);
    console.log('address:', data?.address);
    console.log('phone:', data?.phone);
    console.log('crawled_at:', data?.crawled_at);
    console.log('crawl_version:', data?.crawl_version);
    console.log('region:', data?.region);
  }

  for (const id of ids) {
    const { data, error, count } = await supabase.from('hospital_doctors').select('*', { count: 'exact' }).eq('hospital_id', id).limit(5);
    console.log('\n--- doctors for', id, '---');
    if (error) { console.log('Error:', error.message); continue; }
    console.log('Count:', count);
    if (data && data.length > 0) {
      console.log('Sample keys:', Object.keys(data[0]));
      data.forEach((d: any) => console.log(d.name, d.title, d.specialty));
    }
  }

  for (const id of ids) {
    const { data, error, count } = await supabase.from('hospital_crawl_pages').select('*', { count: 'exact' }).eq('hospital_id', id).limit(3);
    console.log('\n--- crawl_pages for', id, '---');
    if (error) { console.log('Error:', error.message); continue; }
    console.log('Count:', count);
    if (data && data.length > 0) {
      console.log('Sample keys:', Object.keys(data[0]));
      data.forEach((d: any) => console.log(d.page_type, d.char_count, d.page_url?.substring(0, 80)));
    }
  }

  for (const id of ids) {
    const { data, error } = await supabase.from('hospital_crawl_validations').select('*').eq('hospital_id', id);
    console.log('\n--- validations for', id, '---');
    if (error) { console.log('Error:', error.message); continue; }
    console.log('Count:', data?.length);
    if (data && data.length > 0) {
      console.log(JSON.stringify(data[0], null, 2));
    }
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
