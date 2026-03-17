import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
import { supabase } from '../utils/supabase.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx') as typeof import('xlsx');
import { readdirSync } from 'fs';
import { extractLocation } from './lib/location-extractor.js';

async function main() {
  // 1. DB sido 분포 확인
  const PAGE_SIZE = 1000;
  const sidoCount: Record<string, number> = {};
  let page = 0;
  while (true) {
    const { data } = await supabase
      .from('hospitals')
      .select('sido')
      .in('department', ['피부과', '성형외과'])
      .eq('status', 'active')
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (!data || data.length === 0) break;
    for (const h of data) {
      const s = h.sido ?? 'null';
      sidoCount[s] = (sidoCount[s] ?? 0) + 1;
    }
    if (data.length < PAGE_SIZE) break;
    page++;
  }
  console.log('=== DB sido 분포 ===');
  Object.entries(sidoCount).sort((a, b) => b[1] - a[1]).forEach(([s, c]) => console.log(`  ${s}: ${c}건`));

  // 2. v3 모호건에서 지역 hint 분포 확인
  const outputDir = path.resolve(__dirname, '../../output');
  const files = readdirSync(outputDir)
    .filter(f => f.startsWith('disambig-v3-result-') && f.endsWith('.xlsx'))
    .sort().reverse();
  if (files.length === 0) { console.log('v3 결과 없음'); return; }

  const wb = XLSX.readFile(path.join(outputDir, files[0]));
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet);
  const ambiguous = rows.filter(r => r['매칭상태']?.includes('모호'));

  console.log(`\n=== 모호 ${ambiguous.length}건 지역 hint 분포 ===`);
  const hintDist: Record<string, number> = {};
  for (const r of ambiguous) {
    const hint = r['지역힌트'] ?? '없음';
    hintDist[hint] = (hintDist[hint] ?? 0) + 1;
  }
  Object.entries(hintDist).sort((a, b) => b[1] - a[1]).slice(0, 20)
    .forEach(([h, c]) => console.log(`  [${h}]: ${c}건`));

  console.log('\n=== 모호건 샘플 10 ===');
  ambiguous.slice(0, 10).forEach(r =>
    console.log(`  "${r['병원명(엑셀)']}" → "${r['변환이름']}" hint=[${r['지역힌트']}] tipo=${r['변환타입']}`)
  );
}

main().catch(console.error);
