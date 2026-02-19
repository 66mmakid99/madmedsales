# Phase 2: 스코어링 엔진 (Week 5~6)

## 이 Phase의 목표

전체 병원에 5대 축 스코어링을 실행하여 S/A/B/C 등급을 분류하고, AI 분석 메모를 생성.

## 선행 조건

- Phase 1 완료 (hospitals 2,000건+ 적재, 장비/시술 데이터 보강)
- Claude API 키 준비

## 완료 체크리스트

- [ ] 5대 축 스코어링 로직 구현
- [ ] 상권 분석 (반경 내 경쟁 병원 조회)
- [ ] Claude API 연동 (AI 분석 메모 생성)
- [ ] 가중치 버전 관리 시스템
- [ ] 전체 병원 일괄 스코어링 실행
- [ ] 등급 분포 확인 (S: ~5%, A: ~15%, B: ~30%, C: ~50%)
- [ ] 리드 자동 생성 (S/A 등급)

---

## 1. Engine 코드 구조 (이 Phase)

```
apps/engine/src/
├── routes/
│   └── scoring.ts              # 스코어링 API
├── services/
│   └── scoring/
│       ├── calculator.ts       # 축별 점수 계산
│       ├── weights.ts          # 가중치 관리
│       ├── grading.ts          # 등급 분류
│       ├── competitor.ts       # 상권 분석 (경쟁 병원)
│       └── aiAnalysis.ts       # Claude API 분석 메모
└── types/
    └── scoring.ts              # 스코어링 타입
```

---

## 2. 타입 정의

```typescript
// types/scoring.ts

export interface ScoringInput {
  hospital: {
    id: string;
    name: string;
    department: string;
    opened_at: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  equipments: {
    equipment_name: string;
    equipment_brand: string | null;
    equipment_category: string;  // rf, laser, ultrasound, ipl, other
    estimated_year: number | null;
  }[];
  treatments: {
    treatment_name: string;
    treatment_category: string;
    price_min: number | null;
    price_max: number | null;
    is_promoted: boolean;
  }[];
  competitors: CompetitorData[];
}

export interface CompetitorData {
  hospital_id: string;
  name: string;
  distance_meters: number;
  hasModernRF: boolean;         // 최근 3년 내 RF 장비 보유
  rfEquipmentName: string | null;
  treatmentCount: number;
}

export interface ScoringOutput {
  scores: {
    equipmentSynergy: number;    // 0~100
    equipmentAge: number;        // 0~100
    revenueImpact: number;       // 0~100
    competitiveEdge: number;     // 0~100
    purchaseReadiness: number;   // 0~100
  };
  totalScore: number;
  grade: 'S' | 'A' | 'B' | 'C' | 'EXCLUDE';
}

export interface ScoringWeights {
  equipmentSynergy: number;      // 기본 25
  equipmentAge: number;          // 기본 20
  revenueImpact: number;        // 기본 30
  competitiveEdge: number;       // 기본 15
  purchaseReadiness: number;     // 기본 10
}
```

---

## 3. 축별 점수 계산 로직

### 축 1: 장비 시너지 (기본 25%)

> 핵심 질문: "이 병원에 TORR RF를 넣으면 기존 장비와 시너지가 나는가?"

