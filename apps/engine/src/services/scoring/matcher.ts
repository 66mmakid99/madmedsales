/**
 * [2단계] 제품별 매칭 스코어 (v3.1)
 * products.scoring_criteria의 sales_angles를 동적 평가하여 product_match_scores에 upsert.
 *
 * v3.1 영업 각도 기반:
 *   sales_angles 루프 → 키워드 매칭 (공백 제거 + Contains)
 *   normalizer standard_name 기준 매칭
 *   각도별 점수 산출 → weight 가중합 → total_score
 *   상위 N개를 top_pitch_points로 선택
 *   등급: S(75+) / A(55+) / B(35+) / C(<35)
 *   이전 grade와 비교 → 변동 시 scoring_change_history에 기록
 *
 * v3.1 - 2026-02-21
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Hospital,
  HospitalEquipment,
  HospitalTreatment,
  HospitalProfile,
  Product,
  ProductMatchScore,
  ScoringRule,
  ScoringCriteriaV31,
  ScoringCriteriaLegacy,
  SalesAngle,
  SalesKeyword,
  CompetitorData,
  Grade,
} from '@madmedsales/shared';
import { getCompetitors } from './competitor.js';

// ─── DEPRECATED: v3.0 조건 평가 시스템 (삭제 금지) ──────

// DEPRECATED: replaced by evaluateSalesAngles
interface EvalContext {
  hospital: Pick<Hospital, 'id' | 'opened_at' | 'data_quality_score'>;
  equipments: HospitalEquipment[];
  treatments: HospitalTreatment[];
  profile: HospitalProfile;
  product: Product;
  competitors: CompetitorData[];
}

// DEPRECATED: replaced by evaluateSalesAngles
function evaluateCondition(condition: string, ctx: EvalContext): boolean {
  const currentYear = new Date().getFullYear();
  const rfEquips = ctx.equipments.filter((e) => e.equipment_category === 'rf');
  const hifuEquips = ctx.equipments.filter(
    (e) => e.equipment_category === 'hifu' || e.equipment_category === 'ultrasound'
  );
  switch (condition) {
    case 'no_rf': return rfEquips.length === 0;
    case 'has_rf': return rfEquips.length > 0;
    case 'old_rf_3yr': {
      if (rfEquips.length === 0) return false;
      const years = rfEquips.map((e) => e.estimated_year).filter((y): y is number => y != null);
      if (years.length === 0) return false;
      return currentYear - Math.min(...years) >= 3;
    }
    case 'old_rf_5yr': {
      if (rfEquips.length === 0) return false;
      const years = rfEquips.map((e) => e.estimated_year).filter((y): y is number => y != null);
      if (years.length === 0) return false;
      return currentYear - Math.min(...years) >= 5;
    }
    case 'has_ultrasound': return hifuEquips.length > 0;
    case 'has_laser': return ctx.equipments.some((e) => e.equipment_category === 'laser');
    case 'equipment_count_5plus': return ctx.equipments.length >= 5;
    case 'has_torr_rf': return ctx.equipments.some((e) => e.equipment_name.toLowerCase().includes('torr'));
    case 'has_any_rf_needle': return ctx.treatments.some((t) => t.treatment_name.includes('니들') || t.treatment_name.includes('needle'));
    case 'lifting_treatments': return ctx.treatments.some((t) => t.treatment_category != null && ['lifting', 'tightening'].includes(t.treatment_category));
    case 'high_antiaging_ratio': {
      const antiAging = ['lifting', 'tightening', 'toning', 'filler', 'botox'];
      const count = ctx.treatments.filter((t) => t.treatment_category != null && antiAging.includes(t.treatment_category)).length;
      return count / Math.max(ctx.treatments.length, 1) >= 0.5;
    }
    case 'high_price_treatments': {
      const prices = ctx.treatments.map((t) => t.price_min ?? t.price).filter((p): p is number => p != null && p > 0);
      if (prices.length === 0) return false;
      return prices.reduce((a, b) => a + b, 0) / prices.length >= 300000;
    }
    case 'opened_2_5yr': {
      if (!ctx.hospital.opened_at) return false;
      const years = currentYear - new Date(ctx.hospital.opened_at).getFullYear();
      return years >= 2 && years <= 5;
    }
    case 'recent_investment': return ctx.equipments.some((e) => e.estimated_year != null && currentYear - e.estimated_year <= 2);
    case 'no_recent_rf_purchase': return !rfEquips.some((e) => e.estimated_year != null && currentYear - e.estimated_year <= 2);
    case 'competitive_market': return ctx.competitors.length >= 10;
    case 'prime_profile': return ctx.profile.profile_grade === 'PRIME';
    case 'high_profile': return ctx.profile.profile_grade === 'PRIME' || ctx.profile.profile_grade === 'HIGH';
    case 'has_competing_equipment': {
      const kws = ctx.product.competing_keywords ?? [];
      return ctx.equipments.some((e) => kws.some((k) => e.equipment_name.includes(k)));
    }
    case 'has_synergy_equipment': {
      const kws = ctx.product.synergy_keywords ?? [];
      return ctx.equipments.some((e) => kws.some((k) => e.equipment_name.includes(k)));
    }
    case 'has_required_equipment': {
      const kws = ctx.product.requires_equipment_keywords ?? [];
      return ctx.equipments.some((e) => kws.some((k) => e.equipment_name.includes(k)));
    }
    case 'regular_reorder': return false;
    default: return false;
  }
}

// DEPRECATED: replaced by evaluateSalesAngles
function evaluateRules(rules: ScoringRule[], ctx: EvalContext): number {
  if (!rules || rules.length === 0) return 0;
  let totalPossible = 0;
  let earned = 0;
  for (const rule of rules) {
    totalPossible += rule.score;
    if (evaluateCondition(rule.condition, ctx)) earned += rule.score;
  }
  if (totalPossible === 0) return 0;
  return Math.min(Math.round((earned / totalPossible) * 100), 100);
}

// DEPRECATED: v3.0 Need/Fit/Timing 평가 (삭제 금지)
export function evaluateNeed(rules: ScoringRule[], ctx: EvalContext): number { return evaluateRules(rules, ctx); }
export function evaluateFit(rules: ScoringRule[], ctx: EvalContext): number { return evaluateRules(rules, ctx); }
export function evaluateTiming(rules: ScoringRule[], ctx: EvalContext): number { return evaluateRules(rules, ctx); }

// ─── v3.1 영업 각도 기반 매칭 ─────────────────────────

/**
 * 키워드 매칭: 공백 제거 후 Contains 비교.
 * "남성 피부관리" ↔ "남성피부관리" 매칭 가능.
 * normalizer standard_name 기준 (장비명 + 시술명 모두 검색).
 */
