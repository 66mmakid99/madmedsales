# MADMEDSALES v3.1 — 단계별 실행 지시

> 기존 멀티 제품 전환 1~2단계는 완료 상태.
> 이 문서는 v3.1 기획서의 재설계 사항을 기존 코드베이스 위에 적용하는 실행 계획이다.
> **각 단계 완료 후 빌드 확인 + 보고 → 승인 후 다음 단계 진행.**
> 임의로 다음 단계로 넘어가지 말 것.

---

## 이전 작업 현황 (이미 완료, 건드리지 말 것)

- ✅ Migration 009: products, hospital_profiles, product_match_scores 테이블 생성
- ✅ Migration 010: leads, emails, email_sequences, demos, commissions에 product_id 추가
- ✅ Migration 011: TORR RF, 2mm 니들 시딩
- ✅ profiler.ts: 5축 평가 (투자/포트/규모/경쟁/온라인) → **v3.1에서 4축으로 변경 예정**
- ✅ matcher.ts: need/fit/timing 3축 → **v3.1에서 영업 각도로 전면 재설계 예정**
- ✅ lead-generator.ts: 기본 구조
- ✅ MADMEDCHECK 크롤링 통합: Puppeteer+Gemini Vision OCR

---

## 🔴 1단계: DB 확장 마이그레이션 (최우선)

### 1-1. 신규 테이블 생성 (Migration 012)

```sql
-- 1. 키워드 정규화 사전
CREATE TABLE keyword_dictionary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  standard_name VARCHAR(100) NOT NULL,
  category VARCHAR(50) NOT NULL,          -- hifu, rf, booster, surgery, lifting, body
  aliases JSONB NOT NULL DEFAULT '[]',    -- ["울세라","ulthera","울쎄","울"]
  base_unit_type VARCHAR(20),             -- SHOT, JOULE, CC, UNIT, LINE, SESSION (null이면 SESSION)
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 확정 합성어 사전
CREATE TABLE compound_words (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  compound_name VARCHAR(100) NOT NULL UNIQUE,
  decomposed_names JSONB NOT NULL,        -- ["울쎄라","써마지"]
  scoring_note TEXT,                       -- "고가 브릿지 타겟, 프리미엄 패키지 제안 가능"
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. 합성어 후보 (Gemini 추론, 관리자 confirm 전)
CREATE TABLE compound_word_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_text VARCHAR(200) NOT NULL,
  inferred_decomposition JSONB,           -- ["울쎄라","써마지"]
  confidence NUMERIC(3,2),                -- 0.00~1.00
  discovery_count INT DEFAULT 1,
  first_hospital_id UUID REFERENCES hospitals(id),
  status VARCHAR(20) DEFAULT 'pending',   -- pending, confirmed, rejected
  confirmed_at TIMESTAMPTZ,
  confirmed_by VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. 시술 가격 (B2C 확장 대비 unit_price 포함)
CREATE TABLE hospital_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id),
  treatment_name VARCHAR(200) NOT NULL,   -- 원본 텍스트 ("울쎄라 300샷")
  standard_name VARCHAR(100),             -- keyword_dictionary.standard_name 참조
  raw_text TEXT,                           -- OCR 원문 전체
  total_quantity INT,                      -- 300
  unit_type VARCHAR(20),                   -- SHOT, JOULE, CC, UNIT, LINE, SESSION
  total_price INT,                         -- 1500000
  unit_price NUMERIC(10,2),               -- 5000.00 (= 1500000 / 300)
  price_band VARCHAR(20),                  -- Premium, Mid, Mass
  is_package BOOLEAN DEFAULT false,
  is_event_price BOOLEAN DEFAULT false,
  is_outlier BOOLEAN DEFAULT false,
  confidence_level VARCHAR(20) DEFAULT 'EXACT', -- EXACT, CALCULATED, ESTIMATED
  crawled_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. 크롤링 스냅샷 (변동 감지 + 시계열)
CREATE TABLE crawl_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id),
  crawled_at TIMESTAMPTZ DEFAULT NOW(),
  tier VARCHAR(10),                        -- tier1, tier2, tier3
  pass1_text_hash VARCHAR(64),            -- SHA-256 (변동 감지용)
  pass2_ocr_hash VARCHAR(64),
  equipments_found JSONB DEFAULT '[]',
  treatments_found JSONB DEFAULT '[]',
  pricing_found JSONB DEFAULT '[]',
  new_compounds JSONB DEFAULT '[]',
  diff_summary TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. 스코어링 변동 이력
CREATE TABLE scoring_change_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id),
  product_id UUID REFERENCES products(id),
  changed_at TIMESTAMPTZ DEFAULT NOW(),
  old_profile_grade VARCHAR(10),
  new_profile_grade VARCHAR(10),
  old_match_grade VARCHAR(10),
  new_match_grade VARCHAR(10),
  change_reason TEXT
);

-- 인덱스
CREATE INDEX idx_keyword_dict_category ON keyword_dictionary(category);
CREATE INDEX idx_keyword_dict_unit ON keyword_dictionary(base_unit_type);
CREATE INDEX idx_compound_candidates_status ON compound_word_candidates(status);
CREATE INDEX idx_hospital_pricing_hospital ON hospital_pricing(hospital_id);
CREATE INDEX idx_hospital_pricing_standard ON hospital_pricing(standard_name);
CREATE INDEX idx_hospital_pricing_unit ON hospital_pricing(unit_type, unit_price);
CREATE INDEX idx_crawl_snapshots_hospital ON crawl_snapshots(hospital_id, crawled_at DESC);
CREATE INDEX idx_scoring_history_hospital ON scoring_change_history(hospital_id, changed_at DESC);
```

