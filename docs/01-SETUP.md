# Phase 0: 프로젝트 셋업 (Week 1~2)

## 이 Phase의 목표

빈 앱 3개가 각각의 도메인에서 구동되고, DB 테이블이 모두 생성된 상태.

## 완료 체크리스트

- [ ] 모노레포 구조 생성 (turbo, 3개 앱)
- [ ] Supabase 프로젝트 생성 + 전체 마이그레이션 실행
- [ ] Cloudflare 설정 (도메인 3개, Workers, Pages)
- [ ] 이메일 도메인 설정 (SPF/DKIM/DMARC)
- [ ] 기본 인증 (Supabase Auth + admin 로그인)
- [ ] 환경변수 세팅
- [ ] 초기 제품 데이터 시딩 (BRITZMEDI 제품 등록)

---

## 1. 모노레포 구조

```
madmedsales/
├── package.json                    # 워크스페이스 루트
├── turbo.json                      # Turborepo 설정
├── apps/
│   ├── web/                        # 공개 웹 (Astro 5 + React 19 + Tailwind 4)
│   │   ├── astro.config.mjs
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── layouts/Layout.astro
│   │   │   ├── pages/index.astro    # "Coming Soon" 페이지로 시작
│   │   │   └── styles/global.css
│   │   └── public/
│   │
│   ├── admin/                      # 관리자 대시보드 (React 19 + Vite 7 + Tailwind 4)
│   │   ├── vite.config.ts
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── App.tsx              # 로그인 화면 + 빈 대시보드
│   │   │   ├── main.tsx
│   │   │   ├── lib/supabase.ts      # Supabase 클라이언트
│   │   │   └── routes/
│   │   │       └── Dashboard.tsx    # 빈 대시보드 (Phase 6에서 완성)
│   │   └── index.html
│   │
│   └── engine/                     # API 서버 (Hono + TypeScript on Workers)
│       ├── wrangler.toml
│       ├── package.json
│       └── src/
│           ├── index.ts             # 엔트리 + 헬스체크 엔드포인트
│           ├── middleware/
│           │   ├── auth.ts          # Supabase JWT 검증
│           │   └── cors.ts          # CORS 설정
│           └── lib/
│               └── supabase.ts      # Supabase 서버 클라이언트
│
├── packages/
│   └── shared/                     # 공유 타입/상수
│       ├── package.json
│       └── src/
│           ├── types/               # 전 앱 공유 타입
│           └── constants/           # 공유 상수
│
├── scripts/                        # 크롤러, 시딩 등 (Phase 1에서 추가)
│
├── supabase/
│   ├── config.toml
│   └── migrations/                 # 아래 DB 스키마 참조
│
└── docs/                           # 이 문서들
```

### 루트 package.json

```json
{
  "name": "madmedsales",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev:web": "turbo run dev --filter=@madmedsales/web",
    "dev:admin": "turbo run dev --filter=@madmedsales/admin",
    "dev:engine": "turbo run dev --filter=@madmedsales/engine",
    "dev": "turbo run dev",
    "build": "turbo run build",
    "deploy:web": "turbo run deploy --filter=@madmedsales/web",
    "deploy:admin": "turbo run deploy --filter=@madmedsales/admin",
    "deploy:engine": "turbo run deploy --filter=@madmedsales/engine"
  },
  "devDependencies": {
    "turbo": "^2.0.0",
    "typescript": "^5.5.0"
  }
}
```

---

## 2. Cloudflare 설정

### 도메인

1. `madmedsales.com` 도메인 등록 (또는 이전)
2. Cloudflare DNS에 추가
3. 서브도메인 설정:
   - `www.madmedsales.com` → Pages (web)
   - `admin.madmedsales.com` → Pages (admin)
   - `api.madmedsales.com` → Workers (engine)

### Engine wrangler.toml