function matchesKeyword(keyword: string, haystack: string): boolean {
  const normalizedKw = keyword.replace(/\s+/g, '').toLowerCase();
  const normalizedHs = haystack.replace(/\s+/g, '').toLowerCase();
  return normalizedHs.includes(normalizedKw);
}

/**
 * 키워드를 SalesKeyword 형태로 정규화.
 * string이면 tier='secondary', point=10으로 fallback.
 */
function normalizeSalesKeyword(kw: SalesKeyword | string): SalesKeyword {
  if (typeof kw === 'string') {
    return { term: kw, tier: 'secondary', point: 10 };
  }
  return kw;
}

/**
 * 단일 영업 각도의 키워드 매칭 점수 산출 (0~100).
 *
 * v3.1.1: tier/point 기반 배점.
 * 매칭된 키워드의 point 합산 / 전체 point 합 × 100.
 * 예: 총 point=120, 매칭 point=80 → 점수 67
 */
function scoreAngle(
  angle: SalesAngle,
  equipments: HospitalEquipment[],
  treatments: HospitalTreatment[]
): { score: number; matchedKeywords: string[]; matchedPoints: number; totalPoints: number } {
  const matchedKeywords: string[] = [];
  let matchedPoints = 0;
  let totalPoints = 0;

  // 병원 데이터 텍스트 풀 구성
  const equipTexts = equipments.map((e) => e.equipment_name);
  const treatTexts = treatments.map((t) => t.treatment_name);
  const catTexts = treatments
    .map((t) => t.treatment_category)
    .filter((c): c is string => c != null);
  const allTexts = [...equipTexts, ...treatTexts, ...catTexts];
  const combinedText = allTexts.join(' ');

  const normalizedKeywords = angle.keywords.map(normalizeSalesKeyword);

  for (const kw of normalizedKeywords) {
    totalPoints += kw.point;

    // 개별 텍스트 매칭 (정밀)
    const matched = allTexts.some((t) => matchesKeyword(kw.term, t));
    // 결합 텍스트 매칭 (광범위)
    const matchedCombined = matchesKeyword(kw.term, combinedText);

    if (matched || matchedCombined) {
      matchedKeywords.push(kw.term);
      matchedPoints += kw.point;
    }
  }

  if (totalPoints === 0) return { score: 0, matchedKeywords, matchedPoints: 0, totalPoints: 0 };

  // point 비율 기반 점수 (0~100)
  const score = Math.round((matchedPoints / totalPoints) * 100);

  return { score, matchedKeywords, matchedPoints, totalPoints };
}

/**
 * exclude_if 조건 확인: 이미 제품을 보유한 경우 제외
 */
