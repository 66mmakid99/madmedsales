-- 016: TORR RF scoring_criteria 가중치 업데이트
-- bridge_care:45, post_op_care:25, mens_target:15, painless_focus:10, combo_body:5
-- (기존: mens_target:30, bridge_care:30, post_op_care:20, painless_focus:20, combo_body:10)

UPDATE products
SET scoring_criteria = jsonb_set(
  scoring_criteria,
  '{sales_angles}',
  '[
    {
      "id": "bridge_care",
      "weight": 45,
      "label": "시술 브릿지 케어",
      "keywords": ["써마지", "울쎄라", "실리프팅", "인모드", "슈링크"],
      "description": "고주파 시술 후 사후관리·브릿지 프로토콜"
    },
    {
      "id": "post_op_care",
      "weight": 25,
      "label": "수술 후 회복 관리",
      "keywords": ["안면거상", "눈성형", "코성형", "지방흡입", "리프팅수술"],
      "description": "수술 후 부종·회복 가속 프로토콜"
    },
    {
      "id": "mens_target",
      "weight": 15,
      "label": "남성 타겟",
      "keywords": ["남성", "탈모", "남성피부", "면도후관리"],
      "description": "남성 전용 메뉴 보유 여부"
    },
    {
      "id": "painless_focus",
      "weight": 10,
      "label": "무통·편의 지향",
      "keywords": ["무통", "수면마취", "통증완화", "편안한"],
      "description": "무통/편의 지향 시술 운영"
    },
    {
      "id": "combo_body",
      "weight": 5,
      "label": "바디 콤보",
      "keywords": ["바디", "복부", "팔뚝", "허벅지", "셀룰라이트"],
      "description": "바디 시술 라인업 보유"
    }
  ]'::jsonb
),
updated_at = NOW()
WHERE name = 'TORR RF';
