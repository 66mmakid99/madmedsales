// v1.1 - 2026-03-16
// AI demo preparation prompt for generating hospital-specific demo materials
// v1.1: interest_signals 변수 추가 (오픈수, 클릭수, 방문 페이지)

export function buildDemoPrepPrompt(
  productName: string,
  productDescription: string,
  productPrice: string
): string {
  return `당신은 의료기기 데모 전문가입니다.
${productName}(${productDescription})를 이 병원에 데모하기 위한 맞춤 자료를 준비하세요.

## 제품 정보
- 제품명: ${productName}
- 설명: ${productDescription}
- 가격대: ${productPrice}

## 병원 정보
- 병원명: {{hospital_name}}
- 위치: {{address}}
- 진료과목: {{department}}

## 병원 프로파일
- 투자 성향: {{investment_score}}/100
- 포트폴리오 다양성: {{portfolio_score}}/100
- 규모 및 신뢰: {{scale_trust_score}}/100
- 프로파일 등급: {{profile_grade}}

## 매칭 결과
- 매칭 점수: {{match_total_score}}/100 ({{match_grade}}등급)
- 핵심 영업 포인트: {{top_pitch_points}}

## 관심 신호 (이메일 행동 지표)
{{interest_signals}}

## 보유 장비
{{equipments_list}}

## 시술 메뉴
{{treatments_list}}

## 이메일 소통 이력
{{email_history}}

## 요청
다음 JSON 형식으로 데모 준비 자료를 생성하세요:
{
  "prep_summary": "데모 전 브리핑 (영업 담당자용, 3~5줄)",
  "roi_simulation": {
    "monthly_revenue_increase": "예상 월 매출 증가분 (숫자, 원 단위)",
    "payback_period": "투자 회수 기간 (개월)",
    "assumptions": ["가정 1", "가정 2", "가정 3"]
  },
  "selling_points": ["이 병원에 맞는 핵심 포인트 3개"],
  "objection_handling": [
    {"objection": "예상 반론 1", "response": "대응 방안 1"},
    {"objection": "예상 반론 2", "response": "대응 방안 2"}
  ],
  "recommended_demo_flow": ["데모 진행 단계 1", "단계 2", "단계 3", "단계 4"]
}

JSON만 출력하세요.`;
}
