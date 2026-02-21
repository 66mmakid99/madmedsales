/**
 * 이메일 수집 통계 리포트
 * 병원 이메일 수집 현황을 분석하고 리포트를 출력합니다.
 */
import { supabase } from '../utils/supabase.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('email-stats');

async function main(): Promise<void> {
  log.info('Generating email collection statistics...');

  // Total hospitals
  const { count: totalHospitals } = await supabase
    .from('hospitals')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active');

  // Hospitals with email
  const { count: withEmail } = await supabase
    .from('hospitals')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active')
    .not('email', 'is', null);

  // Hospitals with website
  const { count: withWebsite } = await supabase
    .from('hospitals')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active')
    .not('website', 'is', null);

  // Hospitals with website but no email (potential for crawling)
  const { count: websiteNoEmail } = await supabase
    .from('hospitals')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active')
    .not('website', 'is', null)
    .is('email', null);

  // Hospitals with no website and no email
  const { count: noWebsiteNoEmail } = await supabase
    .from('hospitals')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active')
    .is('website', null)
    .is('email', null);

  // By sido (region) with email rates
  const { data: regionData } = await supabase
    .from('hospitals')
    .select('sido, email')
    .eq('status', 'active');

  const regionStats: Record<string, { total: number; withEmail: number }> = {};
  for (const row of regionData ?? []) {
    const sido = (row.sido as string) || '기타';
    if (!regionStats[sido]) regionStats[sido] = { total: 0, withEmail: 0 };
    regionStats[sido].total++;
    if (row.email) regionStats[sido].withEmail++;
  }

  // Print report
  const total = totalHospitals ?? 0;
  const emails = withEmail ?? 0;
  const websites = withWebsite ?? 0;
  const wsNoEm = websiteNoEmail ?? 0;
  const noWsNoEm = noWebsiteNoEmail ?? 0;

  console.log('\n═══════════════════════════════════════════');
  console.log('         이메일 수집 현황 리포트');
  console.log('═══════════════════════════════════════════\n');

  console.log(`총 병원 수:           ${total.toLocaleString()}`);
  console.log(`이메일 보유:          ${emails.toLocaleString()} (${total > 0 ? ((emails / total) * 100).toFixed(1) : 0}%)`);
  console.log(`웹사이트 보유:        ${websites.toLocaleString()} (${total > 0 ? ((websites / total) * 100).toFixed(1) : 0}%)`);
  console.log(`웹사이트O 이메일X:    ${wsNoEm.toLocaleString()} (재크롤링 대상)`);
  console.log(`웹사이트X 이메일X:    ${noWsNoEm.toLocaleString()} (카카오 검색 대상)`);

  console.log('\n--- 지역별 이메일 보유율 ---');
  const sortedRegions = Object.entries(regionStats)
    .sort((a, b) => b[1].total - a[1].total);

  for (const [sido, stats] of sortedRegions) {
    const rate = stats.total > 0 ? ((stats.withEmail / stats.total) * 100).toFixed(1) : '0.0';
    console.log(`  ${sido.padEnd(8)} ${String(stats.withEmail).padStart(5)}/${String(stats.total).padStart(5)} (${rate}%)`);
  }

  console.log('\n═══════════════════════════════════════════\n');
}

main().catch((err) => {
  log.error('Fatal error', err);
  process.exit(1);
});
