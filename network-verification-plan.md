# 🏥 피부과 네트워크/체인 검증 시스템 기획서
**프로젝트:** MADMEDSALES v3.1
**작성일:** 2026-02-23
**목적:** 피부과 프랜차이즈/네트워크 소속 병원을 정확하게 식별하고 관리

---

## 1. 왜 이게 중요한가

### 영업 관점
- **체인 본부 1곳 설득 = 전 지점 도입 가능성.** 휴먼피부과가 15개 지점이면, 본부 계약 1건 = 장비 15대
- **지점별 개별 영업은 비효율.** 체인 소속인 줄 모르고 지점마다 따로 접근하면 시간 낭비
- **구매 의사결정 구조가 다름.** 독립 병원은 원장이 결정, 체인은 본부 승인 필요
- **경쟁사 장비 현황 파악.** A체인 전 지점이 경쟁사 장비 쓰면 → 전환 기회 or 회피 판단

### 현재 문제
```
"휴먼" 키워드 매칭 결과:
  ✅ 광명휴먼피부과 → 휴먼피부과 네트워크 실제 지점
  ✅ 동탄휴먼피부과 → 휴먼피부과 네트워크 실제 지점
  ❌ 파스텔휴먼피부과 → 관계 없는 독립 병원 (오탐)
  ❌ 모건휴먼피부과 → 관계 없는 독립 병원 (오탐)
```
키워드만으로는 **오탐(false positive)이 30~50%** 발생 추정

---

## 2. 검증 대상 규모

### 한국 피부과 주요 체인/네트워크 (추정)

| 규모 | 브랜드 수 | 예시 | 총 지점 수 |
|------|----------|------|-----------|
| 대형 (10개+ 지점) | ~10개 | 아이디, 에이치, 연세스타, 라파엘, 뷰티인, 린, 리안, 맥스웰, 프레시안, 휴먼 | ~200개+ |
| 중형 (5~9개 지점) | ~15개 | | ~100개 |
| 소형 (2~4개 지점) | ~30개+ | | ~80개 |
| **합계** | **~55개** | | **~380개+** |

→ 12,505개 전체 병원 중 약 3% 정도가 체인 소속이지만, **영업 가치는 30% 이상**

---

## 3. 검증 방법론: 4단계 신뢰도 체계

하나의 방법에 의존하지 않고, **여러 소스를 교차 검증**해서 신뢰도 등급을 매김.

```
[1단계] 공식 사이트 크롤링 ─── 신뢰도 ★★★★★ (확정)
    +
[2단계] 도메인 패턴 분석 ───── 신뢰도 ★★★★☆ (높음)
    +
[3단계] 사업자등록 법인 대조 ── 신뢰도 ★★★★☆ (높음)
    +
[4단계] 키워드 매칭 ────────── 신뢰도 ★★☆☆☆ (후보)
    ↓
[종합] 복합 신뢰도 점수 → 자동 확정 or 수동 검토 대기
```

### 3-1. [1단계] 공식 사이트 크롤링 — 확정 레벨

**원리:** 대부분의 체인은 공식 사이트에 "지점 안내" 페이지가 있음. 여기 나오면 100% 확정.

**방법:**
1. 각 브랜드 본원 공식 사이트 URL 수집 (수동 1회)
2. "지점안내", "네트워크", "전국매장" 등의 페이지를 Firecrawl로 크롤링
3. 지점명 + 주소 + 전화번호 추출
4. 추출 결과를 DB에 저장 → 신뢰도 "confirmed"

**한계:**
- 휴먼피부과처럼 SSL 인증서 깨진 사이트도 있음 → HTTP 폴백 또는 검색엔진 캐시 활용
- 일부 체인은 지점안내 페이지 자체가 없음 → 2~3단계로 보완
- 크롤링 주기: 월 1회 (지점 추가/폐업 반영)

**데이터 예시:**
```json
{
  "brand": "휴먼피부과",
  "source": "official_site",
  "source_url": "https://www.skinhm.co.kr/page/humanys",
  "branches": [
    { "name": "광명휴먼피부과", "address": "경기도 광명시...", "domain": "gmhuman.co.kr" },
    { "name": "동탄휴먼피부과", "address": "경기도 화성시...", "domain": "humandt.co.kr" }
  ],
  "verified_at": "2026-02-23",
  "confidence": "confirmed"
}
```

### 3-2. [2단계] 도메인 패턴 분석 — 높은 신뢰도

**원리:** 같은 네트워크 지점들은 도메인 패턴이 비슷한 경향이 있음.

