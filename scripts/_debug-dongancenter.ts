import { supabase } from './utils/supabase.js';

async function main(): Promise<void> {
  // 동안중심의원 hospital_id 찾기
  const { data: crm } = await supabase
    .from('crm_hospitals')
    .select('sales_hospital_id')
    .eq('name', '동안중심의원')
    .single();

  if (!crm?.sales_hospital_id) {
    console.log('NOT FOUND');
    return;
  }

  const hid = crm.sales_hospital_id;
  console.log('hospital_id:', hid);

  // 크롤 페이지 확인
  const { data: pages } = await supabase
    .from('hospital_crawl_pages')
    .select('url, page_type, char_count, gemini_analyzed')
    .eq('hospital_id', hid)
    .order('crawled_at');

  console.log('\n=== 크롤 페이지 ===');
  for (const p of pages || []) {
    console.log(`  ${p.page_type.padEnd(10)} | ${String(p.char_count).padStart(6)}자 | analyzed: ${p.gemini_analyzed} | ${p.url}`);
  }

  // doctor 페이지 마크다운 앞부분 확인
  const { data: doctorPage } = await supabase
    .from('hospital_crawl_pages')
    .select('markdown')
    .eq('hospital_id', hid)
    .eq('page_type', 'doctor')
    .single();

  if (doctorPage) {
    console.log('\n=== doctor 페이지 마크다운 (첫 2000자) ===');
    console.log(doctorPage.markdown.substring(0, 2000));
  }

  // main 페이지 마크다운 앞부분
  const { data: mainPage } = await supabase
    .from('hospital_crawl_pages')
    .select('markdown')
    .eq('hospital_id', hid)
    .eq('page_type', 'main')
    .single();

  if (mainPage) {
    console.log('\n=== main 페이지 마크다운 (첫 1000자) ===');
    console.log(mainPage.markdown.substring(0, 1000));
  }
}

main().catch(console.error);
