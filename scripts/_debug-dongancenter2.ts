import { supabase } from './utils/supabase.js';

async function main(): Promise<void> {
  const { data: page } = await supabase
    .from('hospital_crawl_pages')
    .select('markdown')
    .eq('hospital_id', '7b169807-6d76-4796-a31b-7b35f0437899')
    .eq('page_type', 'doctor')
    .single();

  if (!page) { console.log('NOT FOUND'); return; }

  const md = page.markdown;
  console.log('=== 전체 길이:', md.length);

  // 의료진 관련 키워드 위치 찾기
  const keywords = ['원장', '의사', '전문의', '학력', '경력', '대표', '의료진'];
  for (const kw of keywords) {
    const idx = md.indexOf(kw);
    if (idx >= 0) {
      console.log(`\n>>> "${kw}" at position ${idx}:`);
      console.log(md.substring(Math.max(0, idx - 100), idx + 300));
      console.log('---');
    }
  }

  // 중간 부분 확인 (10000~12000)
  console.log('\n=== 중간 부분 (10000-11000) ===');
  console.log(md.substring(10000, 11000));

  // 마지막 3000자
  console.log('\n=== 마지막 3000자 ===');
  console.log(md.substring(md.length - 3000));
}

main().catch(console.error);
