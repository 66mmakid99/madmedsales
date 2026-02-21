# MADMEDSALES v3.1 — 코드베이스 정합성 점검 + 개발 지시

## 상황

### 이전 작업 (완료)
멀티 제품 영업 플랫폼 전환이 2단계까지 완료되었다:
- ✅ 1단계 DB: products, hospital_profiles, product_match_scores, 각 테이블 product_id 추가
- ✅ 2단계 스코어링: profiler.ts(5축), matcher.ts(need/fit/timing 3축), lead-generator.ts
- ✅ MADMEDCHECK 자산 통합: Puppeteer+Gemini Vision OCR, 211개 병원 임포트

### 이번 작업 (v3.1 기획서 반영)
스코어링 시스템 기획서 v3.1이 확정되었다. 완료된 코드베이스 위에 아래 변경을 적용한다:
1. 스코어링 엔진 전면 재설계 (4축 + 영업 각도)
2. 키워드 사전 시스템 신설 (정규화 + 합성어 + 동음이의어)
3. 가격 파싱 심화 (단위당 단가, B2C 확장 대비)
4. 크롤링 파이프라인 5-Stage 강화
5. 자동화 운영 + 품질 보증 체계

## v3.1 핵심 변경 사항

### 1. 스코어링 재설계

#### Phase 1: 병원 프로파일 (5축 → 4축)
- **삭제**: scoreOnlinePresence() — 웹사이트 보유 여부는 구매 의향과 무관
- **추가**: scoreMarketingActivity() — 네이버 블로그/카페/뉴스, 인스타그램 활동량 기반
- **가중치 변경**: 투자성향 30% / 포트폴리오 25% / 진료규모 25% / 마케팅투자 20%
- hospital_profiles에서 online_presence_score 제거 → marketing_activity_score 추가
- 등급: PRIME(75+) / HIGH(55+) / MID(35+) / LOW(<35)

#### Phase 2: 제품별 매칭 (need/fit/timing 3축 → 영업 각도)
- **삭제**: evaluateNeed(), evaluateFit(), evaluateTiming()
- **추가**: evaluateSalesAngles() — 제품별 영업 각도(A~E) 키워드 매칭
- products.scoring_criteria JSONB 구조 전면 변경:
  ```json
  {
    "sales_angles": [
      {"id": "mens_target", "name": "A. 남성 타겟", "weight": 30, "keywords": [...], "pitch": "..."},
      {"id": "bridge_care", "name": "B. 고가시술 브릿지", "weight": 30, "keywords": [...], "pitch": "..."},
      {"id": "post_op_care", "name": "C. 수술 후 사후관리", "weight": 20, "keywords": [...], "pitch": "..."},
      {"id": "painless_focus", "name": "D. 통증 최소화", "weight": 20, "keywords": [...], "pitch": "..."},
      {"id": "combo_body", "name": "E. 복합시술/바디", "weight": 10, "keywords": [...], "pitch": "..."}
    ],
    "combo_suggestions": [
      {"has_equipment": "써마지", "torr_role": "브릿지 유지 관리", "pitch": "..."}
    ],
    "max_pitch_points": 2,
    "exclude_if": ["has_torr_rf"]
  }
  ```
- 각 영업 각도의 keywords를 병원의 장비/시술 데이터와 매칭 → 가중합 → 상위 1~2개만 top_pitch_points
- product_match_scores에 sales_angle_scores(JSONB) + top_pitch_points(JSONB) 추가
- 기존 need_score/fit_score/timing_score는 당분간 유지 (deprecated, 안정화 후 삭제)
- 등급: S(75+) / A(55+) / B(35+) / C(<35)

### 2. 키워드 사전 시스템 (신규 6개 테이블)

| 테이블 | 용도 |
|--------|------|
| keyword_dictionary | 표준명 정규화 + 시술 단위 매핑 (base_unit_type) |
| compound_words | 확정 합성어 (울써마지→울쎄라+써마지) |
| compound_word_candidates | Gemini 추론 합성어 후보 (관리자 confirm 전) |
| hospital_pricing | 시술 단가 + 단위당 단가 (B2C 핵심) |
| crawl_snapshots | 크롤링 스냅샷 + 변동 감지 기준 |
| scoring_change_history | 스코어링 등급 변동 이력 |

