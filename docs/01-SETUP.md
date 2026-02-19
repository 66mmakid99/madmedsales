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

### turbo.json

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "dev": { "cache": false, "persistent": true },
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "deploy": { "dependsOn": ["build"] }
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

# Custom domain
routes = [
  { pattern = "api.madmedsales.com/*", zone_name = "madmedsales.com" }
]

# KV (설정 캐시용)
[[kv_namespaces]]
binding = "SETTINGS_KV"
id = "xxx"

# Queues (이메일 발송 큐 - Phase 3에서 사용)
# [[queues.producers]]
# binding = "EMAIL_QUEUE"
# queue = "madmedsales-email-queue"
```

---

## 3. 이메일 도메인 설정

Resend에서 도메인 인증 (발신 도메인: madmedsales.com)

### DNS 레코드 추가

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

### Migration 001: hospitals

```sql
-- 병원 마스터
CREATE TABLE hospitals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  business_number TEXT UNIQUE,
  address TEXT,
  address_detail TEXT,
  sido TEXT,
  sigungu TEXT,
  dong TEXT,
  latitude DECIMAL(10, 7),
  longitude DECIMAL(10, 7),
  phone TEXT,
  email TEXT,
  website TEXT,
  doctor_name TEXT,
  doctor_specialty TEXT,         -- 피부과, 성형외과, 일반의 등
  doctor_board TEXT,             -- 전문의/일반의
  department TEXT,               -- 진료과목
  hospital_type TEXT,            -- 의원, 병원, 종합병원
  opened_at DATE,
  source TEXT,                   -- hira, naver, crawl
  crawled_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  data_quality_score INT DEFAULT 0,
  status TEXT DEFAULT 'active',  -- active, closed, unknown
  is_target BOOLEAN DEFAULT true,
  exclude_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_hospitals_location ON hospitals(sido, sigungu);
CREATE INDEX idx_hospitals_department ON hospitals(department);
CREATE INDEX idx_hospitals_status ON hospitals(status);

-- 보유 장비
CREATE TABLE hospital_equipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  equipment_name TEXT NOT NULL,
  equipment_brand TEXT,
  equipment_category TEXT NOT NULL,  -- rf, laser, ultrasound, ipl, other
  equipment_model TEXT,
  estimated_year INT,
  is_confirmed BOOLEAN DEFAULT false,
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_equip_hospital ON hospital_equipments(hospital_id);
CREATE INDEX idx_equip_category ON hospital_equipments(equipment_category);

-- 시술 메뉴
CREATE TABLE hospital_treatments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  treatment_name TEXT NOT NULL,
  treatment_category TEXT,  -- lifting, tightening, toning, filler, botox, etc
  price_min INT,
  price_max INT,
  is_promoted BOOLEAN DEFAULT false,
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_treat_hospital ON hospital_treatments(hospital_id);
CREATE INDEX idx_treat_category ON hospital_treatments(treatment_category);
```

### Migration 002: scoring

```sql
-- 스코어링 가중치 (버전 관리)
CREATE TABLE scoring_weights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version TEXT NOT NULL UNIQUE,
  weight_equipment_synergy INT DEFAULT 25,
  weight_equipment_age INT DEFAULT 20,
  weight_revenue_impact INT DEFAULT 30,
  weight_competitive_edge INT DEFAULT 15,
  weight_purchase_readiness INT DEFAULT 10,
  criteria_details JSONB,
  is_active BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 초기 가중치 v1.0 삽입
INSERT INTO scoring_weights (version, is_active, notes) 
VALUES ('v1.0', true, '초기 버전');

-- 스코어링 결과
CREATE TABLE scoring_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  weight_version TEXT NOT NULL,
  score_equipment_synergy INT DEFAULT 0,
  score_equipment_age INT DEFAULT 0,
  score_revenue_impact INT DEFAULT 0,
  score_competitive_edge INT DEFAULT 0,
  score_purchase_readiness INT DEFAULT 0,
  total_score INT DEFAULT 0,
  grade TEXT,                     -- S, A, B, C, EXCLUDE
  ai_analysis TEXT,
  ai_message_direction TEXT,
  ai_raw_response JSONB,
  scored_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(hospital_id, weight_version)
);

