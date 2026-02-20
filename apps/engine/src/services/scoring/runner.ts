/**
 * Scoring runner - orchestrates the full scoring pipeline for a hospital.
 * Extracted from routes/scoring.ts to keep route files under 300 lines.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ScoringOutput, Grade } from '@madmedsales/shared';
import {
  scoreEquipmentSynergy,
  scoreEquipmentAge,
  scoreRevenueImpact,
  scoreCompetitiveEdge,
  scorePurchaseReadiness,
} from './calculator.js';
import { calculateTotalScore, assignGrade } from './grading.js';
import { getCompetitors } from './competitor.js';
import { generateAIAnalysis } from './ai-analysis.js';

interface Env {
  ANTHROPIC_API_KEY: string;
}

interface WeightValues {
  equipmentSynergy: number;
  equipmentAge: number;
  revenueImpact: number;
  competitiveEdge: number;
  purchaseReadiness: number;
}

export interface ScoringRunResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

/**
 * Run full scoring pipeline for a single hospital.
 */
export async function runSingleScoring(
  env: Env,
  supabase: SupabaseClient,
  hospitalId: string,
  weights: WeightValues,
  version: string
): Promise<ScoringRunResult> {
  // 1. Fetch hospital
  const { data: hospital, error: hospErr } = await supabase
    .from('hospitals')
    .select('id, name, department, opened_at, latitude, longitude, address, email, data_quality_score')
    .eq('id', hospitalId)
    .single();

  if (hospErr || !hospital) {
    return { success: false, error: '병원을 찾을 수 없습니다.' };
  }

  // 2. Fetch equipments
  const { data: equipments } = await supabase
    .from('hospital_equipments')
    .select('equipment_name, equipment_brand, equipment_category, estimated_year')
    .eq('hospital_id', hospitalId);

  // 3. Fetch treatments
  const { data: treatments } = await supabase
    .from('hospital_treatments')
    .select('treatment_name, treatment_category, price_min, price_max, is_promoted')
    .eq('hospital_id', hospitalId);

  const equips = equipments ?? [];
  const treats = treatments ?? [];

  // 4. Get competitors
  const competitors = await getCompetitors(supabase, {
    id: hospitalId,
    latitude: hospital.latitude,
    longitude: hospital.longitude,
  });

  // 5. Calculate all 5 scores
  const scores: ScoringOutput['scores'] = {
    equipmentSynergy: scoreEquipmentSynergy(equips),
    equipmentAge: scoreEquipmentAge(equips),
    revenueImpact: scoreRevenueImpact(treats, equips),
    competitiveEdge: scoreCompetitiveEdge(competitors),
    purchaseReadiness: scorePurchaseReadiness(
      { opened_at: hospital.opened_at },
      equips
    ),
  };

  // 6. Total + grade
  const totalScore = calculateTotalScore(scores, weights);
  const grade: Grade = assignGrade(totalScore, hospital.data_quality_score ?? 0);

  const scoringOutput: ScoringOutput = { scores, totalScore, grade };

  // 7. AI analysis
  const aiAnalysis = await generateAIAnalysis(env, {
    hospital: {
      name: hospital.name,
      address: hospital.address,
      department: hospital.department,
      opened_at: hospital.opened_at,
    },
    equipments: equips,
    treatments: treats,
    scores: scoringOutput,
    competitors,
  });

  // 8. Save to scoring_results
  const { data: scoringResult, error: saveErr } = await supabase
    .from('scoring_results')
    .insert({
      hospital_id: hospitalId,
      weight_version: version,
      score_equipment_synergy: scores.equipmentSynergy,
      score_equipment_age: scores.equipmentAge,
      score_revenue_impact: scores.revenueImpact,
      score_competitive_edge: scores.competitiveEdge,
      score_purchase_readiness: scores.purchaseReadiness,
      total_score: totalScore,
      grade,
      ai_analysis: aiAnalysis.recommended_message_direction,
      ai_message_direction: aiAnalysis.recommended_message_direction,
      ai_raw_response: aiAnalysis as unknown as Record<string, unknown>,
      scored_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (saveErr) {
    return { success: false, error: `스코어링 저장 실패: ${saveErr.message}` };
  }

  // 9. Auto-create lead for S/A grade with email
  if (
    (grade === 'S' || grade === 'A') &&
    hospital.email &&
    scoringResult
  ) {
    await autoCreateLead(
      supabase,
      hospitalId,
      scoringResult.id,
      grade,
      hospital.email
    );
  }

  return {
    success: true,
    data: { hospitalId, scores, totalScore, grade, aiAnalysis },
  };
}

/**
 * Auto-create a lead for S/A graded hospitals with email.
 */
async function autoCreateLead(
  supabase: SupabaseClient,
  hospitalId: string,
  scoringResultId: string,
  grade: Grade,
  email: string
): Promise<void> {
  const { data: existing } = await supabase
    .from('leads')
    .select('id')
    .eq('hospital_id', hospitalId)
    .limit(1);

  if (existing && existing.length > 0) return;

  const priority = grade === 'S' ? 100 : 50;

  const { error } = await supabase.from('leads').insert({
    hospital_id: hospitalId,
    scoring_result_id: scoringResultId,
    stage: 'new',
    grade,
    priority,
    contact_email: email,
    interest_level: 'cold',
    open_count: 0,
    click_count: 0,
    reply_count: 0,
    demo_page_visits: 0,
    price_page_visits: 0,
    kakao_connected: false,
    current_sequence_step: 0,
  });

  if (error) {
    console.error(
      `Failed to create lead for hospital ${hospitalId}:`,
      error.message
    );
  }
}
