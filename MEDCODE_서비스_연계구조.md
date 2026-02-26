# MEDCODE 서비스 연계구조

> **회사명**: MEDCODE (사업자등록 완료)  
> **작성일**: 2026-02-26  
> **목적**: MADMEDCHECK & MADMEDSALES 두 서비스 간 데이터·인프라·비즈니스 연계구조를 정의한다.  
> **용도**: Claude Code 개발 시 맥락 공유 문서. 두 서비스 모두 이 문서를 기준으로 아키텍처 결정을 내린다.

---

## 1. MEDCODE 전체 구조

```
MEDCODE (운영사 · 사업자등록 완료)
│
├── MADMEDCHECK (madmedcheck.com) ✅ 도메인 보유
│   └── 병원 대상 온라인 진단 SaaS
│       ├── 의료광고 위반 탐지 (Ad MedCheck)
│       ├── AEO/GEO 최적화 분석 (AG MedCheck)
│       └── 바이럴 마케팅 모니터링 (Viral MedCheck)
│
├── MADMEDSALES (madmedsales.com) 🔴 도메인 구매 필요
│   └── 의료기기 영업 자동화 SaaS
│       ├── 병원 프로파일링 (4축 스코어링)
│       ├── 세일즈 앵글 매칭 (5카테고리)
│       ├── AI 콜드메일 자동화
│       └── CRM (납품처 관리)
│
└── (향후 서비스 확장 가능)
```

**핵심 원칙**: 두 서비스는 독립 브랜드로 운영하되, 내부적으로 인프라와 데이터를 공유하여 비용을 최소화하고 시너지를 극대화한다.

---

## 2. 왜 연계가 중요한가

MADMEDCHECK와 MADMEDSALES는 **같은 대상(한국 병원)을 다른 목적으로 분석**한다.

| 구분 | MADMEDCHECK | MADMEDSALES |
|------|-------------|-------------|
| **고객** | 병원 (B2C) | 의료기기 회사 (B2B) |
| **분석 대상** | 병원 홈페이지 | 병원 홈페이지 |
| **핵심 가치** | 광고 위반 탐지, AI 검색 경쟁력 | 장비/시술/가격 프로파일링 |
| **수익 모델** | 구독형 SaaS (병원이 비용 지불) | 구독형 SaaS (기기 회사가 비용 지불) |

**공통점**: 둘 다 병원 홈페이지를 크롤링하고 AI로 분석한다. 크롤링 인프라, 병원 DB, AI 분석 파이프라인을 공유하면 비용이 절반으로 준다.

---

## 3. 공유 인프라

### 3-1. 크롤링 서버 (단일 서버, 두 서비스 공유)

```
Contabo VPS (도쿄) — $10.75/월
├── Firecrawl 셀프호스팅 (Docker)
├── Playwright (OCR 스크린샷용)
└── MADMEDCHECK + MADMEDSALES 모두 이 서버를 사용
```

**크롤링 스케줄 (서버 유휴 방지)**:
```
MADMEDSALES: 1, 8, 15, 22, 29일 새벽 2시
MADMEDCHECK: 4, 11, 18, 25일 새벽 2시
→ 최대 유휴 간격 3~4일
→ 하나의 서버를 두 서비스가 번갈아 사용
```

### 3-2. 데이터베이스

```
Supabase (공유 인스턴스)
├── MADMEDCHECK 테이블들
│   ├── hospitals (병원 기본정보 — 공통 참조)
│   ├── analysis_results (위반 분석 결과)
│   ├── aeo_scores (AI 검색 경쟁력 점수)
│   └── viral_monitors (바이럴 모니터링)
│
├── MADMEDSALES 테이블들
│   ├── hospitals (동일 테이블 참조)
│   ├── hospital_profiles (4축 프로파일링 결과)
│   ├── sales_angles (세일즈 앵글 매칭)
│   ├── equipment_history (장비 변동 이력)
│   ├── price_history (시술/가격 변동)
│   └── email_campaigns (콜드메일 이력)
│
└── 공통 테이블
    ├── hospitals (2,772건 — 양쪽이 공유)
    ├── crawl_snapshots (크롤링 원본 데이터)
    └── device_dictionary (장비 사전 v1.4)
```

