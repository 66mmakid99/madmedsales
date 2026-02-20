// v1.0 - 2026-02-20
// B-grade email prompt: 잠재 병원용 이메일 생성 (업계 트렌드 + 가벼운 터치)

import type { EmailPromptInput } from './email-s';

export function buildBGradePrompt(input: EmailPromptInput): string {
  const previousContext = input.previousEmails.length > 0
    ? input.previousEmails
        .map((e, i) => `  ${i + 1}회차: "${e.subject}" (${e.sentAt})`)
        .join('\n')
    : '  없음 (첫 이메일)';

  return `당신은 한국 피부과/성형외과 업계 트렌드에 정통한 컨설턴트입니다.
아래 병원 정보를 바탕으로 업계 정보 공유 형식의 가벼운 이메일을 작성하세요.

## 제품 정보
- 제품명: TORR RF
- 브랜드: BRITZMEDI (브릿츠메디)
- 카테고리: RF 리프팅 장비
- 접근 방식: 직접적인 영업보다는 업계 트렌드 공유 + 자연스러운 제품 언급
- 가격대: 이메일에 가격을 절대 언급하지 마세요

## 병원 정보
- 병원명: ${input.hospitalName}
- 원장님: ${input.doctorName ?? '미확인'}
- 진료과: ${input.department ?? '피부과/성형외과'}
- 보유 장비: ${input.equipments.length > 0 ? input.equipments.join(', ') : '정보 없음'}
- 주요 시술: ${input.treatments.length > 0 ? input.treatments.join(', ') : '정보 없음'}

## 시퀀스 정보
- 현재 단계: ${input.stepNumber}회차
- 목적: ${input.stepPurpose}
- 톤앤매너: ${input.stepTone ?? 'casual'}
- 핵심 메시지: ${input.stepKeyMessage ?? 'RF 리프팅 업계 동향'}
- 개인화 포커스: ${input.personalizationFocus ?? '업계 트렌드'}

## 이전 발송 이메일
${previousContext}

## 작성 규칙
1. 제목: 30자 이내, 병원명 포함
2. 본문: 300자 이내
3. 톤: 정보 공유 형태, 가벼운 터치 (하드셀링 금지)
4. CTA 1개 (자료 받아보기, 트렌드 리포트 등 부담 없는 액션)
5. 수신거부 링크 필수: ${input.unsubscribeUrl}
6. 가격 언급 금지
7. 자연스러운 한국어 사용
8. B등급: 업계 트렌드 + RF 시장 동향 중심, 제품 직접 영업 최소화

## 응답 형식 (JSON만 출력)
{
  "subject": "이메일 제목",
  "body_html": "<html>본문</html>",
  "body_text": "텍스트 본문",
  "personalization_notes": "개인화 전략 설명"
}`;
}
