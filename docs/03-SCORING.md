# Phase 2: 2단계 스코어링 엔진 (Week 5~6)

## 이 Phase의 목표

모든 병원에 **제품과 무관한 기본 프로파일**을 생성하고, 등록된 제품별로 **매칭 스코어**를 산출하여 리드를 자동 생성.

## 핵심 개념: 2단계 스코어링

```
[1단계] 병원 프로파일 (제품 무관, 병원당 1회)
   "이 병원은 어떤 곳인가?"
   → investment_score, portfolio_diversity_score, practice_scale_score,
     market_competition_score, online_presence_score
   → profile_grade: PRIME / HIGH / MID / LOW

[2단계] 제품 매칭 스코어 (제품별로 각각 실행)
   "이 병원에 이 제품이 맞는가?"
   → need_score, fit_score, timing_score
   → grade: S / A / B / C / EXCLUDE
   
   같은 병원이라도:
   - TORR RF 매칭: S등급 (RF 공백 + 리프팅 수요 높음)
   - 2mm 바늘 매칭: EXCLUDE (TORR RF 미보유)
   - 관리장비 매칭: A등급 (관리 시술 많고 장비 노후)
```

## 선행 조건

- Phase 1 완료 (hospitals 2,000건+, 장비/시술 데이터 보강)
- 제품 등록 완료 (최소 TORR RF + 소모품)
- Claude API 키 준비

## 완료 체크리스트

- [ ] 1단계: 병원 프로파일 생성 로직
- [ ] 2단계: 제품별 매칭 스코어 산출 로직
- [ ] 상권 분석 (반경 내 경쟁 병원 조회)
- [ ] Claude API 연동 (AI 분석 메모 생성)
- [ ] 전체 병원 일괄 프로파일링 실행
- [ ] 제품별 매칭 스코어 일괄 실행
- [ ] 리드 자동 생성 (S/A 등급)
- [ ] 등급 분포 확인

---

## 1. Engine 코드 구조

```
apps/engine/src/
├── routes/
│   └── scoring.ts                # 스코어링 API
├── services/
│   └── scoring/
│       ├── profiler.ts           # [1단계] 병원 프로파일
│       ├── matcher.ts            # [2단계] 제품 매칭
│       ├── competitor.ts         # 상권 분석
│       ├── lead-generator.ts     # 리드 자동 생성
│       └── ai-analysis.ts       # Claude AI 분석 메모
└── types/
    └── scoring.ts
```

---

## 2. [1단계] 병원 프로파일 생성

### 투자 성향 점수 (investment_score: 0~100)

```typescript
function scoreInvestment(equipments: Equipment[], hospital: Hospital): number {
  let score = 0;
  const currentYear = new Date().getFullYear();

  // 장비 보유 수 (투자 적극성)
  const total = equipments.length;
  if (total >= 7) score += 30;
  else if (total >= 5) score += 25;
  else if (total >= 3) score += 18;
  else if (total >= 1) score += 10;

  // 최근 장비 투자 (2년 이내)
  const recentCount = equipments.filter(e =>
    e.estimated_year && (currentYear - e.estimated_year) <= 2
  ).length;
  if (recentCount >= 2) score += 30;
  else if (recentCount === 1) score += 20;

  // 고가 장비 보유 (투자 여력 지표)
  const premiumEquipments = ['울쎄라', '써마지', '피코슈어', '쿨스컬프팅'];
  const hasPremium = equipments.some(e =>
    premiumEquipments.some(p => e.equipment_name.includes(p))
  );
  if (hasPremium) score += 20;

  // 개원 시기 (확장기 = 투자 활발)
  if (hospital.opened_at) {
    const yearsOpen = currentYear - new Date(hospital.opened_at).getFullYear();
    if (yearsOpen >= 2 && yearsOpen <= 5) score += 20;      // 확장기
    else if (yearsOpen >= 6 && yearsOpen <= 10) score += 15; // 안정기
    else if (yearsOpen > 10) score += 10;                     // 리뉴얼기
  }

  return Math.min(score, 100);
}
```

### 포트폴리오 다양성 점수 (portfolio_diversity_score: 0~100)

```typescript
function scorePortfolioDiversity(equipments: Equipment[]): number {
  // 보유 장비 카테고리 커버리지
  const categories = new Set(equipments.map(e => e.equipment_category));
  const allCategories = ['rf', 'laser', 'ultrasound', 'ipl', 'injection', 'body', 'skinbooster'];
  
  const coverageRatio = categories.size / allCategories.length;
  let score = Math.round(coverageRatio * 60); // 최대 60점

  // 주요 카테고리 보유 보너스
  if (categories.has('rf')) score += 10;
  if (categories.has('laser')) score += 10;
  if (categories.has('ultrasound')) score += 10;
  if (categories.has('ipl')) score += 5;
  if (categories.has('body')) score += 5;

  return Math.min(score, 100);
}
```

### 시술 규모 점수 (practice_scale_score: 0~100)