CREATE INDEX idx_scoring_hospital ON scoring_results(hospital_id);
CREATE INDEX idx_scoring_grade ON scoring_results(grade);
CREATE INDEX idx_scoring_total ON scoring_results(total_score DESC);
```

### Migration 003: leads

```sql
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id),
  scoring_result_id UUID REFERENCES scoring_results(id),
  stage TEXT DEFAULT 'new',
  -- new → contacted → responded → kakao_connected → demo_scheduled
  -- → demo_done → proposal → negotiation → closed_won → closed_lost → nurturing
  grade TEXT,
  priority INT DEFAULT 0,
  contact_email TEXT,
  contact_name TEXT,
  contact_role TEXT,              -- 원장, 실장, 매니저
  email_sequence_id UUID,
  current_sequence_step INT DEFAULT 0,
  last_email_sent_at TIMESTAMPTZ,
  last_email_opened_at TIMESTAMPTZ,
  last_email_clicked_at TIMESTAMPTZ,
  last_replied_at TIMESTAMPTZ,
  kakao_connected BOOLEAN DEFAULT false,
  kakao_channel_user_id TEXT,
  open_count INT DEFAULT 0,
  click_count INT DEFAULT 0,
  reply_count INT DEFAULT 0,
  demo_page_visits INT DEFAULT 0,
  price_page_visits INT DEFAULT 0,
  interest_level TEXT DEFAULT 'unknown',  -- cold, warming, warm, hot
  ai_persona_notes TEXT,
  assigned_sales_rep TEXT,
  assigned_at TIMESTAMPTZ,
  sales_handoff_notes TEXT,
  won_at TIMESTAMPTZ,
  lost_at TIMESTAMPTZ,
  lost_reason TEXT,
  revenue DECIMAL(12, 0),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_leads_hospital ON leads(hospital_id);
CREATE INDEX idx_leads_stage ON leads(stage);
CREATE INDEX idx_leads_grade ON leads(grade);
CREATE INDEX idx_leads_interest ON leads(interest_level);

-- 리드 활동 이력 (타임라인)
CREATE TABLE lead_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL,
  -- email_sent, email_opened, email_clicked, email_replied,
  -- email_bounced, email_unsubscribed,
  -- kakao_connected, kakao_sent, kakao_replied,
  -- demo_requested, demo_completed, demo_evaluated,
  -- page_visited, stage_changed, note_added,
  -- sales_assigned, ai_analysis
  title TEXT,
  description TEXT,
  metadata JSONB,
  actor TEXT DEFAULT 'system',    -- system, ai, admin, sales_rep
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_activities_lead ON lead_activities(lead_id);
CREATE INDEX idx_activities_type ON lead_activities(activity_type);
CREATE INDEX idx_activities_created ON lead_activities(created_at DESC);
```

### Migration 004: emails

```sql
-- 이메일 시퀀스 정의
CREATE TABLE email_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  target_grade TEXT NOT NULL,     -- S, A, B, C
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 시퀀스 단계
CREATE TABLE email_sequence_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id UUID NOT NULL REFERENCES email_sequences(id) ON DELETE CASCADE,
  step_number INT NOT NULL,
  delay_days INT NOT NULL,
  purpose TEXT NOT NULL,          -- intro, case_study, competition, price_offer, final_followup
  tone TEXT,                      -- professional, friendly, consulting, casual
  key_message TEXT,
  personalization_focus TEXT,     -- equipment, revenue, competition, price
  skip_if JSONB,
  upgrade_if JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_steps_sequence ON email_sequence_steps(sequence_id, step_number);

-- 발송된 이메일
CREATE TABLE emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id),
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
  status TEXT DEFAULT 'queued',   -- queued, sent, delivered, bounced, failed
  external_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_emails_lead ON emails(lead_id);
CREATE INDEX idx_emails_status ON emails(status);
CREATE INDEX idx_emails_sent ON emails(sent_at DESC);

-- 이메일 이벤트 추적
CREATE TABLE email_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id UUID NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id),
  event_type TEXT NOT NULL,       -- delivered, opened, clicked, bounced, complained, unsubscribed
  clicked_url TEXT,
  clicked_page TEXT,              -- demo, pricing, product, resource
  ip_address TEXT,
  user_agent TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_events_email ON email_events(email_id);
CREATE INDEX idx_events_lead ON email_events(lead_id);
CREATE INDEX idx_events_type ON email_events(event_type);
```

### Migration 005: demos

```sql
CREATE TABLE demos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id),
  hospital_id UUID NOT NULL REFERENCES hospitals(id),
  demo_type TEXT NOT NULL,        -- online, visit, self_video
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  scheduled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  assigned_to TEXT,
  prep_scoring_summary TEXT,
  prep_roi_simulation JSONB,
  prep_combo_suggestion TEXT,
  status TEXT DEFAULT 'requested',
  -- requested → confirmed → preparing → in_progress → completed → evaluated → cancelled
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_demos_lead ON demos(lead_id);
CREATE INDEX idx_demos_status ON demos(status);
CREATE INDEX idx_demos_scheduled ON demos(scheduled_at);