**휴먼피부과 실제 사례:**
```
패턴 발견:
  gmhuman.co.kr    (광명)
  humansnu.co.kr   (서울대)
  yshuman.co.kr    (용산)
  humanep.co.kr    (은평)
  humandt.co.kr    (동탄)
  humanpt.co.kr    (평택)
  humanic.co.kr    (청라)
  humanuj.co.kr    (의정부)
  humanca.co.kr    (천안)

공통점: 도메인에 "human" 포함 + .co.kr + 지역 약자 접두/접미
```

**방법:**
1. 같은 브랜드 키워드를 가진 병원들의 홈페이지 URL 수집
2. 도메인 패턴 분석 (공통 키워드, 등록기관, 네임서버 등)
3. 패턴 일치도가 높으면 → 신뢰도 "high"
4. 패턴 불일치 → "candidate"로 남김

**자동화 가능한 패턴 체크:**
| 체크 항목 | 점수 |
|----------|------|
| 도메인에 브랜드 키워드 포함 | +30 |
| 도메인 등록기관(registrar) 동일 | +20 |
| 네임서버 동일 | +20 |
| WHOIS 등록자 정보 유사 | +15 |
| 웹사이트 디자인/템플릿 동일 | +15 |
| **60점 이상** | **→ 신뢰도 "high"** |
| **40~59점** | **→ 신뢰도 "medium"** |
| **39점 이하** | **→ 신뢰도 "low"** |

### 3-3. [3단계] 사업자등록 법인 대조 — 높은 신뢰도

**원리:** 같은 체인이면 법인명이 같거나, 대표자가 같거나, 법인번호가 연관됨.

**데이터 소스:**
- 심평원 API: 개설자명(대표 의사) 정보 제공
- 국세청 사업자등록 조회: 사업자번호로 법인 확인
- 크롤링 데이터: 병원 홈페이지 하단 사업자정보

**방법:**
1. 같은 브랜드 키워드 병원들의 대표자명/법인명 비교
2. 대표자명 동일 → +40점
3. 법인명에 공통 키워드 → +30점
4. 사업자번호 연번(연속된 번호) → +20점

**예시:**
```
✅ 네트워크 소속 패턴:
  - 광명휴먼피부과: 대표 홍길동 / (주)휴먼메디컬그룹
  - 동탄휴먼피부과: 대표 김철수 / (주)휴먼메디컬그룹  ← 법인명 동일!

❌ 독립 병원 패턴:
  - 파스텔휴먼피부과: 대표 이영희 / 파스텔의원  ← 법인명 완전히 다름
```

### 3-4. [4단계] 키워드 매칭 — 후보 레벨

**현재 방식. 가장 쉽지만 오탐이 많음.**

**개선된 키워드 매칭 규칙:**
```
매칭 점수 계산:

[높은 점수]
- 브랜드명이 병원명 앞에 위치: "휴먼피부과 ○○점" → +40점
- "○○점", "○○지점", "○○원" 패턴 포함 → +30점
  
[낮은 점수]  
- 브랜드 키워드가 중간에 끼인 경우: "파스텔휴먼피부과" → +10점
- 브랜드명 + 완전히 다른 수식어: "모건휴먼" → +5점

[감점]
- 브랜드명 앞에 의미 있는 다른 단어가 붙음 → -20점
  예: "파스텔" + "휴먼" → 파스텔이 독립 브랜드일 가능성
```

---

## 4. 복합 신뢰도 점수 & 자동 판정

### 점수 합산

```
최종 신뢰도 = 공식사이트(0~100) + 도메인패턴(0~100) + 법인대조(0~100) + 키워드(0~100)
                    ↓
              가중평균 (4:3:3:1)
```

| 합산 점수 | 판정 | 처리 |
|----------|------|------|
| 80~100 | ✅ **confirmed** (확정) | 자동으로 네트워크 소속 등록 |
| 50~79 | 🟡 **probable** (유력) | admin에서 1클릭 승인/거부 |
| 20~49 | 🟠 **candidate** (후보) | admin에서 수동 검토 |
| 0~19 | ❌ **unlikely** (미해당) | 독립 병원으로 분류 |

### 자동 확정 조건 (수동 검토 없이 바로 확정)
- 공식 사이트 지점 목록에 있음 → 무조건 confirmed
- 도메인 패턴 + 법인명 둘 다 일치 → confirmed
- 3개 소스 이상에서 일치 → confirmed

---

## 5. DB 스키마