```typescript
function scorePracticeScale(treatments: Treatment[]): number {
  let score = 0;

  // 시술 메뉴 수
  if (treatments.length >= 15) score += 30;
  else if (treatments.length >= 8) score += 20;
  else if (treatments.length >= 3) score += 10;

  // 안티에이징 비율 (고수익 시술)
  const antiAging = ['lifting', 'tightening', 'toning', 'filler', 'botox'];
  const antiAgingCount = treatments.filter(t =>
    antiAging.includes(t.treatment_category)
  ).length;
  const ratio = antiAgingCount / Math.max(treatments.length, 1);
  if (ratio >= 0.5) score += 25;
  else if (ratio >= 0.3) score += 15;

  // 가격대 (환자 구매력 + 병원 포지셔닝)
  const prices = treatments.map(t => t.price_min).filter((p): p is number => p != null && p > 0);
  if (prices.length > 0) {
    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
    if (avgPrice >= 300000) score += 25;
    else if (avgPrice >= 150000) score += 18;
    else if (avgPrice >= 80000) score += 10;
  }

  // 프로모션 시술 보유 (마케팅 적극성)
  const promotedCount = treatments.filter(t => t.is_promoted).length;
  if (promotedCount >= 3) score += 20;
  else if (promotedCount >= 1) score += 10;

  return Math.min(score, 100);
}
```

### 상권 경쟁 점수 + 온라인 존재감 점수

```typescript
// market_competition_score: 반경 1km 내 경쟁 병원 수 기반
// 밀집도 높을수록 → 장비 차별화 니즈 높음 → 영업 기회

// online_presence_score: 웹사이트 품질, 네이버 리뷰 수, 정보 공개 수준
// 높을수록 → 마케팅에 투자하는 병원 → 장비에도 투자할 가능성
```

### 프로파일 등급

```typescript
function assignProfileGrade(profileScore: number): string {
  if (profileScore >= 75) return 'PRIME';  // 상위 ~10%
  if (profileScore >= 55) return 'HIGH';   // 상위 ~30%
  if (profileScore >= 35) return 'MID';    // 상위 ~70%
  return 'LOW';                             // 나머지
}
```

---

## 3. [2단계] 제품별 매칭 스코어

### 핵심: 제품의 scoring_criteria를 읽어서 동적으로 점수 산출

```typescript
/**
 * 각 제품의 scoring_criteria에는 need_rules, fit_rules, timing_rules가 정의됨.
 * 매처는 이 규칙들을 읽어서 병원 데이터와 대조하여 점수를 산출.
 * 
 * 예시 - TORR RF의 scoring_criteria:
 * {
 *   "need_rules": [
 *     {"condition": "no_rf", "score": 40, "reason": "RF 장비 공백"},
 *     {"condition": "old_rf_5yr", "score": 30, "reason": "RF 5년+"},
 *     ...
 *   ],
 *   "fit_rules": [...],
 *   "timing_rules": [...]
 * }
 */

interface MatchInput {
  hospital: Hospital;
  equipments: Equipment[];
  treatments: Treatment[];
  profile: HospitalProfile;
  product: Product;
  competitors: CompetitorData[];
}

function calculateProductMatch(input: MatchInput): MatchOutput {
  const { product, equipments, treatments, profile } = input;
  const criteria = product.scoring_criteria;
  
  const needScore = evaluateRules(criteria.need_rules, input);     // 0~100
  const fitScore = evaluateRules(criteria.fit_rules, input);       // 0~100
  const timingScore = evaluateRules(criteria.timing_rules, input); // 0~100
  
  // 가중 합산 (need 40%, fit 35%, timing 25%)
  const totalScore = Math.round(
    needScore * 0.40 + fitScore * 0.35 + timingScore * 0.25
  );
  
  return { needScore, fitScore, timingScore, totalScore, grade: assignGrade(totalScore) };
}
```

### 조건 평가 엔진 (evaluateRules)

```typescript
/**
 * 제품의 scoring_criteria에 정의된 조건들을 병원 데이터와 대조
 * 
 * 지원하는 조건 목록:
 * 
 * [장비 관련]
 * no_rf              → RF 장비 미보유
 * has_rf             → RF 장비 보유
 * old_rf_3yr         → RF 장비 3년+
 * old_rf_5yr         → RF 장비 5년+
 * has_ultrasound     → HIFU 장비 보유
 * has_laser          → 레이저 보유
 * equipment_count_5plus → 장비 5개+
 * has_torr_rf        → TORR RF 보유 (소모품용)
 * has_any_rf_needle  → RF 니들 시술 중
 * 
 * [시술 관련]
 * lifting_treatments       → 리프팅 시술 메뉴 보유
 * high_antiaging_ratio     → 안티에이징 비율 50%+
 * high_price_treatments    → 평균 시술가 30만원+
 * 
 * [병원 특성]
 * opened_2_5yr        → 개원 2~5년 (확장기)
 * recent_investment    → 최근 2년 내 장비 구매 이력
 * no_recent_rf_purchase → 최근 2년 RF 구매 없음
 * competitive_market   → 상권 경쟁 병원 10개+
 * prime_profile        → 프로파일 등급 PRIME
 * high_profile         → 프로파일 등급 HIGH+
 * 
 * [경쟁 장비 관련]
 * has_competing_equipment → 제품의 competing_keywords에 해당하는 장비 보유
 * has_synergy_equipment   → 제품의 synergy_keywords에 해당하는 장비 보유
 * has_required_equipment  → 제품의 requires_equipment_keywords에 해당하는 장비 보유 (소모품)
 * 
 * 조건 추가는 이 엔진에 case를 추가하면 됨 (제품 등록 시 새 조건 사용 가능)
 */
```