function shouldExclude(
  excludeConditions: string[],
  equipments: HospitalEquipment[]
): boolean {
  for (const condition of excludeConditions) {
    if (condition === 'has_torr_rf') {
      if (equipments.some((e) => e.equipment_name.toLowerCase().includes('torr'))) {
        return true;
      }
    }
    // 범용 장비명 포함 체크
    if (equipments.some((e) => matchesKeyword(condition.replace('has_', ''), e.equipment_name))) {
      return true;
    }
  }
  return false;
}

export interface AngleScoreDetail {
  angleId: string;
  angleName: string;
  score: number;
  weight: number;
  weightedScore: number;
  matchedKeywords: string[];
  matchedPoints: number;
  totalPoints: number;
}

/**
 * v3.1 핵심: 제품별 영업 각도 평가.
 * scoring_criteria.sales_angles를 루프하여 키워드 매칭 → 가중합.
 */
export function evaluateSalesAngles(
  criteria: ScoringCriteriaV31,
  equipments: HospitalEquipment[],
  treatments: HospitalTreatment[]
): {
  totalScore: number;
  angleScores: Record<string, number>;
  angleDetails: AngleScoreDetail[];
  topPitchPoints: string[];
} {
  const angleDetails: AngleScoreDetail[] = [];
  const angleScores: Record<string, number> = {};

  const totalWeight = criteria.sales_angles.reduce((sum, a) => sum + a.weight, 0);
  let weightedSum = 0;

  for (const angle of criteria.sales_angles) {
    const { score, matchedKeywords, matchedPoints, totalPoints } = scoreAngle(angle, equipments, treatments);
    const normalizedWeight = totalWeight > 0 ? angle.weight / totalWeight : 0;
    const weightedScore = score * normalizedWeight;

    angleScores[angle.id] = score;
    angleDetails.push({
      angleId: angle.id,
      angleName: angle.label ?? angle.name,
      score,
      weight: angle.weight,
      weightedScore: Math.round(weightedScore * 100) / 100,
      matchedKeywords,
      matchedPoints,
      totalPoints,
    });

    weightedSum += weightedScore;
  }

  const totalScore = Math.round(weightedSum);

  // 상위 N개 pitch points 선택 (매칭 점수 기준)
  const maxPitch = criteria.max_pitch_points ?? 2;
  const sorted = [...angleDetails]
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score || b.weight - a.weight);
  const topPitchPoints = sorted.slice(0, maxPitch).map((d) => d.angleId);

  return { totalScore, angleScores, angleDetails, topPitchPoints };
}

// ─── 매칭 등급 ───────────────────────────────────────

function isV31Criteria(criteria: unknown): criteria is ScoringCriteriaV31 {
  return (
    typeof criteria === 'object' &&
    criteria !== null &&
    'sales_angles' in criteria &&
    Array.isArray((criteria as ScoringCriteriaV31).sales_angles)
  );
}

export function assignMatchGradeV31(totalScore: number): Grade {
  if (totalScore >= 75) return 'S';
  if (totalScore >= 55) return 'A';
  if (totalScore >= 35) return 'B';
  return 'C';
}

// DEPRECATED: v3.0 등급 (data_quality 기반 EXCLUDE 포함)
export function assignMatchGrade(totalScore: number, dataQuality: number): Grade {
  if (dataQuality < 50) return 'EXCLUDE';
  if (totalScore >= 75) return 'S';
  if (totalScore >= 55) return 'A';
  if (totalScore >= 35) return 'B';
  return 'C';
}

// ─── 등급 변동 기록 ────────────────────────────────

async function recordGradeChange(
  supabase: SupabaseClient,
  hospitalId: string,
  productId: string,
  oldGrade: string | null,
  newGrade: string,
  changeReason: string
): Promise<void> {
  if (oldGrade === newGrade) return;

  await supabase.from('scoring_change_history').insert({
    hospital_id: hospitalId,
    product_id: productId,
    old_match_grade: oldGrade,
    new_match_grade: newGrade,
    change_reason: changeReason,
    changed_at: new Date().toISOString(),
  });
}

// ─── 단건 매칭 (v3.1) ──────────────────────────────

export interface MatchResult {
  success: boolean;
  matchScore?: ProductMatchScore;
  error?: string;
}