**중요**: hospitals 테이블은 양쪽 서비스가 같이 쓴다. 병원 기본정보(이름, 주소, 전화번호, 홈페이지 URL)는 한 번만 수집하면 된다.

### 3-3. AI 분석

| 용도 | 모델 | 비용 | 사용 서비스 |
|------|------|------|------------|
| 병원 홈페이지 분석 (텍스트+이미지) | Gemini 2.5 Flash | ₩700/1000건 | 양쪽 공유 |
| 의료광고 위반 판단 | Gemini 2.5 Flash | 위와 동일 | MADMEDCHECK |
| 콜드메일 생성 | Claude Haiku | 별도 | MADMEDSALES |
| 이미지 OCR | Playwright + Gemini | 양쪽 공유 | 양쪽 공유 |

### 3-4. 배포 인프라

| 서비스 | 프론트엔드 | 백엔드 | 도메인 |
|--------|-----------|--------|--------|
| MADMEDCHECK | Cloudflare Pages | Cloudflare Workers | madmedcheck.com |
| MADMEDSALES | Cloudflare Pages | Cloudflare Workers | madmedsales.com |
| 크롤링 서버 | — | Contabo VPS | (내부용) |
| DB | — | Supabase | (내부용) |

---

## 4. 데이터 흐름 — 크롤링부터 최종 출력까지

```
[병원 홈페이지 URL]
        │
        ▼
┌──────────────────────────────┐
│  Phase 1: 크롤링 (공유)       │
│  Firecrawl → Markdown + 스크린샷 │
│  저장: Supabase crawl_snapshots  │
└──────────────┬───────────────┘
               │
       ┌───────┴───────┐
       ▼               ▼
┌─────────────┐ ┌──────────────┐
│ MADMEDCHECK │ │ MADMEDSALES  │
│ 분석 파이프라인│ │ 분석 파이프라인 │
├─────────────┤ ├──────────────┤
│ 위반 패턴    │ │ 장비 추출     │
│ (156개 규칙) │ │ 시술/가격 추출 │
│ OCR 분석     │ │ 의사 정보     │
│ AEO 채점     │ │ 4축 스코어링   │
│ 바이럴 감지   │ │ 5앵글 매칭    │
└──────┬──────┘ └──────┬───────┘
       │               │
       ▼               ▼
┌─────────────┐ ┌──────────────┐
│ 병원 리포트  │ │ 영업 브리핑   │
│ (B2C)       │ │ (B2B)        │
└─────────────┘ └──────────────┘
```

**핵심**: Phase 1(크롤링)은 한 번만 실행하고, 그 결과를 양쪽 서비스가 각자 목적에 맞게 분석한다. 같은 병원을 두 번 크롤링할 필요가 없다.

---

## 5. 비즈니스 시너지

### 5-1. MADMEDSALES → MADMEDCHECK 데이터 기여

MADMEDSALES가 49개(향후 2,700개) 병원을 프로파일링하면서 수집하는 데이터:
- 병원별 보유 장비 목록
- 시술 메뉴 및 가격
- 의사 정보
- 이벤트/마케팅 활동

이 데이터는 MADMEDCHECK의 **AEO/GEO 분석**과 **바이럴 모니터링**에 직접 활용 가능하다.

### 5-2. MADMEDCHECK → MADMEDSALES 데이터 기여

MADMEDCHECK가 병원을 분석하면서 발견하는 데이터:
- 의료광고 위반 현황 (청정도 등급)
- 학술활동 점수
- 온라인 마케팅 활성도

이 데이터는 MADMEDSALES의 **Marketing 축 스코어링**에 활용 가능하다. 예를 들어, 광고를 공격적으로 하는 병원은 마케팅 점수가 높고, TORR RF 영업 시 "마케팅 도구"로 포지셔닝할 수 있다.

