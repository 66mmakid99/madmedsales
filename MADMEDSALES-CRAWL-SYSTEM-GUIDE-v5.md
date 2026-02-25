# MADMEDSALES 크롤링 & 분석 시스템 지침서 (v5)

> **이 문서는 병원 웹사이트 데이터 수집의 모든 단계에서 반드시 참조하는 표준 지침이다.**
> 새 스크립트 작성, 기존 스크립트 수정, 프롬프트 변경, 테스트 실행 시 이 문서의 규칙을 위반하면 안 된다.

---

## 1. 기본 원칙

### 1-1. 데이터는 자산이다
- 크롤링한 원본(마크다운, 스크린샷)은 **반드시 Supabase에 영구 저장**
- 메모리에서 처리 후 버리지 않는다
- 나중에 더 좋은 AI 모델이 나오면 원본으로 재분석할 수 있어야 한다

### 1-2. 텍스트를 자르지 않는다
- 긴 페이지는 청크로 나눠서 전부 분석한다
- 앞에서부터 잘라서 뒤를 버리는 행위 금지
- 중간을 날리는 행위 금지

### 1-3. 추출 후 반드시 검증한다
- 숫자가 0이 아니라고 성공이 아니다
- 실제 사이트에 있는 정보 대비 추출률을 측정한다
- 검증 없이 "전체 실행" 넘어가지 않는다

### 1-4. 최선의 방법을 제시한다
- 한국 피부과 사이트의 특성(이미지 기반, 플래시, iframe)을 사전에 고려한다
- "안 되면 어쩔 수 없다"가 아니라 "안 되면 다른 방법을 찾는다"
- 텍스트 크롤링 실패 → 스크린샷 + Vision, 그래도 안 되면 수동 입력 플래그

### 1-5. 비용을 의식한다
- Firecrawl 크레딧, Gemini 토큰, Supabase Storage 용량을 항상 추적
- 불필요한 호출을 줄이되, 데이터 품질을 위한 호출은 아끼지 않는다
- 매 배치 실행 후 크레딧/비용 잔여 보고

---

## 2. 크롤링 규칙

### 2-1. URL 수집 (mapUrl)

```
1차: firecrawl.v1.mapUrl(url, { limit: 100 })
  → 사이트 전체 URL 수집

2차: mapUrl 결과가 5개 미만이면
  → 메인 페이지 HTML에서 내부 링크 직접 추출
  → <a href="..."> 태그에서 같은 도메인 링크 수집
  → 이 방법으로도 부족하면 sitemap.xml 시도
```

### 2-2. URL 필터링

**포함 패턴 (하나라도 매칭되면 포함):**
```regex
/시술|프로그램|장비|기기|의료진|원장|대표원장|doctor|staff|
이벤트|event|할인|가격|price|비용|menu|
리프팅|피부|레이저|rf|hifu|바디|보톡스|필러|
주사|부스터|스킨|케어|토닝|제모|탈모|
info|about|introduce|소개|진료|
landing|treatment|program|clinic/i
```

**제외 패턴:**
```regex
/blog|후기|리뷰|review|공지|notice|개인정보|privacy|
채용|recruit|오시는길|map|location|contact|
\.pdf|\.jpg|\.png|login|admin|board|gallery|
예약|booking|reservation|sitemap|
카카오|kakao|naver\.com|instagram|youtube|facebook/i
```

**중요: /landing/ 경로 포함할 것.**
동안중심의원처럼 /landing/130.htm (써마지FLX), /landing/17.htm (울쎄라) 등
개별 시술 상세 페이지가 /landing/ 하위에 있는 경우가 많다.

### 2-3. 페이지 수 규칙

- **최소/최대 제한 없음. 관련 페이지는 전부 가져온다.**
- URL 필터링(2-2)을 통과한 페이지는 전부 크롤링한다. 임의로 줄이지 않는다.
- 단, 기술적 상한은 **50페이지**로 설정 (50개 초과 시 우선순위 정렬 후 상위 50개)
- 우선순위 (50개 초과 시에만 적용): main > doctor > treatment > equipment > event > price > other
- 페이지가 3개 나왔으면 3개 전부, 30개 나왔으면 30개 전부 크롤링한다. "최소 3개만" 같은 자의적 축소 금지.

