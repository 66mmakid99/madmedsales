# MADMEDSALES v5.4 패치 작업 지시서

## 프로젝트 경로
`C:\Users\J\Projects\madmedsales`

## 작업 대상 파일
- `scripts/recrawl-v5.ts`
- DB 스키마 (Supabase)

---

## 작업 1: 커버리지 검증 타임아웃 수정

### 배경
동안중심의원/포에버의원의 마크다운이 45,000~53,000자로, 커버리지 검증 시 Gemini 응답이 120초 내 도착하지 않아 타임아웃 발생.

### 수정 사항

#### 1-1. 타임아웃 120초 → 300초
커버리지 검증 함수 내 `AbortSignal.timeout` 찾아서 변경:
```typescript
// 변경 전
signal: AbortSignal.timeout(120000),

// 변경 후
signal: AbortSignal.timeout(300000),  // 5분 (대규모 병원 대응)
```

#### 1-2. 마크다운 truncation 기준 변경
커버리지 검증 함수 내 마크다운 축소 로직 변경:
```typescript
// 변경 전
const truncatedMd = allMarkdown.length > 100000
  ? allMarkdown.substring(0, 50000) + '\n\n...(중략)...\n\n' + allMarkdown.substring(allMarkdown.length - 50000)
  : allMarkdown;

// 변경 후
const truncatedMd = allMarkdown.length > 30000
  ? allMarkdown.substring(0, 15000) + '\n\n...(중략)...\n\n' + allMarkdown.substring(allMarkdown.length - 15000)
  : allMarkdown;
```

---

## 작업 2: callGemini maxOutputTokens 증가

### 배경
callGemini 함수의 기본 maxOutputTokens가 8000으로, 대규모 병원 분석 시 응답이 잘림.

### 수정 사항
callGemini 함수 내 generationConfig 찾아서 변경:
```typescript
// 변경 전
generationConfig: { temperature: 0.1, maxOutputTokens: 8000 },

// 변경 후
generationConfig: { temperature: 0.1, maxOutputTokens: 16384 },
```

---

## 작업 3: 사이트 유형 핑거프린팅 모듈 추가

### 배경
한국 병원 홈페이지가 워드프레스, 카페24, 그누보드, SPA 등 제각각이다. 크롤링 단계에서 사이트 유형을 자동 감지하고 DB에 기록하면, 유형별 크롤링 전략 최적화와 실패 원인 분석이 가능해진다.

### 구현 사항

#### 3-1. 핑거프린팅 함수 생성
크롤링 후 받은 HTML을 분석해서 사이트 유형을 반환하는 함수:

```typescript
function detectSiteType(html: string, url: string): {
  siteType: string;       // wordpress | cafe24 | gnuboard | sixshop | custom_spa | custom_ssr | naver_only | unknown
  confidence: number;     // 0~1
  signals: string[];      // 감지에 사용된 시그널 목록
}
```

**감지 시그널:**

| 유형 | 감지 패턴 |
|------|----------|
| wordpress | `wp-content`, `wp-includes`, `wp-json`, `wordpress` in meta generator |
| cafe24 | `cafe24` in script/link src, `.cafe24.com` domain |
| gnuboard | `gnuboard`, `g5_`, `/bbs/` 패턴 |
| sixshop | `sixshop` in script src |
| custom_spa | 초기 HTML body가 `<div id="root"></div>` 또는 `<div id="app"></div>`만 있고 텍스트 콘텐츠 거의 없음 (500자 미만) |
| custom_ssr | 위 패턴 해당 없고 텍스트 콘텐츠 충분 |
| naver_only | 자체 홈페이지 URL 없이 네이버 스마트플레이스만 존재 |

**추가 감지 (보조 분류):**

