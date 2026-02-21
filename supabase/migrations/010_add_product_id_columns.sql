-- ============================================================
-- Migration 010: 기존 테이블에 product_id 컬럼 추가
-- 기존 데이터 보존을 위해 NULL 허용 (나중에 NOT NULL 전환)
-- ============================================================

-- 1. leads 테이블
ALTER TABLE leads ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS match_score_id UUID REFERENCES product_match_scores(id);
CREATE INDEX IF NOT EXISTS idx_leads_product ON leads(product_id);

-- 2. emails 테이블
ALTER TABLE emails ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id);
CREATE INDEX IF NOT EXISTS idx_emails_product ON emails(product_id);

-- 3. email_sequences 테이블
ALTER TABLE email_sequences ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id);
CREATE INDEX IF NOT EXISTS idx_seq_product ON email_sequences(product_id);

-- 4. demos 테이블
ALTER TABLE demos ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id);
CREATE INDEX IF NOT EXISTS idx_demos_product ON demos(product_id);

-- 5. commissions 테이블
ALTER TABLE commissions ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id);
CREATE INDEX IF NOT EXISTS idx_comm_product ON commissions(product_id);

-- 6. system_settings 업데이트 (새 스코어링 버전 키 추가)
INSERT INTO system_settings (key, value, description) VALUES
  ('scoring_profile_version', '"v1.0"', '현재 병원 프로파일 스코어링 버전'),
  ('scoring_match_version', '"v1.0"', '현재 제품 매칭 스코어링 버전')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