### 2-4. 크롤링 형식

```typescript
const result = await firecrawl.v1.scrapeUrl(pageUrl, {
  formats: ['markdown', 'screenshot'],  // 항상 둘 다
  waitFor: 3000,
  actions: [/* 아래 2-5 참조 */],
});
```

**markdown과 screenshot을 항상 동시에 수집한다.**
텍스트가 풍부한 페이지에서도 스크린샷은 저장해둔다 (나중에 재분석용).

### 2-5. 스크린샷 캡처 전략

#### 문제 인식
Firecrawl screenshot은 **viewport 캡처**다. 브라우저 창 크기(기본 1280×800)만큼만 찍힌다.
- 세로로 긴 페이지: 상단만 찍히고 하단(시술/의료진/이벤트) 누락
- 팝업이 떠있으면: 본문이 가려진 채로 캡처됨
- 이미지 기반 사이트에서 Vision 분석 시 치명적 데이터 손실

#### 캡처 규칙

**규칙 1: 팝업 2회 캡처**
팝업은 이벤트/행사 소식일 가능성이 높으므로 삭제하면 안 된다.
```
1회차: 팝업 있는 그대로 캡처 → 이벤트/행사 정보 추출용
2회차: 팝업 닫은 후 캡처 → 메인 본문 추출용
```

**규칙 2: 스크롤 다중 캡처**
한 페이지에서 viewport 단위로 스크롤하며 여러 장 캡처한다.
```
상단(팝업 포함) → 팝업 닫기 → 상단(본문) → 중단 스크롤 → 하단 스크롤
```

**규칙 3: 모든 스크린샷 저장**
한 페이지에서 나온 모든 스크린샷을 전부 Supabase Storage에 저장하고, 전부 Vision 분석 대상으로 삼는다.

#### actions 구현

```typescript
const result = await firecrawl.v1.scrapeUrl(pageUrl, {
  formats: ['markdown', 'screenshot'],
  waitFor: 3000,
  actions: [
    // 1회: 팝업 있는 상태 캡처 (이벤트 정보 보존)
    { type: 'screenshot' },
    
    // 팝업 닫기 시도 (일반적인 닫기 버튼 셀렉터)
    { type: 'click', selector: '.popup-close, .modal-close, [class*="close"], [class*="닫기"], .btn-close, .close-btn, a[href="javascript:;"]' },
    { type: 'wait', milliseconds: 500 },
    
    // 2회: 팝업 닫은 후 상단 캡처
    { type: 'screenshot' },
    
    // 3회: 중간으로 스크롤 → 캡처
    { type: 'scroll', direction: 'down', amount: 3 },
    { type: 'wait', milliseconds: 500 },
    { type: 'screenshot' },
    
    // 4회: 하단으로 스크롤 → 캡처
    { type: 'scroll', direction: 'down', amount: 3 },
    { type: 'wait', milliseconds: 500 },
    { type: 'screenshot' },
  ]
});
```

**주의:** actions 기능이 현재 Firecrawl 플랜에서 지원되는지 반드시 테스트 먼저.
지원 안 되면 대안:
- Puppeteer/Playwright 직접 사용하여 캡처
- 또는 Firecrawl fullPageScreenshot 옵션 확인

#### 스크린샷 저장 경로

```
hospital-screenshots/
  {hospital_id}/
    {page_type}_{url_slug}_{date}_popup.webp      ← 팝업 포함
    {page_type}_{url_slug}_{date}_top.webp         ← 상단 (팝업 닫은 후)
    {page_type}_{url_slug}_{date}_mid.webp         ← 중간 스크롤
    {page_type}_{url_slug}_{date}_bottom.webp      ← 하단 스크롤
```

