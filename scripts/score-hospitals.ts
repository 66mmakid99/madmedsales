/**
 * 병원 스코어링 배치 스크립트
 *
 * Usage:
 *   npx tsx scripts/score-hospitals.ts [--top 50] [--dry-run] [--hospital-id UUID]
 */
import { scoreAllHospitals, type ScoringResult } from '../apps/engine/src/services/hospital-scoring/index.js';

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const topIdx = args.indexOf('--top');
  const topN = topIdx !== -1 ? parseInt(args[topIdx + 1], 10) : 50;
  const hidIdx = args.indexOf('--hospital-id');
  const hospitalId = hidIdx !== -1 ? args[hidIdx + 1] : undefined;

  console.log('═══════════════════════════════════════════════');
  console.log('  🏥 Hospital Scoring + TORR RF Target List');
  console.log('═══════════════════════════════════════════════');
  console.log(`  Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  if (hospitalId) console.log(`  Target: ${hospitalId}`);
  console.log('');

  const results = await scoreAllHospitals({ dryRun, hospitalId });

  if (results.length === 0) {
    console.log('❌ 스코어링 결과 없음');
    return;
  }

  // 통계 요약
  printStats(results);

  // Top N 출력
  const topResults = results.slice(0, topN);
  printTopList(topResults, topN);

  // 단일 병원 디버그
  if (hospitalId && results.length > 0) {
    printDebug(results[0]);
  }
}

function printStats(results: ScoringResult[]) {
  const finals = results.map((r) => r.finalScore);
  const avg = finals.reduce((a, b) => a + b, 0) / finals.length;
  const max = Math.max(...finals);
  const min = Math.min(...finals);

  const completeness = results.map((r) => r.dataCompleteness);
  const avgComp = completeness.reduce((a, b) => a + b, 0) / completeness.length;

  console.log('\n📊 통계 요약');
  console.log('─────────────────────────────────────');
  console.log(`  총 스코어링: ${results.length}개 병원`);
  console.log(`  Final Score — 평균: ${avg.toFixed(2)}, 최고: ${max.toFixed(2)}, 최저: ${min.toFixed(2)}`);
  console.log(`  데이터 완성도 평균: ${(avgComp * 100).toFixed(1)}%`);

  // 분포
  const brackets = [0, 20, 40, 60, 80, 100];
  console.log('\n  점수 분포:');
  for (let i = 0; i < brackets.length - 1; i++) {
    const lo = brackets[i];
    const hi = brackets[i + 1];
    const count = finals.filter((f) => f >= lo && f < (i === brackets.length - 2 ? hi + 1 : hi)).length;
    const bar = '█'.repeat(Math.ceil(count / Math.max(1, results.length) * 40));
    console.log(`    ${String(lo).padStart(3)}~${String(hi).padStart(3)}: ${String(count).padStart(4)}개 ${bar}`);
  }
}

function printTopList(results: ScoringResult[], topN: number) {
  console.log(`\n🎯 Top ${topN} TORR RF 타겟 리스트`);
  console.log('─────────────────────────────────────────────────────────────────────────');
  console.log(
    '  #  | Final | Total | TORR  | Inv  | Port | Scale | Mkt  | Comp | Hospital ID',
  );
  console.log('─────────────────────────────────────────────────────────────────────────');

  results.forEach((r, i) => {
    console.log(
      `  ${String(i + 1).padStart(2)} | ${pad(r.finalScore)} | ${pad(r.profiler.total)} | ${pad(r.torr.total)} | ${pad(r.profiler.investment)} | ${pad(r.profiler.portfolio)} | ${pad(r.profiler.scale)} | ${pad(r.profiler.marketing)} | ${(r.dataCompleteness * 100).toFixed(0).padStart(3)}% | ${r.hospitalId.slice(0, 12)}...`,
    );
  });
}

function printDebug(r: ScoringResult) {
  console.log('\n🔍 상세 디버그');
  console.log('─────────────────────────────────────');
  console.log(`  Hospital: ${r.hospitalId}`);
  console.log(`  Data Completeness: ${(r.dataCompleteness * 100).toFixed(0)}%`);
  console.log('\n  [Profiler]');
  console.log(`    Investment: ${r.profiler.investment}`);
  r.details.investmentDetails.forEach((d) => console.log(`      → ${d}`));
  console.log(`    Portfolio: ${r.profiler.portfolio}`);
  r.details.portfolioDetails.forEach((d) => console.log(`      → ${d}`));
  console.log(`    Scale: ${r.profiler.scale}`);
  r.details.scaleDetails.forEach((d) => console.log(`      → ${d}`));
  console.log(`    Marketing: ${r.profiler.marketing}`);
  r.details.marketingDetails.forEach((d) => console.log(`      → ${d}`));
  console.log('\n  [TORR]');
  for (const [axis, keywords] of Object.entries(r.details.torrDetails)) {
    console.log(`    ${axis}: ${keywords.length > 0 ? keywords.join(', ') : '(없음)'}`);
  }
}

function pad(n: number): string {
  return n.toFixed(1).padStart(5);
}

main().catch((err) => {
  console.error('❌ 오류:', err);
  process.exit(1);
});
