import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env'), override: true });

import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main(): Promise<void> {
  console.log('=== scv_crawl_pages 조회 ===');
  const { data: pages, error: e1 } = await sb
    .from('scv_crawl_pages')
    .select('hospital_id, url, char_count, page_type, markdown');

  if (e1) { console.log('ERROR:', e1.message); return; }
  console.log('총', pages?.length ?? 0, '건');
  if (pages) {
    for (const p of pages) {
      console.log(' ', p.hospital_id, p.url, p.char_count + '자', 'markdown:', (p.markdown?.length ?? 0) + '자');
    }
  }

  if (!pages || pages.length === 0) return;

  const ids = [...new Set(pages.map(p => p.hospital_id))];
  console.log('\n=== hospitals 매칭 ===');
  const { data: hosps, error: e2 } = await sb
    .from('hospitals')
    .select('id, name, website')
    .in('id', ids);

  if (e2) { console.log('ERROR:', e2.message); return; }
  console.log('매칭:', hosps?.length ?? 0, '건');
  hosps?.forEach(h => console.log(' ', h.name, h.id.slice(0, 8)));

  // 이름 필터 테스트
  const filtered = hosps?.filter(h => h.name.includes('프리마피부과'));
  console.log('\n이름 필터 "프리마피부과":', filtered?.length ?? 0, '건');
  filtered?.forEach(h => console.log(' ', h.name));
}

main().catch(console.error);