#### keyword_dictionary 핵심 설계
- standard_name: "울쎄라"
- category: "hifu" / "rf" / "booster" / "surgery" / "lifting" / "body"
- aliases: ["울세라","ulthera","울쎄","울"] — Contains 방식 검색
- **base_unit_type**: "SHOT" / "JOULE" / "CC" / "UNIT" / "LINE" / "SESSION"
  - 동음이의어 판별의 기준: "줄" → 시술명이 온다계열이면 JOULE, 실계열이면 LINE

#### hospital_pricing 핵심 설계
- total_quantity: 300 (수량)
- unit_type: "SHOT" (keyword_dictionary.base_unit_type에서 결정)
- total_price: 1500000 (총액)
- **unit_price**: 5000.00 (= 1500000 ÷ 300) — B2C 가격 비교 서비스의 핵심 컬럼
- confidence_level: "EXACT" / "CALCULATED" / "ESTIMATED"

### 3. 크롤링 파이프라인 5-Stage

```
Stage 1: 수집 (2-Pass: Text + Playwright Screenshot OCR)
Stage 2: 정규화 (normalizer.ts — OCR 보정 + 사전 매칭 + 표준명 변환)
Stage 3: 합성어 분해 (decomposer.ts — 사전 조회 + Gemini 추론 + 후보 등록)
Stage 4: 가격 파싱 (price-parser.ts — Regex 토큰화 + 동음이의어 판별 + unit_price 산출)
Stage 5: 저장 (hospital_pricing + crawl_snapshots + 변동 감지)
```

### 4. 운영 강화 (기존 코드에 없는 신규 사항)

- 3티어 차등 크롤링: Tier1(PRIME/HIGH) 주1회 / Tier2(MID) 2주1회 / Tier3(LOW) 월1회
- 변동 감지 기반 선택적 OCR: 텍스트 변동 병원만 OCR → 비용 80% 절감
- 프록시 필수: Residential Proxy 로테이션 (환경변수 PROXY_URL)
- 이미지 토큰 통제: 다운샘플링 1280px, 크롭 2000px, JPEG 70%
- 이미지 휘발 정책: 파싱 후 즉시 삭제, 텍스트만 DB 저장

## 점검 요청

### Step 1: 현재 DB 스키마 확인
supabase/migrations/ 의 마이그레이션 파일들을 전부 읽고 현황 보고.
- 현재 존재하는 테이블 목록
- hospital_profiles의 현재 컬럼 목록 (online_presence_score 존재 여부)
- product_match_scores의 현재 컬럼 목록 (need_score/fit_score/timing_score 존재 여부)
- products의 현재 scoring_criteria JSONB 구조
- keyword_dictionary, compound_words 등 v3.1 신규 테이블 존재 여부

### Step 2: 스코어링 엔진 현재 코드 확인
스코어링 관련 파일들을 찾아서 읽고 현황 보고.
- profiler.ts: 현재 몇 축인지, 어떤 함수들이 있는지
- matcher.ts: 현재 need/fit/timing 구조인지
- 기존 calculator.ts, runner.ts가 아직 있는지

### Step 3: 크롤링 관련 현재 코드 확인
scripts/ 하위의 크롤러 관련 파일들을 찾아서 읽고 현황 보고.
- 현재 크롤링 파이프라인 구조
- normalizer, decomposer, price-parser 존재 여부
- Puppeteer/Playwright OCR 관련 코드 위치

### Step 4: 이메일 시스템 확인
- TORR RF 하드코딩이 남아있는지 grep 확인
- products 테이블에서 동적 로드하는 구조인지

### Step 5: 불일치 보고
위 점검 결과를 다음 형식으로 보고:

```
[완료] 항목명 - 이전 마이그레이션에서 이미 완료됨
[일치] 항목명 - v3.1 기획서와 코드가 맞음
[불일치] 항목명 - 기획서: xxx, 코드: yyy → 수정 필요
[누락] 항목명 - 기획서에는 있으나 코드에 없음 → 구현 필요
[추가] 항목명 - 코드에는 있으나 기획서에 없음 → 판단 필요
```

**수정은 보고 후 승인받고 진행하라. 임의로 코드를 바꾸지 말 것.**
