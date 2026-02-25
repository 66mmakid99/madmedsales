# Claude Code 명령문 — TORR RF 재크롤링 + 재분석 v5 (최종)

---

## ⛔ 작업 규칙 — 이 섹션을 무시하면 전체 결과가 무효다

### 네가 하지 말아야 할 것

1. "일단 돌려보고 결과 보자" → **금지.** 돌리기 전에 설계를 검증해.
2. "3개 병원 숫자 나왔으니 전체 실행할까요?" → **금지.** 숫자 나온 건 성공이 아니다. 실제 사이트 대비 커버리지를 측정하고 보고해.
3. "시술 6개 추출됐습니다 ✅" → **금지.** 사이트에 93개 있는데 6개면 실패다. 사이트에 있는 총량 대비 비율을 보고해.
4. "장비 0개입니다" → **금지.** 시술명에 "울쎄라", "슈링크", "인모드"가 있으면 장비가 0개일 수 없다. 왜 0인지 원인을 찾아서 고쳐.
5. "스크린샷 캡처했습니다" → viewport 상단만 찍은 건 전체 캡처가 아니다. 팝업 포함 + 스크롤 다중 캡처까지 해야 캡처한 거다.
6. "100% 충족" 같은 말 → **추측으로 하지 마.** 근거(원본 대비 추출 비율)를 숫자로 보여줘.
7. 알고 있는 문제를 설계에 반영 안 하고 넘어가는 것 → **금지.** 한국 피부과 사이트 특성, 크롤링 한계를 사전에 대응해.

### 네가 반드시 해야 할 것

1. 프로젝트 루트에 `MADMEDSALES-CRAWL-SYSTEM-GUIDE-v5.md`를 저장하고, 매 작업 전에 참조해.
2. 스크립트 작성 전에 핵심사항(데이터 저장 방식, 처리 로직, 비용 영향, 손실 위험)을 정리해서 콘솔에 출력해.
3. 매 병원 처리 후 자동 검증을 실행하고, 커버리지 수치를 보고해.
4. 빌드/실행 전 반드시 확인. 추측하지 마. 안 되면 "안 됩니다, 원인은 X"라고 말해.
5. 문제를 발견하면 그 자리에서 고쳐. "나중에 수정" 없다.

---

## 1. 사전 준비

### 1-1. 시스템 지침서 저장

프로젝트 루트(`C:\Users\J\Projects\madmedsales`)에 `MADMEDSALES-CRAWL-SYSTEM-GUIDE-v5.md`를 저장해.
이 파일은 크롤링/분석의 모든 규칙을 담고 있다. 스크립트 작성할 때 반드시 참조해.

### 1-2. DB 스키마 변경

Supabase SQL Editor에서 실행할 SQL을 콘솔에 출력해. 내가 실행한다.

```sql
-- 1. 검증 결과 테이블
CREATE TABLE IF NOT EXISTS hospital_crawl_validations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  hospital_id UUID REFERENCES hospitals(id),
  crawl_version TEXT NOT NULL DEFAULT 'v5',
  equipment_coverage INTEGER,
  treatment_coverage INTEGER,
  doctor_coverage INTEGER,
  overall_coverage INTEGER,
  missing_equipments JSONB DEFAULT '[]',
  missing_treatments JSONB DEFAULT '[]',
  missing_doctors JSONB DEFAULT '[]',
  issues JSONB DEFAULT '[]',
  status TEXT DEFAULT 'pending',
  validated_at TIMESTAMPTZ DEFAULT now(),
  tenant_id UUID DEFAULT '00000000-0000-0000-0000-000000000001'
);

-- RLS
ALTER TABLE hospital_crawl_validations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_validations" ON hospital_crawl_validations
  USING (tenant_id = '00000000-0000-0000-0000-000000000001');

-- 2. screenshot_url을 JSONB 배열로 변경 (다중 캡처 대응)
ALTER TABLE hospital_crawl_pages 
  ALTER COLUMN screenshot_url TYPE JSONB USING 
    CASE WHEN screenshot_url IS NULL THEN '[]'::jsonb
         ELSE jsonb_build_array(screenshot_url) END;
```