```toml
name = "madmedsales-engine"
main = "src/index.ts"
compatibility_date = "2024-12-01"

[vars]
ENVIRONMENT = "production"

routes = [
  { pattern = "api.madmedsales.com/*", zone_name = "madmedsales.com" }
]

[[kv_namespaces]]
binding = "SETTINGS_KV"
id = "xxx"
```

---

## 3. 이메일 도메인 설정

Resend에서 도메인 인증 (발신 도메인: madmedsales.com)

```
# SPF
TXT  @  "v=spf1 include:resend.com ~all"

# DKIM (Resend에서 제공하는 값)
CNAME  resend._domainkey  xxx.dkim.resend.dev

# DMARC
TXT  _dmarc  "v=DMARC1; p=none; rua=mailto:dmarc@madmedsales.com"

# Reply-To용 MX (선택)
MX  @  feedback-smtp.resend.com  10
```

> 이메일 도메인 웜업: 처음 2주는 일 10통 → 점진적 증가. Phase 3에서 상세.

---

## 4. Supabase 설정

1. Supabase 프로젝트 생성 (Region: Northeast Asia - Seoul 권장)
2. Project URL, anon key, service role key 확보
3. Auth 설정: Email/Password 활성화 (admin용)
4. 초기 admin 계정 생성

---

## 5. DB 스키마 (전체)

> 이 Phase에서 모든 테이블을 한번에 만듭니다.
> 이후 Phase에서는 DB를 만들지 않고, 여기서 만든 테이블을 사용만 합니다.

### Migration 001: 제품 (플랫폼의 핵심)

```sql
-- ============================================================
-- 제품 마스터 (모든 영업 활동의 기준점)
-- 같은 병원이라도 제품마다 스코어가 다르고, 시퀀스가 다르고, 리드가 다름
-- ============================================================
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,                -- TORR RF, 2mm 바늘 등
  code TEXT UNIQUE NOT NULL,         -- torr-rf, needle-2mm 등 (URL/코드용)
  manufacturer TEXT NOT NULL,        -- BRITZMEDI, 제휴사명 등
  category TEXT NOT NULL,            -- equipment, consumable, service
  subcategory TEXT,                  -- rf, laser, ultrasound, needle, skincare 등
  description TEXT,
  price_min DECIMAL(12, 0),          -- 최소 가격 (원)
  price_max DECIMAL(12, 0),          -- 최대 가격 (원)
  target_departments TEXT[],         -- {'피부과', '성형외과'} 등
  target_hospital_types TEXT[],      -- {'의원', '병원'} 등
  
  -- 제품별 스코어링 기준 (JSON)
  -- 이 제품을 팔려면 병원이 어떤 조건을 갖춰야 하는지 정의
  scoring_criteria JSONB NOT NULL DEFAULT '{}',
  
  -- 제품별 이메일 가이드 (JSON)
  -- AI가 이메일을 쓸 때 참고할 제품 정보
  email_guide JSONB NOT NULL DEFAULT '{}',
  
  -- 제품별 데모 가이드
  demo_guide JSONB DEFAULT '{}',
  
  -- 관련 장비 키워드 (소모품의 경우, 이 장비를 보유한 병원이 타깃)
  -- 예: 2mm 바늘 → ['TORR RF', 'TORR'] (TORR RF 보유 병원이 타깃)
  requires_equipment_keywords TEXT[],
  
  -- 경쟁 제품 키워드 (교체 대상)
  -- 예: TORR RF → ['써마지', '인모드', '올리지오'] (교체 제안 가능)
  competing_keywords TEXT[],
  
  -- 시너지 장비 키워드 (함께 있으면 좋은 장비)
  -- 예: TORR RF → ['울쎄라', '슈링크'] (RF + HIFU 콤보 제안)
  synergy_keywords TEXT[],
  
  status TEXT DEFAULT 'active',       -- active, upcoming, discontinued
  sort_order INT DEFAULT 0,           -- 제품 표시 순서
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_products_status ON products(status);
CREATE INDEX idx_products_category ON products(category);
CREATE INDEX idx_products_manufacturer ON products(manufacturer);
```

