-- v4: hospital_crawl_pages에 스크린샷 관련 컬럼 추가
ALTER TABLE hospital_crawl_pages ADD COLUMN IF NOT EXISTS screenshot_url TEXT;
ALTER TABLE hospital_crawl_pages ADD COLUMN IF NOT EXISTS analysis_method TEXT DEFAULT 'text';