SQL 실행 완료 확인 후 다음 단계 진행.

### 1-3. Firecrawl actions 기능 테스트

v5의 핵심인 다중 캡처가 가능한지 **먼저 검증**해.

```typescript
// 테스트 1: actions + screenshot이 동작하는지 확인
const test = await firecrawl.v1.scrapeUrl('http://www.dongancenter.com/', {
  formats: ['markdown', 'screenshot'],
  waitFor: 3000,
  actions: [
    { type: 'screenshot' },
    { type: 'click', selector: '[class*="close"], [class*="닫기"], .popup-close' },
    { type: 'wait', milliseconds: 500 },
    { type: 'screenshot' },
    { type: 'scroll', direction: 'down', amount: 3 },
    { type: 'wait', milliseconds: 500 },
    { type: 'screenshot' },
  ]
});
```

확인할 것:
- actions가 지원되는가? (에러 나는가?)
- screenshot이 여러 장 반환되는가? (배열인가?)
- 반환 형식은? (base64? URL? 어떤 필드에?)
- 크레딧 추가 소모가 있는가?

**actions가 안 되면:** 대안을 찾아. Puppeteer 직접 사용, fullPageScreenshot 옵션 등. 
안 되는 채로 넘어가지 마. 대안 없이는 진행 금지.

결과를 콘솔에 출력하고 나한테 보고해. 내가 확인 후 다음 단계.

---

## 2. 스크립트 작성 (recrawl-v5.ts)

v4 스크립트(scripts/recrawl-v4.ts)를 기반으로 수정.
시스템 지침서 참조해서 아래 변경사항 전부 반영.

### 2-1. URL 수집 확대

```typescript
async function collectUrls(mainUrl: string): Promise<string[]> {
  // 1차: mapUrl (limit: 100)
  const mapResult = await firecrawl.v1.mapUrl(mainUrl, { limit: 100 });
  let urls = mapResult.links || [];
  
  // 2차: 5개 미만이면 메인 HTML에서 내부 링크 직접 추출
  if (urls.length < 5) {
    const mainPage = await firecrawl.v1.scrapeUrl(mainUrl, {
      formats: ['markdown'],
      waitFor: 5000,
    });
    // 마크다운에서 [텍스트](URL) 패턴 추출
    const linkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
    const domain = new URL(mainUrl).hostname;
    let match;
    while ((match = linkRegex.exec(mainPage.markdown || '')) !== null) {
      try {
        const fullUrl = new URL(match[2], mainUrl).href;
        if (new URL(fullUrl).hostname === domain) urls.push(fullUrl);
      } catch {}
    }
    urls = [...new Set(urls)];
  }
  
  // 필터링 (시스템 지침서 2-2 포함/제외 패턴)
  const filtered = filterRelevantUrls(urls);
  
  // 전부 가져온다. 50개 초과 시에만 우선순위로 자른다.
  if (filtered.length > 50) {
    return prioritizeUrls(filtered).slice(0, 50);
  }
  return filtered;
}
```

포함 패턴에 `/landing/` 반드시 포함할 것 (동안중심의원 개별 시술 페이지).

### 2-2. 스크린샷 다중 캡처

1-3 테스트 결과에 따라 구현.

actions 지원 시:
```typescript
async function scrapeWithMultiScreenshot(url: string) {
  return await firecrawl.v1.scrapeUrl(url, {
    formats: ['markdown', 'screenshot'],
    waitFor: 3000,
    actions: [
      // 1: 팝업 포함 캡처
      { type: 'screenshot' },
      // 팝업 닫기 시도
      { type: 'click', selector: '.popup-close, .modal-close, [class*="close"], [class*="닫기"], .btn-close, .close-btn' },
      { type: 'wait', milliseconds: 500 },
      // 2: 상단 (팝업 닫은 후)
      { type: 'screenshot' },
      // 3: 중간 스크롤
      { type: 'scroll', direction: 'down', amount: 3 },
      { type: 'wait', milliseconds: 500 },
      { type: 'screenshot' },
      // 4: 하단 스크롤
      { type: 'scroll', direction: 'down', amount: 3 },
      { type: 'wait', milliseconds: 500 },
      { type: 'screenshot' },
    ]
  });
}
```