### Migration 002: 병원

```sql
-- ============================================================
-- 병원 마스터 (제품과 무관한 객관적 병원 정보)
-- ============================================================
CREATE TABLE hospitals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  business_number TEXT UNIQUE,
  address TEXT,
  address_detail TEXT,
  sido TEXT,                          -- 시도
  sigungu TEXT,                       -- 시군구
  dong TEXT,                          -- 읍면동
  latitude DECIMAL(10, 7),
  longitude DECIMAL(10, 7),
  phone TEXT,
  email TEXT,
  website TEXT,
  naver_place_id TEXT,
  naver_place_url TEXT,
  
  -- 의료진 정보
  doctor_name TEXT,
  doctor_specialty TEXT,              -- 피부과, 성형외과, 일반의 등
  doctor_board TEXT,                  -- 전문의/일반의
  
  department TEXT,                    -- 진료과목
  hospital_type TEXT,                 -- 의원, 병원, 종합병원
  opened_at DATE,
  
  -- 수집 메타
  source TEXT,                        -- hira, naver, crawl
  crawled_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  data_quality_score INT DEFAULT 0,   -- 0~100
  
  status TEXT DEFAULT 'active',       -- active, closed, unknown
  is_target BOOLEAN DEFAULT true,
  exclude_reason TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_hospitals_location ON hospitals(sido, sigungu);
CREATE INDEX idx_hospitals_department ON hospitals(department);
CREATE INDEX idx_hospitals_status ON hospitals(status);
CREATE INDEX idx_hospitals_email ON hospitals(email) WHERE email IS NOT NULL;

-- 보유 장비
CREATE TABLE hospital_equipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  equipment_name TEXT NOT NULL,       -- 써마지, 울쎄라 등
  equipment_brand TEXT,               -- Solta Medical, Merz 등
  equipment_category TEXT NOT NULL,   -- rf, laser, ultrasound, ipl, other
  equipment_model TEXT,               -- FLX 등
  estimated_year INT,                 -- 추정 도입년도
  is_confirmed BOOLEAN DEFAULT false,
  source TEXT,                        -- web_crawl, naver, manual
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_equip_hospital ON hospital_equipments(hospital_id);
CREATE INDEX idx_equip_category ON hospital_equipments(equipment_category);
CREATE INDEX idx_equip_name ON hospital_equipments(equipment_name);

-- 시술 메뉴
CREATE TABLE hospital_treatments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  treatment_name TEXT NOT NULL,
  treatment_category TEXT,            -- lifting, tightening, toning, filler, botox 등
  price_min INT,
  price_max INT,
  is_promoted BOOLEAN DEFAULT false,  -- 메인에 노출/강조된 시술
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_treat_hospital ON hospital_treatments(hospital_id);
CREATE INDEX idx_treat_category ON hospital_treatments(treatment_category);
```

### Migration 003: 병원 프로파일 (제품 무관 분석 결과)

