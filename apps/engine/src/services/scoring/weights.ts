// DEPRECATED: replaced by products.scoring_criteria (제품별 동적 스코어링 기준)
// 이 파일은 멀티 제품 전환 이전의 가중치 관리 로직입니다.
// 새 코드에서는 사용하지 마세요.

/**
 * Scoring weights management
 * Handles retrieving active weights and creating new versions.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ScoringWeights } from '@madmedsales/shared';

const DEFAULT_WEIGHTS = {
  weight_equipment_synergy: 25,
  weight_equipment_age: 20,
  weight_revenue_impact: 30,
  weight_competitive_edge: 15,
  weight_purchase_readiness: 10,
};

interface WeightValues {
  equipmentSynergy: number;
  equipmentAge: number;
  revenueImpact: number;
  competitiveEdge: number;
  purchaseReadiness: number;
}

/**
 * Get the currently active scoring weights.
 * Falls back to default weights if none are active.
 */
export async function getActiveWeights(
  supabase: SupabaseClient
): Promise<{ weights: WeightValues; version: string }> {
  const { data, error } = await supabase
    .from('scoring_weights')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    return {
      weights: {
        equipmentSynergy: DEFAULT_WEIGHTS.weight_equipment_synergy,
        equipmentAge: DEFAULT_WEIGHTS.weight_equipment_age,
        revenueImpact: DEFAULT_WEIGHTS.weight_revenue_impact,
        competitiveEdge: DEFAULT_WEIGHTS.weight_competitive_edge,
        purchaseReadiness: DEFAULT_WEIGHTS.weight_purchase_readiness,
      },
      version: 'default',
    };
  }

  const row = data as ScoringWeights;

  return {
    weights: {
      equipmentSynergy: row.weight_equipment_synergy,
      equipmentAge: row.weight_equipment_age,
      revenueImpact: row.weight_revenue_impact,
      competitiveEdge: row.weight_competitive_edge,
      purchaseReadiness: row.weight_purchase_readiness,
    },
    version: row.version,
  };
}

/**
 * Create a new weight version and deactivate previous ones.
 */
export async function createWeightVersion(
  supabase: SupabaseClient,
  weights: WeightValues,
  notes: string
): Promise<void> {
  // Validate weights sum to 100
  const sum =
    weights.equipmentSynergy +
    weights.equipmentAge +
    weights.revenueImpact +
    weights.competitiveEdge +
    weights.purchaseReadiness;

  if (sum !== 100) {
    throw new Error(`Weights must sum to 100, got ${sum}`);
  }

  // Deactivate existing active weights
  const { error: deactivateError } = await supabase
    .from('scoring_weights')
    .update({ is_active: false })
    .eq('is_active', true);

  if (deactivateError) {
    throw new Error(`Failed to deactivate weights: ${deactivateError.message}`);
  }

  // Generate version string
  const now = new Date();
  const version = `v${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;

  // Insert new weight version
  const { error: insertError } = await supabase
    .from('scoring_weights')
    .insert({
      version,
      weight_equipment_synergy: weights.equipmentSynergy,
      weight_equipment_age: weights.equipmentAge,
      weight_revenue_impact: weights.revenueImpact,
      weight_competitive_edge: weights.competitiveEdge,
      weight_purchase_readiness: weights.purchaseReadiness,
      is_active: true,
      notes,
    });

  if (insertError) {
    throw new Error(`Failed to insert weights: ${insertError.message}`);
  }
}
