# 작업지시서: Firecrawl 스크린캡쳐 미지원 → Playwright 직접 호출로 대체

## 문제 정의

Firecrawl 셀프호스팅 서버(194.60.87.184:3002)에서 **스크린캡쳐 기능이 지원되지 않는다.**

구체적으로 2가지가 막혔다:
1. `actions` scrape → "Actions are not supported" 에러 (브라우저 조작 = Cloud 전용)
2. `screenshot` 포맷 요청 → "Engines tried: []" 에러 (스크린샷 포맷 = Cloud 전용)

**Firecrawl의 마크다운 텍스트 추출은 100% 정상 동작한다.** 스크린샷만 안 된다.

스크린샷이 없으면:
- 이미지에 박힌 텍스트(가격표, 이벤트 배너, 팝업 등)를 OCR로 읽을 수 없다
- v5.4 원본 데이터에서 355장 스크린샷 + 104건 OCR이 있었는데, 이걸 전부 잃는다
- 병원 분석 완성도가 떨어진다

## 해결 방향

**같은 서버에 이미 Playwright가 돌고 있다.** Firecrawl이 내부적으로 쓰는 Playwright 컨테이너:

```
firecrawl-playwright-service-1   Up 8 hours   (docker ps로 확인 완료)
```

Firecrawl을 거치지 않고 **Playwright를 직접 호출**해서 스크린샷을 촬영한다.

```
[기존 유지] Firecrawl API → 마크다운 텍스트 추출 (정상 동작)
[신규 추가] Playwright 직접 호출 → 스크린샷 촬영 → Gemini OCR 전달
```

추가 비용: ₩0 (같은 서버, 같은 리소스)

---

## 서버 현황 (확인 완료)

| 항목 | 값 |
|------|-----|
| 서버 IP | 194.60.87.184 |
| 호스팅 | Contabo VPS |
| OS | Ubuntu 24 |
| RAM | 7.8GB (2.2GB 사용, 5.6GB 여유) |
| 디스크 | 145GB (15GB 사용, 130GB 여유) |
| Docker 컨테이너 | 5개 모두 Up |
| Firecrawl API | localhost:3002 (정상) |
| Playwright 컨테이너 | firecrawl-playwright-service-1 (Up) |
| 인증 | USE_DB_AUTHENTICATION=false (키 검증 안함) |

---

## 작업 내용

### 신규 파일 생성: `scripts/v5/screenshot-capture.ts`

이 모듈이 하는 일:
1. 병원 URL을 받는다
2. Playwright 브라우저를 열어서 해당 URL에 접속한다
3. 페이지를 스크롤하면서 **화면 단위(viewport)로 여러 장** 스크린샷을 촬영한다
4. 촬영된 이미지 배열을 반환한다

### 스크린샷 촬영 방식: v5.4 동일 (방법 B)

**방법 B를 사용한다** — 스크롤하면서 화면 단위로 여러 장 촬영.

```
[이유]
- v5.4 원본 데이터에서 병원당 스크린샷이 4~100+장이었던 이유가 이 방식
- fullPage 통이미지 1장은 수만 픽셀이 되어 Gemini 입력 한도를 초과할 수 있음
- 화면 단위로 잘라야 Gemini가 각 섹션을 정확히 분석 가능
```

**촬영 로직:**
```
viewport 설정 (1280 x 1080)
↓
페이지 접속 + 로딩 대기
↓
전체 페이지 높이 측정
↓
while (스크롤 위치 < 전체 높이):
    현재 화면 스크린샷 촬영 → 배열에 추가
    1080px 아래로 스크롤
    짧은 대기 (동적 로딩 대응)
↓
스크린샷 배열 반환 (Buffer[])
```

### recrawl-v5.ts 수정

기존 크롤링 파이프라인에 스크린샷 단계를 추가한다:

```
[현재 v5.5 파이프라인]
① Firecrawl scrape → 마크다운 텍스트
② 코드 레벨 추출 (TORR RF, 연락처, 네비게이션)
③ Gemini 분류 (마크다운 + 추출 데이터 입력)
④ 보고서 생성

[수정 후 파이프라인]
① Firecrawl scrape → 마크다운 텍스트
①-b Playwright 스크린샷 촬영 → 이미지 배열        ← 신규
② 코드 레벨 추출 (TORR RF, 연락처, 네비게이션)
③ Gemini 분류 (마크다운 + 추출 데이터 + 스크린샷)  ← 수정
④ 보고서 생성
```

**①과 ①-b는 병렬 실행** 가능 (동시에 돌리면 시간 절약)