### 2-6. 스크린샷 최적화

```typescript
import sharp from 'sharp';

// PNG → WebP, 1280px, 품질 80%
const optimized = await sharp(imageBuffer)
  .resize(1280, null, { withoutEnlargement: true })
  .webp({ quality: 80 })
  .toBuffer();

// Supabase Storage 업로드
const path = `${hospitalId}/${pageType}_${urlSlug}_${date}_${position}.webp`;
await supabase.storage
  .from('hospital-screenshots')
  .upload(path, optimized, { contentType: 'image/webp' });
```

#### 용량 재계산 (다중 캡처 반영)

| 항목 | 계산 | 용량 |
|------|------|------|
| 페이지당 스크린샷 | 평균 4장 | ~0.6MB |
| 병원당 페이지 | 평균 15페이지 | ~9MB |
| 49개 병원 전체 | 49 × 9MB | **~440MB** |
| Supabase 무료 한도 | 1GB | 여유 있음 |

텍스트 기반 페이지는 2장(팝업+상단), 이미지 기반 긴 페이지는 4~5장.
평균 4장 기준 440MB로 무료 한도 이내.

### 2-7. 원본 저장

크롤링 즉시 hospital_crawl_pages에 INSERT:
```typescript
await supabase.from('hospital_crawl_pages').insert({
  hospital_id: hospitalId,
  url: pageUrl,
  page_type: classifyPageType(pageUrl),
  markdown: result.markdown || '',
  char_count: (result.markdown || '').length,
  screenshot_url: storageUrl,
  analysis_method: 'pending',  // 분석 후 업데이트
  gemini_analyzed: false,
});
```

---

## 3. Gemini 분석 규칙

### 3-1. 분석 방법 결정

```
마크다운 500자 이상 → 텍스트 분석 (analysis_method: 'text')
마크다운 500자 미만 & 스크린샷 있음 → Vision 분석 (analysis_method: 'vision')
마크다운 500자 이상 & 텍스트 분석 결과 빈약 → Vision 추가 (analysis_method: 'both')
둘 다 없음 → 스킵
```

"결과 빈약" 기준:
- 시술 페이지인데 시술 0개
- 의료진 페이지인데 의사 0명
- 메인 페이지인데 시술+장비+의사 합계 3개 미만

### 3-2. 텍스트 청크 분할

```
25,000자 이하: 그대로 1회 호출
25,000자 초과: 문단 경계에서 25,000자 단위 분할
  → 각 청크 개별 호출
  → 결과 병합
```

### 3-3. Gemini 프롬프트 (v5 — 핵심 개선)

