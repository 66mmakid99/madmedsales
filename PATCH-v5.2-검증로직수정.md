# v5.2 패치 — 검증 로직 구조적 결함 수정

---

## 발견된 문제

### 문제 1: "0/0 = 100%" 검증 허점

안산엔비의원 사례:
```
크롤 페이지: 3개 (메인 + 서브 2개)
마크다운에서 의사 발견: 0명
추출된 의사: 0명
커버리지: 0/0 → 100% PASS
```

실제 사이트에 문상재 원장(KOL, 국제학회 강연자, 교과서 저자)이 있는데 의사 0명으로 100% PASS 처리됨.

**원인:** 커버리지가 "크롤한 마크다운 대비 추출 비율"만 측정.
크롤 범위가 좁으면 마크다운 자체에 정보가 없고, 0/0이 100%가 됨.

이건 "시험 범위를 줄여서 100점 받는 것"과 같다.

### 문제 2: 피부과인데 의사 0명, 장비 0개가 PASS

어떤 피부과든 최소한:
- 의사 1명 이상 (의료법상 개설자 필수)
- 장비 1개 이상 (피부과가 장비 없이 운영 불가)
- 시술 3개 이상 (피부과 최소 메뉴)

이 최소 기대치를 충족 못 하면, 커버리지가 100%여도 크롤 자체가 실패한 것.

### 문제 3: 크롤 충분성 판단 없음

3페이지만 크롤했는데 "충분하다"고 판단할 근거가 없다.
실제 사이트에 의료진/장비/시술 페이지가 따로 있는데 못 찾은 것일 수 있다.

---

## 수정 방안

### 수정 1: 2단계 검증 도입

기존 (1단계만):
```
커버리지 = 추출 / 마크다운 발견 → PASS/FAIL
```

수정 (2단계):
```
[1단계] 최소 기대치 검증 (Sanity Check)
  피부과라면:
    의사 ≥ 1명? → NO면 INSUFFICIENT
    시술 ≥ 3개? → NO면 INSUFFICIENT
  
  INSUFFICIENT → 크롤 보강 시도 → 재검증

[2단계] 커버리지 검증 (기존)
  1단계 통과 후에만 실행
  추출 / 마크다운 발견 → PASS/PARTIAL/FAIL
```

### 수정 2: 최소 기대치 테이블

```typescript
const MINIMUM_EXPECTATIONS = {
  // 피부과/성형외과 공통
  dermatology: {
    doctors: 1,     // 최소 1명 (원장)
    treatments: 3,  // 최소 3개 시술
    equipments: 0,  // 장비는 서브페이지에만 있을 수 있어서 0 허용
                    // 단, 시술명에서 장비 분리 추출은 해야 함
  },
};
```

### 수정 3: 크롤 충분성 체크

크롤된 페이지 유형을 확인:
```typescript
function checkCrawlSufficiency(pages: CrawlPage[]): {
  sufficient: boolean;
  missing: string[];
} {
  const pageTypes = pages.map(p => p.page_type);
  const missing: string[] = [];
  
  // 피부과라면 최소한 이 페이지들이 있어야 한다
  if (!pageTypes.includes('main')) missing.push('main');
  
  // 의사 0명인데 doctor 페이지를 크롤 안 했으면 → 크롤 부족
  // 장비 0개인데 equipment 페이지를 크롤 안 했으면 → 크롤 부족
  // 시술 적은데 treatment 페이지를 크롤 안 했으면 → 크롤 부족
  
  return {
    sufficient: missing.length === 0,
    missing,
  };
}
```

### 수정 4: INSUFFICIENT일 때 보강 크롤

최소 기대치 미달 시:
```
의사 0명 → "/doctor", "/staff", "/의료진", "/원장" 경로 직접 시도
장비 0개 → "/equipment", "/장비", "/기기" 경로 직접 시도
시술 부족 → "/treatment", "/시술", "/프로그램", "/menu" 경로 직접 시도
```

도메인 + 일반적 경로 패턴으로 추가 크롤 시도:
```typescript
const COMMON_PATHS = {
  doctor: [
    '/doctor', '/doctor.php', '/staff', '/team',
    '/의료진', '/원장', '/원장소개', '/의료진소개',
    '/intro/doctor', '/info/doctor', '/about/doctor',
    '/sub/doctor', '/contents/doctor',
  ],
  equipment: [
    '/equipment', '/장비', '/기기', '/보유장비',
    '/intro/equipment', '/info/equipment',
  ],
  treatment: [
    '/treatment', '/program', '/시술', '/프로그램',
    '/진료안내', '/진료과목', '/시술안내',
    '/menu', '/price', '/가격',
  ],
};

async function supplementaryCrawl(
  baseUrl: string, 
  missingTypes: string[]
): Promise<CrawlPage[]> {
  const results: CrawlPage[] = [];
  
  for (const type of missingTypes) {
    const paths = COMMON_PATHS[type] || [];
    for (const path of paths) {
      const url = new URL(path, baseUrl).href;
      try {
        const page = await firecrawl.v1.scrapeUrl(url, {
          formats: ['markdown', 'screenshot'],
          waitFor: 3000,
        });
        if (page.markdown && page.markdown.length > 200) {
          results.push({ url, page_type: type, ...page });
          console.log(`  ✅ 보강 크롤 성공: ${url} (${page.markdown.length}자)`);
          break; // 이 타입은 성공했으니 다음으로
        }
      } catch {
        // 404 등 무시, 다음 경로 시도
      }
    }
  }
  
  return results;
}
```

