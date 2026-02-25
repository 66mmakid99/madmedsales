import { supabase } from './utils/supabase.js';

async function main(): Promise<void> {
  // 포에버의원 - crm에서 name 검색 후 hospitals에서 직접 찾기
  const { data: crm } = await supabase
    .from('crm_hospitals')
    .select('id, name, sales_hospital_id')
    .ilike('name', '%포에버%');
  console.log('CRM matches:', crm);

  // hospital_crawl_pages에서 직접 검색
  const { data: pages } = await supabase
    .from('hospital_crawl_pages')
    .select('hospital_id, url, page_type')
    .ilike('url', '%forever%')
    .limit(5);
  console.log('Crawl pages with forever URL:', pages);

  // hospitals 테이블에서 name 검색
  const { data: hosp } = await supabase
    .from('hospitals')
    .select('id, name')
    .ilike('name', '%포에버%');
  console.log('Hospitals matches:', hosp);
}

main().catch(console.error);