```sql
-- ============================================================
-- 병원 프로파일 (1단계 스코어링 결과)
-- 제품과 무관하게 병원 자체의 특성을 분석한 결과
-- 1 hospital = 1 profile (항상 최신 버전만 유지)
-- ============================================================
CREATE TABLE hospital_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  
  -- 투자 성향 (0~100)
  -- 최근 장비 구매 빈도, 장비 총수, 고가 장비 보유 여부
  investment_score INT DEFAULT 0,
  
  -- 장비 포트폴리오 다양성 (0~100)
  -- RF, 레이저, HIFU, IPL 등 카테고리 커버리지
  portfolio_diversity_score INT DEFAULT 0,
  
  -- 시술 규모 (0~100)
  -- 시술 메뉴 수, 가격대, 안티에이징 비율
  practice_scale_score INT DEFAULT 0,
  
  -- 상권 경쟁 강도 (0~100)
  -- 반경 1km 내 경쟁 병원 수, 밀집도
  market_competition_score INT DEFAULT 0,
  
  -- 온라인 존재감 (0~100)
  -- 웹사이트 품질, 네이버 리뷰 수, 정보 공개 수준
  online_presence_score INT DEFAULT 0,
  
  -- 종합 병원 등급 (프로파일 기준)
  -- 제품 매칭과 무관한 "이 병원 자체의 영업 가치"
  profile_score INT DEFAULT 0,        -- 0~100 가중 합산
  profile_grade TEXT,                 -- PRIME, HIGH, MID, LOW
  
  -- AI 분석 메모 (제품 무관)
  ai_summary TEXT,                    -- "강남 핵심상권, 리프팅 전문, 적극 투자형"
  main_focus TEXT,                    -- 주력 분야 (예: "리프팅 전문")
  target_audience TEXT,               -- 추정 주요 환자층
  investment_tendency TEXT,           -- aggressive, moderate, conservative
  
  -- 상권 정보
  competitor_count INT DEFAULT 0,     -- 반경 1km 경쟁 병원 수
  naver_review_count INT DEFAULT 0,
  
  -- 메타
  analyzed_at TIMESTAMPTZ DEFAULT NOW(),
  analysis_version TEXT DEFAULT 'v1.0',
  
  UNIQUE(hospital_id)                 -- 병원당 1개만
);

CREATE INDEX idx_profile_hospital ON hospital_profiles(hospital_id);
CREATE INDEX idx_profile_grade ON hospital_profiles(profile_grade);
CREATE INDEX idx_profile_score ON hospital_profiles(profile_score DESC);
```

### Migration 004: 제품 매칭 스코어 + 리드