```typescript
function scoreEquipmentSynergy(equipments: Equipment[]): number {
  let score = 0;

  const hasRF = equipments.some(e => e.equipment_category === 'rf');
  const rfEquipments = equipments.filter(e => e.equipment_category === 'rf');
  const currentYear = new Date().getFullYear();

  // --- RF 보유 여부 (최대 40점) ---
  if (!hasRF) {
    // RF 전무 = 포트폴리오에 큰 공백 → 높은 도입 동기
    score += 40;
  } else {
    // RF 있음 → 얼마나 오래됐는지
    const oldestYear = Math.min(...rfEquipments.map(e => e.estimated_year || currentYear));
    const age = currentYear - oldestYear;
    if (age >= 5) score += 30;      // 5년+ 구형 → 교체 가능
    else if (age >= 3) score += 15; // 3~4년 → 추가 도입 가능
    else score += 5;                 // 최신 RF → 도입 동기 낮음
  }

  // --- 보완 장비 보유 (최대 35점) ---
  // 리프팅 관련 보완 장비가 있으면 시너지 가능
  const hasUltrasound = equipments.some(e => e.equipment_category === 'ultrasound');
  // 울쎄라, 슈링크 등
  const hasLaser = equipments.some(e => e.equipment_category === 'laser');
  const hasIPL = equipments.some(e => e.equipment_category === 'ipl');

  if (hasUltrasound) score += 20;  // RF+초음파 = 리프팅 풀코스
  if (hasLaser) score += 10;        // 레이저 보유 = 시술 다양성
  if (hasIPL) score += 5;

  // --- 장비 수 (투자 성향 지표, 최대 25점) ---
  const totalEquipments = equipments.length;
  if (totalEquipments >= 5) score += 25;
  else if (totalEquipments >= 3) score += 15;
  else if (totalEquipments >= 1) score += 10;
  // 장비 0개 = 데이터 부족일 수 있음 → 가산 없음

  return Math.min(score, 100);
}
```

### 축 2: 장비 노후도 (기본 20%)

> 핵심 질문: "기존 RF 장비를 교체할 타이밍인가?"

```typescript
function scoreEquipmentAge(equipments: Equipment[]): number {
  const currentYear = new Date().getFullYear();
  const rfEquipments = equipments.filter(e => e.equipment_category === 'rf');

  // RF 없음 = 신규 도입 기회
  if (rfEquipments.length === 0) return 80;

  // RF 있음 → 가장 오래된 RF 기준
  const years = rfEquipments
    .map(e => e.estimated_year)
    .filter((y): y is number => y !== null);

  if (years.length === 0) return 50; // 연도 정보 없음 → 중간값

  const oldestYear = Math.min(...years);
  const age = currentYear - oldestYear;

  if (age >= 7) return 100;    // 7년+ = 즉시 교체 필요
  if (age >= 5) return 85;     // 5~6년 = 교체 적기
  if (age >= 4) return 65;     // 4년 = 교체 고려 시작
  if (age >= 3) return 45;     // 3년 = 아직 현역
  if (age >= 2) return 25;     // 2년 = 교체 불필요
  return 10;                    // 1년 이내 = 방금 산 거
}
```

### 축 3: 매출 임팩트 (기본 30%)

> 핵심 질문: "TORR RF 도입이 이 병원 매출에 얼마나 도움이 되는가?"

```typescript
function scoreRevenueImpact(
  treatments: Treatment[], 
  equipments: Equipment[]
): number {
  let score = 0;
  const hasRF = equipments.some(e => e.equipment_category === 'rf');

  // --- 리프팅/타이트닝 시술 수요 (최대 35점) ---
  const liftingTreatments = treatments.filter(t =>
    ['lifting', 'tightening'].includes(t.treatment_category)
  );
  
  if (liftingTreatments.length >= 3) score += 35;     // 리프팅 전문
  else if (liftingTreatments.length >= 1) score += 25; // 리프팅 메뉴 있음
  else score += 10;                                     // 리프팅 메뉴 없음 (신규 가능)

  // --- 수요 있는데 장비 없음 = 골든 타깃 (최대 25점) ---
  if (!hasRF && liftingTreatments.length > 0) {
    score += 25; // 수요 검증됨 + 장비 공백
  } else if (!hasRF) {
    score += 10; // 수요 미확인이지만 공백
  }

  // --- 시술 단가 (투자 여력 + 환자 구매력 지표, 최대 20점) ---
  const prices = treatments
    .map(t => t.price_min)
    .filter((p): p is number => p !== null && p > 0);
  
  if (prices.length > 0) {
    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
    if (avgPrice >= 300000) score += 20;     // 고가 위주
    else if (avgPrice >= 150000) score += 15;
    else if (avgPrice >= 80000) score += 10;
    else score += 5;
  }

  // --- 안티에이징 포커스 (TORR RF 타깃 환자풀, 최대 20점) ---
  const antiAgingCategories = ['lifting', 'tightening', 'toning', 'filler', 'botox'];
  const antiAgingRatio = treatments.filter(t =>
    antiAgingCategories.includes(t.treatment_category)
  ).length / Math.max(treatments.length, 1);

  if (antiAgingRatio >= 0.5) score += 20;    // 절반 이상 안티에이징
  else if (antiAgingRatio >= 0.3) score += 15;
  else if (antiAgingRatio >= 0.1) score += 10;
  else score += 5;

  return Math.min(score, 100);
}
```

