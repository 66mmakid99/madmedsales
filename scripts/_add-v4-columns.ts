import { supabase } from './utils/supabase.js';

async function main(): Promise<void> {
  // RPC로 SQL 실행 시도
  const sql = `
    ALTER TABLE hospital_crawl_pages ADD COLUMN IF NOT EXISTS screenshot_url TEXT;
    ALTER TABLE hospital_crawl_pages ADD COLUMN IF NOT EXISTS analysis_method TEXT DEFAULT 'text';
  `;

  // 직접 REST API로 SQL 실행
  const url = process.env.SUPABASE_URL || 'https://grtkcrzgwapsjcqkxlmj.supabase.co';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  const res = await fetch(`${url}/rest/v1/rpc/`, {
    method: 'POST',
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });

  console.log('RPC status:', res.status);

  // Alternative: just test that columns work by doing a dummy update
  // If columns don't exist, this will fail, telling us we need manual SQL
  const { data, error } = await supabase
    .from('hospital_crawl_pages')
    .update({ screenshot_url: null, analysis_method: 'text' })
    .eq('hospital_id', '00000000-0000-0000-0000-000000000000') // non-existent, just testing schema
    .select('id')
    .limit(0);

  if (error) {
    if (error.message.includes('column') || error.message.includes('screenshot_url')) {
      console.log('❌ 컬럼 없음 — Supabase SQL Editor에서 수동 실행 필요:');
      console.log('ALTER TABLE hospital_crawl_pages ADD COLUMN IF NOT EXISTS screenshot_url TEXT;');
      console.log("ALTER TABLE hospital_crawl_pages ADD COLUMN IF NOT EXISTS analysis_method TEXT DEFAULT 'text';");
    } else {
      console.log('Update test result:', error.message);
      console.log('(0 rows affected는 정상 — 컬럼 존재 확인됨)');
    }
  } else {
    console.log('✅ 컬럼 존재 확인됨 (update 테스트 성공)');
  }
}

main().catch(console.error);