### 1-2. 기존 테이블 변경 (Migration 013)

```sql
-- hospital_profiles: 5축 → 4축
ALTER TABLE hospital_profiles DROP COLUMN IF EXISTS online_presence_score;
ALTER TABLE hospital_profiles ADD COLUMN IF NOT EXISTS marketing_activity_score NUMERIC(5,2) DEFAULT 0;

-- product_match_scores: 영업 각도 컬럼 추가
ALTER TABLE product_match_scores ADD COLUMN IF NOT EXISTS sales_angle_scores JSONB DEFAULT '{}';
ALTER TABLE product_match_scores ADD COLUMN IF NOT EXISTS top_pitch_points JSONB DEFAULT '[]';
-- ⚠️ 기존 need_score, fit_score, timing_score는 삭제하지 말 것 (deprecated, 안정화 후 삭제)
```

### 1-3. 사전 데이터 시딩 (Migration 014)

**keyword_dictionary 시딩** (핵심 20+건):

| standard_name | category | base_unit_type | aliases (일부) |
|---|---|---|---|
| 울쎄라 | hifu | SHOT | 울세라, ulthera, 울쎄, 울 |
| 슈링크 | hifu | SHOT | 슈링크유니버스, shurink, 슈 |
| 온다리프팅 | hifu | JOULE | 온다, onda |
| 써마지 | rf | SHOT | 써마지FLX, 써마지CPT, thermage, 써마, 써 |
| 인모드 | rf | SESSION | 인모드FX, 인모드FORMA, inmode |
| 올리지오 | rf | SESSION | 올리지오X, 올리 |
| 포텐자 | rf | SESSION | 포텐, potenza |
| 토르RF | rf | SESSION | 토르, TORR, 토르리프팅 |
| 쥬베룩 | booster | CC | 쥬베룩볼륨, 쥬베 |
| 리쥬란 | booster | CC | 리쥬란힐러, 리쥬란HB, 리쥬 |
| 실리프팅 | lifting | LINE | 민트실, 실루엣소프트, 캐번실, 잼버실, 녹는실 |
| 안면거상 | surgery | SESSION | 미니거상, 거상술, 페이스리프트 |
| 지방흡입 | surgery | SESSION | 지흡, 얼굴지흡, 이중턱지흡 |
| 보톡스 | toxin | UNIT | 보톡, botox, 보툴리눔 |
| 필러 | filler | CC | 주름필러, 볼필러, 턱필러 |

**compound_words 시딩** (핵심 10+건):

