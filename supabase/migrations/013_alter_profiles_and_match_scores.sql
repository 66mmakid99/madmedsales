-- ============================================================
-- Migration 013: 기존 테이블 변경
-- hospital_profiles: 5축 → 4축 (online_presence → marketing_activity)
-- product_match_scores: 영업 각도 컬럼 추가
-- claude-code-migration-plan.md 1-2절 참조
-- ============================================================

-- hospital_profiles: 5축 → 4축
ALTER TABLE hospital_profiles DROP COLUMN IF EXISTS online_presence_score;
ALTER TABLE hospital_profiles ADD COLUMN IF NOT EXISTS marketing_activity_score NUMERIC(5,2) DEFAULT 0;

-- product_match_scores: 영업 각도 컬럼 추가
ALTER TABLE product_match_scores ADD COLUMN IF NOT EXISTS sales_angle_scores JSONB DEFAULT '{}';
ALTER TABLE product_match_scores ADD COLUMN IF NOT EXISTS top_pitch_points JSONB DEFAULT '[]';
-- ⚠️ 기존 need_score, fit_score, timing_score는 삭제하지 말 것 (deprecated, 안정화 후 삭제)