```
당신은 한국 피부과/성형외과 웹사이트 데이터 추출 전문가입니다.
이 {콘텐츠_유형}은 "{병원명}" 웹사이트의 {page_type} 페이지입니다.
{지점_정보}

아래 정보를 빠짐없이 JSON으로 추출하세요.

## 추출 규칙

### 장비 (equipments)
1. 장비 소개 페이지에 있는 장비를 추출
2. ★★★ 시술명 안에 포함된 장비명도 반드시 분리 추출 ★★★
   예시: "울쎄라 리프팅 100샷" → equipments에 "Ulthera" 추가
   예시: "인모드 FX 얼굴전체" → equipments에 "InMode" 추가
   예시: "슈링크 유니버스 100샷" → equipments에 "Shrink Universe" 추가
   예시: "텐쎄라 300라인" → equipments에 "Tensera" 추가
   예시: "레블라이트SI 토닝" → equipments에 "RevLite SI" 추가
   예시: "엑셀V" → equipments에 "Excel V" 추가
   예시: "온다 4만줄" → equipments에 "Onda" 추가
   예시: "제네시스" → equipments에 "Genesis" 추가
3. 내비게이션 메뉴의 시술 링크에서도 장비명 추출
   예시: 메뉴에 "써마지FLX 이용시술" → equipments에 "Thermage FLX" 추가

### 시술 (treatments)  
1. 시술 소개, 가격표, 이벤트 페이지의 시술을 추출
2. ★★★ 내비게이션 메뉴/사이드바의 시술 링크도 시술 목록으로 추출 ★★★
   예시: 메뉴에 "울쎄라 이용시술", "써마지FLX 이용시술" → 각각 시술로 추출
   예시: 메뉴에 "색소 > 레드터치 pro 이용시술" → 시술로 추출
3. 같은 시술의 다른 회차/샷수는 개별 항목으로 (가격이 다를 수 있으므로)
4. 패키지/콤보 시술도 추출 (combo_with에 구성 기재)

### 의사 (doctors)
1. 의료진 소개 페이지의 의사 정보 추출
2. 다지점 병원인 경우: {지점_정보}에 해당하는 지점 소속만 추출
   지점 구분이 불가능하면 전체 추출하되 notes에 "전 지점 통합 목록" 표시
3. 학력, 경력, 학술활동은 텍스트에 있는 그대로 추출
4. 이미지 캡션이나 alt 텍스트에 있는 학술 정보도 추출

### 이벤트 (events)
1. 이벤트/할인/프로모션 페이지의 정보 추출
2. 팝업 배너, 슬라이드 배너의 이벤트도 추출
3. 기간 정보가 있으면 description에 포함

## 장비명 정규화

| 한글/약어 | 정규화 |
|-----------|--------|
| 써마지, 써마지FLX | Thermage FLX |
| 써마지CPT | Thermage CPT |
| 울쎄라, 울쎄라프라임 | Ulthera / Ulthera Prime |
| 슈링크, 슈링크유니버스 | Shrink Universe |
| 인모드, 인모드FX | InMode |
| 토르, 토르RF, TORR | TORR RF |
| 토르 컴포트 듀얼, 컴포트듀얼 | TORR Comfort Dual |
| 텐쎄라 | Tensera |
| 텐써마 | Tensurma |
| 스칼렛S | Scarlet S |
| 레블라이트SI | RevLite SI |
| 엑셀V | Excel V |
| 피코슈어 | PicoSure |
| 제네시스 | Genesis |
| 온다 | Onda |
| 젤틱 | CoolSculpting (Zeltiq) |
| LDM | LDM |
| 에너젯 | E-Jet |
| 리포소닉 | Liposonic |
| 포텐자 | Potenza |
| 올리지오 | Oligio |
| 아그네스 | Agnes |
| 덴서티 | Density |
| 원쎄라 | Wonsera |

★ "토르", "TORR", "컴포트듀얼" 관련 언급은 반드시 포함.

## JSON 출력 형식

{
  "equipments": [{
    "name": "정규화된 장비명",
    "category": "laser|rf|hifu|body|lifting|booster|skin|other",
    "manufacturer": "제조사명 (알 수 있으면, 없으면 null)"
  }],
  "treatments": [{
    "name": "시술명 (원문 그대로)",
    "category": "lifting|laser|body|booster|filler_botox|skin|hair|other",
    "price": 숫자(원 단위, 없으면 null),
    "price_note": "가격 조건 (1회, 이벤트가, ~부터, VAT별도 등, 없으면 null)",
    "is_promoted": true/false,
    "combo_with": "콤보 시술명 (없으면 null)"
  }],
  "doctors": [{
    "name": "의사 이름",
    "title": "직함 (대표원장, 원장, 부원장 등)",
    "specialty": "전문분야 (없으면 null)",
    "education": "학력 (없으면 null)",
    "career": "경력 (없으면 null)",
    "academic_activity": "논문, 학회, KOL 활동 (없으면 null)",
    "notes": "기타 참고사항 (없으면 null)"
  }],
  "events": [{
    "title": "이벤트 제목",
    "description": "상세 내용",
    "discount_type": "percent|fixed|package|free_add|other",
    "discount_value": "할인값",
    "related_treatments": ["관련 시술명"]
  }]
}

없는 항목은 빈 배열 []. JSON만 응답 (마크다운 코드블록 없이).
```

