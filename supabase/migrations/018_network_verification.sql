-- 018: 피부과 네트워크/체인 검증 시스템 테이블
-- 2026-02-23

-- 1. networks — 브랜드/체인 마스터
CREATE TABLE IF NOT EXISTS networks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,                    -- '휴먼피부과'
  official_name TEXT,                    -- '(주)휴먼메디컬그룹'
  headquarter_hospital_id UUID REFERENCES hospitals(id),
  official_site_url TEXT,
  branch_page_url TEXT,
  total_branches INTEGER DEFAULT 0,
  category TEXT DEFAULT 'franchise'
    CHECK (category IN ('franchise', 'network', 'group')),
  status TEXT DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'unverified')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_networks_name ON networks(name);
CREATE INDEX idx_networks_status ON networks(status);

-- 2. network_branches — 지점 매핑 + 검증
CREATE TABLE IF NOT EXISTS network_branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id UUID NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
  hospital_id UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  branch_name TEXT,                      -- '광명휴먼피부과'
  role TEXT DEFAULT 'branch'
    CHECK (role IN ('headquarter', 'branch')),

  -- 검증 관련
  confidence TEXT DEFAULT 'candidate'
    CHECK (confidence IN ('confirmed', 'probable', 'candidate', 'unlikely')),
  confidence_score INTEGER DEFAULT 0
    CHECK (confidence_score >= 0 AND confidence_score <= 100),

  -- 각 검증 소스별 점수
  official_site_verified BOOLEAN DEFAULT false,
  domain_pattern_score INTEGER DEFAULT 0,
  corporate_match_score INTEGER DEFAULT 0,
  keyword_match_score INTEGER DEFAULT 0,

  verified_at TIMESTAMPTZ,
  verified_by TEXT,                       -- 'auto' | 'manual'
  verification_notes TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(network_id, hospital_id)
);

CREATE INDEX idx_network_branches_network ON network_branches(network_id);
CREATE INDEX idx_network_branches_hospital ON network_branches(hospital_id);
CREATE INDEX idx_network_branches_confidence ON network_branches(confidence);

-- 3. network_verification_logs — 검증 이력
CREATE TABLE IF NOT EXISTS network_verification_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id UUID REFERENCES networks(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES network_branches(id) ON DELETE CASCADE,
  verification_method TEXT NOT NULL
    CHECK (verification_method IN ('official_site', 'domain_pattern', 'corporate', 'keyword', 'manual')),
  result TEXT NOT NULL
    CHECK (result IN ('match', 'no_match', 'error', 'inconclusive')),
  detail JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_verification_logs_network ON network_verification_logs(network_id);
CREATE INDEX idx_verification_logs_branch ON network_verification_logs(branch_id);
