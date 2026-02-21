/**
 * 리드 자동 생성
 * 매칭 스코어 산출 후 S/A 등급 + 이메일 보유 → leads 자동 생성.
 * docs/03-SCORING.md 섹션 5 참조.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProductMatchScore } from '@madmedsales/shared';

export interface LeadGenerationResult {
  created: boolean;
  leadId?: string;
  reason?: string;
}

/**
 * 매칭 결과로부터 리드를 자동 생성한다.
 *
 * 조건:
 * 1. grade가 S 또는 A
 * 2. 이메일 보유
 * 3. 해당 hospital_id + product_id 조합으로 기존 리드 없음
 */
export async function autoCreateLeadFromMatch(
  supabase: SupabaseClient,
  matchScore: ProductMatchScore
): Promise<LeadGenerationResult> {
  const { hospital_id, product_id, grade, id: matchScoreId } = matchScore;

  if (grade !== 'S' && grade !== 'A') {
    return { created: false, reason: `등급 ${grade}은 자동 리드 대상이 아닙니다.` };
  }

  // 이메일 확인
  const { data: hospital } = await supabase
    .from('hospitals')
    .select('email, name')
    .eq('id', hospital_id)
    .single();

  if (!hospital?.email) {
    return { created: false, reason: '이메일 미보유' };
  }

  // 중복 확인 (hospital_id + product_id)
  const { data: existing } = await supabase
    .from('leads')
    .select('id')
    .eq('hospital_id', hospital_id)
    .eq('product_id', product_id)
    .limit(1);

  if (existing && existing.length > 0) {
    return { created: false, reason: '이미 리드가 존재합니다.', leadId: existing[0].id as string };
  }

  const priority = grade === 'S' ? 100 : 50;

  // v3.1: top_pitch_points 추출 (있으면 notes에 포함)
  const topPitchPoints = (matchScore as unknown as Record<string, unknown>).top_pitch_points as string[] | undefined;
  const pitchNote = topPitchPoints?.length
    ? `핵심 영업 포인트: ${topPitchPoints.join(', ')}`
    : undefined;

  const { data: newLead, error } = await supabase
    .from('leads')
    .insert({
      hospital_id,
      product_id,
      match_score_id: matchScoreId,
      stage: 'new',
      grade,
      priority,
      contact_email: hospital.email,
      interest_level: 'cold',
      open_count: 0,
      click_count: 0,
      reply_count: 0,
      demo_page_visits: 0,
      price_page_visits: 0,
      kakao_connected: false,
      current_sequence_step: 0,
      notes: pitchNote ?? null,
    })
    .select('id')
    .single();

  if (error) {
    return { created: false, reason: `리드 생성 실패: ${error.message}` };
  }

  // 활동 기록
  await supabase.from('lead_activities').insert({
    lead_id: newLead.id,
    activity_type: 'product_matched',
    title: `제품 매칭 리드 자동 생성 (${grade}등급)`,
    description: `매칭 스코어 ${matchScore.total_score}점, 등급 ${grade}${pitchNote ? ` | ${pitchNote}` : ''}`,
    actor: 'system',
  });

  return { created: true, leadId: newLead.id as string };
}
