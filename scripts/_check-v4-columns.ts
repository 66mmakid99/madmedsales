import { supabase } from './utils/supabase.js';

async function main(): Promise<void> {
  const { data, error } = await supabase
    .from('hospital_crawl_pages')
    .select('id, screenshot_url, analysis_method')
    .limit(1);

  if (error) {
    console.log('❌ 컬럼 없음:', error.message);
    console.log('\nSupabase SQL Editor에서 실행 필요:');
    console.log('ALTER TABLE hospital_crawl_pages ADD COLUMN IF NOT EXISTS screenshot_url TEXT;');
    console.log("ALTER TABLE hospital_crawl_pages ADD COLUMN IF NOT EXISTS analysis_method TEXT DEFAULT 'text';");
  } else {
    console.log('✅ v4 컬럼 확인됨. 테스트 실행 가능.');
  }
}

main().catch(console.error);
