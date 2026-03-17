/**
 * [1단계] 병원 프로파일 생성 (v3.2)
 * 제품과 무관하게 병원 자체의 특성을 분석하여 hospital_profiles에 upsert.
 *
 * 4축 가중치:
 *   투자 성향 35% (신규 장비 도입 트렌드, 프리미엄 장비 비중)
 *   포트폴리오 25% (보유 장비 다양성)
 *   규모 및 신뢰 25% (의료진 수, 베드 수, 전문의)
 *   마케팅 활성 15% (marketing-scorer.ts 호출)
 *
 * 등급 컷: PRIME(80+) / HIGH(60~79) / MID(40~59) / LOW(<40)
 *
 * v3.2 - 2026-03-13: DEPRECATED v3.0 코드 제거, V31 접미사 제거
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Hospital,
  HospitalEquipment,
  HospitalTreatment,
  HospitalProfile,
  ProfileGrade,
} from '@madmedsales/shared';
import { getCompetitors } from './competitor.js';
import { scoreMarketingActivity } from './marketing-scorer.js';
import { T } from '../../lib/table-names';

const PREMIUM_EQUIPMENTS = ['울쎄라', '써마지', '피코슈어', '쿨스컬프팅', '인모드', '포텐자'];

/**
 * 축1: 투자 성향 (0~100)
 * 신규 장비 도입 트렌드 + 프리미엄 장비 비중
 */
