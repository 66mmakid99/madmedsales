-- 008: Enhanced crawling - doctors, manufacturer, price fields
-- Adds hospital_doctors table and extends equipment/treatment columns

CREATE TABLE IF NOT EXISTS hospital_doctors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  title TEXT,              -- 대표원장, 원장, 부원장
  specialty TEXT,          -- 피부과전문의, 성형외과전문의
  career TEXT[],           -- 주요경력 배열
  education TEXT[],        -- 학력 배열
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_doctors_hospital ON hospital_doctors(hospital_id);

ALTER TABLE hospital_equipments
  ADD COLUMN IF NOT EXISTS manufacturer TEXT;

ALTER TABLE hospital_treatments
  ADD COLUMN IF NOT EXISTS price INT,
  ADD COLUMN IF NOT EXISTS price_event INT,
  ADD COLUMN IF NOT EXISTS original_treatment_name TEXT;