| compound_name | decomposed_names | scoring_note |
|---|---|---|
| 울써마지 | ["울쎄라","써마지"] | 고가 브릿지, 프리미엄 패키지 |
| 인슈링크 | ["인모드","슈링크"] | RF+HIFU 컴바인 |
| 울쥬베 | ["울쎄라","쥬베룩"] | 리프팅+부스터 패키지 |
| 써쥬베 | ["써마지","쥬베룩"] | RF+부스터 패키지 |
| 텐텐 | ["텐쎄라","텐써마"] | 아이리프팅 특화 |
| 올리쥬란 | ["올리지오","리쥬란"] | RF+부스터 컴바인 |
| 슈쥬베 | ["슈링크","쥬베룩"] | HIFU+부스터 |
| 울포 | ["울쎄라","포텐자"] | HIFU+MRF |

### 1-4. TORR RF scoring_criteria JSONB 업데이트

기존 products 테이블의 TORR RF 레코드 scoring_criteria를 v3.1 영업 각도 구조로 UPDATE:

```sql
UPDATE products SET scoring_criteria = '{
  "sales_angles": [
    {
      "id": "mens_target",
      "name": "A. 남성 타겟/뷰티 입문",
      "weight": 30,
      "keywords": ["남성 피부관리","맨즈 안티에이징","남성 리프팅","제모","옴므","포맨","남성 전용"],
      "pitch": "남성 환자는 통증에 민감해 이탈이 빠릅니다. 토르 리프팅은 무마취 시술로 남성 고객 락인율을 극대화합니다."
    },
    {
      "id": "bridge_care",
      "name": "B. 고가시술 브릿지 관리",
      "weight": 30,
      "keywords": ["써마지","아이써마지","울쎄라","실리프팅","민트실","안면거상"],
      "pitch": "고가 시술(써마지/울쎄라) 간 공백기를 소모품 0원인 토르 리프팅으로 채워 환자 이탈을 방지합니다."
    },
    {
      "id": "post_op_care",
      "name": "C. 수술 후 사후관리",
      "weight": 20,
      "keywords": ["안면거상","지방흡입","이물질 제거","붓기 관리","사후관리","거상술"],
      "pitch": "수술 후 요철/붓기에 다림질 효과를 발휘하여 프리미엄 사후관리 프로그램을 구성할 수 있습니다."
    },
    {
      "id": "painless_focus",
      "name": "D. 통증 최소화 중심",
      "weight": 20,
      "keywords": ["수면마취 없는","무통증 리프팅","직장인 점심시간","무마취","무통","논다운타임"],
      "pitch": "마취 없이 즉시 시술 가능. 직장인 점심시간 시술로 회전율을 높일 수 있습니다."
    },
    {
      "id": "combo_body",
      "name": "E. 복합시술/바디",
      "weight": 10,
      "keywords": ["슈링크","HIFU","눈가 주름","셀룰라이트","바디 타이트닝","이중턱"],
      "pitch": "기존 HIFU/바디 장비와 컴바인하여 탄력 보강 원스톱 솔루션을 제공합니다."
    }
  ],
  "combo_suggestions": [
    {"has_equipment": "써마지", "torr_role": "브릿지 유지 관리", "pitch": "고가 시술 간 공백기를 소모품 0원으로 채우세요"},
    {"has_equipment": "울쎄라", "torr_role": "브릿지 유지 관리", "pitch": "울쎄라 후 관리 시술로 환자 락인"},
    {"has_equipment": "안면거상", "torr_role": "수술 후 사후관리", "pitch": "다림질 효과로 요철을 펴주고 붓기를 빠르게"},
    {"has_equipment": "슈링크", "torr_role": "컴바인 탄력 보강", "pitch": "지방 감소 후 탄력을 채우는 원스톱 솔루션"},
    {"has_equipment": "실리프팅", "torr_role": "유지관리 보조", "pitch": "실 시술 후 자연스러운 탄력 유지를 위한 RF 보강"}
  ],
  "max_pitch_points": 2,
  "exclude_if": ["has_torr_rf"]
}'::jsonb
WHERE name = 'TORR RF';
```

