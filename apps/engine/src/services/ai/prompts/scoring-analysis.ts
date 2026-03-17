// v3.1 - 2026-03-15
// v3.1: 6-Angle 레이블 매핑 추가 (post_op 신규 각도 반영)
// v3.0: 4축 프로파일 + 영업각도 매칭 결과 기반

// 영업 각도 한국어 레이블 매핑 (6-Angle v3.3)
export const ANGLE_LABEL_KO: Record<string, string> = {
  bridge:   '무통증 진입장벽',
  post_op:  '수술 사후관리',   // v3.3 신규
  post_tx:  '시술 후 유지관리',
  mens:     '남성 타겟',
  painless: '다회차 재방문',
  body:     '바디 컨투어링',
};

export function buildScoringAnalysisPrompt(productName: string, productDescription: string): string {
  return `당신은 한국 미용 의료기기 영업 전문가입니다.
${productName}(${productDescription})를 이 병원에 제안하는 관점에서 분석 메모를 작성하세요.

## 병원 정보
- 병원명: {{hospital_name}}
- 위치: {{address}}
- 진료과목: {{department}}
- 개원: {{opened_at}}

## 보유 장비
{{equipments_list}}

## 시술 메뉴
{{treatments_list}}

## 병원 프로파일 (4축)
- 투자 성향: {{investment_score}}/100
- 포트폴리오 다양성: {{portfolio_score}}/100
- 규모 및 신뢰: {{scale_trust_score}}/100
- 마케팅 활성도: {{marketing_score}}/100
- 프로파일 종합: {{profile_score}}/100 (등급: {{profile_grade}})

## 제품 매칭 결과
- 매칭 종합: {{match_total_score}}/100 (등급: {{match_grade}})
- 핵심 영업 포인트: {{top_pitch_points}}
{{angle_details}}

## 상권 경쟁 현황
- 반경 1km 내 경쟁 병원: {{competitor_count}}개
- 최신 RF 보유 병원: {{modern_rf_count}}개
{{competitors_list}}

## 요청
다음 JSON 형식으로 분석 메모를 작성하세요:
{
  "key_selling_points": ["핵심 포인트 1", "핵심 포인트 2", "핵심 포인트 3"],
  "risks": ["주의사항/리스크"],
  "recommended_message_direction": "첫 이메일에서 강조할 점 (2~3문장)",
  "recommended_payment": "추천 결제 방식 (lump_sum/installment/rental 중)",
  "persona_notes": "이 원장에 대한 추정 성향 메모 (1~2문장)"
}

JSON만 출력하세요.`;
}