```sql
-- ============================================================
-- 제품 매칭 스코어 (2단계 스코어링 결과)
-- 1 hospital × 1 product = 1 matching score
-- 같은 병원이 TORR RF에는 S등급, 소모품에는 C등급일 수 있음
-- ============================================================
CREATE TABLE product_match_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  
  -- 제품별 매칭 점수 (0~100)
  need_score INT DEFAULT 0,           -- 이 제품이 이 병원에 필요한 정도
  fit_score INT DEFAULT 0,            -- 이 병원의 상황이 이 제품에 맞는 정도
  timing_score INT DEFAULT 0,         -- 지금이 구매 적기인 정도
  
  total_score INT DEFAULT 0,          -- 가중 합산
  grade TEXT,                         -- S, A, B, C, EXCLUDE
  
  -- AI 매칭 분석 (제품 특화)
  ai_selling_points JSONB,            -- ["RF 공백 → 리프팅 풀코스 구성", "써마지 5년+ → 교체 적기"]
  ai_risks JSONB,                     -- ["최근 RF 도입 이력 → 교체 동기 낮음"]
  ai_recommended_approach TEXT,       -- "리프팅 시너지 강조, 울쎄라+TORR RF 콤보 제안"
  ai_recommended_payment TEXT,        -- lump_sum, installment, rental
  
  -- 메타
  scored_at TIMESTAMPTZ DEFAULT NOW(),
  scoring_version TEXT DEFAULT 'v1.0',
  
  UNIQUE(hospital_id, product_id)     -- 병원×제품 조합당 1개
);

CREATE INDEX idx_match_hospital ON product_match_scores(hospital_id);
CREATE INDEX idx_match_product ON product_match_scores(product_id);
CREATE INDEX idx_match_grade ON product_match_scores(grade);
CREATE INDEX idx_match_score ON product_match_scores(total_score DESC);

-- ============================================================
-- 리드 (영업 대상 = 병원 × 제품)
-- 같은 병원이 TORR RF 리드이면서 동시에 소모품 리드일 수 있음
-- ============================================================
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id),
  product_id UUID NOT NULL REFERENCES products(id),
  match_score_id UUID REFERENCES product_match_scores(id),
  
  -- 리드 상태
  stage TEXT DEFAULT 'new',
  -- new → contacted → responded → demo_scheduled → demo_done →
  -- proposal → negotiation → closed_won → closed_lost → nurturing
  
  grade TEXT,                         -- S, A, B, C (매칭 스코어에서 복사)
  priority INT DEFAULT 0,            -- 높을수록 우선 (S=100, A=50, B=20, C=10)
  
  -- 연락처 (병원 테이블에서 복사 + 추가 확보분)
  contact_email TEXT,
  contact_phone TEXT,
  contact_name TEXT,
  contact_role TEXT,                  -- 원장, 실장, 마케터 등
  
  -- 이메일 성과
  email_sent_count INT DEFAULT 0,
  open_count INT DEFAULT 0,
  click_count INT DEFAULT 0,
  reply_count INT DEFAULT 0,
  last_email_sent_at TIMESTAMPTZ,
  last_email_opened_at TIMESTAMPTZ,
  last_email_clicked_at TIMESTAMPTZ,
  last_replied_at TIMESTAMPTZ,
  
  -- 페이지 방문
  demo_page_visits INT DEFAULT 0,
  price_page_visits INT DEFAULT 0,
  product_page_visits INT DEFAULT 0,
  
  -- 관심도
  interest_level TEXT DEFAULT 'cold', -- cold, warming, warm, hot
  
  -- 이메일 시퀀스 진행
  current_sequence_id UUID,
  current_sequence_step INT DEFAULT 0,
  sequence_paused BOOLEAN DEFAULT false,
  sequence_paused_reason TEXT,
  
  -- 카카오톡
  kakao_connected BOOLEAN DEFAULT false,
  
  -- 영업 배정
  assigned_to TEXT,                   -- 영업 담당자
  assigned_at TIMESTAMPTZ,
  
  -- 결과
  lost_reason TEXT,
  won_amount DECIMAL(12, 0),
  closed_at TIMESTAMPTZ,
  
  -- 메모
  admin_notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(hospital_id, product_id)     -- 병원×제품 조합당 1개 리드
);

CREATE INDEX idx_leads_hospital ON leads(hospital_id);
CREATE INDEX idx_leads_product ON leads(product_id);
CREATE INDEX idx_leads_stage ON leads(stage);
CREATE INDEX idx_leads_grade ON leads(grade);
CREATE INDEX idx_leads_interest ON leads(interest_level);
CREATE INDEX idx_leads_assigned ON leads(assigned_to);

-- 리드 활동 타임라인
CREATE TABLE lead_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL,
  -- email_sent, email_opened, email_clicked, email_replied,
  -- kakao_connected, kakao_sent, kakao_replied,
  -- demo_requested, demo_completed, demo_evaluated,
  -- page_visited, stage_changed, note_added,
  -- sales_assigned, ai_analysis, product_matched
  title TEXT,
  description TEXT,
  metadata JSONB,
  actor TEXT DEFAULT 'system',        -- system, ai, admin, sales_rep
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_activities_lead ON lead_activities(lead_id);
CREATE INDEX idx_activities_type ON lead_activities(activity_type);
CREATE INDEX idx_activities_created ON lead_activities(created_at DESC);
```

### Migration 005: 이메일