### 1단계 완료 조건
- [ ] Migration 012: 6개 신규 테이블 생성 확인
- [ ] Migration 013: hospital_profiles에 marketing_activity_score, product_match_scores에 sales_angle_scores+top_pitch_points 확인
- [ ] Migration 014: keyword_dictionary 15+건, compound_words 8+건 시딩 확인
- [ ] TORR RF scoring_criteria 영업 각도 구조 UPDATE 확인
- [ ] supabase db push 성공
- [ ] 기존 기능 빌드 에러 없음
- [ ] **보고 후 승인 대기**

---

## 🟠 2단계: 크롤링 파이프라인 강화

### 2-1. 사전 상수 파일 생성

```
shared/constants/keyword-dictionary.ts
- keyword_dictionary 시딩 데이터의 TypeScript 소스
- 타입: { standardName, category, aliases[], baseUnitType }[]
- Migration 014의 INSERT도 이 파일 기반으로 생성

shared/constants/compound-words.ts
- compound_words 시딩 데이터의 TypeScript 소스
- 타입: { compoundName, decomposedNames[], scoringNote }[]
```

### 2-2. normalizer.ts (Stage 2: 정규화)

```
경로: scripts/crawler/normalizer.ts

입력: 크롤링 원문 텍스트 + OCR 텍스트
출력: { original, standardName, category, baseUnitType }[]

로직:
1. OCR 오인식 보정 (0↔O, 1↔l|I, 샷→숫/숏 보정)
2. keyword_dictionary의 aliases를 루프하며 Contains 검사
3. 매칭된 텍스트를 standard_name으로 변환
4. 미매칭 키워드는 별도 수집 (정규화 매칭률 모니터링)
```

### 2-3. decomposer.ts (Stage 3: 합성어 분해)

```
경로: scripts/crawler/decomposer.ts

입력: normalizer의 미매칭 키워드 + 원문 텍스트
출력: 분해된 표준명 배열 또는 후보 등록

로직:
1. compound_words 테이블 조회 → 매칭되면 즉시 분해
2. Regex 패턴 (울|써|인|슈|텐|올)(써|쥬|리|슈|모) 감지
3. 사전에 없는 새 합성어 → Gemini Flash에 분해 추론 요청
4. 추론 결과 → compound_word_candidates에 후보 등록 (status: pending)
5. 관리자 confirm 전까지 스코어링에 미반영
```

### 2-4. price-parser.ts (Stage 4: 가격 + 단위당 단가)

```
경로: scripts/crawler/price-parser.ts

입력: 원문 텍스트/OCR 텍스트 + normalizer 결과
출력: hospital_pricing INSERT 데이터

로직:
1. Regex로 [수량]+[단위]+[가격] 세트 추출
   수량&단위: /(\d+(?:,\d{3})*|\d+만|\d+천)\s*(샷|shot|cc|ml|유닛|U|줄|J|라인|회|패키지)/gi
   가격: /(\d+(?:,\d{3})*|\d+만|\d+천)\s*(원|₩)/gi
2. 숫자 변환: "5만"→50000, "350,000"→350000
3. 동음이의어 판별 (Contextual Unit Mapper):
   - "줄" → keyword_dictionary에서 시술의 base_unit_type 조회
   - 시술명이 온다계열이면 JOULE, 실계열이면 LINE
4. unit_price = total_price / total_quantity
5. confidence_level 부여:
   - EXACT: 단일 시술에서 수량+가격 직접 추출
   - CALCULATED: 패키지에서 비율 역산
   - ESTIMATED: 수량 불명확 시 시장 평균 기반
6. is_event_price: "체험가","이벤트가","1회체험" 키워드 감지
7. price_band: Premium(50만+), Mid(20~50만), Mass(20만 미만)
8. → hospital_pricing에 INSERT
```

### 2-5. image-optimizer.ts

```
경로: scripts/crawler/image-optimizer.ts

기능:
- 스크린샷 다운샘플링: 최대 1280px 너비
- 세로 2000px 초과 시 텍스트 밀집 구역 크롭 (상/중/하 3분할)
- 1MB 초과 시 JPEG 압축 (quality 70%)
- 빈 이미지(배경만) 사전 필터링 → API 호출 방지
- 처리 후 원본 이미지 즉시 삭제 (이미지 휘발 정책)
```

