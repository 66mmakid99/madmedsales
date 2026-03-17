/**
 * AI Analysis using Claude Haiku (v3.2)
 * Generates sales analysis memo for each hospital.
 *
 * v3.2 - 2026-03-13: 프로파일 4축 + 매칭 각도별 결과 기반
 */
import type { CompetitorData, ProfileGrade, Grade } from '@madmedsales/shared';
import type { AngleScoreDetail } from './matcher';
import { buildScoringAnalysisPrompt } from '../ai/prompts/scoring-analysis.js';
import { logAiUsage } from '../ai/usage-logger';
import { createSupabaseClient } from '../../lib/supabase';

interface AIAnalysisInput {
  productName: string;
  productDescription: string;
  hospital: {
    name: string;
    address: string | null;
    department: string | null;
    opened_at: string | null;
  };
  equipments: {
    equipment_name: string;
    equipment_brand: string | null;
    equipment_category: string;
    estimated_year: number | null;
  }[];
  treatments: {
    treatment_name: string;
    treatment_category: string | null;
    price_min: number | null;
    price_max: number | null;
    is_promoted: boolean;
  }[];
  profile: {
    investmentScore: number;
    portfolioScore: number;
    scaleTrustScore: number;
    marketingScore: number;
    profileScore: number;
    profileGrade: ProfileGrade;
  };
  matchResult: {
    totalScore: number;
    grade: Grade;
    angleDetails: AngleScoreDetail[];
    topPitchPoints: string[];
  };
  competitors: CompetitorData[];
}

export interface AIAnalysisResult {
  key_selling_points: string[];
  risks: string[];
  recommended_message_direction: string;
  recommended_payment: string;
  persona_notes: string;
}

interface Env {
  ANTHROPIC_API_KEY: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

interface ClaudeContentBlock {
  type: string;
  text?: string;
}

interface ClaudeResponse {
  content: ClaudeContentBlock[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

function fillTemplate(template: string, input: AIAnalysisInput): string {
  const equipmentsList =
    input.equipments.length > 0
      ? input.equipments
          .map(
            (e) =>
              `- ${e.equipment_name} (${e.equipment_category}${e.equipment_brand ? ', ' + e.equipment_brand : ''}${e.estimated_year ? ', ~' + e.estimated_year : ''})`
          )
          .join('\n')
      : '- 장비 정보 없음';

  const treatmentsList =
    input.treatments.length > 0
      ? input.treatments
          .map(
            (t) =>
              `- ${t.treatment_name} (${t.treatment_category ?? '미분류'}${t.price_min ? ', ' + t.price_min.toLocaleString() + '원~' : ''}${t.is_promoted ? ', 주력' : ''})`
          )
          .join('\n')
      : '- 시술 정보 없음';

  const modernRfCount = input.competitors.filter((c) => c.hasModernRF).length;

  const competitorsList =
    input.competitors.length > 0
      ? input.competitors
          .slice(0, 5)
          .map(
            (c) =>
              `- ${c.name} (${c.distance_meters}m, RF: ${c.hasModernRF ? c.rfEquipmentName ?? '있음' : '없음'})`
          )
          .join('\n')
      : '- 상권 데이터 없음';

  const angleDetailsList = input.matchResult.angleDetails
    .map(
      (d) =>
        `- ${d.angleName}: ${d.score}/100 (가중 ${d.weightedScore}점, 매칭: ${d.matchedKeywords.join(', ') || '없음'})`
    )
    .join('\n');

  return template
    .replace('{{hospital_name}}', input.hospital.name)
    .replace('{{address}}', input.hospital.address ?? '정보 없음')
    .replace('{{department}}', input.hospital.department ?? '정보 없음')
    .replace('{{opened_at}}', input.hospital.opened_at ?? '정보 없음')
    .replace('{{equipments_list}}', equipmentsList)
    .replace('{{treatments_list}}', treatmentsList)
    .replace('{{investment_score}}', String(input.profile.investmentScore))
    .replace('{{portfolio_score}}', String(input.profile.portfolioScore))
    .replace('{{scale_trust_score}}', String(input.profile.scaleTrustScore))
    .replace('{{marketing_score}}', String(input.profile.marketingScore))
    .replace('{{profile_score}}', String(input.profile.profileScore))
    .replace('{{profile_grade}}', input.profile.profileGrade)
    .replace('{{match_total_score}}', String(input.matchResult.totalScore))
    .replace('{{match_grade}}', input.matchResult.grade)
    .replace('{{top_pitch_points}}', input.matchResult.topPitchPoints.join(', ') || '없음')
    .replace('{{angle_details}}', angleDetailsList)
    .replace('{{competitor_count}}', String(input.competitors.length))
    .replace('{{modern_rf_count}}', String(modernRfCount))
    .replace('{{competitors_list}}', competitorsList);
}

function isValidAnalysisResult(data: unknown): data is AIAnalysisResult {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  return (
    Array.isArray(obj.key_selling_points) &&
    Array.isArray(obj.risks) &&
    typeof obj.recommended_message_direction === 'string' &&
    typeof obj.recommended_payment === 'string' &&
    typeof obj.persona_notes === 'string'
  );
}

/**
 * Generate AI analysis memo using Claude Haiku.
 */
export async function generateAIAnalysis(
  env: Env,
  input: AIAnalysisInput
): Promise<AIAnalysisResult> {
  const prompt = fillTemplate(
    buildScoringAnalysisPrompt(input.productName, input.productDescription),
    input
  );

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Claude API error ${response.status}: ${errorText}`);
    }

    const result = (await response.json()) as ClaudeResponse;

    if (result.usage) {
      const supabase = createSupabaseClient(env);
      await logAiUsage(supabase, {
        service: 'claude',
        model: 'claude-haiku-4-5',
        purpose: 'scoring',
        inputTokens: result.usage.input_tokens ?? 0,
        outputTokens: result.usage.output_tokens ?? 0,
      });
    }

    const textBlock = result.content.find((b) => b.type === 'text');
    if (!textBlock?.text) {
      throw new Error('No text content in Claude response');
    }

    const parsed: unknown = JSON.parse(textBlock.text);

    if (!isValidAnalysisResult(parsed)) {
      throw new Error('Invalid AI analysis result structure');
    }

    return parsed;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('AI analysis failed:', message);

    return {
      key_selling_points: ['데이터 기반 분석 필요'],
      risks: ['AI 분석 실패 - 수동 검토 필요'],
      recommended_message_direction:
        `일반적인 ${input.productName} 도입 제안으로 시작하세요.`,
      recommended_payment: 'installment',
      persona_notes: 'AI 분석 실패로 수동 확인이 필요합니다.',
    };
  }
}