### networks 테이블 (브랜드/체인 마스터)
```sql
CREATE TABLE networks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,               -- '휴먼피부과'
  official_name TEXT,                -- '(주)휴먼메디컬그룹'
  headquarter_hospital_id UUID,      -- 본원 hospitals 테이블 FK
  official_site_url TEXT,            -- 'https://www.skinhm.co.kr'
  branch_page_url TEXT,              -- 지점안내 페이지 URL
  total_branches INTEGER DEFAULT 0,
  category TEXT DEFAULT 'franchise', -- franchise | network | group
  status TEXT DEFAULT 'active',      -- active | inactive | unverified
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### network_branches 테이블 (지점 매핑)
```sql
CREATE TABLE network_branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id UUID REFERENCES networks(id),
  hospital_id UUID REFERENCES hospitals(id),
  branch_name TEXT,                  -- '광명휴먼피부과'
  role TEXT DEFAULT 'branch',        -- headquarter | branch
  
  -- 검증 관련
  confidence TEXT DEFAULT 'candidate', -- confirmed | probable | candidate | unlikely
  confidence_score INTEGER DEFAULT 0,  -- 0~100 복합 점수
  
  -- 각 검증 소스별 결과
  official_site_verified BOOLEAN DEFAULT false,
  domain_pattern_score INTEGER DEFAULT 0,
  corporate_match_score INTEGER DEFAULT 0,
  keyword_match_score INTEGER DEFAULT 0,
  
  verified_at TIMESTAMPTZ,
  verified_by TEXT,                   -- 'auto' | 'manual'
  verification_notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### network_verification_logs 테이블 (검증 이력)
```sql
CREATE TABLE network_verification_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id UUID REFERENCES networks(id),
  branch_id UUID REFERENCES network_branches(id),
  verification_method TEXT,          -- official_site | domain_pattern | corporate | keyword
  result TEXT,                       -- match | no_match | error | inconclusive
  detail JSONB,                      -- 검증 세부 데이터
  created_at TIMESTAMPTZ DEFAULT now()
);
```

---

## 6. 검증 파이프라인 흐름

```
[수동 1회] TOP 브랜드 시드 데이터 입력
    │      - 브랜드명, 공식사이트 URL, 지점안내 페이지 URL
    │      - 처음에 대형 10~15개만
    ↓
[자동] 공식 사이트 크롤링 (월 1회)
    │      - Firecrawl로 지점안내 페이지 크롤링
    │      - AI가 지점명 + 주소 + 도메인 추출
    │      - → network_branches에 confidence "confirmed"로 저장
    ↓
[자동] 전체 병원 DB 스캔
    │      - 12,505개 병원명에서 브랜드 키워드 매칭
    │      - 공식 지점 목록에 없는 "후보" 발견
    │      - → 도메인 패턴 분석 실행
    │      - → 법인 대조 실행 (데이터 있으면)
    │      - → 복합 점수 계산
    ↓
[자동] 판정
    │      - 80점+ → 자동 confirmed
    │      - 50~79 → probable (admin 검토 대기)
    │      - 20~49 → candidate (admin 검토 대기)
    │      - 19점- → unlikely (독립 병원)
    ↓
[수동] admin 대시보드에서 검토
           - probable/candidate 목록 표시
           - 1클릭 승인/거부
           - 거부 시 사유 입력 (향후 학습용)
```

---

## 7. admin 대시보드 UI

### 네트워크 관리 탭

```
┌─────────────────────────────────────────────────────────┐
│  🏥 네트워크/체인 관리                                    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  [전체 39] [확인됨 15] [검토 대기 24]                     │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │ 휴먼피부과        지점 15개  ✅ confirmed         │    │
│  │ 아이디피부과       지점 22개  ✅ confirmed         │    │
│  │ 연세스타피부과     지점 12개  ✅ confirmed         │    │
│  │ ─────────────────────────────────────────────── │    │
│  │ 뷰티인피부과       지점 8개   🟡 검토 대기 3건     │    │
│  │ 라파엘피부과       지점 6개   🟡 검토 대기 1건     │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 지점 검증 상세 뷰

```
┌─────────────────────────────────────────────────────────┐
│  휴먼피부과 네트워크 — 지점 상세                           │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ✅ 확인된 지점 (15개)                                    │
│  ┌─────────┬──────────────┬──────────┬──────────┐       │
│  │ 지점명   │ 도메인        │ 검증방법  │ 확인일   │       │
│  ├─────────┼──────────────┼──────────┼──────────┤       │
│  │ 광명     │ gmhuman.co.kr │ 공식사이트│ 02/23   │       │
│  │ 동탄     │ humandt.co.kr │ 공식사이트│ 02/23   │       │
│  │ 용산     │ yshuman.co.kr │ 공식+도메인│ 02/23  │       │
│  └─────────┴──────────────┴──────────┴──────────┘       │
│                                                         │
│  🟡 검토 대기 (2개)                     종합점수          │
│  ┌─────────────────────────────────┬──────────┐         │
│  │ 파스텔휴먼피부과                  │ 15점 ❌  │ [거부] │
│  │  공식사이트: ✗  도메인: ✗         │          │        │
│  │  법인: ✗  키워드: △ (+15)         │          │        │
│  ├─────────────────────────────────┼──────────┤         │
│  │ 강서휴먼피부과                    │ 72점 🟡  │ [승인] │
│  │  공식사이트: ✗  도메인: ✓ (+60)   │          │        │
│  │  법인: △ (+30)  키워드: ✓ (+40)   │          │        │
│  └─────────────────────────────────┴──────────┘         │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 8. 영업 활용 시나리오

