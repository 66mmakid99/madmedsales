-- 023: medical_devices 테이블 + device_dictionary + site_type 컬럼
-- 작업 3: 사이트 유형 핑거프린팅 (hospitals 컬럼 추가)
-- 작업 4: 의료기기 분류 체계 (device + injectable 분리)

-- ============================================================
-- 작업 3: hospitals 테이블에 site_type 컬럼 추가
-- ============================================================
ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS site_type TEXT;
ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS site_type_confidence REAL;
ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS site_type_signals JSONB;
ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS crawl_fail_reason TEXT;

-- ============================================================
-- 작업 4-1: medical_devices 테이블
-- ============================================================
CREATE TABLE IF NOT EXISTS medical_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID REFERENCES hospitals(id),

  -- 기본 정보
  name TEXT NOT NULL,
  korean_name TEXT,
  manufacturer TEXT,

  -- 계층 분류
  device_type TEXT NOT NULL,        -- 'device' | 'injectable'
  subcategory TEXT NOT NULL,        -- RF, HIFU, laser, filler, botox, booster ...

  -- 영업 관련
  torr_relation TEXT,               -- 'direct_competitor' | 'complementary' | 'unrelated' | 'self'
  torr_relation_detail TEXT,

  -- 메타
  source TEXT,                      -- 'text' | 'image_banner' | 'image_page' | 'ocr'
  confidence TEXT DEFAULT 'confirmed',
  raw_text TEXT,

  -- 시계열
  first_seen_at TIMESTAMPTZ DEFAULT now(),
  last_seen_at TIMESTAMPTZ DEFAULT now(),
  is_active BOOLEAN DEFAULT true,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_medical_devices_hospital ON medical_devices(hospital_id);
CREATE INDEX IF NOT EXISTS idx_medical_devices_type ON medical_devices(device_type, subcategory);
CREATE INDEX IF NOT EXISTS idx_medical_devices_torr ON medical_devices(torr_relation);

-- ============================================================
-- 작업 4-2: device_dictionary (마스터 사전)
-- ============================================================
CREATE TABLE IF NOT EXISTS device_dictionary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  aliases TEXT[],
  device_type TEXT NOT NULL,
  subcategory TEXT NOT NULL,
  manufacturer TEXT,
  torr_relation TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 초기 데이터