### 3-4. 결과 병합 + 중복 제거

한 병원의 모든 페이지 분석 결과를 모아서:

**장비 중복 제거:**
```typescript
// 정규화된 name 기준
// "Ulthera" + "Ulthera" → 1개
// "Ulthera" + "Ulthera Prime" → 2개 (다른 장비)
```

**시술 중복 제거:**
```typescript
// 1차: 정확한 name 매칭 → 가격 있는 쪽 우선
// 2차: 핵심 키워드 추출 후 매칭
//   "울쎄라 리프팅(고강도 집속 초음파) 100샷 - 한정가"
//   "울쎄라 리프팅 100샷"
//   → 핵심: "울쎄라", "100샷" → 동일 시술, 가격 다르면 둘 다 유지 (정가 vs 한정가)
//
// 이벤트 패키지("설날 복주머니 P!CK")는 시술이 아닌 이벤트로 재분류
```

**의사 중복 제거:**
```typescript
// name 기준, 정보 더 많은 쪽 우선 (education, career 등)
```

**이벤트 중복 제거:**
```typescript
// title 유사도 기준
```

---

## 4. 검증 규칙 (★ 가장 중요)

### 4-1. 자동 검증 (매 병원 분석 완료 후)

분석 완료 후 Gemini를 1회 추가 호출하여 커버리지 체크:

```
프롬프트:
당신은 데이터 품질 검증 전문가입니다.

[원본 마크다운]
{병원의 모든 크롤링 페이지 마크다운 합본}

[추출 결과]
장비: {추출된 장비 목록}
시술: {추출된 시술 목록}
의사: {추출된 의사 목록}

[검증 지시]
원본 마크다운에 있지만 추출 결과에 빠진 항목을 찾으세요.
특히:
1. 내비게이션 메뉴의 시술 링크 중 추출 안 된 것
2. 시술명에 포함된 장비명 중 equipments에 없는 것
3. 의료진 페이지에 있는 의사 중 추출 안 된 것
4. 가격 정보가 있는데 price가 null인 시술

JSON으로 응답:
{
  "missing_equipments": ["누락된 장비명"],
  "missing_treatments": ["누락된 시술명"],
  "missing_doctors": ["누락된 의사명"],
  "missing_prices": ["가격 누락 시술명"],
  "coverage_score": {
    "equipment": 0~100,
    "treatment": 0~100,
    "doctor": 0~100,
    "overall": 0~100
  },
  "issues": ["기타 발견된 문제"]
}
```

### 4-2. 커버리지 기준

| 항목 | 최소 기준 | 목표 |
|------|-----------|------|
| 장비 | 70% | 90%+ |
| 시술 | 70% | 90%+ |
| 의사 | 90% | 100% |
| 전체 | 70% | 85%+ |

커버리지 70% 미만 → **자동 재분석 트리거**
- missing 항목을 프롬프트에 힌트로 추가하여 Gemini 재호출
- 재분석 후에도 70% 미만 → manual_review 플래그

### 4-3. 테스트 보고서 형식

테스트 시 아래 형식으로 보고:

```
═══ {병원명} 검증 결과 ═══

크롤 페이지: {N}개
분석 방식: text / vision / both

[추출 결과]
  장비: {N}개 — {목록}
  시술: {N}개 — 상위 5개 + "외 N개"
  의사: {N}명 — {목록}
  이벤트: {N}개

[자동 검증]
  장비 커버리지: {N}% — 누락: {목록}
  시술 커버리지: {N}% — 누락: {목록}
  의사 커버리지: {N}% — 누락: {목록}
  전체: {N}%

[판정] ✅ PASS / ⚠️ PARTIAL / ❌ FAIL
```

### 4-4. 전체 실행 전 테스트 규칙

1. 반드시 3개 이상 병원으로 테스트
2. 테스트 병원은 다양한 유형 포함:
   - 이미지 기반 사이트 1개 이상
   - 텍스트 풍부한 사이트 1개 이상
   - 서브페이지 많은 사이트 1개 이상