### 매칭 등급

```typescript
function assignGrade(totalScore: number, dataQuality: number): string {
  if (dataQuality < 50) return 'EXCLUDE';
  if (totalScore >= 75) return 'S';   // 최우선 타깃
  if (totalScore >= 55) return 'A';   // 우선 타깃
  if (totalScore >= 35) return 'B';   // 일반 타깃
  return 'C';                          // 장기 육성
}
```

---

## 4. AI 분석 메모 생성 (제품별)

```typescript
const MATCH_ANALYSIS_PROMPT = `
당신은 한국 미용 의료기기 영업 전문가입니다.
아래 제품을 이 병원에 제안하는 관점에서 분석 메모를 작성하세요.

## 제품 정보
- 제품명: {{product_name}}
- 카테고리: {{product_category}}
- 제조사: {{product_manufacturer}}
- 설명: {{product_summary}}
- 경쟁 제품: {{competing_keywords}}
- 시너지 장비: {{synergy_keywords}}

## 병원 정보
- 병원명: {{hospital_name}}
- 위치: {{address}}
- 진료과목: {{department}}
- 보유 장비: {{equipments_list}}
- 시술 메뉴: {{treatments_list}}

## 스코어링 결과
- 병원 프로파일: {{profile_grade}} (투자성향: {{investment_tendency}})
- 제품 매칭: {{match_grade}} (need: {{need_score}}, fit: {{fit_score}}, timing: {{timing_score}})

## 상권 경쟁 현황
- 반경 1km 경쟁 병원: {{competitor_count}}개

## 요청 - JSON으로만 응답
{
  "selling_points": ["핵심 셀링 포인트 1", "포인트 2", "포인트 3"],
  "risks": ["주의사항/리스크"],
  "recommended_approach": "이 병원에 이 제품을 제안할 때 강조할 점 (2~3문장)",
  "recommended_payment": "추천 결제 방식",
  "persona_notes": "원장 추정 성향 (1~2문장)"
}
`;
```

---

## 5. 리드 자동 생성

```typescript
/**
 * 매칭 스코어 산출 후 → 리드 자동 생성
 * 
 * 조건:
 * 1. grade가 S 또는 A
 * 2. 이메일 보유
 * 3. 해당 hospital_id + product_id 조합으로 기존 리드 없음
 * 
 * 생성:
 * - stage: 'new'
 * - grade: 매칭 등급
 * - priority: S=100, A=50
 * - contact_email: hospital.email
 * - product_id: 해당 제품
 * - match_score_id: 방금 생성한 매칭 스코어 ID
 * 
 * B/C 등급은 admin에서 수동 리드 생성 가능
 */
```

---

## 6. 스코어링 API

```typescript
/**
 * POST /api/scoring/profile
 * - body: { hospital_id } (단건) 또는 { batch: true } (일괄)
 * - 1단계 병원 프로파일 생성
 * 
 * POST /api/scoring/match
 * - body: { hospital_id, product_id } (단건)
 * - body: { product_id, batch: true } (특정 제품으로 전체 병원 매칭)
 * - body: { batch: true } (모든 제품 × 모든 병원 매칭)
 * - 2단계 제품 매칭 스코어 산출
 * 
 * GET /api/scoring/profiles
 * - 프로파일 목록 (필터: grade, min_score)
 * 
 * GET /api/scoring/matches
 * - 매칭 결과 목록 (필터: product_id, grade, min_score)
 * 
 * GET /api/scoring/matches/:productId/distribution
 * - 특정 제품의 등급 분포
 */
```

---

## 7. 예상 결과

```
전체 2,000건 기준 (이메일 보유 1,000건 가정):

[병원 프로파일]
PRIME: ~100건 (10%)
HIGH:  ~200건 (20%)
MID:   ~400건 (40%)
LOW:   ~300건 (30%)

[TORR RF 매칭] (이메일 있는 병원 중)
S등급: ~40건  → 즉시 리드 생성
A등급: ~120건 → 즉시 리드 생성
B등급: ~350건 → 대기
C등급: ~490건 → 장기 육성

[2mm 바늘 매칭] (TORR RF 보유 병원만 해당)
→ 초기에는 TORR RF 판매 후 자동 리드 전환

S+A = 제품별 약 100~200건이 첫 영업 대상
```

---

## 이 Phase 완료 후 상태

- `hospital_profiles` 테이블: 전 병원 프로파일 완료
- `product_match_scores` 테이블: 제품별 매칭 스코어 완료
- `leads` 테이블: 제품별 S/A 등급 리드 자동 생성
- 각 리드에 AI 분석 메모 + 추천 접근법 포함
- 제품별 등급 분포 확인 가능
- → 다음: `04-EMAIL.md`