### 5-3. CRM 부가 서비스

MADMEDSALES CRM에서 의료기기 회사(예: BRITZMEDI)의 납품 병원에게 **MADMEDCHECK 리포트를 부가 서비스로 제공**할 수 있다. 이렇게 하면:
- 의료기기 회사: 고객 병원에 추가 가치를 제공 → 이탈 방지
- 병원: 광고 위반 진단을 무료로 받음 → MADMEDCHECK 브랜드 노출
- MEDCODE: 양쪽 서비스의 사용자 확보

---

## 6. MADMEDCHECK 현재 상태 및 재개 계획

### 6-1. 현재 상태 (2026-02-26 기준)

| 컴포넌트 | 상태 | 비고 |
|----------|------|------|
| medcheck-scv (크롤러) | ⚠️ 로컬 의존 | Puppeteer 기반, PC 켜야 동작 |
| medcheck-engine (분석엔진) | ⚠️ 껍데기 | API 50개 있지만 핵심 analyzer.ts 미구현 |
| 위반 패턴 DB | ✅ 156개 | 보건복지부 가이드라인 기반 |
| 대시보드 | ✅ UI 완성 | 데이터 연결 부분 미완 |
| OCR | ⚠️ 미구현 | Gemini Flash 선정까지는 완료 |
| AEO/GEO 분석 | ❌ 미착수 | |
| 바이럴 모니터링 | ❌ 미착수 | |

### 6-2. 중단 원인 및 해결

**중단 원인**: Firecrawl Cloud 비용 ($83/월)이 부담되어 크롤링 자체를 못 하고 있었음.

**해결**: Contabo VPS에 Firecrawl 셀프호스팅으로 크롤링 비용 ₩0 달성. MADMEDSALES에서 이미 검증 완료 (52개 병원 100% 성공).

### 6-3. MADMEDCHECK에서 활용할 MADMEDSALES 성과

MADMEDSALES v5.6에서 이미 해결한 것들을 MADMEDCHECK에 그대로 가져올 수 있다:

| MADMEDSALES 성과 | MADMEDCHECK 적용 |
|-----------------|-----------------|
| Firecrawl 셀프호스팅 + 크롤링 스케줄 | 크롤링 인프라 공유 |
| Gemini 2.5 Flash OCR (시술 1→129건) | 병원 이미지에서 위반 텍스트 추출 |
| 스마트 정렬 (페이지 우선순위화) | 분석 대상 페이지 우선순위화 |
| JSON 잘림 복구 (repairTruncatedJson) | 대형 병원 분석 시 동일 문제 방지 |
| 장비 사전 v1.4 (452 normMap) | 병원 프로파일 보강 데이터 |

---

## 7. 기술 레포지토리 구조

```
GitHub (MEDCODE org 또는 개인)
│
├── madmedcheck/
│   ├── medcheck-scv/          ← 크롤러 (SCV = 일꾼)
│   ├── medcheck-engine/       ← 분석엔진 (두뇌)
│   ├── ad-medcheck/           ← 의료광고위반 서비스 (프론트+대시보드)
│   ├── ag-medcheck/           ← AEO/GEO 분석 (향후)
│   └── viral-medcheck/        ← 바이럴 모니터링 (향후)
│
├── madmedsales/
│   ├── scripts/               ← 크롤링/분석 파이프라인
│   │   ├── recrawl-v5.ts      ← 메인 파이프라인 (OCR 통합 완료)
│   │   ├── v57-batch-analyze.ts
│   │   ├── v57-sales-scoring.ts
│   │   └── crawler/           ← 장비 사전, 로더
│   ├── snapshots/             ← 크롤링 원본 데이터
│   └── output/                ← 분석 결과 JSON
│
└── (공유 인프라는 Contabo VPS + Supabase로 코드 외부에 존재)
```

---