### 축 4: 경쟁 우위 (기본 15%)

> 핵심 질문: "이 병원이 TORR RF를 도입하면 상권에서 차별화 가능한가?"

```typescript
function scoreCompetitiveEdge(competitors: CompetitorData[]): number {
  let score = 0;
  const total = competitors.length;

  if (total === 0) {
    return 50; // 상권 데이터 없음 → 중간값
  }

  // --- 상권 내 최신 RF 보급률 (최대 50점) ---
  const withModernRF = competitors.filter(c => c.hasModernRF).length;
  const rfPenetration = withModernRF / total;

  if (rfPenetration === 0) score += 50;       // RF 전무 = 선점 기회
  else if (rfPenetration < 0.1) score += 40;  // 10% 미만
  else if (rfPenetration < 0.2) score += 30;  // 20% 미만
  else if (rfPenetration < 0.3) score += 20;  // 30% 미만
  else if (rfPenetration < 0.5) score += 10;  // 50% 미만
  else score += 5;                             // 이미 포화

  // --- 상권 밀집도 (경쟁 심할수록 차별화 필요, 최대 30점) ---
  if (total >= 15) score += 30;      // 극도로 밀집 (강남급)
  else if (total >= 10) score += 25;
  else if (total >= 5) score += 15;
  else score += 10;

  // --- 주변 대비 시술 다양성 (최대 20점) ---
  // (간략화: 상권 평균 시술 수 대비 이 병원의 위치)
  // 추후 정교화 가능
  score += 10; // 기본값

  return Math.min(score, 100);
}
```

### 축 5: 구매 여건 (기본 10%)

> 핵심 질문: "이 병원이 실제로 구매할 수 있는 여건인가?"

```typescript
function scorePurchaseReadiness(
  hospital: Hospital,
  equipments: Equipment[]
): number {
  let score = 0;
  const currentYear = new Date().getFullYear();

  // --- 개원 시기 (최대 40점) ---
  if (hospital.opened_at) {
    const openYear = new Date(hospital.opened_at).getFullYear();
    const yearsOpen = currentYear - openYear;

    if (yearsOpen >= 2 && yearsOpen <= 5) score += 40;  // 확장기 (최적)
    else if (yearsOpen >= 6 && yearsOpen <= 10) score += 30; // 안정기 (교체기)
    else if (yearsOpen >= 1 && yearsOpen < 2) score += 20;  // 초기 (아직 투자 중)
    else if (yearsOpen > 10) score += 25;  // 오래된 병원 (리뉴얼 가능)
    else score += 10;  // 1년 미만 (초기)
  } else {
    score += 20; // 개원일 정보 없음 → 중간값
  }

  // --- 최근 장비 투자 이력 (최대 40점) ---
  const recentEquipments = equipments.filter(e =>
    e.estimated_year && (currentYear - e.estimated_year) <= 2
  );

  if (recentEquipments.length >= 2) score += 40;  // 적극 투자 중
  else if (recentEquipments.length === 1) score += 30; // 투자 이력 있음
  else {
    // 최근 투자 없음 → 장비가 아예 없으면 데이터 부족, 있는데 안 샀으면 보수적
    if (equipments.length === 0) score += 15; // 데이터 부족
    else score += 10; // 보수적
  }

  // --- 기본 가산 (이메일 보유 = 연락 가능, 최대 20점) ---
  // 이메일이 있다는 것 자체가 접근 가능성 지표
  score += 20;

  return Math.min(score, 100);
}
```

---

## 4. 종합 점수 & 등급 분류

