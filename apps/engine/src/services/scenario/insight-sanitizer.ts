/**
 * Insight Card 개인정보 안전장치
 * DB에서 꺼낸 insight card 데이터가 이메일/프롬프트/API 응답에
 * 노출되기 전 반드시 이 sanitizer를 거쳐야 함.
 *
 * ⚠️ 절대 규칙: 인사이트를 제공한 병원명/원장명은 어떤 경우에도 외부 노출 금지
 * v4.0 - 2026-03-10
 */

/** 제거 대상 필드 목록 */
const REDACTED_FIELDS = [
  'clinic_name',
  'doctor_name',
  'clinic_info',
  'video_id',
  'url',
] as const;

/** 한글 이름 패턴 (2~4자 한글) */
const KOREAN_NAME_RE = /[가-힣]{2,4}\s*원장/g;

/** 병원명 패턴 */
const CLINIC_NAME_RE = /[가-힣a-zA-Z0-9]+(?:의원|피부과|성형외과|클리닉|병원)/g;

export interface SanitizedInsight {
  source_code: string;
  advantages: string[];
  clinical_applications: string[];
  target_equipment_stack: Array<{
    equipment: string;
    pitching_strategy: string;
  }>;
  combine_therapy_potential: string[];
  clinic_expansion_status: string;
  objection: string | null;
  trigger: string | null;
  angle: string | null;
  persona_hint: string | null;
}

/**
 * structured JSONB에서 개인정보 제거 후 반환
 */
export function sanitizeInsightStructured(
  structured: Record<string, unknown>,
): SanitizedInsight {
  const clean = { ...structured };

  // 개인정보 필드 삭제
  for (const field of REDACTED_FIELDS) {
    delete clean[field];
  }

  return clean as unknown as SanitizedInsight;
}

/**
 * raw_text에서 개인정보 제거
 */
export function sanitizeInsightText(text: string): string {
  let cleaned = text;

  // YT-XX 코드가 아닌 실제 이름이 남아있을 경우 제거
  cleaned = cleaned.replace(KOREAN_NAME_RE, '전문의');
  cleaned = cleaned.replace(CLINIC_NAME_RE, (match) => {
    // YT- 코드는 유지
    if (match.startsWith('YT-')) return match;
    return '전문 클리닉';
  });

  return cleaned;
}

/**
 * API 응답에 포함될 insight card 데이터 정제
 */
export function sanitizeInsightForApi(
  card: Record<string, unknown>,
): Record<string, unknown> {
  const clean = { ...card };

  // structured 정제
  if (clean.structured && typeof clean.structured === 'object') {
    clean.structured = sanitizeInsightStructured(
      clean.structured as Record<string, unknown>,
    );
  }

  // raw_text 정제
  if (typeof clean.raw_text === 'string') {
    clean.raw_text = sanitizeInsightText(clean.raw_text);
  }

  // source_id (video_id) 제거 — 유튜브 영상 역추적 방지
  delete clean.source_id;

  return clean;
}

/**
 * 이메일 프롬프트에 주입할 insight 요약 생성
 * 개인정보 완전 제거 + 세일즈에 필요한 핵심만 추출
 */
export function buildInsightPromptBlock(
  insights: SanitizedInsight[],
): string {
  if (insights.length === 0) return '';

  const blocks = insights.map((ins, i) => {
    const lines = [
      `[인사이트 ${i + 1}]`,
      `핵심 장점: ${ins.advantages[0] ?? ''}`,
      `임상 적용: ${ins.clinical_applications[0] ?? ''}`,
      `타겟 병원 유형: ${ins.clinic_expansion_status}`,
    ];

    if (ins.target_equipment_stack?.[0]) {
      lines.push(`피칭 전략: ${ins.target_equipment_stack[0].pitching_strategy}`);
    }

    return lines.join('\n');
  });

  return [
    '=== 기고객 검증 인사이트 (익명) ===',
    ...blocks,
    '=== 인사이트 끝 ===',
  ].join('\n\n');
}
