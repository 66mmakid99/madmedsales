-- Recreate area_codes with normalized schema
-- Data will be repopulated by scripts/normalize-area.ts

DROP TABLE IF EXISTS area_codes;

CREATE TABLE area_codes (
  code text PRIMARY KEY,           -- 10자리 행정구역코드
  name text NOT NULL,              -- 풀네임 (서울특별시 강남구)
  sido text NOT NULL,              -- 시도명 (서울특별시)
  sigungu text,                    -- 시군구명 (강남구) - 시도 레벨은 null
  level smallint NOT NULL          -- 1=시도, 2=시군구
);

CREATE INDEX idx_area_codes_sido ON area_codes(sido);
CREATE INDEX idx_area_codes_sigungu ON area_codes(sigungu);
CREATE INDEX idx_area_codes_level ON area_codes(level);
