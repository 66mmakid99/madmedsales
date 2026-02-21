-- ============================================================
-- Migration 015: 이벤트 데이터 황금 데이터 (Golden Data) 확장
-- 이벤트/할인 정보를 시계열 자산으로 취급
-- 폴센트 모델: 실시간 최저가 알림, 가격 추이, 종료 임박 딜
-- ============================================================

-- hospital_pricing: 이벤트 컨텍스트 컬럼 추가
ALTER TABLE hospital_pricing
  ADD COLUMN IF NOT EXISTS event_label VARCHAR(200),       -- "3월 한정", "오픈 기념", "선착순 10명"
  ADD COLUMN IF NOT EXISTS event_start_date DATE,          -- 이벤트 시작일 (파싱 가능 시)
  ADD COLUMN IF NOT EXISTS event_end_date DATE,            -- 이벤트 종료일 (파싱 가능 시)
  ADD COLUMN IF NOT EXISTS event_conditions JSONB,         -- {"limit":"선착순 10명","duration":"3월 한정","urgency":"마감 임박"}
  ADD COLUMN IF NOT EXISTS event_detected_at TIMESTAMPTZ;  -- 이벤트 최초 감지 시점

-- crawl_snapshots: 이벤트 컨텍스트 보존 컬럼 추가
ALTER TABLE crawl_snapshots
  ADD COLUMN IF NOT EXISTS event_pricing_snapshot JSONB DEFAULT '[]';
  -- 형태: [{ standardName, totalPrice, unitPrice, eventLabel, eventConditions, isEventPrice }]

-- hospital_pricing 이벤트 인덱스
CREATE INDEX IF NOT EXISTS idx_hospital_pricing_event
  ON hospital_pricing(is_event_price, standard_name)
  WHERE is_event_price = true;

CREATE INDEX IF NOT EXISTS idx_hospital_pricing_event_date
  ON hospital_pricing(event_end_date)
  WHERE event_end_date IS NOT NULL;

-- hospital_pricing 시계열 조회 인덱스 (가격 추이용)
CREATE INDEX IF NOT EXISTS idx_hospital_pricing_timeseries
  ON hospital_pricing(standard_name, hospital_id, crawled_at DESC);
