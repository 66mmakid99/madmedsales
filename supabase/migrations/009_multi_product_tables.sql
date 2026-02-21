-- ============================================================
-- Migration 009: 멀티 제품 플랫폼 핵심 테이블 생성
-- docs/01-SETUP.md Migration 001, 003, 004 참조
-- ============================================================

-- 1. 제품 마스터 테이블
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  manufacturer TEXT NOT NULL,
  category TEXT NOT NULL,            -- equipment, consumable, service
  subcategory TEXT,                  -- rf, laser, ultrasound, needle, skincare 등
  description TEXT,
  price_min DECIMAL(12, 0),
  price_max DECIMAL(12, 0),
  target_departments TEXT[],
  target_hospital_types TEXT[],

  scoring_criteria JSONB NOT NULL DEFAULT '{}',
  email_guide JSONB NOT NULL DEFAULT '{}',
  demo_guide JSONB DEFAULT '{}',

  requires_equipment_keywords TEXT[],
  competing_keywords TEXT[],
  synergy_keywords TEXT[],

  status TEXT DEFAULT 'active',
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_manufacturer ON products(manufacturer);

-- 2. 병원 프로파일 테이블 (1단계 스코어링 결과, 제품 무관)
CREATE TABLE IF NOT EXISTS hospital_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,

  investment_score INT DEFAULT 0,
  portfolio_diversity_score INT DEFAULT 0,
  practice_scale_score INT DEFAULT 0,
  market_competition_score INT DEFAULT 0,
  online_presence_score INT DEFAULT 0,

  profile_score INT DEFAULT 0,
  profile_grade TEXT,                -- PRIME, HIGH, MID, LOW

  ai_summary TEXT,
  main_focus TEXT,
  target_audience TEXT,
  investment_tendency TEXT,          -- aggressive, moderate, conservative

  competitor_count INT DEFAULT 0,
  naver_review_count INT DEFAULT 0,

  analyzed_at TIMESTAMPTZ DEFAULT NOW(),
  analysis_version TEXT DEFAULT 'v1.0',

  UNIQUE(hospital_id)
);

CREATE INDEX IF NOT EXISTS idx_profile_hospital ON hospital_profiles(hospital_id);
CREATE INDEX IF NOT EXISTS idx_profile_grade ON hospital_profiles(profile_grade);
CREATE INDEX IF NOT EXISTS idx_profile_score ON hospital_profiles(profile_score DESC);

-- 3. 제품 매칭 스코어 테이블 (2단계 스코어링 결과)
CREATE TABLE IF NOT EXISTS product_match_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,

  need_score INT DEFAULT 0,
  fit_score INT DEFAULT 0,
  timing_score INT DEFAULT 0,

  total_score INT DEFAULT 0,
  grade TEXT,                        -- S, A, B, C, EXCLUDE

  ai_selling_points JSONB,
  ai_risks JSONB,
  ai_recommended_approach TEXT,
  ai_recommended_payment TEXT,

  scored_at TIMESTAMPTZ DEFAULT NOW(),
  scoring_version TEXT DEFAULT 'v1.0',

  UNIQUE(hospital_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_match_hospital ON product_match_scores(hospital_id);
CREATE INDEX IF NOT EXISTS idx_match_product ON product_match_scores(product_id);
CREATE INDEX IF NOT EXISTS idx_match_grade ON product_match_scores(grade);
CREATE INDEX IF NOT EXISTS idx_match_score ON product_match_scores(total_score DESC);