각 스크린샷을 sharp 최적화 후 Supabase Storage 저장:
```
{hospital_id}/{page_type}_{url_slug}_{date}_popup.webp
{hospital_id}/{page_type}_{url_slug}_{date}_top.webp
{hospital_id}/{page_type}_{url_slug}_{date}_mid.webp
{hospital_id}/{page_type}_{url_slug}_{date}_bottom.webp
```

hospital_crawl_pages.screenshot_url에 JSONB 배열로 저장:
```json
[
  { "url": "...popup.webp", "position": "popup", "order": 0 },
  { "url": "...top.webp", "position": "top", "order": 1 },
  { "url": "...mid.webp", "position": "mid", "order": 2 },
  { "url": "...bottom.webp", "position": "bottom", "order": 3 }
]
```

### 2-3. Gemini 프롬프트 (v5)

시스템 지침서 섹션 3-3의 프롬프트를 **그대로** 사용.
변수 치환만:
- `{콘텐츠_유형}`: 텍스트 분석이면 "텍스트", Vision이면 "이미지"
- `{병원명}`: hospitals 테이블의 name
- `{page_type}`: crawl_pages의 page_type
- `{지점_정보}`: 다지점이면 "이 병원은 {이름}의 '{지점}'점입니다. 가능하면 '{지점}'점 소속 정보만 추출하세요." / 단일이면 빈 문자열

**핵심 변경 확인 체크리스트 (v4에서 못 했던 것):**
- [ ] "시술명 안에 포함된 장비명도 반드시 분리 추출" 예시 포함됐는가
- [ ] "내비게이션 메뉴의 시술 링크도 시술 목록으로 추출" 포함됐는가
- [ ] 장비명 정규화 테이블 24종 포함됐는가
- [ ] 다지점 지시 포함됐는가
- [ ] 학술활동/KOL 추출 지시 포함됐는가

하나라도 빠지면 v4와 같은 실패를 반복한다. 확인해.

### 2-4. 분석 방법 결정

```
텍스트 500자 이상 → 텍스트 분석
텍스트 500자 미만 & 스크린샷 있음 → Vision 분석
텍스트 분석 결과 빈약 → Vision 추가 (both)
```

"빈약" 기준:
- 시술 관련 페이지인데 시술 0개
- 의료진 페이지인데 의사 0명
- 메인 페이지인데 시술+장비+의사 합계 3개 미만
- 내비게이션 메뉴에 시술 링크 10개+ 있는데 시술 추출 5개 미만

Vision 분석 시 다중 스크린샷 전부 순서대로 분석.

### 2-5. 텍스트 청크 분할

25,000자 초과 시 문단 경계에서 분할. 자르지 않는다. 전부 분석한다.

### 2-6. 결과 병합 + 중복 제거

**장비:**
- 정규화된 name 기준 중복 제거
- "시술명에서 분리 추출된 장비"도 동일하게 병합

**시술:**
- 1차: 정확 name 매칭 → 가격 있는 쪽 우선
- 2차: 핵심 키워드 (장비명 + 샷수/회차) 매칭 → 가격 다르면 둘 다 유지
- 이벤트 패키지 (복주머니 P!CK 류) → events로 재분류

**의사:**
- name 기준, 정보 많은 쪽 우선

**이벤트:**
- title 유사도 기준

### 2-7. 자동 검증 (매 병원 완료 후)

Gemini 1회 추가 호출. 시스템 지침서 섹션 4-1의 검증 프롬프트 사용.

검증 결과를 hospital_crawl_validations에 INSERT.

커버리지 기준:
- 70% 이상: pass
- 50~69%: partial → 자동 재분석 (missing 힌트 추가)
- 50% 미만: fail → manual_review 플래그

---

## 3. 테스트 실행

### 3-0. 테스트 전 체크

스크립트 작성 완료 후, 실행 전에 아래를 콘솔에 출력해:

