/**
 * Step 8: 규칙 승격 엔진
 * 시나리오 반응율 검증 → sales_rules 자동 승격 후보 생성
 * 표본 ≥ 30건 + 반응율 ≥ 10% → 승격 후보 → 관리자 승인 후 활성화
 * v4.0 - 2026-03-10
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { T } from '../../lib/table-names';
import { calculateReward, type RewardResult } from './reward-calculator';

export interface RuleCandidate {
  scenarioId: string;
  productId: string;
  sequenceType: string;
  sampleCount: number;
  responseRate: number;
  eligible: boolean;
  reason: string;
}

export interface PromotionResult {
  ruleId: string;
  scenarioId: string;
  ruleType: string;
}

const MIN_SAMPLE_COUNT = 30;
const MIN_RESPONSE_RATE = 0.10;

/**
 * 시나리오가 규칙 승격 조건을 충족하는지 검사
 */
export function checkEligibility(reward: RewardResult): RuleCandidate {
  const eligible = reward.sentCount >= MIN_SAMPLE_COUNT && reward.rewardScore >= MIN_RESPONSE_RATE;
  let reason = '';

  if (reward.sentCount < MIN_SAMPLE_COUNT) {
    reason = `표본 부족 (${reward.sentCount}/${MIN_SAMPLE_COUNT})`;
  } else if (reward.rewardScore < MIN_RESPONSE_RATE) {
    reason = `반응율 미달 (${(reward.rewardScore * 100).toFixed(1)}% < 10%)`;
  } else if (reward.isClickbait) {
    reason = '클릭베이트 판정 (열람 높음 + 회신 없음)';
  } else {
    reason = '승격 가능';
  }

  return {
    scenarioId: reward.scenarioId,
    productId: '', // caller에서 채워야 함
    sequenceType: reward.sequenceType,
    sampleCount: reward.sentCount,
    responseRate: reward.rewardScore,
    eligible: eligible && !reward.isClickbait,
    reason,
  };
}

/**
 * 시나리오를 규칙으로 승격 (관리자 승인 전 후보 생성)
 */
export async function promoteToRule(
  supabase: SupabaseClient,
  scenarioId: string,
): Promise<PromotionResult | null> {
  // 시나리오 조회
  const { data: scenario } = await supabase
    .from(T.scenarios)
    .select('id, hospital_id, product_id, sequence_type, persona_tone, match_grade, scenario_layers')
    .eq('id', scenarioId)
    .single();

  if (!scenario) return null;

  // Reward 계산
  const reward = await calculateReward(supabase, scenarioId);
  if (!reward) return null;

  const eligibility = checkEligibility(reward);
  if (!eligibility.eligible) return null;

  // 페르소나 조건 조회
  const { data: persona } = await supabase
    .from(T.personas)
    .select('doctor_type, clinic_age_group')
    .eq('hospital_id', scenario.hospital_id as string)
    .single();

  // 규칙 조건/액션 구성
  const condition = {
    match_grade: scenario.match_grade,
    doctor_type: persona?.doctor_type ?? null,
    clinic_age_group: persona?.clinic_age_group ?? null,
  };

  const action = {
    sequence_type: scenario.sequence_type,
    persona_tone: scenario.persona_tone,
    scenario_layers: scenario.scenario_layers,
  };

  // 규칙 생성 (is_active: false → 관리자 승인 필요)
  const { data: rule, error } = await supabase
    .from(T.rules)
    .insert({
      product_id: scenario.product_id,
      rule_type: 'scenario',
      condition,
      action,
      sample_count: reward.sentCount,
      response_rate: reward.rewardScore,
      promoted_from: scenarioId,
      is_active: false,
    })
    .select('id')
    .single();

  if (error) {
    console.error(`Rule promotion failed: ${error.message}`);
    return null;
  }

  // 시나리오 상태 업데이트
  await supabase
    .from(T.scenarios)
    .update({ status: 'completed' })
    .eq('id', scenarioId);

  return {
    ruleId: rule.id as string,
    scenarioId,
    ruleType: 'scenario',
  };
}

/**
 * 특정 제품의 승격 후보 목록 조회
 */
export async function listPromotionCandidates(
  supabase: SupabaseClient,
  productId: string,
): Promise<RuleCandidate[]> {
  const { data: scenarios } = await supabase
    .from(T.scenarios)
    .select('id')
    .eq('product_id', productId)
    .in('status', ['active', 'completed']);

  if (!scenarios) return [];

  const candidates: RuleCandidate[] = [];
  for (const s of scenarios) {
    const reward = await calculateReward(supabase, s.id as string);
    if (!reward || reward.sentCount === 0) continue;

    const candidate = checkEligibility(reward);
    candidate.productId = productId;
    candidates.push(candidate);
  }

  return candidates.sort((a, b) => b.responseRate - a.responseRate);
}

/**
 * 규칙 활성화 (관리자 승인)
 */
export async function approveRule(
  supabase: SupabaseClient,
  ruleId: string,
  approvedBy: string,
): Promise<boolean> {
  const { error } = await supabase
    .from(T.rules)
    .update({
      is_active: true,
      approved_by: approvedBy,
      approved_at: new Date().toISOString(),
    })
    .eq('id', ruleId);

  return !error;
}

/**
 * 활성 규칙 기반으로 새 리드에 시나리오 자동 적용 (AI 호출 없이)
 */
export async function applyActiveRules(
  supabase: SupabaseClient,
  hospitalId: string,
  productId: string,
): Promise<{ applied: boolean; ruleId?: string }> {
  // 해당 병원의 페르소나 조회
  const { data: persona } = await supabase
    .from(T.personas)
    .select('doctor_type, clinic_age_group')
    .eq('hospital_id', hospitalId)
    .single();

  if (!persona) return { applied: false };

  // 매칭 스코어 조회
  const { data: matchScore } = await supabase
    .from(T.product_match_scores)
    .select('grade')
    .eq('hospital_id', hospitalId)
    .eq('product_id', productId)
    .single();

  if (!matchScore) return { applied: false };

  // 활성 규칙 중 조건 매칭
  const { data: rules } = await supabase
    .from(T.rules)
    .select('id, condition, action')
    .eq('product_id', productId)
    .eq('is_active', true)
    .eq('rule_type', 'scenario');

  if (!rules || rules.length === 0) return { applied: false };

  for (const rule of rules) {
    const cond = rule.condition as Record<string, unknown>;
    const act = rule.action as Record<string, unknown>;

    // 조건 매칭
    if (cond.match_grade && cond.match_grade !== matchScore.grade) continue;
    if (cond.doctor_type && cond.doctor_type !== persona.doctor_type) continue;
    if (cond.clinic_age_group && cond.clinic_age_group !== persona.clinic_age_group) continue;

    // 매칭된 규칙 → 시나리오 자동 생성
    await supabase
      .from(T.scenarios)
      .upsert(
        {
          hospital_id: hospitalId,
          product_id: productId,
          match_grade: matchScore.grade,
          sequence_type: act.sequence_type as string,
          persona_tone: act.persona_tone as string,
          scenario_layers: act.scenario_layers,
          buying_stage: 'unaware',
          status: 'active',
        },
        { onConflict: 'hospital_id,product_id' },
      );

    return { applied: true, ruleId: rule.id as string };
  }

  return { applied: false };
}
