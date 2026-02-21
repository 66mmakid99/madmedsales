-- ============================================================
-- Migration 012: v3.1 신규 6개 테이블 생성
-- 키워드 사전 시스템 + 크롤링 스냅샷 + 스코어링 이력
-- claude-code-migration-plan.md 1-1절 참조
-- ============================================================

-- 1. 키워드 정규화 사전
CREATE TABLE keyword_dictionary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  standard_name VARCHAR(100) NOT NULL,
  category VARCHAR(50) NOT NULL,          -- hifu, rf, booster, surgery, lifting, body
  aliases JSONB NOT NULL DEFAULT '[]',    -- ["울세라","ulthera","울쎄","울"]
  base_unit_type VARCHAR(20),             -- SHOT, JOULE, CC, UNIT, LINE, SESSION (null이면 SESSION)
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 확정 합성어 사전
CREATE TABLE compound_words (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  compound_name VARCHAR(100) NOT NULL UNIQUE,
  decomposed_names JSONB NOT NULL,        -- ["울쎄라","써마지"]
  scoring_note TEXT,                       -- "고가 브릿지 타겟, 프리미엄 패키지 제안 가능"
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. 합성어 후보 (Gemini 추론, 관리자 confirm 전)
CREATE TABLE compound_word_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_text VARCHAR(200) NOT NULL,
  inferred_decomposition JSONB,           -- ["울쎄라","써마지"]
  confidence NUMERIC(3,2),                -- 0.00~1.00
  discovery_count INT DEFAULT 1,
  first_hospital_id UUID REFERENCES hospitals(id),
  status VARCHAR(20) DEFAULT 'pending',   -- pending, confirmed, rejected
  confirmed_at TIMESTAMPTZ,
  confirmed_by VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. 시술 가격 (B2C 확장 대비 unit_price 포함)
CREATE TABLE hospital_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id),
  treatment_name VARCHAR(200) NOT NULL,   -- 원본 텍스트 ("울쎄라 300샷")
  standard_name VARCHAR(100),             -- keyword_dictionary.standard_name 참조
  raw_text TEXT,                           -- OCR 원문 전체
  total_quantity INT,                      -- 300
  unit_type VARCHAR(20),                   -- SHOT, JOULE, CC, UNIT, LINE, SESSION
  total_price INT,                         -- 1500000
  unit_price NUMERIC(10,2),               -- 5000.00 (= 1500000 / 300)
  price_band VARCHAR(20),                  -- Premium, Mid, Mass
  is_package BOOLEAN DEFAULT false,
  is_event_price BOOLEAN DEFAULT false,
  is_outlier BOOLEAN DEFAULT false,
  confidence_level VARCHAR(20) DEFAULT 'EXACT', -- EXACT, CALCULATED, ESTIMATED
  crawled_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. 크롤링 스냅샷 (변동 감지 + 시계열)
CREATE TABLE crawl_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id),
  crawled_at TIMESTAMPTZ DEFAULT NOW(),
  tier VARCHAR(10),                        -- tier1, tier2, tier3
  pass1_text_hash VARCHAR(64),            -- SHA-256 (변동 감지용)
  pass2_ocr_hash VARCHAR(64),
  equipments_found JSONB DEFAULT '[]',
  treatments_found JSONB DEFAULT '[]',
  pricing_found JSONB DEFAULT '[]',
  new_compounds JSONB DEFAULT '[]',
  diff_summary TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. 스코어링 변동 이력
CREATE TABLE scoring_change_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id),
  product_id UUID REFERENCES products(id),
  changed_at TIMESTAMPTZ DEFAULT NOW(),
  old_profile_grade VARCHAR(10),
  new_profile_grade VARCHAR(10),
  old_match_grade VARCHAR(10),
  new_match_grade VARCHAR(10),
  change_reason TEXT
);

-- 인덱스
CREATE INDEX idx_keyword_dict_category ON keyword_dictionary(category);
CREATE INDEX idx_keyword_dict_unit ON keyword_dictionary(base_unit_type);
CREATE INDEX idx_compound_candidates_status ON compound_word_candidates(status);
CREATE INDEX idx_hospital_pricing_hospital ON hospital_pricing(hospital_id);
CREATE INDEX idx_hospital_pricing_standard ON hospital_pricing(standard_name);
CREATE INDEX idx_hospital_pricing_unit ON hospital_pricing(unit_type, unit_price);
CREATE INDEX idx_crawl_snapshots_hospital ON crawl_snapshots(hospital_id, crawled_at DESC);
CREATE INDEX idx_scoring_history_hospital ON scoring_change_history(hospital_id, changed_at DESC);
