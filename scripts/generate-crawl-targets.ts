/**
 * DB의 hospitals 테이블에서 recrawl-v5용 targets.json 생성
 * 실행: npx tsx scripts/generate-crawl-targets.ts
 */
import { supabase } from './utils/supabase.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const { data: hospitals, error } = await supabase
    .from('hospitals')
    .select('id, name, website, sido, sigungu')
    .not('website', 'is', null)
    .neq('website', '');

  if (error || !hospitals) {
    console.error('❌ 병원 조회 실패:', error?.message);
    return;
  }

  // sales_hospital_doctors에 등록된 병원만
  const { data: doctorHospIds } = await supabase
    .from('sales_hospital_doctors')
    .select('hospital_id');

  const hospIdsWithDoctors = new Set(
    (doctorHospIds || []).map((d: { hospital_id: string }) => d.hospital_id),
  );

  const targets = hospitals
    .filter(h => hospIdsWithDoctors.has(h.id))
    .map((h, i) => ({
      no: i + 1,
      name: h.name,
      region: [h.sido, h.sigungu].filter(Boolean).join(' ') || '미상',
      url: h.website,
      source: 'db',
    }));

  const outPath = path.resolve(__dirname, 'data', 'step2-crawl-targets.json');
  fs.writeFileSync(outPath, JSON.stringify(targets, null, 2), 'utf-8');
  console.log(`✅ ${targets.length}개 병원 타겟 생성: ${outPath}`);
}

main().catch(console.error);
