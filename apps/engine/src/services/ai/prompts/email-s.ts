// v2.0 - 2026-02-27
// S-grade email prompt: 최우선 타깃 병원용 이메일 생성 (product 동적 주입)

export interface ProductInfo {
  name: string;
  manufacturer: string;
  category: string;
  valueProposition: string;
  emailGuide: string | null;
}

export interface EmailPromptInput {
  product: ProductInfo;
  hospitalName: string;
  doctorName: string | null;
  department: string | null;
  equipments: string[];
  treatments: string[];
  aiAnalysis: string | null;
  aiMessageDirection: string | null;
  stepNumber: number;
  stepPurpose: string;
  stepTone: string | null;
  stepKeyMessage: string | null;
  personalizationFocus: string | null;
  previousEmails: { subject: string; sentAt: string }[];
  unsubscribeUrl: string;
}

export function buildSGradePrompt(input: EmailPromptInput): string {
  const previousContext = input.previousEmails.length > 0
    ? input.previousEmails
        .map((e, i) => `  ${i + 1}회차: "${e.subject}" (${e.sentAt})`)
        .join('\n')
    : '  없음 (첫 이메일)';

  const emailGuideSection = input.product.emailGuide
    ? `\n## 제품 이메일 가이드\n${input.product.emailGuide}`
    : '';

  return `당신은 한국 피부과/성형외과 의료기기 영업 전문가입니다.
아래 병원 정보를 바탕으로 개인화된 영업 이메일을 작성하세요.

## 제품 정보
- 제품명: ${input.product.name}
- 제조사/브랜드: ${input.product.manufacturer}
- 카테고리: ${input.product.category}
- 핵심 가치: ${input.product.valueProposition}
- 가격: 이메일에 절대 언급하지 마세요${emailGuideSection}

## 병원 정보
- 병원명: ${input.hospitalName}
- 원장님: ${input.doctorName ?? '미확인'}
- 진료과: ${input.department ?? '피부과/성형외과'}
- 보유 장비: ${input.equipments.length > 0 ? input.equipments.join(', ') : '정보 없음'}
- 주요 시술: ${input.treatments.length > 0 ? input.treatments.join(', ') : '정보 없음'}

## AI 분석 결과
${input.aiAnalysis ?? '분석 정보 없음'}

## 메시지 방향성
${input.aiMessageDirection ?? '일반적인 접근'}

## 시퀀스 정보
- 현재 단계: ${input.stepNumber}회차
- 목적: ${input.stepPurpose}
- 톤앤매너: ${input.stepTone ?? 'professional'}
- 핵심 메시지: ${input.stepKeyMessage ?? '자유롭게 작성'}
- 개인화 포커스: ${input.personalizationFocus ?? '병원 특성에 맞춤'}

## 이전 발송 이메일
${previousContext}

## 작성 규칙
1. 제목: 30자 이내, 반드시 병원명 포함 (예: "[${input.hospitalName}] ...")
2. 본문: 300자 이내, 간결하고 임팩트 있게
3. CTA(행동유도)는 정확히 1개만 포함
4. 반드시 본문 하단에 수신거부 링크 포함: ${input.unsubscribeUrl}
5. 가격 절대 언급 금지
6. 자연스러운 한국어 사용 (번역투 금지)
7. 원장님 성함을 알면 "OOO 원장님"으로 호칭
8. S등급 타깃이므로 병원 특성을 깊이 반영한 맞춤형 메시지
9. 제품명(${input.product.name})은 자연스럽게 언급

## 응답 형식 (JSON만 출력)
{
  "subject": "이메일 제목",
  "body_html": "<html>본문</html>",
  "body_text": "텍스트 본문",
  "personalization_notes": "개인화 전략 설명"
}`;
}