```
═══════════════════════════════════════
  v5 사전 체크리스트
═══════════════════════════════════════

[환경]
  sharp 설치: ✅/❌
  Supabase Storage 버킷: ✅/❌
  hospital_crawl_validations 테이블: ✅/❌
  screenshot_url JSONB 변경: ✅/❌
  Firecrawl actions 지원: ✅/❌ (대안: ...)

[프롬프트 체크]
  시술명→장비 분리 추출 지시: ✅/❌
  메뉴 시술 추출 지시: ✅/❌
  장비 정규화 24종: ✅/❌
  다지점 처리: ✅/❌
  학술활동/KOL: ✅/❌

[스크린샷 체크]
  팝업 2회 캡처: ✅/❌
  스크롤 다중 캡처: ✅/❌
  JSONB 배열 저장: ✅/❌

[URL 수집 체크]
  mapUrl < 5 → HTML 링크 추출: ✅/❌
  /landing/ 경로 포함: ✅/❌
  페이지 수 상한: 50 (임의 축소 없음): ✅/❌

전부 ✅일 때만 실행 시작.
```

하나라도 ❌이면 해결하고 다시 체크. 넘어가지 마.

### 3-1. 테스트 대상

| 병원 | 유형 | 핵심 검증 포인트 |
|------|------|-----------------|
| 동안중심의원 | 이미지 기반 + 메뉴 풍부 | 메뉴에서 시술 93종 추출, 장비 20종+ 추출, 의사 2명 |
| 안산엔비의원 | 서브페이지 필요 + KOL | 원장 추출 (학술활동 KOL), 서브페이지 크롤 확대 |
| 포에버의원(신사) | 다지점 + 시술 풍부 | 시술→장비 분리 11종+, 중복 제거, 지점 필터 |

### 3-2. 실행

```bash
npx tsx scripts/recrawl-v5.ts --limit 3
```

### 3-3. 병원별 검증 보고 형식

매 병원 처리 완료 후 아래 형식으로 콘솔 출력:

```
═══════════════════════════════════════
  {병원명} — v5 검증 결과
═══════════════════════════════════════

[크롤링]
  URL 수집: mapUrl {N}개 → 필터 후 {N}개 → 크롤 완료 {N}개
  페이지 목록:
    main    | {URL} | {char_count}자 | 스크린샷 {N}장
    doctor  | {URL} | {char_count}자 | 스크린샷 {N}장
    ...
  크레딧 소모: scrape {N} + map 1 = {N}

[추출 결과]
  장비: {N}개
    - {장비1}, {장비2}, {장비3}, ...
  시술: {N}개 (가격 포함 {N}개)
    - {상위 10개 나열}
    - 외 {N}개
  의사: {N}명
    - {이름1} ({직함}, 학력: {O/X}, 경력: {O/X}, 학술: {O/X})
    - {이름2} ...
  이벤트: {N}개
    - {제목1}, {제목2}, ...

[자동 검증 — Gemini 커버리지 체크]
  장비 커버리지: {N}% ({추출}/{원본 추정})
    누락: {목록}
  시술 커버리지: {N}% ({추출}/{원본 추정})
    누락 상위 10개: {목록}
  의사 커버리지: {N}% ({추출}/{원본 추정})
    누락: {목록}
  전체 커버리지: {N}%

[판정]
  ✅ PASS (전체 70%+)
  ⚠️ PARTIAL (50~69%) → 재분석 실행
  ❌ FAIL (50% 미만) → manual_review

[이전 버전(v4) 대비]
  장비: {v4}개 → {v5}개 ({변화})
  시술: {v4}개 → {v5}개 ({변화})
  의사: {v4}명 → {v5}명 ({변화})
  이벤트: {v4}개 → {v5}개 ({변화})
```

### 3-4. 3개 병원 전부 완료 후