```typescript
// grading.ts

function calculateTotalScore(
  scores: ScoringOutput['scores'],
  weights: ScoringWeights
): number {
  const total =
    (scores.equipmentSynergy * weights.equipmentSynergy +
     scores.equipmentAge * weights.equipmentAge +
     scores.revenueImpact * weights.revenueImpact +
     scores.competitiveEdge * weights.competitiveEdge +
     scores.purchaseReadiness * weights.purchaseReadiness) / 100;

  return Math.round(total);
}

function assignGrade(totalScore: number, dataQuality: number): string {
  // 데이터 품질이 너무 낮으면 스코어링 제외
  if (dataQuality < 50) return 'EXCLUDE';

  // 등급 기준 (운영하면서 조정)
  if (totalScore >= 80) return 'S';   // 상위 ~5%
  if (totalScore >= 65) return 'A';   // 상위 ~20%
  if (totalScore >= 45) return 'B';   // 상위 ~50%
  return 'C';                          // 나머지
}
```

---

## 5. 상권 분석 (경쟁 병원 조회)

```typescript
// competitor.ts

/**
 * 특정 병원 기준 반경 1km 이내 경쟁 병원 조회
 * 
 * Supabase에서 PostGIS 함수 사용:
 * 
 * SELECT h.*, 
 *   ST_Distance(
 *     ST_SetSRID(ST_MakePoint(h.longitude, h.latitude), 4326)::geography,
 *     ST_SetSRID(ST_MakePoint($longitude, $latitude), 4326)::geography
 *   ) as distance_meters
 * FROM hospitals h
 * WHERE h.id != $hospital_id
 *   AND h.status = 'active'
 *   AND h.department IN ('피부과', '성형외과')
 *   AND ST_DWithin(
 *     ST_SetSRID(ST_MakePoint(h.longitude, h.latitude), 4326)::geography,
 *     ST_SetSRID(ST_MakePoint($longitude, $latitude), 4326)::geography,
 *     1000  -- 반경 1km
 *   )
 * ORDER BY distance_meters;
 * 
 * 참고: PostGIS가 Supabase에서 기본 활성화 안 되어 있으면
 *       Extensions에서 활성화 필요 (Supabase Dashboard → Database → Extensions → postgis)
 * 
 * 대안: PostGIS 없이 하려면 위도/경도로 직접 계산
 *       (정확도 약간 떨어지지만 가능)
 */

// PostGIS 없이 하는 대안 (Haversine 공식)
function getCompetitorsWithoutPostGIS(
  supabase: SupabaseClient,
  hospital: { latitude: number; longitude: number; id: string },
  radiusKm: number = 1
) {
  // 1. 같은 시군구의 모든 병원 조회
  // 2. JavaScript에서 거리 계산 (Haversine)
  // 3. 반경 내 필터링
  
  // Haversine 공식
  function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }
}
```

---

## 6. AI 분석 메모 생성

```typescript
// aiAnalysis.ts

const SCORING_ANALYSIS_PROMPT = `
당신은 한국 미용 의료기기 영업 전문가입니다.
TORR RF(고주파 장비)를 이 병원에 제안하는 관점에서 분석 메모를 작성하세요.

## 병원 정보
- 병원명: {{hospital_name}}
- 위치: {{address}}
- 진료과목: {{department}}
- 개원: {{opened_at}}

## 보유 장비
{{equipments_list}}

## 시술 메뉴
{{treatments_list}}

## 스코어링 결과
- 장비 시너지: {{score_equipment_synergy}}/100
- 장비 노후도: {{score_equipment_age}}/100
- 매출 임팩트: {{score_revenue_impact}}/100
- 경쟁 우위: {{score_competitive_edge}}/100
- 구매 여건: {{score_purchase_readiness}}/100
- 종합: {{total_score}}/100 (등급: {{grade}})

## 상권 경쟁 현황
- 반경 1km 내 경쟁 병원: {{competitor_count}}개
- 최신 RF 보유 병원: {{modern_rf_count}}개
{{competitors_list}}

## 요청
다음 JSON 형식으로 분석 메모를 작성하세요:
{
  "key_selling_points": ["핵심 포인트 1", "핵심 포인트 2", "핵심 포인트 3"],
  "risks": ["주의사항/리스크"],
  "recommended_message_direction": "첫 이메일에서 강조할 점 (2~3문장)",
  "recommended_payment": "추천 결제 방식 (lump_sum/installment/rental 중)",
  "persona_notes": "이 원장에 대한 추정 성향 메모 (1~2문장)"
}