export function scoreInvestment(
  equipments: HospitalEquipment[],
  hospital: Pick<Hospital, 'opened_at'>
): number {
  let score = 0;
  const currentYear = new Date().getFullYear();

  // 최근 2년 내 도입 장비 비율 (최대 35점)
  const recentCount = equipments.filter(
    (e) => e.estimated_year != null && currentYear - e.estimated_year <= 2
  ).length;
  const recentRatio = equipments.length > 0 ? recentCount / equipments.length : 0;
  if (recentRatio >= 0.5) score += 35;
  else if (recentRatio >= 0.3) score += 28;
  else if (recentCount >= 2) score += 22;
  else if (recentCount === 1) score += 15;

  // 프리미엄 장비 비중 (최대 40점)
  const premiumCount = equipments.filter((e) =>
    PREMIUM_EQUIPMENTS.some((p) => e.equipment_name.includes(p))
  ).length;
  if (premiumCount >= 4) score += 40;
  else if (premiumCount >= 3) score += 33;
  else if (premiumCount >= 2) score += 25;
  else if (premiumCount >= 1) score += 15;

  // 개원 연차 가산 (최대 25점)
  if (hospital.opened_at) {
    const yearsOpen = currentYear - new Date(hospital.opened_at).getFullYear();
    if (yearsOpen >= 2 && yearsOpen <= 5) score += 25;
    else if (yearsOpen >= 6 && yearsOpen <= 10) score += 18;
    else if (yearsOpen > 10) score += 12;
    else if (yearsOpen >= 1) score += 8;
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * 축2: 포트폴리오 다양성 (0~100)
 * 보유 장비 카테고리 다양성 + 시술 다양성
 */
export function scorePortfolio(
  equipments: HospitalEquipment[],
  treatments: HospitalTreatment[]
): number {
  let score = 0;

  // 장비 카테고리 다양성 (최대 50점)
  const categories = new Set(equipments.map((e) => e.equipment_category));
  const allCategories = ['rf', 'laser', 'hifu', 'ipl', 'booster', 'body', 'lifting'];
  const coverageRatio = categories.size / allCategories.length;
  score += Math.round(coverageRatio * 50);

  // 총 장비 수 (최대 20점)
  const eqCount = equipments.length;
  if (eqCount >= 10) score += 20;
  else if (eqCount >= 7) score += 16;
  else if (eqCount >= 5) score += 12;
  else if (eqCount >= 3) score += 8;
  else if (eqCount >= 1) score += 4;

  // 시술 메뉴 수 (최대 30점)
  const trCount = treatments.length;
  if (trCount >= 20) score += 30;
  else if (trCount >= 15) score += 25;
  else if (trCount >= 10) score += 18;
  else if (trCount >= 5) score += 12;
  else if (trCount >= 1) score += 5;

  return Math.max(0, Math.min(100, score));
}

/**
 * 축3: 규모 및 신뢰 (0~100)
 * 의료진 수, 시술 규모, 가격대
 */
export function scoreScaleTrust(
  treatments: HospitalTreatment[],
  doctorCount: number
): number {
  let score = 0;

  // 의료진 수 (최대 40점)
  if (doctorCount >= 5) score += 40;
  else if (doctorCount >= 3) score += 32;
  else if (doctorCount >= 2) score += 22;
  else if (doctorCount >= 1) score += 12;

  // 시술 가격대 (최대 35점)
  const prices = treatments
    .map((t) => t.price_min ?? t.price)
    .filter((p): p is number => p != null && p > 0);
  if (prices.length > 0) {
    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
    if (avgPrice >= 500000) score += 35;
    else if (avgPrice >= 300000) score += 28;
    else if (avgPrice >= 150000) score += 20;
    else if (avgPrice >= 80000) score += 12;
  }

  // 프리미엄 시술 비중 (최대 25점)
  const premiumCats = ['lifting', 'tightening', 'surgery'];
  const premiumCount = treatments.filter(
    (t) => t.treatment_category != null && premiumCats.includes(t.treatment_category)
  ).length;
  const premiumRatio = treatments.length > 0 ? premiumCount / treatments.length : 0;
  if (premiumRatio >= 0.4) score += 25;
  else if (premiumRatio >= 0.2) score += 18;
  else if (premiumRatio > 0) score += 10;

  return Math.max(0, Math.min(100, score));
}

export function assignProfileGrade(profileScore: number): ProfileGrade {
  if (profileScore >= 80) return 'PRIME';
  if (profileScore >= 60) return 'HIGH';
  if (profileScore >= 40) return 'MID';
  return 'LOW';
}

function classifyInvestmentTendency(investmentScore: number): string {
  if (investmentScore >= 65) return 'aggressive';
  if (investmentScore >= 35) return 'moderate';
  return 'conservative';
}

// ─── 단건 프로파일 생성 ──────────────────────────────

export interface ProfileEnv {
  NAVER_CLIENT_ID?: string;
  NAVER_CLIENT_SECRET?: string;
}

export interface ProfileResult {
  success: boolean;
  profile?: HospitalProfile;
  error?: string;
}

export async function profileSingleHospital(
  supabase: SupabaseClient,
  hospitalId: string,
  env?: ProfileEnv
): Promise<ProfileResult> {
  const { data: hospital, error: hErr } = await supabase
    .from(T.hospitals)
    .select('id, name, opened_at, website, email, data_quality_score, latitude, longitude, sigungu')
    .eq('id', hospitalId)
    .single();

  if (hErr || !hospital) {
    return { success: false, error: '병원을 찾을 수 없습니다.' };
  }

  const { data: equipments } = await supabase
    .from(T.hospital_equipments)
    .select('id, hospital_id, equipment_name, equipment_brand, equipment_category, equipment_model, estimated_year, manufacturer, is_confirmed, source, created_at, updated_at')
    .eq('hospital_id', hospitalId);

  const { data: treatments } = await supabase
    .from(T.hospital_treatments)
    .select('id, hospital_id, treatment_name, treatment_category, price_min, price_max, price, price_event, original_treatment_name, is_promoted, source, created_at')
    .eq('hospital_id', hospitalId);

  const { data: doctors } = await supabase
    .from(T.hospital_doctors)
    .select('id')
    .eq('hospital_id', hospitalId);

  const equips = (equipments ?? []) as HospitalEquipment[];
  const treats = (treatments ?? []) as HospitalTreatment[];
  const doctorCount = doctors?.length ?? 0;

  const competitors = await getCompetitors(supabase, {
    id: hospitalId,
    latitude: hospital.latitude,
    longitude: hospital.longitude,
  });

  // 4축 점수
  const investmentVal = scoreInvestment(equips, hospital);
  const portfolioVal = scorePortfolio(equips, treats);
  const scaleTrustVal = scoreScaleTrust(treats, doctorCount);

  // 마케팅 활성 점수 (marketing-scorer.ts)
  const marketingResult = await scoreMarketingActivity({
    hospitalName: hospital.name,
    website: hospital.website,
    email: hospital.email,
    dataQualityScore: hospital.data_quality_score ?? 0,
    naverReviewCount: 0,
    naverClientId: env?.NAVER_CLIENT_ID,
    naverClientSecret: env?.NAVER_CLIENT_SECRET,
  });
  const marketingVal = marketingResult.score;

  // 가중합: 투자 35% + 포트폴리오 25% + 규모신뢰 25% + 마케팅 15%
  const profileScore = Math.round(
    investmentVal * 0.35 +
    portfolioVal * 0.25 +
    scaleTrustVal * 0.25 +
    marketingVal * 0.15
  );

  const profileGrade = assignProfileGrade(profileScore);

  const profileData = {
    hospital_id: hospitalId,
    investment_score: investmentVal,
    portfolio_diversity_score: portfolioVal,
    practice_scale_score: scaleTrustVal,
    market_competition_score: competitors.length,
    marketing_activity_score: marketingVal,
    profile_score: profileScore,
    profile_grade: profileGrade,
    investment_tendency: classifyInvestmentTendency(investmentVal),
    competitor_count: competitors.length,
    naver_review_count: 0,
    analyzed_at: new Date().toISOString(),
    analysis_version: 'v3.2',
  };

  const { data: upserted, error: saveErr } = await supabase
    .from(T.hospital_profiles)
    .upsert(profileData, { onConflict: 'hospital_id' })
    .select()
    .single();

  if (saveErr) {
    return { success: false, error: `프로파일 저장 실패: ${saveErr.message}` };
  }

  return { success: true, profile: upserted as HospitalProfile };
}
