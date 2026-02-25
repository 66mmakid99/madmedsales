# 작업지시서: Firecrawl 타임아웃 대응 — Playwright 마크다운 fallback

## 문제 정의

Firecrawl 셀프호스팅 서버(독일 리전)에서 **한국 병원 사이트 크롤링 시 대량 타임아웃 발생.**

- 동안중심의원: 50페이지 중 절반 이상 타임아웃
- 원인 추정: 독일→한국 네트워크 지연 (~200ms) + 일부 한국 사이트의 해외 IP 쓰로틀링
- 결과: 크롤링 시간 과다 + 마크다운 데이터 누락

## 현재 구조의 문제

```
Firecrawl (독일 서버) → 마크다운 텍스트    ← 절반 타임아웃 실패
Playwright (로컬 PC)  → 스크린샷만          ← 정상 동작
```

Firecrawl이 실패하면 해당 페이지의 마크다운이 아예 없다.
Playwright는 이미 그 페이지에 접속해서 스크린샷을 찍고 있는데, 텍스트를 안 뽑고 있다.

## 해결 방향

Playwright가 스크린샷 찍을 때 **텍스트도 같이 추출**한다.
Firecrawl 실패 시 Playwright 텍스트로 대체한다.

```
[정상] Firecrawl → 마크다운 ✅ + Playwright → 스크린샷 ✅
[실패] Firecrawl → 타임아웃 ❌ → Playwright → 마크다운 ✅ + 스크린샷 ✅
```

추가로 `--playwright-only` 모드를 만들어서 Firecrawl을 아예 안 거치는 옵션도 제공한다.

---

## 작업 내용

### 1. screenshot-capture.ts 수정

#### 1-1. ScreenshotResult에 텍스트 필드 추가

```typescript
export interface ScreenshotResult {
  url: string;
  screenshots: Buffer[];
  totalHeight: number;
  viewportCount: number;
  errors: string[];
  // ▼ 신규 추가
  pageText: string;        // document.body.innerText (전체 텍스트)
  pageTitle: string;        // document.title
  pageHtml: string;         // 간소화된 HTML (선택적, 마크다운 변환용)
}
```

#### 1-2. captureScreenshots 함수에서 텍스트 추출 추가

스크린샷 촬영 완료 후, 같은 페이지에서 텍스트를 뽑는다.
**추가 네트워크 요청 없음** — 이미 열려있는 페이지에서 가져오는 것.

```typescript
// 스크린샷 촬영 루프 끝난 후, 브라우저 닫기 전에:
const pageText = await page.evaluate(() => document.body.innerText);
const pageTitle = await page.title();

// [선택] HTML도 가져와서 마크다운으로 변환하면 링크/이미지 정보 보존
// const pageHtml = await page.content();
// → turndown 같은 라이브러리로 마크다운 변환 가능
// → 하지만 1차로는 innerText만으로 충분. HTML 변환은 추후 필요 시.
```

#### 1-3. captureMultiplePages도 동일하게 수정

여러 URL 촬영 시 각 URL의 텍스트를 수집.

### 2. recrawl-v5.ts 수정

#### 2-1. Firecrawl 실패 페이지를 Playwright 텍스트로 대체

현재 파이프라인에서 Firecrawl 크롤링 후 pages 배열이 만들어진다.
Playwright 스크린샷 결과(ssResults)에 pageText가 있으니, Firecrawl이 실패한 URL에 대해 Playwright 텍스트를 채워넣는다.

```
로직:
1. Firecrawl 크롤링 완료 → pages 배열 (일부 URL은 실패로 누락)
2. Playwright 스크린샷 완료 → ssResults 배열 (각각 pageText 포함)
3. ssResults 중 pages에 없는 URL → 새 page 객체 생성하여 pages에 추가
   - markdown: ssResults[i].pageText
   - source: 'playwright-fallback' (출처 표시)
4. 콘솔에 "[v5.5] Playwright fallback: N개 페이지 마크다운 대체" 출력
```

#### 2-2. Playwright 크롤링 URL 확장

현재 스크린샷은 메인 + 서브 5개만 촬영한다.
Firecrawl이 타임아웃 나는 상황에서는 **Firecrawl이 시도한 전체 URL을 Playwright에도 넘겨야** 한다.

```
현재: screenshotUrls = [메인URL, ...서브 5개]
수정: screenshotUrls = Firecrawl이 크롤링 시도한 전체 URL 목록
     (단, Firecrawl이 이미 성공한 URL은 스크린샷만 촬영하고 텍스트는 버림)
     (Firecrawl이 실패한 URL은 스크린샷 + 텍스트 모두 사용)
```

**주의:** 50개 URL을 전부 Playwright로 돌리면 로컬 PC에서 시간이 오래 걸릴 수 있다.
→ 동시 실행(concurrency) 제한: 3~5개씩 병렬
→ 페이지당 타임아웃: 20초
→ 전체 타임아웃: 5분

#### 2-3. --playwright-only 플래그

Firecrawl 완전히 건너뛰고 Playwright만으로 전체 파이프라인 실행.

```
npx tsx scripts/recrawl-v5.ts --name "동안중심" --playwright-only
```

이 모드에서는:
1. Firecrawl map API로 사이트맵만 가져온다 (URL 목록만, 실패해도 진행)
   - 실패 시 → 메인 URL 하나만으로 시작