| 특성 | 감지 방법 |
|------|----------|
| image_heavy | 이미지 태그 대비 텍스트 비율이 낮음 (텍스트 1000자 미만, 이미지 10개 이상) |
| price_in_image | 가격 관련 텍스트 없고 이미지에 가격 표기 추정 (OCR 의존도 높음) |
| multi_page | 서브페이지 링크 10개 이상 |
| single_page | 서브페이지 링크 3개 미만 |

#### 3-2. 크롤링 파이프라인에 삽입
Firecrawl로 HTML 받은 직후, Gemini 분석 전에 실행:
```
Firecrawl 크롤링 → HTML 수신 → [핑거프린팅] → Gemini OCR/분류 → DB 저장
```

#### 3-3. DB 저장
기존 병원 데이터에 다음 필드 추가 저장:
- `site_type`: 감지된 유형 (string)
- `site_type_confidence`: 감지 신뢰도 (number)
- `site_type_signals`: 감지 시그널 (string[] or JSON)
- `crawl_fail_reason`: 크롤링 실패 시 원인 분류 (string, nullable)
  - `domain_expired`: ERR_NAME_NOT_RESOLVED
  - `bot_blocked`: ERR_BLOCKED_BY_CLIENT, 403
  - `invalid_url`: URL 형식 오류
  - `timeout`: 응답 시간 초과
  - `spa_render_fail`: SPA인데 JS 렌더링 실패
  - `redirect_loop`: 무한 리다이렉트
  - `ssl_error`: 인증서 문제

#### 3-4. 실행 후 통계 출력
배치 실행 완료 시 유형별 통계를 콘솔에 출력:
```
📊 사이트 유형 통계:
  wordpress: 15개 (성공 14, 실패 1)
  cafe24: 8개 (성공 7, 실패 1)
  custom_spa: 5개 (성공 3, 실패 2)
  gnuboard: 3개 (성공 3, 실패 0)
  ...
📊 크롤링 실패 원인:
  domain_expired: 4개
  bot_blocked: 2개
  timeout: 1개
```

---

## 작업 4: 의료기기 분류 체계 변경 (MEDICAL-DEVICE-TAXONOMY)

### 배경
기존 "equipment" 단일 카테고리로는 장비와 주사제가 구분되지 않는다. 안산엔비의원 테스트에서 "장비 0종"으로 나왔지만, 실제로는 스컬트라/리쥬란/아디페 등 주사제를 사용 중이다. 이 정보가 영업 인사이트에 핵심적이므로, 의료기기를 장비(device)와 주사제(injectable)로 분리하는 계층형 분류 체계로 변경한다.

### 분류 구조
```
medical_devices (의료기기)
├── devices (장비) — 기계, 전원 켜서 사용, 피부에 에너지 전달
│   ├── RF: 써마지 FLX, TORR RF, 인모드, 테너, 시크릿RF ...
│   ├── HIFU: 울쎄라, 슈링크, 더블로, 울트라포머, 리프테라 ...
│   ├── laser: 피코슈어, 레블라이트, 젠틀맥스, 클라리티, 엑셀V ...
│   ├── IPL: M22, BBL, 루메니스 ...
│   ├── microneedle: 포텐자, 시크릿RF(중복가능), MTS ...
│   ├── cryotherapy: 쿨스컬프팅, 크리올리포, 제트필 ...
│   ├── EMS_magnetic: 엠스컬프트, 테슬라포머 ...
│   └── other_device: 아쿠아필, 산소필링, LED 테라피 ...
│
└── injectables (주사제) — 약물/제품, 주사기로 주입, 체내에서 작용
    ├── filler: 쥬비덤, 레스틸렌, 벨로테로, HA필러 ...
    ├── botox: 보톡스, 제오민, 나보타, 디스포트 ...
    ├── booster: 리쥬란, 쥬베룩, 엑소좀, 연어주사 ...
    ├── lipolytic: 아디페, 윤곽조각주사, PPC, HPL ...
    ├── collagen_stimulator: 스컬트라, 올리디아365, 엘란쎄, 래디어스 ...
    ├── thread: PDO실, 코그실, 민트리프트, 울트라V리프트 ...
    └── other_injectable: PRP, 줄기세포, 엑소좀 ...
```

