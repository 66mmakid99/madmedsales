// v1.0 - 2026-02-20
// A-grade email prompt: 우선순위 높은 병원용 이메일 생성 (가치 제안 중심)

import type { EmailPromptInput } from './email-s';

export function buildAGradePrompt(input: EmailPromptInput): string {
  const previousContext = input.previousEmails.length > 0
    ? input.previousEmails
        .map((e, i) => `  ${i + 1}회차: "${e.subject}" (${e.sentAt})`)
        .join('\n')
    : '  없음 (첫 이메일)';

  return `당신은 한국 피부과/성형외과 의료기기 영업 전문가입니다.
아래 병원 정보를 바탕으로 가치 제안 중심의 영업 이메일을 작성하세요.

## 제품 정보
- 제품명: TORR RF
- 브랜드: BRITZMEDI (브릿츠메디)
- 카테고리: RF 리프팅 장비
- 핵심 가치: 최신 RF 기술로 기존 장비 대비 높은 시술 효과 및 환자 만족도
- 가격대: 이메일에 가격을 절대 언급하지 마세요

## 병원 정보
- 병원명: ${input.hospitalName}
- 원장님: ${input.doctorName ?? '미확인'}
- 진료과: ${input.department ?? '피부과/성형외과'}
- 보유 장비: ${input.equipments.length > 0 ? input.equipments.join(', ') : '정보 없음'}
- 주요 시술: ${input.treatments.length > 0 ? input.treatments.join(', ') : '정보 없음'}

## AI 분석 결과
${input.aiAnalysis ?? '분석 정보 없음'}

## 시퀀스 정보
- 현재 단계: ${input.stepNumber}회차
- 목적: ${input.stepPurpose}
- 톤앤매너: ${input.stepTone ?? 'friendly'}
- 핵심 메시지: ${input.stepKeyMessage ?? '일반적인 가치 제안'}
- 개인화 포커스: ${input.personalizationFocus ?? '일반적인 접근'}

## 이전 발송 이메일
${previousContext}

## 작성 규칙
1. 제목: 30자 이내, 반드시 병원명 포함
2. 본문: 300자 이내
3. CTA 1개만 포함 (데모 신청, 자료 요청 등)
4. 수신거부 링크 필수: ${input.unsubscribeUrl}
5. 가격 언급 금지
6. 자연스러운 한국어 사용
7. A등급: 일반적인 RF 가치 제안 중심, 과도한 개인화보다 제품 장점 강조

## 응답 형식 (JSON만 출력)
{
  "subject": "이메일 제목",
  "body_html": "<html>본문</html>",
  "body_text": "텍스트 본문",
  "personalization_notes": "개인화 전략 설명"
}`;
}