```sql
-- ============================================================
-- 이메일 시퀀스 (제품별로 다른 시퀀스)
-- TORR RF(고가) → 5단계, 소모품(저가) → 2단계 등
-- ============================================================
CREATE TABLE email_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id),
  name TEXT NOT NULL,
  target_grade TEXT NOT NULL,         -- S, A, B, C
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_seq_product ON email_sequences(product_id);

-- 시퀀스 단계
CREATE TABLE email_sequence_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id UUID NOT NULL REFERENCES email_sequences(id) ON DELETE CASCADE,
  step_number INT NOT NULL,
  delay_days INT NOT NULL,            -- 이전 단계 후 대기 일수
  purpose TEXT NOT NULL,              -- intro, case_study, competition, price_offer, final
  tone TEXT,                          -- professional, friendly, consulting, casual
  key_message TEXT,
  personalization_focus TEXT,         -- equipment, revenue, competition, price, synergy
  skip_if JSONB,                      -- 건너뛰기 조건
  upgrade_if JSONB,                   -- 단계 업그레이드 조건
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_steps_sequence ON email_sequence_steps(sequence_id, step_number);

-- 발송된 이메일
CREATE TABLE emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id),
  product_id UUID NOT NULL REFERENCES products(id),
  sequence_id UUID REFERENCES email_sequences(id),
  step_number INT,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_text TEXT,
  ai_prompt_used TEXT,
  ai_personalization JSONB,
  from_email TEXT NOT NULL,
  to_email TEXT NOT NULL,
  sent_at TIMESTAMPTZ,
  status TEXT DEFAULT 'queued',       -- queued, sent, delivered, bounced, failed
  external_id TEXT,                   -- Resend 메시지 ID
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_emails_lead ON emails(lead_id);
CREATE INDEX idx_emails_product ON emails(product_id);
CREATE INDEX idx_emails_status ON emails(status);
CREATE INDEX idx_emails_sent ON emails(sent_at DESC);

-- 이메일 이벤트 추적
CREATE TABLE email_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id UUID NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id),
  event_type TEXT NOT NULL,           -- delivered, opened, clicked, bounced, complained, unsubscribed
  clicked_url TEXT,
  clicked_page TEXT,                  -- demo, pricing, product, resource
  ip_address TEXT,
  user_agent TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_events_email ON email_events(email_id);
CREATE INDEX idx_events_lead ON email_events(lead_id);
CREATE INDEX idx_events_type ON email_events(event_type);
```

### Migration 006: 데모

```sql
CREATE TABLE demos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id),
  hospital_id UUID NOT NULL REFERENCES hospitals(id),
  product_id UUID NOT NULL REFERENCES products(id),
  demo_type TEXT NOT NULL,            -- online, visit, self_video
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  scheduled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  assigned_to TEXT,
  prep_summary TEXT,                  -- AI 자동 생성: 병원 분석 요약
  prep_roi_simulation JSONB,          -- AI 자동 생성: ROI 시뮬레이션
  prep_product_pitch TEXT,            -- AI 자동 생성: 이 병원에 맞는 제품 제안 포인트
  status TEXT DEFAULT 'requested',
  -- requested → confirmed → preparing → in_progress → completed → evaluated → cancelled
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_demos_lead ON demos(lead_id);
CREATE INDEX idx_demos_product ON demos(product_id);
CREATE INDEX idx_demos_status ON demos(status);

-- 데모 평가
CREATE TABLE demo_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  demo_id UUID NOT NULL REFERENCES demos(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id),
  satisfaction_score INT,             -- 1~5
  purchase_intent TEXT,               -- immediate, considering, hold, no_interest
  preferred_payment TEXT,             -- lump_sum, installment, rental, capital
  additional_questions TEXT,
  feedback TEXT,
  evaluated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Migration 007: 카카오톡, 수수료, 시스템 설정

```sql
-- 카카오톡 메시지
CREATE TABLE kakao_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id),
  message_type TEXT NOT NULL,         -- alimtalk, friendtalk, chat
  template_code TEXT,
  content TEXT NOT NULL,
  direction TEXT NOT NULL,            -- outbound, inbound
  status TEXT DEFAULT 'queued',
  external_id TEXT,
  sent_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_kakao_lead ON kakao_messages(lead_id);