### 4-1. DB 스키마 변경

#### 신규 테이블: medical_devices
기존 hospital_equipment 테이블은 유지하고, 신규 테이블 생성 후 마이그레이션 완료되면 기존 테이블 삭제.

```sql
CREATE TABLE medical_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID REFERENCES hospitals(id),
  
  -- 기본 정보
  name TEXT NOT NULL,                    -- 제품/브랜드명 (써마지 FLX, 스컬트라 등)
  korean_name TEXT,                      -- 한국어 통칭
  manufacturer TEXT,                     -- 제조사 (Solta Medical, Galderma 등)
  
  -- 계층 분류
  device_type TEXT NOT NULL,             -- 'device' | 'injectable'
  subcategory TEXT NOT NULL,             -- 'RF' | 'HIFU' | 'laser' | 'filler' | 'botox' | 'booster' ...
  
  -- 영업 관련
  torr_relation TEXT,                    -- 'direct_competitor' | 'complementary' | 'unrelated'
  torr_relation_detail TEXT,             -- "RF 직접 경쟁 - 써마지 대비 차별점 어필" 등
  
  -- 메타
  source TEXT,                           -- 'text' | 'image_banner' | 'image_page' | 'ocr'
  confidence TEXT DEFAULT 'confirmed',   -- 'confirmed' | 'uncertain'
  raw_text TEXT,                         -- 추출 근거 원문
  
  -- 시계열
  first_seen_at TIMESTAMPTZ DEFAULT now(),
  last_seen_at TIMESTAMPTZ DEFAULT now(),
  is_active BOOLEAN DEFAULT true,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_medical_devices_hospital ON medical_devices(hospital_id);
CREATE INDEX idx_medical_devices_type ON medical_devices(device_type, subcategory);
CREATE INDEX idx_medical_devices_torr ON medical_devices(torr_relation);
```

#### 신규 테이블: device_dictionary (마스터 사전)
제품명 → 분류 자동 매칭용. Gemini가 분류 못하더라도 사전 매칭으로 보정.

```sql
CREATE TABLE device_dictionary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  aliases TEXT[],                        -- 별칭 배열 ["써마지", "thermage", "서마지"]
  device_type TEXT NOT NULL,             -- 'device' | 'injectable'
  subcategory TEXT NOT NULL,
  manufacturer TEXT,
  torr_relation TEXT,                    -- TORR RF와의 관계 기본값
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 초기 데이터
INSERT INTO device_dictionary (name, aliases, device_type, subcategory, manufacturer, torr_relation) VALUES
-- 장비 - RF
('써마지 FLX', '{"써마지","thermage","서마지","thermage FLX"}', 'device', 'RF', 'Solta Medical', 'direct_competitor'),
('TORR RF', '{"토르","토르RF","TORR"}', 'device', 'RF', 'BRITZMEDI', 'self'),
('인모드', '{"inmode","인모드FX"}', 'device', 'RF', 'InMode', 'direct_competitor'),
('테너', '{"tenor","테너장비"}', 'device', 'RF', 'Alma Lasers', 'direct_competitor'),
-- 장비 - HIFU
('울쎄라', '{"ulthera","울세라","울쎄라MPT"}', 'device', 'HIFU', 'Merz', 'complementary'),
('슈링크', '{"shrink","슈링크유니버스"}', 'device', 'HIFU', 'Classys', 'complementary'),
-- 주사제 - 콜라겐자극제
('스컬트라', '{"sculptra","스컬프트라"}', 'injectable', 'collagen_stimulator', 'Galderma', 'unrelated'),
('올리디아365', '{"olidia","올리디아"}', 'injectable', 'collagen_stimulator', NULL, 'unrelated'),
-- 주사제 - 부스터
('리쥬란', '{"rejuran","연어주사"}', 'injectable', 'booster', 'Pharma Research', 'unrelated'),
-- 주사제 - 지방분해
('아디페', '{"adipe"}', 'injectable', 'lipolytic', NULL, 'unrelated');
```

