/**
 * Step 7-A: Reward 계산 + 클릭베이트 판정
 * 시나리오별 진짜 반응율 산출 → 규칙 승격 판단 기준
 * v4.0 - 2026-03-10
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { T } from '../../lib/table-names';

export interface RewardResult {
  scenarioId: string;
  sequenceType: string;
  sentCount: number;
  openRate: number;
  replyRate: number;
  demoConversionRate: number;
  rewardScore: number;
  isClickbait: boolean;
}

interface ScenarioRow {
  id: string;
  hospital_id: string;
  product_id: string;
  sequence_type: string;
}

/**
 * 특정 시나리오의 Reward 스코어 계산
 * Reward = 데모전환율 × 0.7 + 긍정회신율 × 0.3
 * 클릭베이트 = 열람율 ≥ 50% + 회신율 0%
 */
export async function calculateReward(
  supabase: SupabaseClient,
  scenarioId: string,
): Promise<RewardResult | null> {
  const { data: scenario } = await supabase
    .from(T.scenarios)
    .select('id, hospital_id, product_id, sequence_type')
    .eq('id', scenarioId)
    .single();

  if (!scenario) return null;
  const s = scenario as ScenarioRow;

  // 해당 시나리오의 리드 조회
  const { data: leads } = await supabase
    .from(T.leads)
    .select('id, open_count, reply_count, stage')
    .eq('hospital_id', s.hospital_id)
    .eq('product_id', s.product_id);

  if (!leads || leads.length === 0) return null;

  // 발송된 이메일 수
  const leadIds = leads.map((l) => l.id as string);
  const { count: sentCount } = await supabase
    .from(T.emails)
    .select('id', { count: 'exact', head: true })
    .in('lead_id', leadIds)
    .eq('status', 'sent');

  const sent = sentCount ?? 0;
  if (sent === 0) return null;

  // 집계
  const totalOpens = leads.reduce((sum, l) => sum + ((l.open_count as number) ?? 0), 0);
  const totalReplies = leads.reduce((sum, l) => sum + ((l.reply_count as number) ?? 0), 0);
  const demoLeads = leads.filter((l) =>
    ['demo_scheduled', 'demo_done', 'proposal', 'negotiation', 'closed_won'].includes(l.stage as string),
  ).length;

  const openRate = totalOpens > 0 ? Math.min(totalOpens / sent, 1) : 0;
  const replyRate = totalReplies / sent;
  const demoConversionRate = demoLeads / leads.length;

  const rewardScore = demoConversionRate * 0.7 + replyRate * 0.3;
  const isClickbait = openRate >= 0.5 && replyRate === 0;

  return {
    scenarioId: s.id,
    sequenceType: s.sequence_type,
    sentCount: sent,
    openRate: Math.round(openRate * 1000) / 1000,
    replyRate: Math.round(replyRate * 1000) / 1000,
    demoConversionRate: Math.round(demoConversionRate * 1000) / 1000,
    rewardScore: Math.round(rewardScore * 1000) / 1000,
    isClickbait,
  };
}

/**
 * 특정 제품의 모든 시나리오 Reward 일괄 계산
 */
export async function calculateRewardsForProduct(
  supabase: SupabaseClient,
  productId: string,
): Promise<RewardResult[]> {
  const { data: scenarios } = await supabase
    .from(T.scenarios)
    .select('id')
    .eq('product_id', productId)
    .in('status', ['active', 'completed']);

  if (!scenarios) return [];

  const results: RewardResult[] = [];
  for (const s of scenarios) {
    const reward = await calculateReward(supabase, s.id as string);
    if (reward && reward.sentCount > 0) {
      results.push(reward);
    }
  }

  return results;
}
