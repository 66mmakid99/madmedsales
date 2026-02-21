-- ============================================================
-- Migration 011: BRITZMEDI 초기 제품 시딩
-- docs/01-SETUP.md Migration 008 참조
-- ============================================================

INSERT INTO products (name, code, manufacturer, category, subcategory,
  price_min, price_max, target_departments, target_hospital_types,
  scoring_criteria, email_guide, competing_keywords, synergy_keywords, sort_order)
VALUES
(
  'TORR RF', 'torr-rf', 'BRITZMEDI', 'equipment', 'rf',
  25000000, 28000000,
  ARRAY['피부과', '성형외과'],
  ARRAY['의원', '병원'],
  '{
    "need_rules": [
      {"condition": "no_rf", "score": 40, "reason": "RF 장비 공백 → 신규 도입 기회"},
      {"condition": "old_rf_5yr", "score": 30, "reason": "RF 5년+ → 교체 적기"},
      {"condition": "old_rf_3yr", "score": 15, "reason": "RF 3~4년 → 추가 도입 가능"},
      {"condition": "lifting_treatments", "score": 25, "reason": "리프팅 시술 수요 확인"},
      {"condition": "high_antiaging_ratio", "score": 20, "reason": "안티에이징 집중 병원"}
    ],
    "fit_rules": [
      {"condition": "has_ultrasound", "score": 20, "reason": "HIFU+RF 콤보 시너지"},
      {"condition": "equipment_count_5plus", "score": 15, "reason": "적극 투자형 병원"},
      {"condition": "high_price_treatments", "score": 15, "reason": "고가 시술 → 환자 구매력"},
      {"condition": "competitive_market", "score": 10, "reason": "경쟁 심한 상권 → 차별화 필요"}
    ],
    "timing_rules": [
      {"condition": "opened_2_5yr", "score": 30, "reason": "확장기 병원"},
      {"condition": "recent_investment", "score": 25, "reason": "최근 장비 투자 이력"},
      {"condition": "no_recent_rf_purchase", "score": 20, "reason": "RF 최근 구매 없음"}
    ]
  }'::jsonb,
  '{
    "product_summary": "고주파(RF) 기반 피부 리프팅/타이트닝 의료기기",
    "key_benefits": ["빠른 시술 시간", "높은 환자 만족도", "다양한 시술 조합 가능"],
    "price_mention_policy": "이메일에서 직접 가격 언급 금지, 문의 유도",
    "tone_guide": "전문적이면서 친근한 톤, 의료기기법 준수",
    "cta_options": ["데모 신청", "자료 요청", "상담 예약"]
  }'::jsonb,
  ARRAY['써마지', '인모드', '올리지오', '포텐자', '시크릿'],
  ARRAY['울쎄라', '슈링크', '더블로', '리프테라'],
  1
),
(
  '2mm 니들 (소모품)', 'needle-2mm', 'BRITZMEDI', 'consumable', 'needle',
  NULL, NULL,
  ARRAY['피부과', '성형외과'],
  ARRAY['의원', '병원'],
  '{
    "need_rules": [
      {"condition": "has_torr_rf", "score": 90, "reason": "TORR RF 보유 → 필수 소모품"},
      {"condition": "has_any_rf_needle", "score": 30, "reason": "RF 니들 시술 중 → 호환 가능성"}
    ],
    "fit_rules": [],
    "timing_rules": [
      {"condition": "regular_reorder", "score": 50, "reason": "정기 주문 패턴"}
    ]
  }'::jsonb,
  '{
    "product_summary": "TORR RF 전용 2mm 시술 니들",
    "key_benefits": ["정품 소모품", "안정적 공급", "대량 주문 할인"],
    "price_mention_policy": "가격 안내 가능 (소모품이므로)",
    "tone_guide": "실무적이고 간결한 톤",
    "cta_options": ["견적 요청", "샘플 요청"]
  }'::jsonb,
  ARRAY['TORR RF', 'TORR'],
  NULL,
  2
)
ON CONFLICT (code) DO NOTHING;