## 8. MADMEDCHECK 재개 시 첫 번째 할 일

### 우선순위 1: 크롤링 연결

medcheck-scv의 크롤링을 **Contabo VPS의 Firecrawl**로 전환한다. 기존 로컬 Puppeteer 의존을 끊고, MADMEDSALES와 동일한 Firecrawl API를 호출하도록 변경.

```
기존: medcheck-scv → 로컬 Puppeteer → 불안정
변경: medcheck-scv → Contabo Firecrawl API → 안정 + MADMEDSALES와 공유
```

### 우선순위 2: 분석엔진 실체 확보

현재 medcheck-engine의 핵심 analyzer.ts가 껍데기 상태. "위반 패턴 156개"는 데이터로 있지만, 이를 실제 텍스트에 적용하여 맥락까지 판단하는 분석기가 미구현.

**검증 방법**: 하나의 병원 URL → 크롤링 → 분석 → 등급 판정까지 한 줄기가 돌아가는지 확인. 이게 안 되면 나머지는 의미 없음.

### 우선순위 3: OCR 파이프라인 이식

MADMEDSALES에서 검증된 Playwright + Gemini 2.5 Flash OCR을 medcheck-engine에 통합. 이미지로 된 광고 콘텐츠(시술 전후 사진, 가격표 이미지 등)에서 텍스트를 추출하여 위반 판단에 활용.

---

## 9. 비용 구조 (두 서비스 합산)

| 항목 | 월 비용 | 비고 |
|------|---------|------|
| Contabo VPS (크롤링 서버) | ₩15,000 | 두 서비스 공유 |
| Gemini 2.5 Flash (AI 분석) | ₩5,000~15,000 | 병원 수에 비례 |
| Supabase | ₩0 (Free) ~ ₩30,000 (Pro) | 트래픽에 따라 |
| Cloudflare (Pages + Workers) | ₩0 (Free) | 무료 플랜 충분 |
| **합계** | **₩20,000~60,000/월** | 두 서비스 합산 |

MADMEDSALES 단독이었을 때와 비교하면, MADMEDCHECK를 추가 운영하는 데 드는 **추가 비용은 거의 0**이다. 크롤링 서버와 AI 분석을 공유하기 때문.

---

## 10. 핵심 철칙 (MEDCODE 전사 원칙)

```
1. 해외에서 개인이 아무런 도움도 받지 않고 서울에 찾아와서
   피부과 시술을 안전하게 받고, 바가지 안쓰고
   좋은 기억으로 돌아갈 수 있도록 한다.

2. 돌아가서도 사후 관리를 체계적으로 수행해서
   6개월, 1년 뒤에 다시 재방문 할 수 있도록 신경쓴다.

3. 시스템의 구현에 있어서 반복적이고 단순한 이슈들은
   자동화할 수 있게 설계한다.
```

**사업 철학**: "이건 신뢰의 비즈니스다. 우리 시스템에 들어온 병원의 수가 많은 게 중요한 게 아니라, 믿을 만한 시스템을 갖춘 병원이 하나라도 제대로 있느냐의 문제다."

---

## 11. 이 문서의 활용법

**MADMEDCHECK 개발 시 Claude Code에게 이렇게 전달**:

```
이 문서를 읽고 MEDCODE의 서비스 구조를 파악해.
MADMEDCHECK는 MADMEDSALES와 크롤링 인프라(Contabo VPS Firecrawl)와
병원 DB(Supabase)를 공유해.
MADMEDSALES에서 이미 검증된 기술(OCR, 스마트 정렬, JSON 복구)을 
적극적으로 참고해서 개발해.
```

**MADMEDSALES 개발 시에도 이 문서를 참조**:
- hospitals 테이블 스키마 변경 시 양쪽 영향 확인
- 크롤링 스케줄 변경 시 MADMEDCHECK 일정과 충돌 확인
- 새로운 분석 기능 추가 시 반대쪽 서비스에서도 활용 가능한지 검토