### 2-6. change-detector.ts

```
경로: scripts/crawler/change-detector.ts

기능:
1. 이전 crawl_snapshots의 pass1_text_hash와 현재 텍스트 해시(SHA-256) 비교
2. 변동 감지 시 → OCR 트리거 (선택적 OCR로 비용 80% 절감)
3. diff_summary 생성: 장비 추가/제거, 가격 변동, 시술 변경
4. 변동 리포트 JSON 반환
```

### 2-7. run-batch-pipeline.ts 수정

```
기존 파일 수정: scripts/crawler/run-batch-pipeline.ts (또는 해당 경로)

변경:
1. 3티어 차등 실행 로직
   - Tier1(PRIME/HIGH): 매주 Full (Text+OCR)
   - Tier2(MID): 2주마다 Text, 월1회 OCR (변동 감지 기반)
   - Tier3(LOW): 월1회 Text, 분기1회 OCR (변동 감지 기반)
2. 프록시 로테이션 통합 (환경변수 PROXY_URL)
3. 5-Stage 파이프라인 호출: 수집 → normalizer → decomposer → price-parser → 저장
4. image-optimizer 호출 (OCR 전)
5. change-detector 호출 (선택적 OCR 판단)
6. crawl_snapshots 저장
```

### 2단계 완료 조건
- [ ] normalizer.ts: "울세라" → "울쎄라" 변환 테스트 통과
- [ ] decomposer.ts: "울써마지" → ["울쎄라","써마지"] 분해 테스트 통과
- [ ] price-parser.ts: "울쎄라 300샷 150만원" → unit_price 5000 테스트 통과
- [ ] price-parser.ts: "온다 5만줄 35만원" → unit_type JOULE, unit_price 7 테스트 통과
- [ ] image-optimizer.ts: 2000px 초과 이미지 크롭 동작 확인
- [ ] change-detector.ts: 텍스트 해시 비교 동작 확인
- [ ] 신사루비의원 1건 전체 파이프라인 E2E 테스트 통과
- [ ] 빌드 성공
- [ ] **보고 후 승인 대기**

---

## 🟡 3단계: 스코어링 엔진 리팩터

### 3-1. marketing-scorer.ts (신규)

```
경로: scripts/crawler/marketing-scorer.ts

기능:
- 네이버 블로그/카페/뉴스 게시물 수 (병원명 검색)
- 인스타그램 활동량 추정
- 네이버 플레이스 리뷰 관리 여부
- → 0~100 점수 반환
```

### 3-2. profiler.ts 수정

```
변경:
1. scoreOnlinePresence() → DEPRECATED 주석 처리 (삭제 금지)
2. scoreMarketingActivity() 추가 — marketing-scorer.ts 호출
3. 가중치: 투자 30% / 포트폴리오 25% / 진료규모 25% / 마케팅투자 20%
4. hospital_profiles.marketing_activity_score upsert
5. 등급: PRIME(75+) / HIGH(55+) / MID(35+) / LOW(<35)
```

### 3-3. matcher.ts 전면 재설계

```
변경:
1. evaluateNeed(), evaluateFit(), evaluateTiming() → DEPRECATED (삭제 금지)
2. 신규: evaluateSalesAngles(hospital, product)
   - product.scoring_criteria.sales_angles 루프
   - 각 영업 각도의 keywords를 병원 장비/시술과 매칭
   - normalizer의 표준명 기준 매칭 (유의어 포함)
   - 각 각도별 점수 → weight 가중합 → total_score
3. 상위 1~2개 → top_pitch_points 자동 선택
   - max_pitch_points (기본값 2)
4. 등급: S(75+) / A(55+) / B(35+) / C(<35)
5. product_match_scores에 upsert:
   - sales_angle_scores: {"mens_target": 85, "bridge_care": 60, ...}
   - top_pitch_points: ["mens_target", "bridge_care"]
   - grade: "S"
6. 이전 grade와 비교 → 변동 시 scoring_change_history 기록
```

### 3-4. lead-generator.ts 수정

```
변경:
- S/A 등급 → 리드 자동 생성 (기존 동일)
- 리드에 top_pitch_points 포함 (이메일 생성 시 사용)
```

