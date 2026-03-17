/**
 * [2단계] 제품별 매칭 스코어 (v3.2)
 * products.scoring_criteria의 sales_angles를 동적 평가하여 product_match_scores에 upsert.
 *
 * 영업 각도 기반:
 *   sales_angles 루프 → 키워드 매칭 (공백 제거 + Contains)
 *   normalizer standard_name 기준 매칭
 *   각도별 점수 산출 → weight 가중합 → total_score
 *   상위 N개를 top_pitch_points로 선택
 *   등급: S(75+) / A(55+) / B(35+) / C(<35)
 *   이전 grade와 비교 → 변동 시 scoring_change_history에 기록
 *
 * v3.2 - 2026-03-13: DEPRECATED v3.0 코드 제거, V31 접미사 제거
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  HospitalEquipment,
  HospitalTreatment,
  HospitalProfile,
  Product,
  ProductMatchScore,
  ScoringCriteriaV31,
  SalesAngle,
  SalesKeyword,
  Grade,
  EquipmentBonusRule,
  ClinicTypeRule,
} from '@madmedsales/shared';
import { T } from '../../lib/table-names';

/**
 * 키워드 매칭: 공백 제거 후 Contains 비교.
 * "남성 피부관리" ↔ "남성피부관리" 매칭 가능.
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
 * tier/point 기반 배점.
 * 매칭된 키워드의 point 합산 / 전체 point 합 × 100.
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

    const matched = allTexts.some((t) => matchesKeyword(kw.term, t));
    const matchedCombined = matchesKeyword(kw.term, combinedText);

    if (matched || matchedCombined) {
      matchedKeywords.push(kw.term);
      matchedPoints += kw.point;
    }
  }

  if (totalPoints === 0) return { score: 0, matchedKeywords, matchedPoints: 0, totalPoints: 0 };

  const score = Math.round((matchedPoints / totalPoints) * 100);

  return { score, matchedKeywords, matchedPoints, totalPoints };
}

/**
 * exclude_if 조건 확인: 이미 제품을 보유한 경우 제외
 * v1.1 - 2026-03-16: competing_keywords 파라미터 추가 (경쟁 제품 배제)
 */
function shouldExclude(
  excludeConditions: string[],
  equipments: HospitalEquipment[],
  competingKeywords?: string[] | null
): boolean {
  for (const condition of excludeConditions) {
    if (condition === 'has_torr_rf') {
      if (equipments.some((e) => e.equipment_name.toLowerCase().includes('torr'))) {
        return true;
      }
    }
    if (equipments.some((e) => matchesKeyword(condition.replace('has_', ''), e.equipment_name))) {
      return true;
    }
  }
  // 경쟁 제품 키워드 배제 (TORR RF: 써마지, 울트라포머 등)
  if (competingKeywords?.length) {
    if (equipments.some((e) =>
      competingKeywords.some((kw) => matchesKeyword(kw, e.equipment_name))
    )) {
      return true;
    }
  }
  return false;
}

// ─── v3.3 보너스 레이어 ──────────────────────────────

/**
 * 보유 장비 기반 보너스 점수 계산.
 * equipment_bonus_rules의 각 장비를 병원 장비 목록과 매칭 → bonus 합산.
 * 캡: +25점 상한
 */
function applyEquipmentBonus(
  rules: EquipmentBonusRule[],
  equipments: HospitalEquipment[]
): { bonus: number; matchedEquipments: string[] } {
  const matched: string[] = [];
  let total = 0;

  for (const rule of rules) {
    const allTerms = [rule.equipment, ...rule.aliases];
    const isMatch = allTerms.some((term) =>
      equipments.some((e) => matchesKeyword(term, e.equipment_name))
    );
    if (isMatch) {
      matched.push(rule.equipment);
      total += rule.bonus_score;
    }
  }

  return {
    bonus: Math.min(total, 25),
    matchedEquipments: matched,
  };
}

/**
 * 병원 타입 프로파일 기반 기본 점수 계산.
 * clinic_type_rules 조건 평가 → 매칭된 타입 중 base_score 최고값 1개만 적용.
 */
