-- crm_equipment에 source/detected_at 컬럼 추가
ALTER TABLE crm_equipment
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'delivered',
  ADD COLUMN IF NOT EXISTS detected_at timestamptz;

-- 기존 레코드: source='delivered', status='delivered'
UPDATE crm_equipment SET source = 'delivered', status = 'delivered' WHERE source = 'delivered';

-- source 인덱스
CREATE INDEX IF NOT EXISTS idx_crm_equipment_source ON crm_equipment(source);
