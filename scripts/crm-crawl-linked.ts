/**
 * CRM 매칭된 병원 크롤링 실행.
 *
 * sales_hospital_id가 있고 hospitals.website가 있는 병원만 크롤링.
 * 기존 run-single-pipeline 로직을 batch로 실행.
 *
 * Usage: npx tsx scripts/crm-crawl-linked.ts [--dry-run] [--limit 10]
 */
import { supabase } from './utils/supabase.js';

function getArg(flag: string, defaultVal: string): string {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : defaultVal;
}

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = parseInt(getArg('--limit', '100'), 10);

async function main(): Promise<void> {
  console.log('=== CRM 매칭 병원 크롤링 대상 확인 ===\n');

  // CRM 병원 중 sales_hospital_id가 있는 것
  const { data: linked, error } = await supabase
    .from('crm_hospitals')
    .select('id, name, sales_hospital_id, website')
    .not('sales_hospital_id', 'is', null)
    .order('name')
    .limit(LIMIT);

  if (error || !linked) {
    console.error('조회 실패:', error?.message);
    process.exit(1);
  }

  console.log(`매칭된 CRM 병원: ${linked.length}개`);

  // hospitals에서 website 조회
  const hospitalIds = linked.map((h) => h.sales_hospital_id).filter(Boolean);
  const { data: hospitals } = await supabase
    .from('hospitals')
    .select('id, name, website, crawled_at, is_target, status')
    .in('id', hospitalIds);

  const hospitalMap = new Map((hospitals ?? []).map((h) => [h.id, h]));

  const crawlTargets: { crmName: string; hospitalId: string; hospitalName: string; website: string }[] = [];
  const noCrawl: string[] = [];

  for (const crm of linked) {
    const main = hospitalMap.get(crm.sales_hospital_id);
    if (!main?.website) {
      noCrawl.push(`${crm.name} — website 없음`);
      continue;
    }
    crawlTargets.push({
      crmName: crm.name,
      hospitalId: main.id,
      hospitalName: main.name,
      website: main.website,
    });
  }

  console.log(`크롤링 대상: ${crawlTargets.length}개`);
  console.log(`website 없어서 제외: ${noCrawl.length}개\n`);

  if (noCrawl.length > 0) {
    console.log('--- website 없는 병원 ---');
    noCrawl.forEach((n) => console.log(`  ⚠️ ${n}`));
    console.log('');
  }

  console.log('--- 크롤링 대상 ---');
  crawlTargets.forEach((t, i) => {
    console.log(`  ${i + 1}. ${t.crmName} → ${t.hospitalName} | ${t.website}`);
  });

  if (DRY_RUN) {
    console.log('\n[DRY RUN] 크롤링 안 함. --dry-run 빼고 실행하세요.');
    return;
  }

  // 크롤링 대상 병원을 is_target=true, status=active로 활성화
  console.log('\n--- 크롤링 대상 활성화 ---');
  for (const t of crawlTargets) {
    const { error: upErr } = await supabase
      .from('hospitals')
      .update({ is_target: true, status: 'active' })
      .eq('id', t.hospitalId);
    if (upErr) {
      console.log(`  ⚠️ ${t.crmName}: 활성화 실패 — ${upErr.message}`);
    }
  }
  console.log(`${crawlTargets.length}개 병원 활성화 완료.`);

  // 출력: 크롤링 실행 명령어
  console.log('\n══════ 크롤링 실행 ══════');
  console.log('아래 명령어로 배치 크롤링을 실행하세요:\n');
  console.log(`npx tsx scripts/crawler/run-batch-pipeline.ts --limit ${crawlTargets.length} --text-only\n`);
  console.log('또는 개별 실행:');
  crawlTargets.slice(0, 3).forEach((t) => {
    console.log(`npx tsx scripts/crawler/run-single-pipeline.ts --name "${t.hospitalName}" --text-only`);
  });
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