3. 3개 병원 **전부** 커버리지 70% 이상일 때만 전체 실행
4. 테스트 결과를 보고하고 **승인 받은 후** 전체 실행

---

## 5. 한국 피부과 사이트 특성 대응

### 5-1. 이미지 기반 사이트

많은 한국 피부과 사이트는:
- 시술 소개가 이미지 배너/인포그래픽
- 의료진 소개가 사진+텍스트 혼합
- 가격표가 이미지로 제작됨

대응:
1. 마크다운 추출이 빈약하면 자동으로 Vision 분석
2. 단, HTML 내비게이션 메뉴는 텍스트로 남아있는 경우가 많음
   → 마크다운에서 메뉴 구조를 시술 목록으로 활용
3. 스크롤 다중 캡처로 전체 페이지 이미지 확보 (섹션 2-5)

### 5-2. 다지점 프랜차이즈

포에버의원, 클리어의원 등 다지점 운영 병원:
- 전 지점 의사가 한 페이지에 나열
- 시술/가격이 지점별로 다를 수 있음

대응:
1. Gemini에 지점명 전달: "이 병원은 {병원명}의 {지점명}점입니다. {지점명}점 소속 정보만 추출하세요."
2. 지점 구분이 불가능하면 전체 추출하되 notes에 "전 지점 통합 목록" 표시

### 5-3. SPA/동적 사이트

React/Vue 기반 SPA:
- 마크다운이 빈 껍데기일 수 있음

대응:
1. waitFor: 5000으로 늘려서 렌더링 대기
2. 그래도 텍스트 부족하면 스크린샷 Vision 분석

### 5-4. 팝업/모달

이벤트 정보가 팝업으로만 노출:
- 메인 크롤 시 팝업이 캡처될 수도 안 될 수도 있음

대응:
1. 팝업 포함 캡처 + 팝업 닫은 후 캡처 (2회, 섹션 2-5)
2. 팝업 전용 URL이 있으면 별도 크롤

### 5-5. 지연 로딩 (Lazy Loading)

한국 피부과 사이트 대부분이 이미지 지연 로딩 사용:
- 스크롤하지 않으면 하단 이미지가 로드되지 않음
- 마크다운에 placeholder만 남고 실제 이미지 URL이 없을 수 있음
- 스크린샷에도 로딩 안 된 빈 이미지 영역이 찍힘

대응:
1. 스크롤 다중 캡처가 이 문제를 자동 해결 (스크롤하면 이미지 로드 트리거)
2. 각 스크롤 후 wait 500ms로 이미지 로딩 시간 확보
3. 그래도 안 되면 waitFor를 5000ms로 늘리고 재시도

### 5-6. iframe 콘텐츠

일부 사이트가 시술 소개, 가격표를 iframe으로 삽입:
- Firecrawl은 기본적으로 iframe 내부를 크롤하지 않음
- 마크다운에 빈 영역, 스크린샷에는 보일 수 있음

대응:
1. 스크린샷 Vision으로 iframe 내 정보 추출 시도
2. iframe src URL을 별도 크롤 대상으로 추가

### 5-7. 모바일 리다이렉트

일부 사이트가 User-Agent에 따라 모바일 버전으로 리다이렉트:
- 모바일 버전이 더 간소하여 정보 누락 가능
- 반대로 모바일이 더 정보가 많은 경우도 있음

대응:
1. Firecrawl은 기본적으로 데스크탑 User-Agent 사용 → 보통 문제없음
2. 크롤 결과가 비정상적으로 빈약하면 모바일 리다이렉트 의심 → URL 확인

### 5-8. 쿠키 동의 배너

GDPR 대응 사이트에서 쿠키 배너가 화면 하단을 가림:
- 한국 사이트에서는 드물지만, 글로벌 템플릿 사용 시 존재
- 스크린샷 하단이 가려질 수 있음