JSON만 출력하세요.
`;

// Claude API 호출
async function generateAIAnalysis(input: {
  hospital: any;
  equipments: any[];
  treatments: any[];
  scores: ScoringOutput;
  competitors: CompetitorData[];
}): Promise<AIAnalysisResult> {
  
  // 프롬프트 템플릿 채우기
  const prompt = fillTemplate(SCORING_ANALYSIS_PROMPT, input);
  
  // Claude Haiku 호출 (비용 효율)
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }]
  });
  
  // JSON 파싱
  const text = response.content[0].text;
  return JSON.parse(text);
}
```

---

## 7. 스코어링 API

### routes/scoring.ts

```typescript
/**
 * POST /api/scoring/run
 * - body: { hospital_id: string } (단건)
 * - body: { batch: true, filters?: {...} } (일괄)
 * 
 * 처리:
 * 1. 병원 + 장비 + 시술 데이터 조회
 * 2. 상권 경쟁 병원 조회
 * 3. 축별 점수 계산
 * 4. 종합 점수 + 등급
 * 5. AI 분석 메모 생성 (Claude API)
 * 6. scoring_results에 저장
 * 7. S/A 등급 → leads 자동 생성 (이미 없는 경우)
 * 
 * GET /api/scoring/weights
 * - 현재 활성 가중치 조회
 * 
 * PUT /api/scoring/weights
 * - 새 가중치 버전 생성 (이전 버전 비활성화)
 * - body: { weights: ScoringWeights, notes: string }
 * 
 * GET /api/scoring/results
 * - 스코어링 결과 목록 (필터, 정렬)
 * - filter: grade, min_score, max_score
 * - sort: total_score desc
 * 
 * GET /api/scoring/distribution
 * - 등급 분포 통계 (S: n건, A: n건, ...)
 */
```

### 리드 자동 생성 로직

```typescript
/**
 * 스코어링 완료 후 → 리드 자동 생성
 * 
 * 조건: grade가 S 또는 A이고, 이메일이 있는 병원
 * 
 * 1. 이미 leads에 해당 hospital_id가 있으면 skip
 * 2. 없으면 leads에 INSERT:
 *    - stage: 'new'
 *    - grade: 스코어링 등급
 *    - contact_email: hospital.email
 *    - scoring_result_id: 방금 생성한 스코어링 결과 ID
 *    - priority: S=100, A=50
 * 
 * B/C 등급은 수동으로 리드 생성 가능 (admin에서)
 */
```

---

## 8. 일괄 스코어링 스크립트

```typescript
// scripts/migrate/run-scoring.ts

/**
 * 전체 병원 일괄 스코어링
 * 
 * 1. 활성(active) + 타깃(is_target) + 데이터품질(>= 50) 병원 조회
 * 2. 각 병원에 대해 스코어링 실행
 * 3. AI 분석 메모 생성 (Claude API)
 * 4. 결과 저장
 * 5. 리드 자동 생성 (S/A)
 * 
 * 주의:
 * - Claude API 호출 간격: 500ms (rate limit 방지)
 * - 2,000건 × 500ms = ~17분 소요
 * - 진행률 표시 필요
 * - 중간에 끊겨도 재시작 가능 (이미 스코어링된 건 skip)
 */
```

---

## 9. 예상 등급 분포

```
전체 2,000건 기준 (이메일 보유 1,000건 가정):

이메일 있는 병원:
- S등급: ~50건 (5%)   → 즉시 리드 생성, 1순위 접촉
- A등급: ~150건 (15%) → 즉시 리드 생성, 2순위 접촉
- B등급: ~300건 (30%) → 대기, 수동 선별 가능
- C등급: ~500건 (50%) → 장기 육성 대상

이메일 없는 병원:
- 스코어링은 실행하되 리드 미생성
- 이메일 확보 후 리드 전환 가능

S+A = 약 200건 → 이게 첫 영업 대상
```

---

## 이 Phase 완료 후 상태

- `scoring_results` 테이블: 전 병원 스코어링 완료
- `leads` 테이블: S/A 등급 ~200건 자동 생성
- 각 리드에 AI 분석 메모 + 추천 메시지 방향 포함
- 가중치 v1.0 적용, 이후 조정 가능
- `/api/scoring/` API 작동
- → 다음: `04-EMAIL.md`
