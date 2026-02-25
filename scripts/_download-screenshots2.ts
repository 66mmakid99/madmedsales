import { supabase } from './utils/supabase.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const targets = [
  { name: '안산엔비의원', hid: '1267b395-1132-4511-a8ba-1afc228a8867' },
  { name: '동안중심의원', hid: '7b169807-6d76-4796-a31b-7b35f0437899' },
  { name: '포에버의원(신사)', hid: '92f7b52a-66e9-4b1c-a118-6058f89db92e' },
];

async function main(): Promise<void> {
  const outDir = path.resolve(__dirname, 'data', 'v4-test3', 'screenshots');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  for (const t of targets) {
    const { data: pages } = await supabase
      .from('hospital_crawl_pages')
      .select('page_type, url, screenshot_url')
      .eq('hospital_id', t.hid)
      .not('screenshot_url', 'is', null)
      .order('crawled_at');

    if (!pages) continue;

    const safeName = t.name.replace(/[()]/g, '').replace(/\s+/g, '-');
    let idx = 0;

    for (const p of pages) {
      if (!p.screenshot_url) continue;
      idx++;
      try {
        const resp = await fetch(p.screenshot_url);
        const buf = Buffer.from(await resp.arrayBuffer());
        // URL에서 slug 생성
        const urlSlug = new URL(p.url).pathname.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30) || 'root';
        const fileName = `${safeName}_${idx}_${p.page_type}_${urlSlug}.webp`;
        const filePath = path.resolve(outDir, fileName);
        fs.writeFileSync(filePath, buf);
        console.log(`✅ ${fileName} (${(buf.length / 1024).toFixed(1)}KB) — ${p.url}`);
      } catch (err) {
        console.log(`❌ ${t.name} ${p.page_type}: ${err}`);
      }
    }
  }
}

main().catch(console.error);