### 4-2. Gemini 2단계 분류 프롬프트 변경

기존 프롬프트의 equipment 섹션을 아래로 교체:

```
### 3. medical_devices (의료기기 — 장비 + 주사제 모두 포함)

모든 의료기기를 빠짐없이 추출하되, 장비와 주사제를 구분하라.

각 의료기기 항목:
- name: 제품/브랜드명 (정확히)
- korean_name: 한국어 통칭 (있으면)
- manufacturer: 제조사 (알 수 있으면)
- device_type: "device" (장비) 또는 "injectable" (주사제)
- subcategory: 아래 분류표 참조
- description: 용도/특징 설명
- source: "text" | "image_banner" | "image_page" | "ocr"

#### device_type = "device" (장비) 일 때 subcategory:
- "RF": 고주파 (써마지, 인모드, 테너, TORR RF 등)
- "HIFU": 초음파 (울쎄라, 슈링크, 더블로 등)
- "laser": 레이저 (피코슈어, 레블라이트, 젠틀맥스 등)
- "IPL": 광선치료 (M22, BBL 등)
- "microneedle": 마이크로니들 (포텐자, 시크릿RF 등)
- "cryotherapy": 냉각/냉동 (쿨스컬프팅 등)
- "EMS_magnetic": 전자기/자기장 (엠스컬프트 등)
- "other_device": 위에 해당 안 되는 장비

#### device_type = "injectable" (주사제) 일 때 subcategory:
- "filler": 필러 (쥬비덤, 레스틸렌 등)
- "botox": 보톡스/보툴리눔 (보톡스, 제오민, 나보타 등)
- "booster": 스킨부스터 (리쥬란, 쥬베룩, 엑소좀 등)
- "lipolytic": 지방분해 (아디페, 윤곽조각주사 등)
- "collagen_stimulator": 콜라겐자극제 (스컬트라, 올리디아365, 엘란쎄 등)
- "thread": 실리프팅 (PDO실, 코그실 등)
- "other_injectable": 위에 해당 안 되는 주사

> 중요: "장비"와 "주사제"를 혼동하지 마라.
> - 장비 = 기계. 전원을 켜서 사용. 피부에 에너지를 전달.
> - 주사제 = 약물/제품. 주사기로 주입. 체내에서 작용.
> - 스컬트라, 리쥬란, 아디페 → 주사제 (injectable)
> - 써마지, 울쎄라, 인모드 → 장비 (device)
```

### 4-3. JSON 스키마 변경

기존:
```json
"equipment": [
  { "brand": "써마지", "model": "FLX", "category": "RF" }
]
```

변경:
```json
"medical_devices": [
  {
    "name": "써마지 FLX",
    "korean_name": "써마지",
    "manufacturer": "Solta Medical",
    "device_type": "device",
    "subcategory": "RF",
    "description": "고주파 피부 리프팅 장비",
    "source": "text"
  },
  {
    "name": "스컬트라",
    "korean_name": "스컬트라",
    "manufacturer": "Galderma",
    "device_type": "injectable",
    "subcategory": "collagen_stimulator",
    "description": "PLLA 기반 콜라겐 자극 주사제",
    "source": "text"
  }
]
```

### 4-4. 코드 변경
- `convertV54ToAnalysis` 함수에서 `equipment` → `medical_devices` 변환 로직 수정
- device_dictionary 테이블 조회해서 Gemini 분류 결과를 보정하는 로직 추가
- torr_relation 자동 매핑 (device_dictionary에 있으면 사전값 사용, 없으면 null)