-- 수수료
CREATE TABLE commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id),
  product_id UUID NOT NULL REFERENCES products(id),
  deal_amount DECIMAL(12, 0) NOT NULL,
  manufacturing_cost DECIMAL(12, 0),
  company_margin DECIMAL(12, 0),
  sales_commission DECIMAL(12, 0),
  madmedsales_share_pct INT DEFAULT 50,
  dealer_share_pct INT DEFAULT 50,
  madmedsales_amount DECIMAL(12, 0),
  dealer_amount DECIMAL(12, 0),
  dealer_name TEXT,
  status TEXT DEFAULT 'pending',      -- pending, confirmed, paid
  closed_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_comm_lead ON commissions(lead_id);
CREATE INDEX idx_comm_product ON commissions(product_id);

-- 수신거부
CREATE TABLE unsubscribes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  hospital_id UUID REFERENCES hospitals(id),
  reason TEXT,
  unsubscribed_at TIMESTAMPTZ DEFAULT NOW()
);

-- 시스템 설정
CREATE TABLE system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO system_settings (key, value, description) VALUES
('email_daily_limit', '50', '일일 이메일 발송 제한'),
('email_warmup_phase', 'true', '도메인 웜업 모드'),
('email_send_hours', '{"start": 12, "end": 19}', '발송 허용 시간대'),
('scoring_profile_version', '"v1.0"', '현재 병원 프로파일 스코어링 버전'),
('scoring_match_version', '"v1.0"', '현재 제품 매칭 스코어링 버전');
```

### Migration 008: 초기 제품 시딩

```sql
-- ============================================================
-- BRITZMEDI 초기 제품 등록
-- ============================================================
INSERT INTO products (name, code, manufacturer, category, subcategory, 
  price_min, price_max, target_departments, target_hospital_types,
  scoring_criteria, email_guide, competing_keywords, synergy_keywords, sort_order)
