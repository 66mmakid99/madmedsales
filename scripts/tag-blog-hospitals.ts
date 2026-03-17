/**
 * tag-blog-hospitals.ts — hospitals 테이블에 crawl_type 태깅
 *
 * 1. crawl_type 컬럼이 없으면 추가 (text, default 'website')
 * 2. website URL 기반으로 일괄 업데이트:
 *    - blog.naver.com, m.blog.naver.com → 'naver_blog'
 *    - cafe.naver.com → 'naver_cafe'
 *    - 나머지 → 'website'
 * 3. 결과 통계 출력
 *
 * Usage: npx tsx scripts/tag-blog-hospitals.ts
 */

import { supabase } from './utils/supabase.js';

// ============================================================
// crawl_type 판별 함수 (재사용 가능하도록 export)
// ============================================================
type CrawlType = 'naver_blog' | 'naver_cafe' | 'website';

export function detectCrawlType(url: string | null): CrawlType {
  if (!url) return 'website';
  try {
    const hostname = new URL(url.startsWith('http') ? url : `https://${url}`).hostname.toLowerCase();
    if (hostname === 'blog.naver.com' || hostname === 'm.blog.naver.com') return 'naver_blog';
    if (hostname === 'cafe.naver.com' || hostname === 'm.cafe.naver.com') return 'naver_cafe';
    return 'website';
  } catch {
    return 'website';
  }
}

// ============================================================
// 메인
// ============================================================
async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════');
  console.log('  hospitals crawl_type 태깅');
  console.log('═══════════════════════════════════════════════════\n');

  // 1. crawl_type 컬럼 추가 (없으면)
  console.log('[1/3] crawl_type 컬럼 확인/추가...');
  const { error: colErr } = await supabase.rpc('exec_sql', {
    sql: `
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'hospitals' AND column_name = 'crawl_type'
        ) THEN
          ALTER TABLE hospitals ADD COLUMN crawl_type text DEFAULT 'website';
          RAISE NOTICE 'crawl_type 컬럼 추가됨';
        ELSE
          RAISE NOTICE 'crawl_type 컬럼 이미 존재';
        END IF;
      END $$;
    `,
  });

  if (colErr) {
    // rpc('exec_sql') 미지원 시 직접 SQL 시도
    console.log(`  ⚠️ rpc 실패 (${colErr.message}) → 직접 ALTER TABLE 시도...`);
    const { error: alterErr } = await supabase.from('hospitals').select('crawl_type').limit(1);
    if (alterErr && alterErr.message.includes('crawl_type')) {
      // 컬럼이 없다 → Supabase SQL Editor에서 직접 추가 필요
      console.log('  ❌ crawl_type 컬럼이 없습니다. Supabase SQL Editor에서 실행해주세요:');
      console.log('     ALTER TABLE hospitals ADD COLUMN crawl_type text DEFAULT \'website\';');
      process.exit(1);
    } else {
      console.log('  ✅ crawl_type 컬럼 이미 존재');
    }
  } else {
    console.log('  ✅ 완료');
  }

  // 2. 전체 병원 URL 조회 + crawl_type 판별 + 업데이트
  console.log('\n[2/3] 전체 병원 URL 기반 crawl_type 업데이트...');

  const { data: hospitals, error: fetchErr } = await supabase
    .from('hospitals')
    .select('id, name, website')
    .not('website', 'is', null);

  if (fetchErr || !hospitals) {
    console.error(`  ❌ 병원 조회 실패: ${fetchErr?.message}`);
    process.exit(1);
  }

  console.log(`  총 ${hospitals.length}개 병원 (website 있는 것만)`);

  const updates: { id: string; crawl_type: CrawlType }[] = [];
  const stats: Record<CrawlType, number> = { naver_blog: 0, naver_cafe: 0, website: 0 };

  for (const h of hospitals) {
    const ct = detectCrawlType(h.website as string);
    stats[ct]++;
    updates.push({ id: h.id as string, crawl_type: ct });
  }

  // 배치 upsert (100개씩)
  let updated = 0;
  const batchSize = 100;
  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);

    // naver_blog 업데이트
    const blogIds = batch.filter(u => u.crawl_type === 'naver_blog').map(u => u.id);
    if (blogIds.length > 0) {
      const { error } = await supabase
        .from('hospitals')
        .update({ crawl_type: 'naver_blog' })
        .in('id', blogIds);
      if (error) console.log(`  ⚠️ naver_blog 업데이트 오류: ${error.message}`);
      else updated += blogIds.length;
    }

    // naver_cafe 업데이트
    const cafeIds = batch.filter(u => u.crawl_type === 'naver_cafe').map(u => u.id);
    if (cafeIds.length > 0) {
      const { error } = await supabase
        .from('hospitals')
        .update({ crawl_type: 'naver_cafe' })
        .in('id', cafeIds);
      if (error) console.log(`  ⚠️ naver_cafe 업데이트 오류: ${error.message}`);
      else updated += cafeIds.length;
    }

    // website 업데이트
    const webIds = batch.filter(u => u.crawl_type === 'website').map(u => u.id);
    if (webIds.length > 0) {
      const { error } = await supabase
        .from('hospitals')
        .update({ crawl_type: 'website' })
        .in('id', webIds);
      if (error) console.log(`  ⚠️ website 업데이트 오류: ${error.message}`);
      else updated += webIds.length;
    }

    if ((i + batchSize) % 500 === 0 || i + batchSize >= updates.length) {
      console.log(`  ${Math.min(i + batchSize, updates.length)}/${updates.length} 업데이트 완료...`);
    }
  }

  console.log(`  ✅ ${updated}개 병원 업데이트 완료`);

  // 3. 통계 출력
  console.log('\n[3/3] crawl_type 현황');
  console.log('  ────────────────────────────────────────');
  console.log(`  website:     ${stats.website}개`);
  console.log(`  naver_blog:  ${stats.naver_blog}개`);
  console.log(`  naver_cafe:  ${stats.naver_cafe}개`);
  console.log('  ────────────────────────────────────────');
  console.log(`  총:          ${hospitals.length}개\n`);

  // 블로그 병원 상위 5개 출력
  if (stats.naver_blog > 0) {
    console.log('  📋 네이버 블로그 병원 샘플 (최대 5개):');
    const blogHospitals = hospitals.filter(h => detectCrawlType(h.website as string) === 'naver_blog');
    for (const h of blogHospitals.slice(0, 5)) {
      console.log(`    - ${h.name} → ${h.website}`);
    }
  }

  if (stats.naver_cafe > 0) {
    console.log('  📋 네이버 카페 병원 샘플 (최대 5개):');
    const cafeHospitals = hospitals.filter(h => detectCrawlType(h.website as string) === 'naver_cafe');
    for (const h of cafeHospitals.slice(0, 5)) {
      console.log(`    - ${h.name} → ${h.website}`);
    }
  }

  console.log('\n  ✅ 태깅 완료');
}

// 직접 실행 시에만 main() 호출 (import 시에는 실행하지 않음)
const isDirectRun = process.argv[1]?.replace(/\\/g, '/').includes('tag-blog-hospitals');
if (isDirectRun) {
  main().catch(err => {
    console.error('❌ 실패:', err);
    process.exit(1);
  });
}