### 4-5. 보고서 형식 변경

기존:
```
### 🔧 장비 (0종)
```

변경:
```
### 🔧 의료기기 ({N}종)

#### 장비 (device) — {N}종
| # | 제품명 | 제조사 | 분류 | TORR RF 관계 |
|---|--------|--------|------|--------------|
| 1 | 써마지 FLX | Solta Medical | RF | 직접 경쟁 |

#### 주사제 (injectable) — {N}종
| # | 제품명 | 제조사 | 분류 | 비고 |
|---|--------|--------|------|------|
| 1 | 스컬트라 | Galderma | 콜라겐자극제 | - |
| 2 | 리쥬란 | Pharma Research | 부스터 | - |

> 🔎 **TORR RF 보유 여부: ❌ 없음**
> 🔎 **RF 경쟁 장비: {있으면 목록}**
> 🔎 **보완 장비: {HIFU 등 목록}**
```

### 4-6. 영업 인사이트 변경

기존:
```
### 경쟁 장비 현황
RF 장비 없음 → 신규 도입 기회
```

변경:
```
### 경쟁 장비 현황

#### RF 장비 (직접 경쟁)
| 보유 RF 장비 | TORR RF 대비 차별점 |
|-------------|-------------------|
| (없음) | → RF 장비 미보유, 신규 도입 최적 |

#### HIFU/보완 장비
| 보유 장비 | 관계 | 영업 포인트 |
|-----------|------|------------|
| (없음) | - | - |

#### 주사제 현황
| 보유 주사제 | 분류 | 시사점 |
|------------|------|--------|
| 스컬트라 | 콜라겐자극제 | 리프팅 니즈 있음 → TORR RF 시너지 가능 |
| 리쥬란 | 부스터 | 피부 재생 관심 높음 |
| 아디페 | 지방분해 | 바디 시술 관심 → TORR RF 바디팁 제안 |

> 💡 분석: RF 장비 미보유 + 스컬트라/리쥬란 사용 중 = 리프팅/재생 니즈는 있으나 장비 투자는 안 한 상태.
> TORR RF 도입 시 기존 주사 시술과 결합 패키지 제안이 효과적.
```

---

## 적용 순서

### Step 1: 코드 수정 (작업 1, 2)
타임아웃 + maxOutputTokens 변경 → 검증:
```bash
findstr "300000" scripts\recrawl-v5.ts
findstr "30000" scripts\recrawl-v5.ts
findstr "16384" scripts\recrawl-v5.ts
```

### Step 2: 핑거프린팅 모듈 추가 (작업 3)
안산엔비의원 1개로 테스트:
```bash
npx tsx scripts/recrawl-v5.ts --start-from 0 --limit 1
```
콘솔에 site_type 출력 + DB 저장 확인

### Step 3: 의료기기 분류 체계 변경 (작업 4)
1. DB: medical_devices + device_dictionary 테이블 생성
2. Gemini 프롬프트 변경
3. 코드: convertV54ToAnalysis 수정
4. 보고서 형식 변경
5. 안산엔비의원 재테스트 → 스컬트라/올리디아365/리쥬란/아디페가 injectable로 분류되는지 확인

### Step 4: 3개 병원 전부 재테스트
안산엔비 + 동안중심 + 포에버의원 전부 PASS 확인 → Phase 2 진행

---

## 주의사항
- 기존 금지사항 34개 전부 유지
- 핑거프린팅은 크롤링 성능에 영향 없어야 함 (HTML 문자열 검색만, 추가 네트워크 요청 없음)
- 핑거프린팅 실패해도 크롤링 파이프라인이 중단되면 안 됨 (try-catch로 감싸서 실패 시 unknown 반환)
- 기존 hospital_equipment 테이블은 유지, medical_devices 마이그레이션 완료 후 삭제
- device_dictionary 초기 데이터는 위 SQL 기준, 추후 확장 예정
