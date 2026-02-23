# MADMEDSALES Admin 대시보드 전면 개편 — Claude Code 명령

## 사전 준비

이 프로젝트 루트에 `docs/ADMIN_DASHBOARD_SPEC.md` 파일을 먼저 읽어라.
이 파일이 없으면 아래 내용을 기반으로 작업해라.
프로젝트 경로: `C:\Users\J\Projects\madmedsales`

## 규칙

1. **매 Step 완료 후 `npm run build` 실행해서 빌드 성공 확인. 에러 있으면 반드시 수정 후 다음 Step으로.**
2. **기존 작동 중인 기능 절대 깨지 않게. 특히 비용 관리 페이지, 기존 병원 목록/상세 API.**
3. **Engine(localhost:8787)과 Admin(localhost:5181) 포트 기존 설정 유지.**
4. **TypeScript strict 모드 에러 0개 유지.**
5. **모든 새 컴포넌트는 기존 코드 스타일/패턴 따르기. 기존 파일 먼저 읽고 패턴 파악 후 작업.**

---

## Step 1: 사이드바 네비게이션 개편

기존 사이드바를 그룹별로 재구성해라.

```
MADMEDSALES

📊  대시보드          /dashboard

── 데이터 ─────────────
🏥  병원 DB           /hospitals
📡  크롤 관리         /crawls          ← 신규 페이지

── 영업 ───────────────
👤  리드              /leads           ← 비활성 (회색 텍스트 + 🔒)
📧  이메일            /emails          ← 비활성
📋  파이프라인        /pipeline        ← 비활성
📅  데모              /demos           ← 비활성

── 분석 ───────────────
💰  비용 관리         /costs           ← 기존 유지
📈  리포트            /reports         ← 비활성

── 시스템 ─────────────
⚙️  설정              /settings        ← 비활성
```

