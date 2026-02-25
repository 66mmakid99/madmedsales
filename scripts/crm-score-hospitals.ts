/**
 * CRM 병원 배치 스코어링 (프로파일 + 매칭).
 *
 * 1단계: profileSingleHospital → hospital_profiles (4축 프로파일)
 * 2단계: matchSingleHospitalProduct → product_match_scores (TORR RF 매칭)
 * 3단계: autoCreateLeadFromMatch → S/A등급 리드 자동 생성
 *
 * Usage: npx tsx scripts/crm-score-hospitals.ts [--product-id <id>] [--limit 30]
 */
import { supabase } from './utils/supabase.js';
import { createLogger } from './utils/logger.js';
import { profileSingleHospital } from '../apps/engine/src/services/scoring/profiler.js';
import { matchSingleHospitalProduct } from '../apps/engine/src/services/scoring/matcher.js';
import { autoCreateLeadFromMatch } from '../apps/engine/src/services/scoring/lead-generator.js';

const log = createLogger('crm-score');

const TORR_RF_PRODUCT_ID = '5d35c712-228c-4835-acf6-904f6a8c342f';

function getArg(flag: string, defaultVal: string): string {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : defaultVal;
}

const PRODUCT_ID = getArg('--product-id', TORR_RF_PRODUCT_ID);
const LIMIT = parseInt(getArg('--limit', '100'), 10);

interface ScoreResult {
  hospitalName: string;
  profileGrade: string;
  profileScore: number;
  matchGrade: string;
  matchScore: number;
  topPitch: string[];
  leadCreated: boolean;
}

async function main(): Promise<void> {
  log.info('=== CRM 병원 배치 스코어링 ===');
  log.info(`제품 ID: ${PRODUCT_ID}`);
  log.info(`limit: ${LIMIT}`);

  // CRM 매칭된 병원 목록 가져오기
  const { data: crmHospitals } = await supabase
    .from('crm_hospitals')
    .select('id, name, sales_hospital_id')
    .not('sales_hospital_id', 'is', null)
    .order('name')
    .limit(LIMIT);

  if (!crmHospitals || crmHospitals.length === 0) {
    log.info('매칭된 CRM 병원 없음');
    return;
  }

  const hospitalIds = crmHospitals.map((h) => h.sales_hospital_id).filter(Boolean);

  // hospitals에서 크롤링된 병원만 필터 (crawled_at이 있는 것)
  const { data: hospitals } = await supabase
    .from('hospitals')
    .select('id, name, crawled_at')
    .in('id', hospitalIds)
    .not('crawled_at', 'is', null);

  const hospitalMap = new Map((hospitals ?? []).map((h) => [h.id, h]));

  // 크롤링된 병원만 스코어링 대상
  const targets: { crmName: string; hospitalId: string; hospitalName: string }[] = [];
  for (const crm of crmHospitals) {
    const main = hospitalMap.get(crm.sales_hospital_id);
    if (!main) continue;
    targets.push({ crmName: crm.name, hospitalId: main.id, hospitalName: main.name });
  }

  log.info(`스코어링 대상: ${targets.length}개 (크롤링 완료된 병원)\n`);

  // 제품 정보 확인
  const { data: product, error: prodErr } = await supabase
    .from('products')
    .select('id, name, code')
    .eq('id', PRODUCT_ID)
    .single();

  if (prodErr || !product) {
    log.error(`제품 조회 실패: ${prodErr?.message ?? 'not found'}`);
    return;
  }
  log.info(`매칭 제품: ${product.name} (${product.code})\n`);

  const results: ScoreResult[] = [];
  let profileSuccess = 0;
  let profileFail = 0;
  let matchSuccess = 0;
  let matchFail = 0;
  let leadsCreated = 0;

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    log.info(`[${i + 1}/${targets.length}] ${t.crmName} (${t.hospitalName})`);

    // 1단계: 프로파일
    const profileResult = await profileSingleHospital(supabase, t.hospitalId);
    if (!profileResult.success || !profileResult.profile) {
      log.warn(`  프로파일 실패: ${profileResult.error}`);
      profileFail++;
      continue;
    }
    profileSuccess++;

    const prof = profileResult.profile;
    log.info(`  프로파일: ${prof.profile_grade} (${prof.profile_score}점) | 투자=${prof.investment_score} 포트=${prof.portfolio_diversity_score} 규모=${prof.practice_scale_score} 마케팅=${prof.marketing_activity_score}`);

    // 2단계: 매칭
    const matchResult = await matchSingleHospitalProduct(supabase, t.hospitalId, PRODUCT_ID);
    if (!matchResult.success || !matchResult.matchScore) {
      log.warn(`  매칭 실패: ${matchResult.error}`);
      matchFail++;
      results.push({
        hospitalName: t.crmName,
        profileGrade: prof.profile_grade,
        profileScore: prof.profile_score,
        matchGrade: '-',
        matchScore: 0,
        topPitch: [],
        leadCreated: false,
      });
      continue;
    }
    matchSuccess++;

    const ms = matchResult.matchScore;
    const topPitch = (ms.top_pitch_points as string[]) ?? [];
    log.info(`  매칭: ${ms.grade} (${ms.total_score}점) | pitch: ${topPitch.join(', ') || '-'}`);

    // 3단계: S/A등급이면 리드 자동 생성
    let leadCreated = false;
    if (ms.grade === 'S' || ms.grade === 'A') {
      const leadResult = await autoCreateLeadFromMatch(supabase, ms);
      if (leadResult) {
        leadsCreated++;
        leadCreated = true;
        log.info(`  리드 생성됨 (${ms.grade}등급)`);
      }
    }

    results.push({
      hospitalName: t.crmName,
      profileGrade: prof.profile_grade,
      profileScore: prof.profile_score,
      matchGrade: ms.grade,
      matchScore: ms.total_score,
      topPitch,
      leadCreated,
    });
  }

  // 결과 요약
  log.info('\n══════ 스코어링 결과 ══════');
  log.info(`프로파일: 성공 ${profileSuccess} / 실패 ${profileFail}`);
  log.info(`매칭: 성공 ${matchSuccess} / 실패 ${matchFail}`);
  log.info(`리드 생성: ${leadsCreated}개\n`);

  // 등급별 분포
  const profileDist: Record<string, number> = { PRIME: 0, HIGH: 0, MID: 0, LOW: 0 };
  const matchDist: Record<string, number> = { S: 0, A: 0, B: 0, C: 0 };

  for (const r of results) {
    if (r.profileGrade in profileDist) profileDist[r.profileGrade]++;
    if (r.matchGrade in matchDist) matchDist[r.matchGrade]++;
  }

  log.info('프로파일 등급 분포:');
  log.info(`  PRIME: ${profileDist.PRIME} | HIGH: ${profileDist.HIGH} | MID: ${profileDist.MID} | LOW: ${profileDist.LOW}`);
  log.info('매칭 등급 분포:');
  log.info(`  S: ${matchDist.S} | A: ${matchDist.A} | B: ${matchDist.B} | C: ${matchDist.C}`);

  // 상세 테이블
  log.info('\n── 상세 결과 ──');
  log.info('병원명 | 프로파일 | 매칭 | 리드');
  log.info('─'.repeat(60));
  for (const r of results) {
    const lead = r.leadCreated ? '✅' : '';
    log.info(`${r.hospitalName} | ${r.profileGrade}(${r.profileScore}) | ${r.matchGrade}(${r.matchScore}) | ${lead}`);
  }
}

main().catch((err) => {
  log.error('Fatal:', err);
  process.exit(1);
});