```
═══════════════════════════════════════
  v5 테스트 종합 결과
═══════════════════════════════════════

| 병원 | 장비 | 시술 | 의사 | 이벤트 | 커버리지 | 판정 |
|------|------|------|------|--------|----------|------|
| 동안중심 | ?개 | ?개 | ?명 | ?개 | ?% | ? |
| 안산엔비 | ?개 | ?개 | ?명 | ?개 | ?% | ? |
| 포에버 | ?개 | ?개 | ?명 | ?개 | ?% | ? |

크레딧 소모: 총 {N} (잔여 {N})
Supabase Storage: {N}MB 사용

전체 실행 여부: 3개 병원 전부 PASS → 승인 요청
                  PARTIAL/FAIL 있음 → 원인 분석 + 수정 후 재테스트
```

**3개 병원 전부 PASS일 때만 "승인 요청"을 해. PARTIAL이나 FAIL이 있으면 고치고 다시 돌려.**

---

## 4. 전체 실행 (내 승인 후에만)

### 4-1. 실행 범위

- v4에서 원본(hospital_crawl_pages) 있는 병원: **재분석만** (Firecrawl 크레딧 0)
- 원본 없는 병원: **재크롤링 + 분석**
- v5 테스트 3개 병원: 이미 완료 → 스킵

### 4-2. 배치 실행

10개 단위로 실행. 매 배치 완료 후:

```
배치 {N}/5 완료
  처리: {병원 목록}
  PASS: {N}개, PARTIAL: {N}개, FAIL: {N}개
  크레딧 소모: 이번 배치 {N}, 누적 {N}, 잔여 {N}
  Storage: 이번 {N}MB, 누적 {N}MB
```

### 4-3. 전체 완료 후

```
═══════════════════════════════════════
  v5 전체 실행 결과
═══════════════════════════════════════

[전체 통계]
  대상: {N}개 병원
  PASS: {N}개 ({N}%)
  PARTIAL: {N}개 ({N}%)
  FAIL: {N}개 ({N}%)
  manual_review: {N}개

[데이터 변화 — v4 vs v5]
  장비 총: {v4}개 → {v5}개 ({+N, +N%})
  시술 총: {v4}개 → {v5}개
  의사 총: {v4}명 → {v5}명
  이벤트 총: {v4}개 → {v5}개
  가격 포함 시술: {v4}개 → {v5}개

[크레딧/비용]
  Firecrawl: {N} 소모, {N} 잔여
  Storage: {N}MB / 1GB

[TORR RF 관련]
  TORR RF 보유 병원: {N}개
  TORR Comfort Dual 보유: {N}개
  TORR 관련 시술: {N}개
  TORR 관련 이벤트: {N}개

[manual_review 병원 목록]
  {병원명} — 사유: {...}
```

export JSON: `torr-rf-hospitals-full-export-v5.json`

---

## 5. Gemini 프롬프트 전문

### 5-1. 추출 프롬프트

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
   예시: "덴서티 300샷" → equipments에 "Density" 추가
   예시: "원쎄라 2000샷" → equipments에 "Wonsera" 추가
3. 내비게이션 메뉴의 시술 링크에서도 장비명 추출
   예시: 메뉴에 "써마지FLX 이용시술" → equipments에 "Thermage FLX" 추가
   예시: 메뉴에 "울쎄라 이용시술" → equipments에 "Ulthera" 추가
   예시: 메뉴에 "슈링크리프팅 이용시술" → equipments에 "Shrink Universe" 추가

### 시술 (treatments)
1. 시술 소개, 가격표, 이벤트 페이지의 시술을 추출
2. ★★★ 내비게이션 메뉴/사이드바의 시술 링크도 시술 목록으로 추출 ★★★
   메뉴에 "울쎄라 이용시술", "써마지FLX 이용시술" → 각각 시술로 추출
   메뉴에 "색소 > 레드터치 pro 이용시술" → "레드터치 pro 이용시술"로 추출
3. 같은 시술의 다른 회차/샷수는 개별 항목으로 (가격이 다를 수 있으므로)
4. 패키지/콤보 시술도 추출 (combo_with에 구성 기재)

### 의사 (doctors)
1. 의료진 소개 페이지의 의사 정보 추출
2. 다지점 병원인 경우: {지점_정보}에 해당하는 지점만 추출
   지점 구분 불가능하면 전체 추출하되 notes에 "전 지점 통합 목록" 표시