---

## ⚠️ 사전 확인 필수 사항 (이것부터 먼저 해결)

### 확인 1: Playwright 컨테이너 접근 방식

`firecrawl-playwright-service-1`은 Firecrawl이 내부적으로 쓰는 컨테이너다. 
**이 컨테이너가 외부에서 직접 호출 가능한지 확인해야 한다.**

```bash
# SSH 접속 후 확인할 것들:

# 1) 컨테이너 포트 확인 — 외부 포트가 매핑되어 있는지
docker port firecrawl-playwright-service-1

# 2) 컨테이너 내부 서비스 확인
docker exec firecrawl-playwright-service-1 ps aux

# 3) Docker 네트워크 확인 — 내부 IP
docker inspect firecrawl-playwright-service-1 | grep -A 5 "Networks"

# 4) Playwright 서비스가 어떤 프로토콜로 통신하는지 (WebSocket? HTTP?)
docker logs firecrawl-playwright-service-1 --tail 50
```

### 확인 1의 결과별 분기

| 결과 | 대응 |
|------|------|
| ✅ WebSocket 포트가 노출됨 (보통 3000 또는 9222) | `playwright.connect()` 로 원격 연결 |
| ⚠️ 포트가 Docker 내부에서만 접근 가능 | docker-compose.yml 수정해서 포트 노출 추가 |
| ❌ 단순 Chromium 프로세스이고 API 없음 | **대안 B로 전환** (아래 참조) |

### 확인 2: 프로젝트 코드에서 Playwright 의존성

```bash
# 프로젝트 루트에서:
cat package.json | grep playwright
# → playwright가 이미 있는지 확인
# → 없으면 npm install playwright 필요
```

---

## 🔄 대안 계획 (문제 발생 시)

### 대안 A: Docker 포트 노출 추가

기존 컨테이너의 포트가 내부에서만 접근 가능할 경우:

```yaml
# docker-compose.yml 수정
playwright-service:
  ports:
    - "9222:9222"  # 또는 해당 포트 번호
```

```bash
docker compose down && docker compose up -d
```

### 대안 B: 서버에 Playwright 직접 설치

기존 Playwright 컨테이너가 독립 API를 제공하지 않을 경우:

```bash
# 서버에 직접 Node.js + Playwright 설치
npm install playwright
npx playwright install chromium --with-deps
```

그 후 코드에서 로컬 Playwright를 사용:

```typescript
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
```

**장점:** 컨테이너 의존성 없음, 직접 제어
**단점:** 서버에 추가 설치 필요 (~300MB)
**서버 여유:** 디스크 130GB, RAM 5.6GB → 충분

### 대안 C: MADMEDSALES 프로젝트 내에서 Playwright 실행

만약 서버 접속 없이 로컬(개발 PC)에서 실행하는 구조라면:

```
로컬 PC에서 Playwright 실행 → 스크린샷 촬영
→ Buffer를 Gemini에 전달
→ Firecrawl 서버는 마크다운만 담당
```

---

## 기술 상세

### screenshot-capture.ts 인터페이스

```typescript
interface ScreenshotResult {
  url: string;
  screenshots: Buffer[];       // viewport 단위 이미지들
  totalHeight: number;          // 페이지 전체 높이
  viewportCount: number;        // 촬영된 스크린샷 수
  errors: string[];             // 발생한 에러들
}

// 메인 함수
async function captureScreenshots(
  url: string,
  options?: {
    viewportWidth?: number;     // 기본값 1280
    viewportHeight?: number;    // 기본값 1080
    waitAfterScroll?: number;   // 스크롤 후 대기 ms, 기본값 500
    maxScreenshots?: number;    // 최대 촬영 수, 기본값 50
    timeout?: number;           // 페이지 로딩 타임아웃, 기본값 30000
  }
): Promise<ScreenshotResult>
```

### Gemini 입력 수정 (prompts.ts)

현재 Gemini에 마크다운 텍스트만 보내고 있다면, 스크린샷 이미지도 함께 보내야 한다:

```typescript
// 현재
const response = await gemini.generateContent([
  { text: markdownContent + navMenuText + ... }
]);

// 수정 후
const parts = [
  { text: markdownContent + navMenuText + ... },
  // 스크린샷 이미지 추가
  ...screenshots.map(buf => ({
    inlineData: {
      mimeType: 'image/png',
      data: buf.toString('base64')
    }
  }))
];
const response = await gemini.generateContent(parts);
```

### 주의사항

