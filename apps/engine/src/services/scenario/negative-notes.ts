/**
 * Step 7-B: 오답노트 (R1~R6 거부코드 분류)
 * 거부 반응 수집 → rejection_code 자동 분류 → negative_notes 저장
 * v4.0 - 2026-03-10
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { T } from '../../lib/table-names';

export const REJECTION_CODES = {
  R1: { code: 'R1', label: '예산 부족', action: '분할납부/보상판매 앵글로 재접근' },
  R2: { code: 'R2', label: '기존 장비 만족', action: '확장/보상 앵글 또는 장기 보류' },
  R3: { code: 'R3', label: '경쟁사 선택', action: '팩트 비교 앵글 (중립적)' },
  R4: { code: 'R4', label: '시기 상조', action: '장기 보류 (3~6개월 후 재활성화)' },
  R5: { code: 'R5', label: '관심 없음', action: '풀 제외 또는 최하위 우선순위' },
  R6: { code: 'R6', label: '연락 불가', action: '연락처 재확인 후 재시도 또는 제외' },
} as const;

export type RejectionCode = keyof typeof REJECTION_CODES;

export interface NegativeNoteInput {
  hospitalId: string;
  productId: string;
  rejectionCode: RejectionCode;
  rejectionDetail?: string;
  source: 'email_reply' | 'phone' | 'demo_feedback';
  insightCardId?: string;
}

export interface NegativeNoteResult {
  id: string;
  rejectionCode: RejectionCode;
  recommendedAction: string;
}

/**
 * 텍스트에서 거부코드 자동 추론
 */
export function inferRejectionCode(text: string): RejectionCode {
  const lower = text.toLowerCase();

  // 예산/가격 관련
  if (/예산|비용|비싸|가격|부담|자금/.test(lower)) return 'R1';
  // 기존 장비 만족
  if (/만족|현재.*장비|기존.*장비|쓰고.*있|사용.*중/.test(lower)) return 'R2';
  // 경쟁사
  if (/다른.*회사|경쟁|타사|이미.*계약|다른.*제품/.test(lower)) return 'R3';
  // 시기
  if (/나중|다음|시기|아직|내년|올해.*안|검토.*중/.test(lower)) return 'R4';
  // 관심 없음
  if (/관심.*없|필요.*없|수신.*거부|연락.*마|보내.*마/.test(lower)) return 'R5';
  // 연락 불가
  if (/번호.*변경|이메일.*오류|부재|연결.*안|반송/.test(lower)) return 'R6';

  return 'R5'; // 기본값
}

/**
 * 오답노트 저장
 */
export async function createNegativeNote(
  supabase: SupabaseClient,
  input: NegativeNoteInput,
): Promise<NegativeNoteResult | null> {
  const { hospitalId, productId, rejectionCode, rejectionDetail, source, insightCardId } = input;

  const { data, error } = await supabase
    .from(T.negative_notes)
    .insert({
      hospital_id: hospitalId,
      product_id: productId,
      rejection_code: rejectionCode,
      rejection_detail: rejectionDetail ?? null,
      source,
      insight_card_id: insightCardId ?? null,
    })
    .select('id')
    .single();

  if (error) {
    console.error(`Negative note insert failed: ${error.message}`);
    return null;
  }

  const codeInfo = REJECTION_CODES[rejectionCode];

  // R4: 시기 상조 → 시나리오를 excluded로 변경, 3개월 후 재활성화 예약
  if (rejectionCode === 'R4') {
    await supabase
      .from(T.scenarios)
      .update({ status: 'excluded' })
      .eq('hospital_id', hospitalId)
      .eq('product_id', productId);
  }

  // R5: 관심 없음 → 리드 stage를 closed_lost로
  if (rejectionCode === 'R5') {
    await supabase
      .from(T.leads)
      .update({ stage: 'closed_lost' })
      .eq('hospital_id', hospitalId)
      .eq('product_id', productId);

    await supabase
      .from(T.scenarios)
      .update({ status: 'excluded' })
      .eq('hospital_id', hospitalId)
      .eq('product_id', productId);
  }

  // R6: 연락 불가 → 리드 일시 중지
  if (rejectionCode === 'R6') {
    await supabase
      .from(T.leads)
      .update({ stage: 'nurturing' })
      .eq('hospital_id', hospitalId)
      .eq('product_id', productId);
  }

  return {
    id: data.id as string,
    rejectionCode,
    recommendedAction: codeInfo.action,
  };
}

/**
 * 특정 제품의 거부코드 분포 조회
 */
export async function getRejectionDistribution(
  supabase: SupabaseClient,
  productId: string,
): Promise<Record<RejectionCode, number>> {
  const { data } = await supabase
    .from(T.negative_notes)
    .select('rejection_code')
    .eq('product_id', productId);

  const dist: Record<string, number> = { R1: 0, R2: 0, R3: 0, R4: 0, R5: 0, R6: 0 };
  for (const row of data ?? []) {
    const code = row.rejection_code as string;
    if (code in dist) dist[code]++;
  }

  return dist as Record<RejectionCode, number>;
}