2. Playwright가 모든 URL을 방문하면서:
   - 마크다운(innerText) 추출
   - 스크린샷 촬영
   - 페이지 내 링크 수집 (사이트맵 대체)
3. 이후 파이프라인은 동일 (코드레벨 추출 → Gemini 분류 → 보고서)

**이 모드가 필요한 이유:**
- 서버가 아예 다운됐을 때
- 리전 이전 중 서버 접근 불가할 때
- 한국 사이트가 해외 IP를 완전 차단할 때
- 빠르게 1~2개 병원만 테스트할 때

#### 2-4. 콘솔 출력 강화

어떤 URL이 Firecrawl 성공이고, 어떤 URL이 Playwright fallback인지 명확히 출력:

```
📄 Firecrawl 성공: 23/50 페이지
⚠️ Firecrawl 타임아웃: 27/50 페이지
📸 Playwright fallback: 27개 페이지 마크다운 대체
📊 최종: 50/50 페이지 데이터 확보 (Firecrawl 23 + Playwright 27)
```

### 3. Playwright 텍스트 품질 보완

Playwright의 `document.body.innerText`는 Firecrawl의 마크다운과 다르다:
- Firecrawl 마크다운: 링크 `[텍스트](URL)`, 이미지 `![alt](src)`, 제목 `# 헤딩` 형식
- innerText: 순수 텍스트만 (링크 URL 없음, 이미지 없음)

**연락처 URL이 누락될 수 있다.**

보완책:
```typescript
// innerText 외에 링크도 별도 추출
const links = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('a[href]')).map(a => ({
    text: a.textContent?.trim() || '',
    href: a.getAttribute('href') || ''
  }));
});

// SNS 링크 필터링하여 텍스트 끝에 추가
const snsLinks = links.filter(l => 
  /kakao|naver|instagram|facebook|youtube|blog/.test(l.href)
);
const linkSection = snsLinks.map(l => `[${l.text}](${l.href})`).join('\n');
pageText += '\n\n--- 링크 목록 ---\n' + linkSection;
```

이렇게 하면 contact-extractor.ts의 URL 패턴매칭이 Playwright 텍스트에서도 동작한다.

---

## 작업 순서

```
Step 1: screenshot-capture.ts 수정
├─ 1-1. ScreenshotResult에 pageText, pageTitle 추가
├─ 1-2. captureScreenshots에서 텍스트+링크 추출 로직 추가
├─ 1-3. captureMultiplePages도 동일 수정
└─ 1-4. 단독 테스트: 동안중심의원 메인 → pageText 출력 확인

Step 2: recrawl-v5.ts fallback 로직
├─ 2-1. Firecrawl 실패 URL 감지 + Playwright 텍스트 대체 로직
├─ 2-2. 콘솔 출력 (Firecrawl 성공 N + Playwright fallback M)
└─ 2-3. 테스트: 동안중심의원 전체 파이프라인 (fallback 동작 확인)

Step 3: --playwright-only 모드
├─ 3-1. 플래그 추가 + Firecrawl 건너뛰기 로직
├─ 3-2. Playwright 단독 URL 수집 (사이트 내 링크 크롤링)
└─ 3-3. 테스트: 동안중심의원 --playwright-only

Step 4: 검증
├─ 4-1. 동안중심의원: fallback 모드 → TORR RF 감지 확인
├─ 4-2. 동안중심의원: --playwright-only → 결과 품질 비교
├─ 4-3. 안산엔비의원: --playwright-only 테스트
├─ 4-4. 포에버의원: 병원명 불일치 경고 확인
└─ 4-5. Firecrawl 결과 vs Playwright 결과 텍스트 품질 비교표 작성
```

---

## 금지사항

1. Firecrawl 타임아웃을 늘려서 해결하려 하지 말 것 — 근본 해결 아님
2. Playwright fallback 실패 시 조용히 무시 금지 — 에러 로그 필수
3. innerText만으로 충분하다고 판단하고 링크 추출 생략 금지 — 연락처 URL 누락됨
4. --playwright-only에서 URL 수집 없이 메인페이지만 분석하지 말 것 — 서브페이지 필수
5. 50개 URL 동시 Playwright 실행 금지 — concurrency 3~5로 제한

---

## 성공 기준

- [ ] Firecrawl 실패 URL을 Playwright 텍스트로 자동 대체
- [ ] 대체된 페이지 수가 콘솔에 명확히 표시됨
- [ ] --playwright-only 모드로 Firecrawl 없이 전체 파이프라인 완료
- [ ] Playwright 텍스트에서 SNS 링크(카톡/블로그/인스타)가 추출됨
- [ ] 동안중심의원에서 TORR RF 감지 성공
- [ ] 3개 병원(동안중심/안산엔비/포에버) 전부 보고서 생성 완료

---

## 이 작업 완료 후 다음 단계

이 fallback이 안정적으로 동작하면:
→ Contabo 서버를 독일 → 일본(도쿄) 리전으로 Live Migration
→ 비용: 월 +€3.65 (약 ₩5,000)
→ 효과: Firecrawl 타임아웃 자체가 대폭 감소 (레이턴시 200ms → 30ms)
→ fallback은 그대로 유지 (안전망)