대응:
1. 팝업 닫기 actions에 쿠키 배너 닫기 셀렉터도 포함
2. `.cookie-banner, .cookie-consent, [class*="cookie"], [class*="consent"]`

### 5-9. PDF 가격표

일부 병원이 가격표를 PDF 파일로 제공:
- 홈페이지에 "가격표 다운로드" 링크
- Firecrawl markdown에 PDF 내용 미포함

대응:
1. URL 필터링에서 .pdf 제외하지 않음 (가격표 PDF는 가치 있음)
2. PDF URL 발견 시 별도 다운로드 → Gemini Vision 분석
3. 현재 버전에서는 PDF 크롤링 미지원 — manual_review 플래그로 표시

### 5-10. 학술활동/뉴스 섹션

안산엔비의원처럼 메인에 원장의 학술활동이 이미지+텍스트로 노출:
- 학술대회 참가, 강연, 저서 편찬 등 KOL 판별 핵심 정보
- 이미지 캡션 형태라 마크다운에서 놓칠 수 있음

대응:
1. Gemini 프롬프트에 "학술활동, 학회 참가, 강연, 저서 정보도 추출" 명시
2. 스크린샷 Vision에서 이미지 캡션/alt 텍스트 추출
3. 이 정보는 doctors.academic_activity에 저장

---

## 6. DB 스키마

### 6-1. 테이블 구조

```
hospitals                    — 병원 기본정보
hospital_crawl_pages         — 크롤링 원본 (마크다운 + 스크린샷 URL)
hospital_equipments          — 보유 장비
hospital_treatments          — 시술 메뉴
hospital_doctors             — 의료진
hospital_events              — 이벤트/할인
hospital_crawl_validations   — 검증 결과 (NEW)
```

### 6-2. hospital_crawl_pages 스크린샷 필드

한 페이지에서 다중 스크린샷이 나온다 (팝업 포함, 상단, 중단, 하단).
screenshot_url은 단일 TEXT가 아니라 **JSONB 배열**로 저장한다.

```sql
-- 기존 TEXT → JSONB 변경
ALTER TABLE hospital_crawl_pages 
  ALTER COLUMN screenshot_url TYPE JSONB USING 
    CASE WHEN screenshot_url IS NULL THEN '[]'::jsonb
         ELSE jsonb_build_array(screenshot_url) END;
```

저장 형식:
```json
[
  { "url": "...popup.webp", "position": "popup", "order": 0 },
  { "url": "...top.webp", "position": "top", "order": 1 },
  { "url": "...mid.webp", "position": "mid", "order": 2 },
  { "url": "...bottom.webp", "position": "bottom", "order": 3 }
]
```

Vision 분석 시 전체 배열의 이미지를 순서대로 분석한다.

### 6-3. 검증 결과 테이블 (신규)

```sql
CREATE TABLE hospital_crawl_validations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  hospital_id UUID REFERENCES hospitals(id),
  crawl_version TEXT NOT NULL,  -- 'v5'
  equipment_coverage INTEGER,   -- 0~100
  treatment_coverage INTEGER,
  doctor_coverage INTEGER,
  overall_coverage INTEGER,
  missing_equipments JSONB,     -- ["누락 장비"]
  missing_treatments JSONB,
  missing_doctors JSONB,
  issues JSONB,                 -- ["기타 문제"]
  status TEXT,                  -- 'pass', 'partial', 'fail', 'manual_review'
  validated_at TIMESTAMPTZ DEFAULT now(),
  tenant_id UUID DEFAULT '00000000-0000-0000-0000-000000000001'
);
```

### 6-4. 컬럼 참조

```
hospital_equipments:
  equipment_name, equipment_category, manufacturer, source

hospital_treatments:
  treatment_name, treatment_category, price, price_note,
  is_promoted, combo_with, source

hospital_doctors:
  name, title, specialty, education (TEXT[]),
  career (TEXT[]), academic_activity

hospital_events:
  title, description, discount_type, discount_value,
  related_treatments (TEXT[]), source_url, source

hospital_crawl_pages:
  url, page_type, markdown, char_count,
  screenshot_url, analysis_method, gemini_analyzed
```