-- 데모 평가
CREATE TABLE demo_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  demo_id UUID NOT NULL REFERENCES demos(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id),
  satisfaction_score INT,         -- 1~5
  purchase_intent TEXT,           -- immediate, considering, hold, no_interest
  preferred_payment TEXT,         -- lump_sum, installment, rental, capital
  additional_questions TEXT,
  feedback TEXT,
  evaluated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Migration 006: kakao & commission & settings

```sql
-- 카카오톡 메시지
CREATE TABLE kakao_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id),
  message_type TEXT NOT NULL,     -- alimtalk, friendtalk, chat
  template_code TEXT,
  content TEXT NOT NULL,
  direction TEXT NOT NULL,        -- outbound, inbound
  status TEXT DEFAULT 'queued',   -- queued, sent, delivered, read, failed
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
  deal_amount DECIMAL(12, 0) NOT NULL,
  manufacturing_cost DECIMAL(12, 0),
  company_margin DECIMAL(12, 0),
  sales_commission DECIMAL(12, 0),
  madmedsales_share_pct INT DEFAULT 50,
  dealer_share_pct INT DEFAULT 50,
  madmedsales_amount DECIMAL(12, 0),
  dealer_amount DECIMAL(12, 0),
  dealer_name TEXT,
  status TEXT DEFAULT 'pending',  -- pending, confirmed, paid
  closed_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_comm_lead ON commissions(lead_id);
CREATE INDEX idx_comm_status ON commissions(status);

-- 수신거부
CREATE TABLE unsubscribes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  hospital_id UUID REFERENCES hospitals(id),
  reason TEXT,
  unsubscribed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_unsub_email ON unsubscribes(email);

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
('email_send_hours', '{"start": 12, "end": 19}', '발송 허용 시간대 (점심~저녁)'),
('scoring_active_version', '"v1.0"', '현재 적용 스코어링 버전'),
('torr_rf_price_min', '25000000', 'TORR RF 최소 가격'),
('torr_rf_price_max', '28000000', 'TORR RF 최대 가격'),
('commission_default_split', '{"madmedsales": 50, "dealer": 50}', '기본 수수료 분배'),
('sequence_pause_on_reply', 'true', '회신 시 시퀀스 일시정지');
```

---

## 6. 환경변수

### apps/engine/.dev.vars (로컬 개발)

```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=xxx
SUPABASE_SERVICE_ROLE_KEY=xxx
ANTHROPIC_API_KEY=xxx
GOOGLE_AI_API_KEY=xxx
RESEND_API_KEY=xxx
KAKAO_API_KEY=xxx
KAKAO_SENDER_KEY=xxx
ADMIN_URL=http://localhost:5174
WEB_URL=http://localhost:4321
```

### apps/admin/.env (로컬 개발)

```
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=xxx
VITE_API_URL=http://localhost:8787
```

### apps/web/.env (로컬 개발)

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
  RESEND_API_KEY: string;
  ADMIN_URL: string;
  WEB_URL: string;
  SETTINGS_KV: KVNamespace;
};

const app = new Hono<{ Bindings: Bindings }>();

// CORS
app.use('*', cors({
  origin: (origin, c) => {
    const allowed = [c.env.ADMIN_URL, c.env.WEB_URL];
    return allowed.includes(origin) ? origin : '';
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// Health check
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Routes (Phase별로 추가)
// Phase 1: app.route('/api/hospitals', hospitalsRoute);
// Phase 2: app.route('/api/scoring', scoringRoute);
// Phase 3: app.route('/api/emails', emailsRoute);
// Phase 4: app.route('/api/tracking', trackingRoute);
// Phase 5: app.route('/api/kakao', kakaoRoute);
// Phase 5: app.route('/api/demos', demosRoute);
// Phase 6: app.route('/api/reports', reportsRoute);

export default app;
```

---

## 이 Phase 완료 후 상태

- 3개 앱이 각각 로컬에서 실행됨 (web:4321, admin:5174, engine:8787)
- `api.madmedsales.com/health` 에서 `{"status":"ok"}` 응답
- Supabase에 모든 테이블 생성 완료
- 이메일 도메인 인증 완료 (SPF/DKIM/DMARC)
- → 다음: `02-DATA-COLLECTION.md`