### 3단계 완료 조건
- [ ] profiler.ts: marketing_activity_score 반영, 4축 가중합 확인
- [ ] matcher.ts: TORR RF 영업 각도(A~E) 점수 산출 확인
- [ ] top_pitch_points 자동 선택 (최대 2개) 확인
- [ ] scoring_change_history 등급 변동 기록 확인
- [ ] 빌드 성공
- [ ] **보고 후 승인 대기**

---

## 🟢 4단계: Admin 대시보드 확장

### 4-1. 합성어 관리 탭 (신규)

```
경로: /admin/compound-words

- compound_word_candidates 목록 (status: pending)
- discovery_count 3회 이상 하이라이트
- [Confirm] → compound_words로 이동 + 소급 반영 트리거
- [Reject] → status: rejected
```

### 4-2. 키워드 사전 관리 (신규)

```
경로: /admin/dictionary

- keyword_dictionary CRUD
- 표준명, 카테고리, 유의어(aliases), base_unit_type 편집
```

### 4-3. 변동 리포트 뷰 (신규)

```
경로: /admin/crawl-report

- 이번 주 크롤링 현황: 처리 수, 성공률, 장비 검출률
- 변동 병원 목록: 장비 추가/제거, 가격 변동
- 스코어링 등급 변동 병원
- 품질 지표: 정규화 매칭률, 가격 이상치 수
```

### 4-4. 운영 현황판 (기존 /admin/dashboard 확장)

```
추가 위젯:
- 사전 현황: 표준명 수 / 합성어 수 / 승인 대기 후보 수
- 스코어링 분포: 등급별 병원 수 (PRIME/HIGH/MID/LOW)
- 영업 전환: 등급별 이메일 응답률 / 피칭포인트별 전환율
```

### 4단계 완료 조건
- [ ] /admin/compound-words 후보 목록 + confirm/reject 동작
- [ ] /admin/dictionary 키워드 CRUD 동작
- [ ] /admin/crawl-report 변동 리포트 표시
- [ ] 빌드 성공
- [ ] **보고 후 승인 대기**

---

## 🔵 5단계: 이메일 리팩터 (영업 각도 맞춤 피칭)

### 5-1. 영업 각도별 맞춤 이메일

```
변경:
- product_match_scores.top_pitch_points에서 메인 피칭 포인트 조회
- scoring_criteria.sales_angles에서 해당 각도의 pitch 텍스트 조회
- combo_suggestions에서 병원 보유 장비 매칭 → 컴바인 제안 삽입
- AI 프롬프트에 동적 주입: {{top_pitch_points}}, {{pitch_scripts}}, {{combo_suggestion}}
```

### 5-2. TORR RF 하드코딩 완전 제거

```bash
grep -r "TORR RF\|토르 알에프\|2,500만원\|2500만" apps/ scripts/
# → 0건 확인 필수
```

### 5단계 완료 조건
- [ ] TORR RF 하드코딩 grep 0건
- [ ] S등급 병원: 영업 각도 맞춤 이메일 생성 (top_pitch_points 기반)
- [ ] 컴바인 제안 자동 삽입 (써마지 보유 병원 → 브릿지 피칭)
- [ ] 빌드 성공
- [ ] **보고 후 승인 대기**

---

## 작업 원칙

1. **각 단계 완료 후 반드시 보고 + 승인 대기**. 임의로 다음 단계 진행 금지.
2. **빌드 깨지면 즉시 중단 후 보고**. 에러를 무시하고 넘어가지 말 것.
3. **기존 데이터 보존**. DROP TABLE 금지. ALTER + 마이그레이션으로 진행.
4. **deprecated 처리**: 더 이상 안 쓰는 함수/파일은 삭제하지 말고 `// DEPRECATED: replaced by xxx` 주석 추가.
5. **테스트**: 각 단계의 완료 조건 테스트를 반드시 실행하고 결과를 보고에 포함.
6. **코딩 시 반드시 빌드/타입 체크**: `npm run build` 또는 `tsc --noEmit` 통과 확인.
7. **확인된 것만 보고**: 안 되는 것을 된다고 하지 말 것. 모르겠으면 모르겠다고 보고.