### 시나리오 A: 체인 본부 공략
```
대시보드에서 확인:
  "휴먼피부과 네트워크: 15개 지점"
  "현재 TORR RF 도입: 0개 지점"
  "경쟁사 장비: 2개 지점에서 S사 RF 사용"
    ↓
영업 전략:
  본부 담당자에게 접근 → 전 지점 도입 제안
  추천 앵글: bridge_care (시술 간 관리 표준화)
  예상 계약: 장비 15대 (본부 일괄 구매)
```

### 시나리오 B: 경쟁 체인 분석
```
대시보드에서 확인:
  "아이디피부과 22개 지점 중 10개 지점이 C사 장비 사용"
  "계약 만료 추정: 2026년 하반기"
    ↓
영업 전략:
  계약 만료 6개월 전부터 본부 접근
  추천 앵글: post_op_care (시술 후 관리 차별화)
```

### 시나리오 C: 체인 확장 감지
```
시그널 감지:
  "연세스타피부과 — 새 지점 오픈 공고 (일산점)"
    ↓
영업 전략:
  신규 지점은 장비 구매 필수 → 즉시 접근
  기존 지점 장비 현황 참고해서 제안
```

---

## 9. 구현 순서

### Step 1: 시드 데이터 + DB (반나절)
- networks, network_branches, verification_logs 테이블 생성
- TOP 10 대형 브랜드 수동 입력 (이름, 공식사이트 URL)
- 기존 12,505개 병원에서 키워드 매칭으로 후보 추출

### Step 2: 공식 사이트 크롤링 자동화 (1일)
- TOP 10 브랜드 지점안내 페이지 크롤링
- AI로 지점명/주소/도메인 추출
- confirmed 지점 자동 등록

### Step 3: 도메인 패턴 분석 (반나절)
- 확인된 지점들의 도메인 패턴 자동 추출
- 미확인 후보들에 패턴 점수 부여

### Step 4: 복합 점수 계산 + 자동 판정 (반나절)
- 4단계 소스 점수 합산 로직
- 자동 confirmed / 검토 대기 분류

### Step 5: admin UI (1일)
- 네트워크 목록 뷰
- 지점 검증 상세 뷰
- 1클릭 승인/거부

### Step 6: MADMEDSALES 대시보드 연동 (반나절)
- 병원 상세 페이지에 "네트워크 소속" 배지 표시
- 네트워크 단위 영업 뷰 (체인별 장비 현황, 도입률)
- 시그널에 "신규 지점 오픈" 감지 추가

**총 예상 소요: 4~5일**

---

## 10. Claude Code 작업 지시문

### Step 1: DB 마이그레이션
```
MADMEDSALES에 피부과 네트워크/체인 관리 테이블 3개 추가해줘.

1. networks — 브랜드 마스터
   - id, name, official_name, headquarter_hospital_id(FK hospitals),
     official_site_url, branch_page_url, total_branches,
     category(franchise|network|group), status, notes, created_at, updated_at

2. network_branches — 지점 매핑 + 검증
   - id, network_id(FK), hospital_id(FK), branch_name, role(headquarter|branch),
     confidence(confirmed|probable|candidate|unlikely), confidence_score(0~100),
     official_site_verified(bool), domain_pattern_score, corporate_match_score,
     keyword_match_score, verified_at, verified_by(auto|manual),
     verification_notes, created_at, updated_at

3. network_verification_logs — 검증 이력
   - id, network_id(FK), branch_id(FK), verification_method, result, detail(jsonb),
     created_at

Supabase 마이그레이션 파일로 만들어줘.
RLS는 일단 비활성화 상태로.
```

### Step 2: 크롤링 + 검증 엔진
```
MADMEDSALES engine에 네트워크 검증 API 추가해줘.

POST /api/networks/verify-branches
- network_id 받아서 해당 브랜드의 공식사이트 지점 페이지 크롤링
- Firecrawl로 크롤링 → AI로 지점명/주소/도메인 추출
- hospitals 테이블과 매칭 → network_branches에 저장
- confidence "confirmed"

POST /api/networks/scan-candidates
- 전체 hospitals에서 해당 브랜드 키워드 매칭
- 이미 confirmed된 병원 제외
- 도메인 패턴 점수 + 키워드 점수 계산
- 복합 점수로 candidate/probable/unlikely 자동 판정
- network_branches에 저장

GET /api/networks/:id/branches
- 특정 네트워크의 전 지점 목록 + 검증 상태 반환
```