function applyClinicTypeBonus(
  rules: ClinicTypeRule[],
  hospital: { address: string | null; sido: string | null; sigungu: string | null; department: string | null },
  equipments: HospitalEquipment[],
  treatments: HospitalTreatment[]
): { bonus: number; matchedType: string | null } {
  const locationText = [hospital.address, hospital.sido, hospital.sigungu]
    .filter(Boolean)
    .join(' ');
  const departmentText = hospital.department ?? '';

  let bestScore = 0;
  let bestType: string | null = null;

  for (const rule of rules) {
    const dr = rule.detection_rules;
    const checks: boolean[] = [];

    if (dr.specialty_contains?.length) {
      checks.push(dr.specialty_contains.some((s) => matchesKeyword(s, departmentText)));
    }
    if (dr.menu_contains_any?.length) {
      checks.push(dr.menu_contains_any.some((kw) =>
        treatments.some((t) => matchesKeyword(kw, t.treatment_name))
      ));
    }
    if (dr.equipment_contains_any?.length) {
      checks.push(dr.equipment_contains_any.some((kw) =>
        equipments.some((e) => matchesKeyword(kw, e.equipment_name))
      ));
    }
    if (dr.equipment_count_gte !== undefined) {
      checks.push(equipments.length >= dr.equipment_count_gte);
    }
    if (dr.location_contains_any?.length) {
      checks.push(dr.location_contains_any.some((loc) => matchesKeyword(loc, locationText)));
    }

    const isMatch = checks.length > 0 && checks.every(Boolean);

    if (isMatch && rule.base_score > bestScore) {
      bestScore = rule.base_score;
      bestType = rule.type;
    }
  }

  return { bonus: bestScore, matchedType: bestType };
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
 * 핵심: 제품별 영업 각도 평가.
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

export function assignMatchGrade(totalScore: number): Grade {
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

  await supabase.from(T.scoring_change_history).insert({
    hospital_id: hospitalId,
    product_id: productId,
    old_match_grade: oldGrade,
    new_match_grade: newGrade,
    change_reason: changeReason,
    changed_at: new Date().toISOString(),
  });
}

// ─── 단건 매칭 ──────────────────────────────────────

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
  // 1. 병원 기본 정보 (v3.3: address, sido, sigungu, department 추가 — 병원 타입/지역 보너스용)
  const { data: hospital, error: hErr } = await supabase
    .from(T.hospitals)
    .select('id, name, opened_at, data_quality_score, latitude, longitude, address, sido, sigungu, department')
    .eq('id', hospitalId)
    .single();

  if (hErr || !hospital) {
    return { success: false, error: '병원을 찾을 수 없습니다.' };
  }

  // 2. 제품
  const { data: product, error: pErr } = await supabase
    .from(T.products)
    .select('*')
    .eq('id', productId)
    .single();

  if (pErr || !product) {
    return { success: false, error: '제품을 찾을 수 없습니다.' };
  }

  // 3. 병원 프로파일
  const { data: profile, error: profErr } = await supabase
    .from(T.hospital_profiles)
    .select('*')
    .eq('hospital_id', hospitalId)
    .single();

  if (profErr || !profile) {
    return { success: false, error: '병원 프로파일이 없습니다. 먼저 1단계 프로파일을 생성하세요.' };
  }

  // 4. 장비, 시술
  const { data: equipments } = await supabase
    .from(T.hospital_equipments)
    .select('*')
    .eq('hospital_id', hospitalId);

  const { data: treatments } = await supabase
    .from(T.hospital_treatments)
    .select('*')
    .eq('hospital_id', hospitalId);

  const equips = (equipments ?? []) as HospitalEquipment[];
  const treats = (treatments ?? []) as HospitalTreatment[];
  const criteria = (product as Product).scoring_criteria as ScoringCriteriaV31;

  // 기존 매칭 결과 조회 (등급 변동 추적용)
  const { data: existingMatch } = await supabase
    .from(T.product_match_scores)
    .select('grade')
    .eq('hospital_id', hospitalId)
    .eq('product_id', productId)
    .single();

  const oldGrade = existingMatch?.grade ?? null;

  // exclude_if + competing_keywords 체크
  const productTyped = product as Product;
  if (shouldExclude(criteria.exclude_if ?? [], equips, productTyped.competing_keywords)) {
    return { success: false, error: '제외 조건 해당 (이미 제품 보유 또는 경쟁 제품 보유)' };
  }

  const { totalScore, angleScores, angleDetails, topPitchPoints } = evaluateSalesAngles(
    criteria, equips, treats
  );

  // ─── v3.3 보너스 레이어 ──────────────────────────────
  let equipBonus = 0;
  let equipMatched: string[] = [];
  let clinicType: string | null = null;
  let clinicBonus = 0;

  if (criteria.equipment_bonus_rules?.length) {
    const eb = applyEquipmentBonus(criteria.equipment_bonus_rules, equips);
    equipBonus = eb.bonus;
    equipMatched = eb.matchedEquipments;
  }

  if (criteria.clinic_type_rules?.length) {
    const cb = applyClinicTypeBonus(criteria.clinic_type_rules, hospital, equips, treats);
    clinicBonus = cb.bonus;
    clinicType = cb.matchedType;
  }

  const totalBonus = Math.min(equipBonus + clinicBonus, 40); // 총 보너스 상한 +40
  const finalScore = Math.min(totalScore + totalBonus, 100); // 최종 점수 상한 100
  // ──────────────────────────────────────────────────────

  // 소규모 의원 C등급 강제 하향: 장비 2개 이하 + 시술 5개 이하 (FR-06)
  const isSmallClinic = equips.length <= 2 && treats.length <= 5;
  const grade = isSmallClinic ? 'C' as Grade : assignMatchGrade(finalScore);

  const matchData = {
    hospital_id: hospitalId,
    product_id: productId,
    need_score: 0,
    fit_score: 0,
    timing_score: 0,
    total_score: finalScore,
    grade,
    sales_angle_scores: angleScores,
    top_pitch_points: topPitchPoints,
    scored_at: new Date().toISOString(),
    scoring_version: 'v3.3',
  };

  const { data: upserted, error: saveErr } = await supabase
    .from(T.product_match_scores)
    .upsert(matchData, { onConflict: 'hospital_id,product_id' })
    .select()
    .single();

  if (saveErr) {
    return { success: false, error: `매칭 스코어 저장 실패: ${saveErr.message}` };
  }

  // 등급 변동 기록
  const detailParts = angleDetails
    .filter((d) => d.matchedPoints > 0 || d.totalPoints > 0)
    .map((d) => `${d.angleId}: ${d.matchedPoints}/${d.totalPoints}pt [${d.matchedKeywords.join(',')}]`);
  const smallClinicNote = isSmallClinic ? ` [소규모의원 C강제: equip=${equips.length}, treat=${treats.length}]` : '';
  const changeReason = `v3.3 매칭: base=${totalScore}, bonus=${totalBonus}(equip:${equipBonus}[${equipMatched.join(',')}]+type:${clinicBonus}[${clinicType ?? 'none'}]), final=${finalScore}; ${detailParts.join('; ')}${smallClinicNote}`;
  await recordGradeChange(supabase, hospitalId, productId, oldGrade, grade, changeReason);

  return { success: true, matchScore: upserted as ProductMatchScore };
}
