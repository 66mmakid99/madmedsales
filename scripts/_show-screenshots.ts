import { supabase } from './utils/supabase.js';

const targets = [
  { name: '안산엔비의원', hid: '1267b395-1132-4511-a8ba-1afc228a8867' },
  { name: '동안중심의원', hid: '7b169807-6d76-4796-a31b-7b35f0437899' },
  { name: '포에버의원(신사)', hid: '92f7b52a-66e9-4b1c-a118-6058f89db92e' },
];

async function main(): Promise<void> {
  for (const t of targets) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  ${t.name}`);
    console.log('═'.repeat(60));

    const { data: pages } = await supabase
      .from('hospital_crawl_pages')
      .select('page_type, url, screenshot_url, analysis_method, char_count')
      .eq('hospital_id', t.hid)
      .order('crawled_at');

    if (!pages || pages.length === 0) {
      console.log('  (페이지 없음)');
      continue;
    }

    for (const p of pages) {
      console.log(`\n  [${p.page_type}] ${p.url}`);
      console.log(`    텍스트: ${p.char_count.toLocaleString()}자 | 분석: ${p.analysis_method}`);
      if (p.screenshot_url) {
        console.log(`    📸 ${p.screenshot_url}`);
      } else {
        console.log(`    📸 (스크린샷 없음)`);
      }
    }
  }
}

main().catch(console.error);
