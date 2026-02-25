-- 021_recrawl_v3_schema.sql
-- TORR RF 재크롤링 v3: 크롤 원본 저장 + 확장 추출 스키마

-- 1. 크롤링 원본 마크다운 (페이지별 개별 저장)
CREATE TABLE IF NOT EXISTS hospital_crawl_pages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  hospital_id UUID REFERENCES hospitals(id),
  url TEXT NOT NULL,
  page_type TEXT NOT NULL, -- 'main', 'treatment', 'equipment', 'doctor', 'event', 'price', 'other'
  markdown TEXT NOT NULL,
  char_count INTEGER NOT NULL,
  crawled_at TIMESTAMPTZ DEFAULT now(),
  gemini_analyzed BOOLEAN DEFAULT false,
  tenant_id UUID DEFAULT '00000000-0000-0000-0000-000000000001'
);

CREATE INDEX IF NOT EXISTS idx_crawl_pages_hospital ON hospital_crawl_pages(hospital_id);
CREATE INDEX IF NOT EXISTS idx_crawl_pages_tenant ON hospital_crawl_pages(tenant_id);

ALTER TABLE hospital_crawl_pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_crawl_pages" ON hospital_crawl_pages
  USING (tenant_id = '00000000-0000-0000-0000-000000000001');

-- 2. 이벤트/행사 저장 테이블
CREATE TABLE IF NOT EXISTS hospital_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  hospital_id UUID REFERENCES hospitals(id),
  title TEXT NOT NULL,
  description TEXT,
  discount_type TEXT, -- 'percent', 'fixed', 'package', 'free_add', 'other'
  discount_value TEXT, -- '30%', '50000원', '1+1' 등
  related_treatments TEXT[], -- 관련 시술명 배열
  source_url TEXT,
  source TEXT DEFAULT 'firecrawl_gemini_v3',
  crawled_at TIMESTAMPTZ DEFAULT now(),
  tenant_id UUID DEFAULT '00000000-0000-0000-0000-000000000001'
);

CREATE INDEX IF NOT EXISTS idx_events_hospital ON hospital_events(hospital_id);

ALTER TABLE hospital_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_events" ON hospital_events
  USING (tenant_id = '00000000-0000-0000-0000-000000000001');

-- 3. hospital_doctors에 academic_activity 추가 (education, career는 이미 존재)
ALTER TABLE hospital_doctors ADD COLUMN IF NOT EXISTS academic_activity TEXT;

-- 4. hospital_treatments에 price_note, combo_with 추가
ALTER TABLE hospital_treatments ADD COLUMN IF NOT EXISTS price_note TEXT;
ALTER TABLE hospital_treatments ADD COLUMN IF NOT EXISTS combo_with TEXT;