VALUES 
(
  'TORR RF', 'torr-rf', 'BRITZMEDI', 'equipment', 'rf',
  25000000, 28000000,
  ARRAY['피부과', '성형외과'],
  ARRAY['의원', '병원'],
  '{
    "need_rules": [
      {"condition": "no_rf", "score": 40, "reason": "RF 장비 공백 → 신규 도입 기회"},
      {"condition": "old_rf_5yr", "score": 30, "reason": "RF 5년+ → 교체 적기"},
      {"condition": "old_rf_3yr", "score": 15, "reason": "RF 3~4년 → 추가 도입 가능"},
      {"condition": "lifting_treatments", "score": 25, "reason": "리프팅 시술 수요 확인"},
      {"condition": "high_antiaging_ratio", "score": 20, "reason": "안티에이징 집중 병원"}
    ],
    "fit_rules": [
      {"condition": "has_ultrasound", "score": 20, "reason": "HIFU+RF 콤보 시너지"},
      {"condition": "equipment_count_5plus", "score": 15, "reason": "적극 투자형 병원"},
      {"condition": "high_price_treatments", "score": 15, "reason": "고가 시술 → 환자 구매력"},
      {"condition": "competitive_market", "score": 10, "reason": "경쟁 심한 상권 → 차별화 필요"}
    ],
    "timing_rules": [
      {"condition": "opened_2_5yr", "score": 30, "reason": "확장기 병원"},
      {"condition": "recent_investment", "score": 25, "reason": "최근 장비 투자 이력"},
      {"condition": "no_recent_rf_purchase", "score": 20, "reason": "RF 최근 구매 없음"}
    ]
  }'::jsonb,
  '{
    "product_summary": "고주파(RF) 기반 피부 리프팅/타이트닝 의료기기",
    "key_benefits": ["빠른 시술 시간", "높은 환자 만족도", "다양한 시술 조합 가능"],
    "price_mention_policy": "이메일에서 직접 가격 언급 금지, 문의 유도",
    "tone_guide": "전문적이면서 친근한 톤, 의료기기법 준수",
    "cta_options": ["데모 신청", "자료 요청", "상담 예약"]
  }'::jsonb,
  ARRAY['써마지', '인모드', '올리지오', '포텐자', '시크릿'],
  ARRAY['울쎄라', '슈링크', '더블로', '리프테라'],
  1
),
(
  '2mm 니들 (소모품)', 'needle-2mm', 'BRITZMEDI', 'consumable', 'needle',
  NULL, NULL,
  ARRAY['피부과', '성형외과'],
  ARRAY['의원', '병원'],
  '{
    "need_rules": [
      {"condition": "has_torr_rf", "score": 90, "reason": "TORR RF 보유 → 필수 소모품"},
      {"condition": "has_any_rf_needle", "score": 30, "reason": "RF 니들 시술 중 → 호환 가능성"}
    ],
    "fit_rules": [],
    "timing_rules": [
      {"condition": "regular_reorder", "score": 50, "reason": "정기 주문 패턴"}
    ]
  }'::jsonb,
  '{
    "product_summary": "TORR RF 전용 2mm 시술 니들",
    "key_benefits": ["정품 소모품", "안정적 공급", "대량 주문 할인"],
    "price_mention_policy": "가격 안내 가능 (소모품이므로)",
    "tone_guide": "실무적이고 간결한 톤",
    "cta_options": ["견적 요청", "샘플 요청"]
  }'::jsonb,
  ARRAY['TORR RF', 'TORR'],
  NULL,
  2
);
-- 추가 제품은 admin에서 등록하거나 이후 마이그레이션으로 추가
```

---

## 6. 환경변수

### apps/engine/.dev.vars

```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=xxx
SUPABASE_SERVICE_ROLE_KEY=xxx
ANTHROPIC_API_KEY=xxx
GOOGLE_AI_API_KEY=xxx
RESEND_API_KEY=xxx
RESEND_WEBHOOK_SECRET=xxx
KAKAO_API_KEY=xxx
KAKAO_SENDER_KEY=xxx
ADMIN_URL=http://localhost:5174
WEB_URL=http://localhost:4321
```

### apps/admin/.env

```
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=xxx
VITE_API_URL=http://localhost:8787
```

### apps/web/.env

```
PUBLIC_SUPABASE_URL=https://xxx.supabase.co
PUBLIC_SUPABASE_ANON_KEY=xxx
PUBLIC_API_URL=http://localhost:8787
```

---

## 7. Engine 기본 코드

### src/index.ts

```typescript
import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Bindings = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  ANTHROPIC_API_KEY: string;
  GOOGLE_AI_API_KEY: string;
  RESEND_API_KEY: string;
  ADMIN_URL: string;
  WEB_URL: string;
  SETTINGS_KV: KVNamespace;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('*', cors({
  origin: (origin, c) => {
    const allowed = [c.env.ADMIN_URL, c.env.WEB_URL];
    return allowed.includes(origin) ? origin : '';
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Routes (Phase별로 추가)
// Phase 1: app.route('/api/hospitals', hospitalsRoute);
// Phase 1: app.route('/api/products', productsRoute);
// Phase 2: app.route('/api/scoring', scoringRoute);
// Phase 3: app.route('/api/emails', emailsRoute);
// Phase 3: app.route('/api/sequences', sequencesRoute);
// Phase 4: app.route('/api/tracking', trackingRoute);
// Phase 4: app.route('/api/kakao', kakaoRoute);
// Phase 5: app.route('/api/demos', demosRoute);
// Phase 5: app.route('/api/reports', reportsRoute);

export default app;
```

---

## 이 Phase 완료 후 상태

- 3개 앱이 각각 로컬에서 실행됨 (web:4321, admin:5174, engine:8787)
- `api.madmedsales.com/health` 에서 `{"status":"ok"}` 응답
- Supabase에 모든 테이블 생성 완료 (products 포함)
- BRITZMEDI 초기 제품 2건 (TORR RF, 2mm 바늘) 등록 완료
- 이메일 도메인 인증 완료 (SPF/DKIM/DMARC)
- → 다음: `02-DATA-COLLECTION.md`