1. **Gemini 입력 한도:** 이미지가 너무 많으면 토큰 초과. `maxScreenshots` 옵션으로 제어. 병원 사이트가 50페이지 넘는 경우 → 앞쪽 30장 + 뒤쪽 5장 등 샘플링 전략 필요
2. **메모리 관리:** 스크린샷 Buffer를 메모리에 쌓으므로, 큰 사이트에서 RAM 주의. 촬영 즉시 base64로 변환하고 Buffer 해제
3. **한국 사이트 특성:**
   - 네이버 모듈(카페/블로그) 임베드 → iframe 내부는 별도 처리 필요할 수 있음
   - 팝업/모달 → 로딩 후 팝업 닫기 로직 고려
   - 플래시/ActiveX 잔재 → 무시 (2026년 기준 대부분 사라짐)
4. **User-Agent:** 병원 사이트가 봇을 차단할 수 있으므로 일반 브라우저 UA 설정
5. **에러 격리:** 스크린샷 실패해도 마크다운 기반 분석은 계속 진행 (스크린샷은 보조 데이터)

---

## 작업 순서

```
Phase 1: 환경 확인 (서버 SSH)
├─ 1-1. Playwright 컨테이너 포트/프로토콜 확인
├─ 1-2. 연결 방식 결정 (원격 연결 vs 직접 설치)
└─ 1-3. 결정된 방식으로 단순 테스트 (example.com 스크린샷 1장)

Phase 2: 모듈 개발
├─ 2-1. scripts/v5/screenshot-capture.ts 생성
├─ 2-2. 단독 실행 테스트 (동안중심의원 1개)
└─ 2-3. 스크린샷 수량/크기 확인

Phase 3: 파이프라인 통합
├─ 3-1. recrawl-v5.ts에 스크린샷 단계 추가
├─ 3-2. Gemini 입력에 이미지 추가 (prompts.ts 수정)
├─ 3-3. --no-screenshot 플래그 추가 (스크린샷 건너뛰기 옵션)
└─ 3-4. 에러 시 graceful fallback (마크다운만으로 계속 진행)

Phase 4: 검증
├─ 4-1. 동안중심의원 → 스크린샷 포함 전체 파이프라인 실행
├─ 4-2. v5.4 원본 데이터(355장)와 비교
├─ 4-3. 안산엔비의원, 포에버의원도 테스트
└─ 4-4. 스크린샷 유무에 따른 Gemini 분석 결과 차이 비교
```

---

## 금지사항

1. Firecrawl Cloud 유료 플랜으로 전환 제안 금지 — 셀프호스팅 유지가 원칙
2. "스크린샷 없어도 마크다운만으로 충분하다" 판단 금지 — v5.4와 동일한 데이터 품질이 목표
3. 스크린샷 실패 시 조용히 무시 금지 — 반드시 에러 로그 출력하고, 콘솔에 "스크린샷 X건 실패" 표시
4. Phase 1 건너뛰기 금지 — 환경 확인 없이 코드부터 작성하지 말 것
5. fullPage 통이미지 방식 사용 금지 — 반드시 viewport 단위로 분할 촬영 (v5.4 동일)

---

## 성공 기준

- [ ] 동안중심의원 URL로 스크린샷 10장 이상 촬영 성공
- [ ] 촬영된 스크린샷이 Gemini 입력으로 정상 전달됨
- [ ] 스크린샷 포함 시 TORR RF 감지율/의료기기 추출율이 마크다운 단독 대비 향상됨
- [ ] 스크린샷 실패해도 마크다운 기반 분석이 중단 없이 완료됨
- [ ] --no-screenshot 옵션으로 스크린샷 단계를 건너뛸 수 있음
- [ ] 추가 비용 ₩0 (서버 리소스만 사용)

---

## 참고 파일 위치

| 파일 | 위치 |
|------|------|
| 메인 크롤링 스크립트 | scripts/recrawl-v5.ts |
| TORR RF 감지 모듈 | scripts/v5/torr-detector.ts |
| 연락처 추출 모듈 | scripts/v5/contact-extractor.ts |
| Gemini 프롬프트 | scripts/v5/prompts.ts |
| 타입 정의 | scripts/v5/types.ts |
| v5.5 패치 문서 | PATCH-v5.5-VERIFICATION-FIX.md |
| 원본 크롤링 데이터 (참조) | raw_crawl_data_3hospitals_20260225.docx |
| .env (Firecrawl 설정) | .env (FIRECRAWL_API_URL, FIRECRAWL_API_KEY) |