### 수정 5: 검증 보고서에 단계 표시

```
═══ {병원명} — v5.2 검증 결과 ═══

[1단계: 최소 기대치]
  의사: {N}명 (최소 1명) → ✅/❌
  시술: {N}개 (최소 3개) → ✅/❌
  판정: SUFFICIENT / INSUFFICIENT

  INSUFFICIENT인 경우:
    보강 크롤 시도: {시도한 경로 목록}
    보강 결과: {추가된 페이지/데이터}
    재검증: 의사 {N}명, 시술 {N}개 → ✅/❌

[2단계: 커버리지]
  (1단계 통과 후)
  장비: {N}% | 시술: {N}% | 의사: {N}% | 전체: {N}%
  판정: PASS / PARTIAL / FAIL
```

### 수정 6: 최종 판정 로직

```typescript
function finalVerdict(hospital: HospitalResult): Verdict {
  // 1단계: 최소 기대치
  if (hospital.doctors.length === 0) {
    // 보강 크롤 시도
    const supplementary = await supplementaryCrawl(hospital.url, ['doctor']);
    if (supplementary.length > 0) {
      // 보강 데이터로 재분석
      await reanalyze(hospital, supplementary);
    }
    
    // 재분석 후에도 의사 0명이면
    if (hospital.doctors.length === 0) {
      return {
        status: 'INSUFFICIENT',
        reason: '의사 0명 — 크롤 범위 부족 가능성. 사이트에 의료진 페이지가 있으나 URL 발견 실패.',
        action: 'manual_review',
      };
    }
  }
  
  if (hospital.treatments.length < 3) {
    // 동일하게 보강 시도
    // ...
  }
  
  // 2단계: 커버리지 (기존 로직)
  const coverage = calculateCoverage(hospital);
  
  if (coverage.overall >= 70) return { status: 'PASS', coverage };
  if (coverage.overall >= 50) return { status: 'PARTIAL', action: 'reanalyze' };
  return { status: 'FAIL', action: 'manual_review' };
}
```

---

## 안산엔비의원 구체 대응

http://talmostop.com 사이트:

1. mapUrl로 URL 수집 → 3개밖에 안 나옴
2. 메인 HTML에서 내부 링크 추출 → 추가 URL 찾기
3. 그래도 부족하면 → COMMON_PATHS로 직접 시도:
   - http://talmostop.com/doctor
   - http://talmostop.com/doctor.php
   - http://talmostop.com/staff
   - http://talmostop.com/의료진
   - 등등
4. 문상재 원장 정보가 이미지 기반이면 → Vision 분석

**핵심:** 사이트가 작아서 정보가 적은 것과, 크롤을 못 한 것을 구분해야 한다.
의사 0명이면 무조건 "크롤 부족 의심" → 보강 시도 → 그래도 없으면 manual_review.

---

## 포에버의원 이벤트 16 → 7개 감소 확인

v4: 16개 이벤트
v5.1: 7개 이벤트

확인할 것:
- 중복 제거가 과하게 적용된 건 아닌지
- 이벤트 페이지를 크롤 못 한 건 아닌지
- "월간포에버", "설맞이 한정 이벤트", "발렌타인데이 특가", "화수목 한정가", "첫시술 체험전", "다이어트 솔루션", "평일 해피타임" 등이 있어야 하는데 어떤 것이 빠졌는지

---

## 동안중심의원 의사 3명 → 2명이어야 함

실제: 조창환, 구소연 (2명)
추출: 3명

3번째 의사가 누구인지 확인 필요. 다른 직원이 의사로 잘못 분류된 건 아닌지.

---

## 시스템 지침서 추가 항목

섹션 4에 추가:

```
### 4-5. 2단계 검증 (v5.2)

[1단계] 최소 기대치 (Sanity Check)
- 피부과/성형외과: 의사 ≥ 1명, 시술 ≥ 3개
- 미달 시: 크롤 범위 부족 판단 → 보강 크롤 → 재분석
- 보강 후에도 미달: manual_review (PASS 처리 금지)

[2단계] 커버리지 (기존)
- 1단계 통과 후에만 실행
- 70%+ PASS / 50~69% PARTIAL / 50% 미만 FAIL
```

---

## 금지사항 추가

```
19. ❌ 의사 0명, 장비 0개인데 "원본에 없으니 100%" 처리 (크롤 부족 가능성을 먼저 의심)
20. ❌ 0/0 = 100% 커버리지 계산 (분모가 0이면 "판정 불가"로 처리, PASS가 아님)
```

---

## 적용 순서

```
v5.1 전체 실행 전에 적용 (아직 승인 안 했으므로)
  ↓
recrawl-v5.ts의 검증 함수 수정
  ↓
최소 기대치 체크 + 보강 크롤 로직 추가
  ↓
안산엔비의원 단독 재테스트
  ↓
의사 ≥ 1명 확인 (문상재 원장)
  ↓
동안중심의원 의사 3명 → 2명 확인
  ↓
포에버의원 이벤트 7 vs 16 확인
  ↓
3개 병원 재검증 완료 → 승인 → 전체 실행
```

---

## 비용 영향

- 보강 크롤: 병원당 최대 5~10회 URL 시도 (대부분 404) → 크레딧 미미
- 실제 성공하는 보강: 병원당 1~2페이지 → 크레딧 +2
- 49개 병원 전체: 최대 +100 크레딧 (실패하는 URL은 비용 없음)
- 현재 잔여 ~2,000 → 충분
