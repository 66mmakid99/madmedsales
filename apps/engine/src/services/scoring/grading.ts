/**
 * Grading module
 * Calculates total weighted score and assigns grade.
 */
import type { Grade } from '@madmedsales/shared';

interface ScoreSet {
  equipmentSynergy: number;
  equipmentAge: number;
  revenueImpact: number;
  competitiveEdge: number;
  purchaseReadiness: number;
}

interface WeightSet {
  equipmentSynergy: number;
  equipmentAge: number;
  revenueImpact: number;
  competitiveEdge: number;
  purchaseReadiness: number;
}

/**
 * Calculate total weighted score from individual axis scores and weights.
 * Weights should sum to 100 (e.g., 25 + 20 + 30 + 15 + 10 = 100).
 */
export function calculateTotalScore(
  scores: ScoreSet,
  weights: WeightSet
): number {
  const total =
    (scores.equipmentSynergy * weights.equipmentSynergy +
      scores.equipmentAge * weights.equipmentAge +
      scores.revenueImpact * weights.revenueImpact +
      scores.competitiveEdge * weights.competitiveEdge +
      scores.purchaseReadiness * weights.purchaseReadiness) /
    100;

  return Math.round(total);
}

/**
 * Assign a grade based on total score and data quality.
 *
 * - dataQuality < 50 -> EXCLUDE (insufficient data)
 * - totalScore >= 80 -> S (top ~5%)
 * - totalScore >= 65 -> A (top ~20%)
 * - totalScore >= 45 -> B (top ~50%)
 * - else -> C
 */
export function assignGrade(totalScore: number, dataQuality: number): Grade {
  if (dataQuality < 50) return 'EXCLUDE';
  if (totalScore >= 80) return 'S';
  if (totalScore >= 65) return 'A';
  if (totalScore >= 45) return 'B';
  return 'C';
}