---

## 7. 실행 프로토콜

### 7-1. 테스트 실행

```
1. DB 스키마 확인/생성
2. 테스트 병원 3개 선정 (다양한 유형)
3. 크롤링 + 원본 저장
4. 페이지별 Gemini 분석
5. 결과 병합 + 중복 제거
6. 자동 검증 (커버리지 체크)
7. 커버리지 70% 미만 → 재분석
8. 결과 보고 (위 4-3 형식)
9. 승인 대기
```

### 7-2. 전체 실행

```
1. 승인 후 시작
2. 10개 단위 배치 실행
3. 매 배치 후 진행률 + 크레딧 보고
4. 커버리지 70% 미만 병원은 별도 목록
5. 전체 완료 후:
   - 이전 vs 이번 비교표
   - 전체 통계
   - 커버리지 분포
   - export JSON 생성
6. manual_review 병원 목록 별도 보고
```

### 7-3. 재분석 (원본 있을 때)

이미 hospital_crawl_pages에 원본이 있으면:
- Firecrawl 재크롤링 불필요
- Gemini 프롬프트만 변경하여 재분석
- 크레딧 소모 없음

---

## 8. 환경 정보

- 프로젝트: C:\Users\J\Projects\madmedsales
- Firecrawl SDK: @mendable/firecrawl-js v4.13.0 (firecrawl.v1.xxx)
- Supabase: https://grtkcrzgwapsjcqkxlmj.supabase.co
- Supabase Storage: hospital-screenshots 버킷
- TENANT_ID: 00000000-0000-0000-0000-000000000001
- .env: scripts/.env
- Gemini 인증: scripts/analysis/gemini-auth.js
- Supabase 유틸: scripts/utils/supabase.js
- 이미지 최적화: sharp

---

## 9. 금지사항

1. ❌ 크롤링 원본을 메모리에서 처리 후 버리기
2. ❌ 텍스트를 앞에서 잘라서 뒤를 버리기
3. ❌ 텍스트 중간을 날리기
4. ❌ Gemini 호출 횟수를 임의로 고정하기
5. ❌ 검증 없이 "전체 실행" 넘어가기
6. ❌ mapUrl 결과가 적은데 추가 URL 수집 시도 안 하기
7. ❌ 이미지 기반 사이트에서 텍스트만으로 분석하기
8. ❌ 시술명 안의 장비를 무시하기
9. ❌ HTML 내비게이션 메뉴를 콘텐츠가 아닌 것으로 취급하기
10. ❌ 비용/크레딧 보고 생략하기
11. ❌ 로컬에 파일 저장하기 (전부 Supabase에)
12. ❌ 추측으로 "100% 성공" 보고하기
13. ❌ 관련 페이지가 있는데 임의로 크롤링 수를 줄이기 (필터 통과한 페이지는 전부 가져온다)
14. ❌ viewport 1장만 캡처하고 전체 페이지 캡처한 것처럼 처리하기
15. ❌ 팝업을 그냥 무시하거나 삭제만 하기 (이벤트 정보 있으므로 먼저 캡처)
16. ❌ 알고 있는 사이트 특성/한계를 설계에 선제 반영하지 않기
17. ❌ 문제를 알면서 지적받을 때까지 방치하기

---

## 변경 이력

| 버전 | 날짜 | 변경 내용 |
|------|------|-----------|
| v1~v3 | - | (설계 결함으로 폐기) |
| v4 | 2026-02-24 | 스크린샷+Vision 추가, 원본 저장, 이미지 최적화 |
| v5 | 2026-02-24 | 장비 분리 추출, 메뉴 파싱, 서브페이지 확대, 자동 검증, 팝업 2회 캡처, 스크롤 다중 캡처, screenshot_url JSONB 변경, 사이트 특성 10가지 대응, 금지사항 17개, 시스템 지침서화 |