비활성 메뉴: 클릭하면 "이 기능은 Phase 3에서 활성화됩니다" 안내 페이지.
그룹 라벨(데이터, 영업, 분석, 시스템)은 작고 회색(#64748B)으로.

→ 빌드 확인

---

## Step 2: 대시보드 메인 전면 재설계

기존 대시보드 컴포넌트를 개편. 기존 `/api/reports/dashboard/stats` 엔드포인트를 확장하거나 새로 만들어라.

### 2-1. Engine API 수정

GET /api/dashboard/stats 응답에 아래 추가:

```typescript
{
  kpi: {
    totalHospitals: number,      // hospitals 테이블 COUNT
    profiledCount: number,       // hospital_profiles 테이블 COUNT  
    pendingCrawl: number,        // total - profiled
    weekCrawls: number           // crawl_snapshots WHERE created_at > 7일전
  },
  pipeline: {
    phase1_collected: number,    // = totalHospitals
    phase2_profiled: number,     // = profiledCount
    phase3_leads: 0,             // 아직 없음
    phase4_contacted: 0,
    phase5_responded: 0,
    phase6_contracted: 0
  },
  dataCollection: {
    withEquipment: { count: number, percentage: number },
    withTreatment: { count: number, percentage: number },
    withPricing: { count: number, percentage: number }
  },
  gradeDistribution: {
    PRIME: number, A: number, B: number, C: number, D: number
  },
  recentActivity: Array<{
    type: string,
    hospital: string,
    hospitalId: string,
    detail: string,
    time: string       // relative time "5분 전"
  }>,
  monthlyCost: {
    gemini: number,
    claude: number,
    total: number,
    budget: 1000000,
    percentage: number
  }
}
```

### 2-2. Admin 대시보드 레이아웃 (6개 위젯)

```
Row 1: KPI 카드 4개
  - 프로파일링 완료 (12 / 2,700) → 클릭 시 /hospitals?tab=profiled
  - 활성 리드 (0) → 클릭 시 /leads (Phase 3 안내)
  - 이번주 발송 (0) → 클릭 시 /emails (Phase 4 안내)
  - 데모 예정 (0) → 클릭 시 /demos (Phase 6 안내)

Row 2: 
  Left: 영업 퍼널 시각화 (수집 12505 → 분석 12 → 리드 0 → 접촉 0 → 반응 0 → 계약 0)
    - 수평 바 차트, 각 단계 라벨 + 숫자
    - Phase 3~6은 회색으로 "활성화 예정"
    - 병목 지점 강조 (분석 12 / 수집 12505 = 0.1% 전환율 빨간색)
  Right: 최근 활동 피드 (crawl_snapshots 기반 최신 10건)
    - "815의원 프로파일 완료 — PRIME등급, 80점 — 5분 전"
    - 각 항목 클릭 → /hospitals/:id

Row 3:
  Left: 이번달 AI 비용 (api_usage_logs 합계)
    - Gemini ₩123 / Claude ₩0 / 합계 ₩123
    - 프로그레스 바: ₩123 / ₩1,000,000 (0.01%)
    - 클릭 → /costs
  Right: 매칭 등급 분포 (PRIME/A/B/C/D 수평 바 차트)
    - 등급별 색상: PRIME #7C3AED, A #2563EB, B #059669, C #D97706, D #6B7280
```

디자인:
- 배경: #FAFBFC
- 카드: white, rounded-lg, shadow-sm, border border-gray-100
- 제목 폰트: font-bold text-lg text-gray-800
- KPI 숫자: font-bold text-3xl text-gray-900
- KPI 서브텍스트: text-sm text-gray-500

→ 빌드 확인

---

## Step 3: 병원 DB 목록 페이지 개편

### 3-1. Engine API 수정

GET /api/hospitals 에 status 쿼리 파라미터 추가:

```
GET /api/hospitals?status=profiled → hospital_profiles JOIN한 결과만
GET /api/hospitals?status=all → 기존과 동일 (전체)
```

profiled 결과에 포함할 필드:
- 기본: id, name, address, department, phone, email
- 추가: equipment_count, treatment_count, pricing_count, grade, total_score, last_crawl_date

grade는 hospital_profiles.profile_data에서 추출.
total_score도 profile_data에서 추출.
equipment/treatment/pricing count는 각 테이블 LEFT JOIN COUNT.

### 3-2. Admin 병원 목록

```
상단: 상태 카드 3개
  🟢 프로파일링 완료 (12건) — 클릭하면 profiled 탭 활성화
  🟡 크롤만 완료 (0건)
  ⚪ 미수집 (12,493건)

탭: [프로파일링 완료 12] [전체 병원 12,505]
기본 활성 탭: 프로파일링 완료

프로파일링 탭 테이블 컬럼:
  ☐ | 병원명 | 지역 | 과 | 장비 | 시술 | 가격 | 등급(배지) | 점수 | 크롤일

등급 배지 색상:
  PRIME: bg-purple-100 text-purple-700
  A: bg-blue-100 text-blue-700
  B: bg-green-100 text-green-700
  C: bg-amber-100 text-amber-700
  D: bg-gray-100 text-gray-500

정렬: [등급순] [점수순] [장비많은순] [시술많은순]
검색: 병원명 검색 (디바운스 300ms)

전체 병원 탭: 기존 테이블 유지, 프로파일링 완료 병원은 이름 옆에 🟢 점
```

체크박스 선택 시 하단에 일괄 액션 바:
- "N건 선택됨 | [🔄 크롤 재실행] [→ 리드로 전환]"
- 실제 기능은 Phase 3에서 구현, 지금은 버튼만 만들고 클릭 시 "준비 중" 토스트

→ 빌드 확인

---

## Step 4: 병원 상세 페이지 3탭 보강

### 4-1. Engine API 수정

GET /api/hospitals/:id 응답에 아래 추가 (또는 별도 엔드포인트):

```
GET /api/hospitals/:id/profile → {
  scores: {
    investment: { score: number, rationale: string },
    portfolio: { score: number, rationale: string },
    scale: { score: number, rationale: string },
    marketing: { score: number, rationale: string }
  },
  totalScore: number,
  grade: string,
  aiMemo: string,
  aiMemoModel: string,
  aiMemoDate: string,
  matching: {
    totalScore: number,
    angles: [
      { code: string, name: string, score: number, description: string }
    ],
    bestAngle: string,
    recommendedPitch: string
  }
}
```

이 데이터는 hospital_profiles.profile_data JSON과 crawl_snapshots.analysis_result에서 추출.
만약 profile_data에 rationale이 없으면, 장비/시술 데이터 기반으로 간단한 근거 문자열을 서버에서 생성:
- 투자성향: "보유 장비 N종, 고가장비 N종 (울쎄라, 인모드 등)"
- 포트폴리오: "시술 N종, 카테고리 N개 (리프팅 N, 피부 N, 레이저 N)"
- 시술규모: "총 시술 N종, 가격 공개 N건"
- 마케팅: "웹사이트 N페이지 크롤됨"

### 4-2. [탭1: 병원 프로필] 보강

기존 HospitalInfoTab에 추가:

1. **전화번호 포맷팅**: 표시할 때만 하이픈 삽입 (DB 원본 유지)
```typescript
function formatPhoneNumber(raw: string): string {
  const cleaned = raw.replace(/\D/g, '');
  if (cleaned.startsWith('02')) {
    if (cleaned.length === 9) return cleaned.replace(/(\d{2})(\d{3})(\d{4})/, '$1-$2-$3');
    if (cleaned.length === 10) return cleaned.replace(/(\d{2})(\d{4})(\d{4})/, '$1-$2-$3');
  }
  if (cleaned.startsWith('01')) {
    if (cleaned.length === 10) return cleaned.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
    if (cleaned.length === 11) return cleaned.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3');
  }
  if (cleaned.length === 10) return cleaned.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
  if (cleaned.length === 11) return cleaned.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3');
  return raw;
}
```

2. **4축 점수 바 차트 + 종합점수 + 등급 배지**
   - 각 축: 라벨 | 프로그레스 바 | 점수
   - 종합: "80점 PRIME등급"

3. **점수 산출 근거 아코디언**
   - 각 축 클릭하면 펼쳐짐
   - 내용: "판단 근거" + "영업 시사점"
   - 화살표 ▶(접힘) ▼(펼침) 토글

4. **AI 영업 분석 메모 카드**
   - 분석 메모 텍스트
   - 하단: 모델명 + 날짜 + [🔄 재생성] 버튼 (비활성, "준비 중" 토스트)

5. **[→ 리드로 전환] 버튼** 상단 우측에 배치 (비활성, "Phase 3" 토스트)

### 4-3. [탭2: 수집 데이터] 보강

기존 HospitalDataTab에 추가:

1. **장비를 카테고리별 그룹핑** (리프팅/레이저/IPL/RF/기타)
   - 카테고리 헤더 클릭하면 접기/펼치기
   - 각 장비: 장비명 | 브랜드 | 분류 | 확인(✅)/추정(⚠️) | 등급(프리미엄/중급/일반)

2. **🔴 TORR RF 영업 포인트 하이라이트 박스** (장비 섹션 최상단)
   - 빨간 테두리 또는 빨간 배경 카드
   - 내용: RF 장비 보유 현황 + 영업 앵글 요약
   - 예: "RF 장비 2종 보유 (써마지, 올리지오) → 기존 RF 대비 차별점 앵글 유효"
   - RF 장비 없으면: "RF 장비 미보유 → 신규 도입 앵글로 접근"

3. **시술도 카테고리별 그룹핑** (리프팅/피부/레이저/쁘띠/체형/기타)

4. **가격**: 있으면 테이블, 없으면 "이 병원은 웹사이트에 가격을 공개하지 않습니다" 안내

### 4-4. [탭3: 분석 결과] 보강

기존 HospitalAnalysisTab에 추가:

1. **제품 매칭 분석 카드**
   - 종합 매칭 점수 + 등급
   - 최적 앵글 강조 표시
   - 5앵글 수평 바 차트: Bridge/수술후/남성/무통/바디
   - 각 바 옆에 한줄 설명
   
2. **추천 이메일 피치** 텍스트 박스
   - profile_data의 matching 데이터에서 추출
   - 없으면 "프로파일링 데이터 기반으로 생성 예정" 표시

3. **크롤 히스토리**
   - crawl_snapshots 테이블에서 이 병원의 크롤 이력
   - 각 크롤: 날짜 | 방식 | 페이지수 | 용량 | 장비/시술/가격 추출수 | 상태
   - [🔄 크롤 재실행] 버튼 (비활성)

→ 빌드 확인

---

## Step 5: 크롤 관리 페이지 (신규)

### 5-1. Engine API

```
GET /api/crawls/stats → {
  totalCrawls: number,
  successCount: number,
  failCount: number,
  avgDuration: string,
  totalCost: number
}

GET /api/crawls?page=1&limit=20 → {
  data: Array<{
    id: string,
    hospitalName: string,
    hospitalId: string,
    crawlDate: string,
    method: string,       // "firecrawl" | "playwright"
    pageCount: number,
    markdownSize: number,
    equipmentCount: number,
    treatmentCount: number,
    pricingCount: number,
    cost: number,
    status: string        // "success" | "failed"
  }>,
  pagination: { page, limit, total, totalPages }
}
```

crawl_snapshots 테이블에서 JOIN해서 가져오기.

### 5-2. Admin 크롤 관리 페이지

```
/crawls 라우트 추가

상단: KPI 카드 4개 (총 크롤, 성공률, 평균소요, 총비용)

테이블: 병원명 | 일시 | 방식 | 페이지 | 장비/시술/가격 | 비용 | 상태
  - 병원명 클릭 → /hospitals/:id
  - 상태: ✅ 성공 / ❌ 실패

하단: 크롤 스케줄 안내 카드
  - "MADMEDSALES: 매월 1, 8, 15, 22, 29일 자동 실행"
  - "다음 실행: (다음 스케줄 날짜)"
  - "대상: 상위 2,700개 병원"
  - "예상 비용: ₩40,000"

인프라 상태 카드:
  - Oracle VM: ❌ 미생성
  - Firecrawl: ⚠️ 클라우드 크레딧 사용 중
  - Gemini API: ✅ 정상
```

→ 빌드 확인

---

## Step 6: 전체 디자인 통일

모든 페이지에 디자인 시스템 적용:

컬러:
- 배경: #FAFBFC (bg-gray-50)
- 카드: white, border-gray-100, shadow-sm, rounded-lg
- 사이드바: bg-slate-900 (어두운 네이비)
- 사이드바 텍스트: text-gray-300, 활성: text-white bg-slate-700
- 메인 텍스트: text-slate-800
- 보조 텍스트: text-slate-500
- 브랜드: indigo-600 (#4F46E5)

등급 배지:
- PRIME: bg-purple-50 text-purple-700 border-purple-200
- A: bg-blue-50 text-blue-700 border-blue-200
- B: bg-green-50 text-green-700 border-green-200
- C: bg-amber-50 text-amber-700 border-amber-200
- D: bg-gray-50 text-gray-500 border-gray-200

→ 최종 빌드 확인
→ admin dev 서버 실행해서 각 페이지 정상 렌더링 확인
→ 에러 콘솔 확인해서 warning/error 0개 달성

---

## 최종 체크리스트

완료 후 아래 항목 모두 확인:

- [ ] `npm run build` 에러 0개 (engine + admin 둘 다)
- [ ] /dashboard — 6개 위젯 정상 표시, 실제 DB 데이터 반영
- [ ] /hospitals — 탭 전환 정상, 프로파일링 탭에 등급/점수 표시
- [ ] /hospitals/:id — 3탭 모두 정상, 전화번호 포맷, 점수 근거 아코디언
- [ ] /crawls — 신규 페이지 정상, 크롤 내역 테이블
- [ ] /costs — 기존 기능 깨지지 않음
- [ ] 사이드바 — 그룹핑 + 비활성 메뉴 정상
- [ ] 비활성 메뉴 클릭 시 안내 페이지 표시
- [ ] TypeScript 에러 0개
- [ ] 콘솔 에러/경고 0개
