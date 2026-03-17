/**
 * Step 5: 시나리오 엔진
 * match_grade × persona → sequence_type 자동 라우팅 + 시나리오 생성
 * v4.0 - 2026-03-10
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { T } from '../../lib/table-names';

export interface ScenarioInput {
  hospitalId: string;
  productId: string;
}

export interface ScenarioResult {
  scenarioId: string;
  sequenceType: string;
  personaTone: string;
  matchGrade: string;
}

interface PersonaRow {
  id: string;
  hospital_id: string;
  doctor_type: string;
  clinic_age_group: string;
  data_confidence: string;
}

interface MatchScoreRow {
  grade: string;
  total_score: number;
  top_pitch_points: string[] | null;
  sales_angle_scores: Record<string, unknown> | null;
}

/**
 * 시퀀스 타입 결정 로직 (TABLE 10)
 * S등급 → direct_pitch
 * A등급 specialist/newbie → direct_pitch
 * A등급 그 외 → soft_touch
 * B등급 → hold_probe
 */
function determineSequenceType(
  grade: string,
  doctorType: string,
  clinicAgeGroup: string,
): string {
  if (grade === 'S') return 'direct_pitch';
  if (grade === 'A') {
    if (doctorType === 'specialist' && clinicAgeGroup === 'newbie') {
      return 'direct_pitch';
    }
    return 'soft_touch';
  }
  return 'hold_probe';
}

/**
 * 페르소나 톤 결정
 * specialist → 명분우선 (논문/허가/기전 앵글)
 * gp → 돈우선 (ROI/수익성 앵글)
 * network → 균형 (본사 구매 의사결정 프로세스)
 */
function determinePersonaTone(doctorType: string): string {
  if (doctorType === 'specialist') return '명분우선';
  if (doctorType === 'gp') return '돈우선';
  return '균형';
}

/**
 * 3계층 시나리오 레이어 생성
 */
function buildScenarioLayers(
  grade: string,
  personaTone: string,
  topPitchPoints: string[] | null,
): Array<{ layer: number; angle: string; content_template: string }> {
  const layers: Array<{ layer: number; angle: string; content_template: string }> = [];

  if (personaTone === '명분우선') {
    layers.push(
      { layer: 1, angle: '임상근거', content_template: '논문/FDA 허가 기반 신뢰 구축' },
      { layer: 2, angle: '차별화', content_template: '기존 장비 대비 기술적 우위 팩트' },
      { layer: 3, angle: '수익보완', content_template: 'ROI 시뮬레이션 보조 자료' },
    );
  } else if (personaTone === '돈우선') {
    layers.push(
      { layer: 1, angle: 'ROI', content_template: '월 손익분기점 + 환자당 수익 시뮬레이션' },
      { layer: 2, angle: '시장트렌드', content_template: '상권 내 경쟁 현황 + 수가 밴드' },
      { layer: 3, angle: '명분보완', content_template: '임상 근거 요약 보조 자료' },
    );
  } else {
    layers.push(
      { layer: 1, angle: '종합제안', content_template: '본사 의사결정용 종합 제안서' },
      { layer: 2, angle: '규모할인', content_template: '다지점 일괄 도입 시 특별 조건' },
      { layer: 3, angle: '레퍼런스', content_template: '동급 네트워크 도입 사례' },
    );
  }

  // 매칭 스코어의 top_pitch_points 반영
  if (topPitchPoints?.length && layers.length > 0) {
    layers[0].content_template += ` | 핵심: ${topPitchPoints.join(', ')}`;
  }

  return layers;
}

/**
 * 단일 병원×제품에 대한 시나리오 생성/업데이트
 */
export async function generateScenario(
  supabase: SupabaseClient,
  input: ScenarioInput,
): Promise<ScenarioResult | null> {
  const { hospitalId, productId } = input;

  // 매칭 스코어 조회
  const { data: matchScore } = await supabase
    .from(T.product_match_scores)
    .select('grade, total_score, top_pitch_points, sales_angle_scores')
    .eq('hospital_id', hospitalId)
    .eq('product_id', productId)
    .single();

  if (!matchScore || matchScore.grade === 'C') return null;
  const ms = matchScore as MatchScoreRow;

  // 페르소나 조회
  const { data: persona } = await supabase
    .from(T.personas)
    .select('id, hospital_id, doctor_type, clinic_age_group, data_confidence')
    .eq('hospital_id', hospitalId)
    .single();

  if (!persona) return null;
  const p = persona as PersonaRow;

  const sequenceType = determineSequenceType(ms.grade, p.doctor_type, p.clinic_age_group);
  const personaTone = determinePersonaTone(p.doctor_type);
  const layers = buildScenarioLayers(ms.grade, personaTone, ms.top_pitch_points);

  const { data: scenario, error } = await supabase
    .from(T.scenarios)
    .upsert(
      {
        hospital_id: hospitalId,
        product_id: productId,
        persona_id: p.id,
        match_grade: ms.grade,
        sequence_type: sequenceType,
        persona_tone: personaTone,
        scenario_layers: layers,
        buying_stage: 'unaware',
        status: 'pending',
      },
      { onConflict: 'hospital_id,product_id' },
    )
    .select('id')
    .single();

  if (error) {
    console.error(`Scenario upsert failed: ${error.message}`);
    return null;
  }

  return {
    scenarioId: scenario.id as string,
    sequenceType,
    personaTone,
    matchGrade: ms.grade,
  };
}

/**
 * 특정 제품에 대해 모든 S/A/B 병원 시나리오 일괄 생성
 */
export async function generateScenariosForProduct(
  supabase: SupabaseClient,
  productId: string,
): Promise<{ created: number; skipped: number; errors: number }> {
  const { data: matches } = await supabase
    .from(T.product_match_scores)
    .select('hospital_id')
    .eq('product_id', productId)
    .in('grade', ['S', 'A', 'B']);

  if (!matches || matches.length === 0) {
    return { created: 0, skipped: 0, errors: 0 };
  }

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const m of matches) {
    const result = await generateScenario(supabase, {
      hospitalId: m.hospital_id as string,
      productId,
    });
    if (result) created++;
    else skipped++;
  }

  return { created, skipped, errors };
}