export async function matchSingleHospitalProduct(
  supabase: SupabaseClient,
  hospitalId: string,
  productId: string
): Promise<MatchResult> {
  // 1. 병원 기본 정보
  const { data: hospital, error: hErr } = await supabase
    .from('hospitals')
    .select('id, name, opened_at, data_quality_score, latitude, longitude')
    .eq('id', hospitalId)
    .single();

  if (hErr || !hospital) {
    return { success: false, error: '병원을 찾을 수 없습니다.' };
  }

  // 2. 제품
  const { data: product, error: pErr } = await supabase
    .from('products')
    .select('*')
    .eq('id', productId)
    .single();

  if (pErr || !product) {
    return { success: false, error: '제품을 찾을 수 없습니다.' };
  }

  // 3. 병원 프로파일
  const { data: profile, error: profErr } = await supabase
    .from('hospital_profiles')
    .select('*')
    .eq('hospital_id', hospitalId)
    .single();

  if (profErr || !profile) {
    return { success: false, error: '병원 프로파일이 없습니다. 먼저 1단계 프로파일을 생성하세요.' };
  }

  // 4. 장비, 시술
  const { data: equipments } = await supabase
    .from('hospital_equipments')
    .select('*')
    .eq('hospital_id', hospitalId);

  const { data: treatments } = await supabase
    .from('hospital_treatments')
    .select('*')
    .eq('hospital_id', hospitalId);

  const equips = (equipments ?? []) as HospitalEquipment[];
  const treats = (treatments ?? []) as HospitalTreatment[];
  const criteria = (product as Product).scoring_criteria;

  // 기존 매칭 결과 조회 (등급 변동 추적용)
  const { data: existingMatch } = await supabase
    .from('product_match_scores')
    .select('grade')
    .eq('hospital_id', hospitalId)
    .eq('product_id', productId)
    .single();

  const oldGrade = existingMatch?.grade ?? null;

  // v3.1 sales_angles 방식 or v3.0 need/fit/timing 방식
  if (isV31Criteria(criteria)) {
    // exclude_if 체크
    if (shouldExclude(criteria.exclude_if ?? [], equips)) {
      return { success: false, error: '제외 조건 해당 (이미 제품 보유)' };
    }

    const { totalScore, angleScores, angleDetails, topPitchPoints } = evaluateSalesAngles(
      criteria, equips, treats
    );

    const grade = assignMatchGradeV31(totalScore);

    const matchData = {
      hospital_id: hospitalId,
      product_id: productId,
      need_score: 0,       // v3.1에서는 미사용 (호환성 유지)
      fit_score: 0,
      timing_score: 0,
      total_score: totalScore,
      grade,
      sales_angle_scores: angleScores,
      top_pitch_points: topPitchPoints,
      scored_at: new Date().toISOString(),
      scoring_version: 'v3.1',
    };

    const { data: upserted, error: saveErr } = await supabase
      .from('product_match_scores')
      .upsert(matchData, { onConflict: 'hospital_id,product_id' })
      .select()
      .single();

    if (saveErr) {
      return { success: false, error: `매칭 스코어 저장 실패: ${saveErr.message}` };
    }

    // 등급 변동 기록 (구체적 사유 포함)
    const detailParts = angleDetails
      .filter((d) => d.matchedPoints > 0 || d.totalPoints > 0)
      .map((d) => `${d.angleId}: ${d.matchedPoints}/${d.totalPoints}pt [${d.matchedKeywords.join(',')}]`);
    const changeReason = `v3.1 매칭: total=${totalScore}, ${detailParts.join('; ')}`;
    await recordGradeChange(supabase, hospitalId, productId, oldGrade, grade, changeReason);

    return { success: true, matchScore: upserted as ProductMatchScore };
  }

  // v3.0 fallback (need/fit/timing)
  const competitors = await getCompetitors(supabase, {
    id: hospitalId,
    latitude: hospital.latitude,
    longitude: hospital.longitude,
  });

  const ctx: EvalContext = {
    hospital, equipments: equips, treatments: treats,
    profile: profile as HospitalProfile, product: product as Product, competitors,
  };

  const legacyCriteria = criteria as ScoringCriteriaLegacy;
  const needScore = evaluateRules(legacyCriteria.need_rules ?? [], ctx);
  const fitScore = evaluateRules(legacyCriteria.fit_rules ?? [], ctx);
  const timingScore = evaluateRules(legacyCriteria.timing_rules ?? [], ctx);

  const totalScore = Math.round(needScore * 0.40 + fitScore * 0.35 + timingScore * 0.25);
  const grade = assignMatchGrade(totalScore, hospital.data_quality_score ?? 0);

  const matchData = {
    hospital_id: hospitalId,
    product_id: productId,
    need_score: needScore,
    fit_score: fitScore,
    timing_score: timingScore,
    total_score: totalScore,
    grade,
    scored_at: new Date().toISOString(),
    scoring_version: 'v3.0-legacy',
  };

  const { data: upserted, error: saveErr } = await supabase
    .from('product_match_scores')
    .upsert(matchData, { onConflict: 'hospital_id,product_id' })
    .select()
    .single();

  if (saveErr) {
    return { success: false, error: `매칭 스코어 저장 실패: ${saveErr.message}` };
  }

  await recordGradeChange(supabase, hospitalId, productId, oldGrade, grade,
    `v3.0-legacy: need=${needScore}, fit=${fitScore}, timing=${timingScore}`);

  return { success: true, matchScore: upserted as ProductMatchScore };
}
