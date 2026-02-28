-- hospitals 테이블에 franchise_brand 컬럼 추가
ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS franchise_brand text;
CREATE INDEX IF NOT EXISTS idx_hospitals_franchise_brand ON hospitals(franchise_brand);