INSERT INTO device_dictionary (name, aliases, device_type, subcategory, manufacturer, torr_relation) VALUES
-- 장비 - RF
('써마지 FLX', '{"써마지","thermage","서마지","thermage FLX","써마지FLX"}', 'device', 'RF', 'Solta Medical', 'direct_competitor'),
('써마지 CPT', '{"써마지CPT","thermage CPT"}', 'device', 'RF', 'Solta Medical', 'direct_competitor'),
('TORR RF', '{"토르","토르RF","TORR","토르 RF"}', 'device', 'RF', 'BRITZMEDI', 'self'),
('TORR Comfort Dual', '{"토르 컴포트 듀얼","컴포트듀얼","TORR 컴포트"}', 'device', 'RF', 'BRITZMEDI', 'self'),
('인모드', '{"inmode","인모드FX","InMode","인모드 FX"}', 'device', 'RF', 'InMode', 'direct_competitor'),
('테너', '{"tenor","테너장비","Tenor"}', 'device', 'RF', 'Alma Lasers', 'direct_competitor'),
('올리지오', '{"oligio","Oligio"}', 'device', 'RF', 'Viora', 'direct_competitor'),
('아그네스', '{"agnes","Agnes"}', 'device', 'RF', 'AGNES Medical', 'direct_competitor'),
('시크릿RF', '{"시크릿","secret RF","Secret RF","시크릿 RF"}', 'device', 'microneedle', NULL, 'complementary'),
('스칼렛S', '{"scarlet S","Scarlet S","스칼렛"}', 'device', 'microneedle', NULL, 'complementary'),
('포텐자', '{"potenza","Potenza"}', 'device', 'microneedle', 'Cynosure', 'complementary'),
-- 장비 - HIFU
('울쎄라', '{"ulthera","울세라","울쎄라MPT","Ulthera","울쎄라 프라임","울쎄라프라임"}', 'device', 'HIFU', 'Merz', 'complementary'),
('슈링크', '{"shrink","슈링크유니버스","Shrink Universe","슈링크 유니버스"}', 'device', 'HIFU', 'Classys', 'complementary'),
('더블로', '{"doublo","Doublo","더블로골드"}', 'device', 'HIFU', 'HIRONIC', 'complementary'),
('리프테라', '{"liftera","Liftera"}', 'device', 'HIFU', 'Classys', 'complementary'),
('텐쎄라', '{"tensera","Tensera"}', 'device', 'HIFU', NULL, 'complementary'),
('원쎄라', '{"wonsera","Wonsera"}', 'device', 'HIFU', NULL, 'complementary'),
('덴서티', '{"density","Density"}', 'device', 'HIFU', NULL, 'complementary'),
-- 장비 - laser
('피코슈어', '{"picosure","PicoSure"}', 'device', 'laser', 'Cynosure', 'unrelated'),
('레블라이트SI', '{"revlite SI","RevLite SI","레블라이트"}', 'device', 'laser', 'Cynosure', 'unrelated'),
('엑셀V', '{"excel V","Excel V","엑셀브이"}', 'device', 'laser', 'Cutera', 'unrelated'),
('제네시스', '{"genesis","Genesis"}', 'device', 'laser', 'Cutera', 'unrelated'),
('젠틀맥스', '{"gentlemax","GentleMax","젠틀맥스프로"}', 'device', 'laser', 'Candela', 'unrelated'),
('클라리티', '{"clarity","Clarity"}', 'device', 'laser', 'Lutronic', 'unrelated'),
('온다', '{"onda","Onda"}', 'device', 'laser', 'DEKA', 'complementary'),
-- 장비 - IPL
('M22', '{"M22","루메니스M22"}', 'device', 'IPL', 'Lumenis', 'unrelated'),
('BBL', '{"BBL","BBL Forever+"}', 'device', 'IPL', 'Sciton', 'unrelated'),
('루메카', '{"lumeca","Lumeca"}', 'device', 'IPL', 'InMode', 'unrelated'),
-- 장비 - cryotherapy
('쿨스컬프팅', '{"coolsculpting","젤틱","CoolSculpting","쿨스컬프팅 엘리트"}', 'device', 'cryotherapy', 'Allergan', 'unrelated'),
-- 장비 - EMS_magnetic
('엠스컬프트', '{"emsculpt","M스컬프트","엠스컬프트 NEO","M스컬프트 NEO"}', 'device', 'EMS_magnetic', 'BTL', 'unrelated'),
('엠셀라', '{"emsella","Emsella"}', 'device', 'EMS_magnetic', 'BTL', 'unrelated'),
-- 장비 - other_device
('LDM', '{"LDM"}', 'device', 'other_device', NULL, 'unrelated'),
('에너젯', '{"e-jet","E-Jet"}', 'device', 'other_device', NULL, 'unrelated'),
-- 주사제 - collagen_stimulator
('스컬트라', '{"sculptra","스컬프트라","Sculptra"}', 'injectable', 'collagen_stimulator', 'Galderma', 'unrelated'),
('올리디아365', '{"olidia","올리디아","Olidia 365","올리디아 365"}', 'injectable', 'collagen_stimulator', NULL, 'unrelated'),
('엘란쎄', '{"ellanse","Ellanse"}', 'injectable', 'collagen_stimulator', 'Sinclair', 'unrelated'),
('래디어스', '{"radiesse","Radiesse","레디어스"}', 'injectable', 'collagen_stimulator', 'Merz', 'unrelated'),
-- 주사제 - booster
('리쥬란', '{"rejuran","연어주사","리쥬란힐러","Rejuran"}', 'injectable', 'booster', 'Pharma Research', 'unrelated'),
('쥬베룩', '{"juvelook","쥬베룩 볼륨","Juvelook"}', 'injectable', 'booster', NULL, 'unrelated'),
('리쥬젯', '{"rejujet","리쥬젯"}', 'injectable', 'booster', NULL, 'unrelated'),
('벨로테로 리바이브', '{"belotero revive","벨로테로","Belotero Revive"}', 'injectable', 'booster', 'Merz', 'unrelated'),
-- 주사제 - filler
('쥬비덤', '{"juvederm","Juvederm"}', 'injectable', 'filler', 'Allergan', 'unrelated'),
('레스틸렌', '{"restylane","Restylane"}', 'injectable', 'filler', 'Galderma', 'unrelated'),
-- 주사제 - botox
('보톡스', '{"botox","Botox"}', 'injectable', 'botox', 'Allergan', 'unrelated'),
('제오민', '{"xeomin","Xeomin"}', 'injectable', 'botox', 'Merz', 'unrelated'),
('나보타', '{"nabota","Nabota"}', 'injectable', 'botox', 'Daewoong', 'unrelated'),
-- 주사제 - lipolytic
('아디페', '{"adipe","Adipe"}', 'injectable', 'lipolytic', NULL, 'unrelated'),
-- 주사제 - thread
('실루엣소프트', '{"silhouette soft","Silhouette Soft"}', 'injectable', 'thread', 'Sinclair', 'unrelated')
ON CONFLICT (name) DO NOTHING;