3. 학력, 경력, 학술활동은 텍스트에 있는 그대로 추출
4. ★★★ 학술대회 참가, 강연, 저서 편찬, KOL 활동도 academic_activity에 추출 ★★★
5. 이미지 캡션이나 alt 텍스트에 있는 의사 정보도 추출

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
★ 가격 정보가 있으면 반드시 추출. "~부터", "VAT별도" 등 조건도 price_note에.
★ 학술활동, 학회 참가, 강연, 저서 정보가 있으면 반드시 추출.

## JSON 출력 형식

{
  "equipments": [{ "name": "정규화 장비명", "category": "laser|rf|hifu|body|lifting|booster|skin|other", "manufacturer": "제조사 or null" }],
  "treatments": [{ "name": "시술명 원문", "category": "lifting|laser|body|booster|filler_botox|skin|hair|other", "price": 숫자 or null, "price_note": "조건 or null", "is_promoted": true/false, "combo_with": "콤보 or null" }],
  "doctors": [{ "name": "이름", "title": "직함", "specialty": "전문 or null", "education": "학력 or null", "career": "경력 or null", "academic_activity": "학술/KOL or null", "notes": "참고 or null" }],
  "events": [{ "title": "제목", "description": "내용", "discount_type": "percent|fixed|package|free_add|other", "discount_value": "값", "related_treatments": ["시술명"] }]
}

없는 항목은 빈 배열 []. JSON만 응답 (마크다운 코드블록 없이).
```

### 5-2. 검증 프롬프트

```
당신은 데이터 품질 검증 전문가입니다.

[원본 마크다운]
{병원의 모든 크롤링 페이지 마크다운 합본 — 자르지 말 것}

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
5. 학술활동/학회/강연/저서 정보가 있는데 추출 안 된 것

JSON으로 응답:
{
  "missing_equipments": ["누락된 장비명"],
  "missing_treatments": ["누락된 시술명 (상위 20개)"],
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

---

## 6. 환경 정보

- 프로젝트: C:\Users\J\Projects\madmedsales
- Firecrawl SDK: @mendable/firecrawl-js v4.13.0 (firecrawl.v1.xxx)
- Supabase: https://grtkcrzgwapsjcqkxlmj.supabase.co
- Supabase Storage: hospital-screenshots 버킷 (public)
- TENANT_ID: 00000000-0000-0000-0000-000000000001
- .env: scripts/.env
- Gemini 인증: scripts/analysis/gemini-auth.js
- Supabase 유틸: scripts/utils/supabase.js
- 이미지 최적화: sharp
- 시스템 지침서: MADMEDSALES-CRAWL-SYSTEM-GUIDE-v5.md (프로젝트 루트)
- 기존 v4 스크립트: scripts/recrawl-v4.ts (참고용)

---

## 7. 금지사항 (17개)

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
13. ❌ 관련 페이지가 있는데 임의로 크롤링 수를 줄이기
14. ❌ viewport 1장만 캡처하고 전체 페이지 캡처한 것처럼 처리하기
15. ❌ 팝업을 그냥 무시하거나 삭제만 하기 (이벤트 정보 먼저 캡처)
16. ❌ 알고 있는 사이트 특성/한계를 설계에 선제 반영하지 않기
17. ❌ 문제를 알면서 지적받을 때까지 방치하기

---

## 8. 실행 순서 요약

```
준비:
  1. 시스템 지침서 저장
  2. SQL 실행 (내가 함)
  3. Firecrawl actions 테스트 → 결과 보고 → 내 확인

스크립트:
  4. recrawl-v5.ts 작성 (v4 기반 수정)
  5. 사전 체크리스트 출력 → 전부 ✅ 확인

테스트:
  6. 3개 병원 실행
  7. 병원별 검증 보고 (커버리지 수치 포함)
  8. 3개 전부 PASS → 종합 결과 보고 → 내 승인 대기
     PARTIAL/FAIL → 수정 후 재테스트

전체 (승인 후):
  9. 10개 배치 실행 + 매 배치 보고
  10. 전체 완료 후 종합 보고 + export JSON
```

**각 단계에서 내 확인/승인 없이 다음으로 넘어가지 마.**
