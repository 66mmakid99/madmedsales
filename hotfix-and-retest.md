# E2E 파이프라인 핫픽스 + 10건 전체 재테스트

## 배경
첫 E2E 테스트에서 8/10 성공했으나, 성공한 건도 데이터 품질이 부족하다.
바노바기피부과는 장비 1개만 감지(실제 7개 이상), 이미지 OCR은 10건 전부 0건.
이번 핫픽스의 목표는 **완벽한 크롤링 품질**이다. 비용은 신경쓰지 않는다.

---

## 핫픽스 1: Gemini 모델 업그레이드

### 대상 파일: Gemini API를 호출하는 모든 파일 (analyze-web.ts, analyze-images.ts, screenshot-ocr.ts 등)

현재 모델: `gemini-2.0-flash`
변경 모델: `gemini-2.5-pro-preview-05-06` (또는 사용 가능한 최신 2.5-pro)

작업:
1. 프로젝트 내에서 `gemini-2.0-flash` 또는 `gemini` 모델명이 하드코딩된 모든 위치를 찾아라
2. 모델명을 환경변수 `GEMINI_MODEL`로 추출하고, 기본값을 `gemini-2.5-pro-preview-05-06`으로 설정
3. 만약 2.5-pro가 API에서 거부되면 `gemini-2.5-flash-preview-04-17` → `gemini-2.0-flash` 순서로 폴백
4. .env 파일에 `GEMINI_MODEL=gemini-2.5-pro-preview-05-06` 추가

검증: Gemini API에 간단한 테스트 프롬프트를 보내서 2.5-pro 모델이 응답하는지 확인.
응답 헤더 또는 로그에 실제 사용된 모델명을 출력하도록 로깅 추가.

---

## 핫픽스 2: 파이프라인 생존성 강화 (텍스트 실패 → OCR 계속)

### 대상 파일: run-batch-pipeline.ts, run-single-pipeline.ts (또는 단일 병원 실행 진입점)

현재 문제: 
- fetchPage() 실패 시 process.exit(1) 또는 early return → Pass 2 미실행
- 결과: 닥터스피부과 신사, 톡스앤필 강서 완전 실패 (장비 0, 시술 0)

수정 내용:
1. 프로젝트 전체에서 `process.exit`를 검색하라. 모든 위치를 리스트업하라.
2. 각 exit를 분류:
   - 인프라 에러 (DB 연결 실패, 환경변수 누락 등) → exit 유지
   - 크롤링 실패 (fetchPage 에러, 타임아웃, 빈 응답 등) → exit 제거
3. 크롤링 실패 시 흐름을 아래처럼 변경:

```typescript
// AS-IS (잘못된 흐름)
const textResult = await fetchPage(url);
if (!textResult || textResult.length === 0) {
  console.error('텍스트 크롤링 실패');
  process.exit(1); // ← 여기서 죽음. Pass 2 영원히 도달 못함
}

// TO-BE (올바른 흐름)
let textResult = '';
let textCrawlSuccess = false;
try {
  textResult = await fetchPage(url);
  textCrawlSuccess = textResult.length > 0;
} catch (error) {
  console.warn(`[WARN] 텍스트 크롤링 실패: ${error.message}. 스크린샷 OCR로 대체 시도.`);
  textCrawlSuccess = false;
}

// Pass 2 진입 조건 수정: 텍스트가 비었으면 무조건 OCR 실행
const shouldRunOcr = !textCrawlSuccess 
  || changeDetected 
  || isFirstCrawl 
  || extractedText.length < 500; // 텍스트가 너무 적어도 OCR 보강
```

4. Pass 1 → Pass 2 사이의 모든 early return도 동일하게 수정
5. 최종적으로 Pass 1 실패 + Pass 2 실패인 경우에만 해당 병원을 FAILED로 기록하되, 파이프라인 자체는 다음 병원으로 넘어간다

검증: 
- 존재하지 않는 URL (https://www.this-hospital-does-not-exist-12345.com/)로 파이프라인 실행
- Pass 1 실패 로그 출력 → Pass 2(스크린샷) 시도 로그 출력까지 확인
- process.exit로 죽지 않고 정상 종료되는지 확인

---

## 핫픽스 3: Gemini 프롬프트 전면 강화

### 3-A. 장비/시술 이중 분류 (analyze-web.ts)

현재 문제: "써마지FLX 시술" → treatment에만 분류, equipment 누락
바노바기피부과에서 울쎄라, 써마지FLX 등이 전부 treatment로만 잡힘

Gemini 프롬프트의 장비 추출 지시 부분에 아래 규칙을 **최상단에** 추가:

```
## 한국 피부과 장비 추출 핵심 규칙 (최우선 적용)

한국 피부과/성형외과에서는 "장비명 = 시술명"인 경우가 매우 많습니다.
아래 브랜드명이 페이지 어디에든 등장하면(시술 소개, 메뉴, 이벤트, 가격표 등),
**반드시 equipments 배열에 포함**시키세요. treatments에도 동시에 포함해도 됩니다.

[리프팅/타이트닝 장비 - 반드시 equipment로 분류]
써마지, Thermage, 써마지FLX, 써마지CPT
울쎄라, Ulthera, 울쎄라프라임, 울쎄라피
인모드, Inmode, 인모드FX, 인모드리프팅
슈링크, Shurink, 슈링크유니버스
튠페이스, TuneFace
텐써마, 텐쎄라
올리지오, 올리지오X, Oligio
리프테라, Liftera
포텐자, Potenza
소프웨이브, Sofwave
볼뉴머, Volnewmer
울핏, Ulfit
더블로, Doublo
리니어지, Linearge
리니어펌, LinearFirm
티타늄, Titanium, 티타늄리프팅
온다, Onda, 온다리프팅
세르프, CERP
쓰리딥, 3DEEP
페어티타늄

[레이저 장비 - 반드시 equipment로 분류]
엑셀브이, ExcelV
피코슈어, PicoSure
피코웨이, PicoWay
레블라이트, RevLite
프락셀, Fraxel
클라리티, Clarity
젠틀맥스, GentleMax
스텔라M22, StellarM22
아큐핏, Accufit

[바디/체형 장비 - 반드시 equipment로 분류]
쿨스컬프팅, CoolSculpting
바넥스, Vanquish
엠스컬프트, Emsculpt
리포셀, LipoCell
울트라포머, Ultraformer

[스킨부스터/재생 - 장비가 아닌 시술이지만 영업에 중요]
쥬베룩, Juvelook
리쥬란, Rejuran
스컬트라, Sculptra
프로파운드, Profound

"써마지FLX 리프팅 안내" → equipments: ["써마지FLX"], treatments: ["써마지FLX 리프팅"]
"울쎄라 300샷 이벤트" → equipments: ["울쎄라"], treatments: ["울쎄라 300샷"]
"인모드 + 슈링크 패키지" → equipments: ["인모드", "슈링크"], treatments: ["인모드+슈링크 패키지"]
```

### 3-B. 가격 추출 강화 (analyze-web.ts, analyze-images.ts, screenshot-ocr.ts)

프롬프트에 가격 추출 규칙 추가:

```
## 가격 추출 규칙

한국 피부과 가격 표기 패턴을 모두 인식하세요:
- "550,000원", "55만원", "55만", "₩550,000"
- "이벤트가 39만원", "정가 55만 → 할인가 39만"
- "300샷 55만원", "600샷 99만원" (샷수+가격 세트)
- 취소선이 있는 정가 + 실제 할인가
- 부가세 별도/포함 표기

가격을 발견하면 아래 형식으로 추출:
{
  "treatment": "써마지FLX 300샷",
  "original_price": 1000000,
  "event_price": 550000,
  "unit": "원",
  "note": "2월 이벤트, 부가세 별도"
}
```

### 3-C. 스크린샷 OCR 프롬프트 강화 (screenshot-ocr.ts)

스크린샷 OCR은 텍스트 크롤링의 보완재가 아니라 **독립적인 데이터 소스**로 취급해야 한다.
프롬프트를 아래처럼 전면 교체:

```
당신은 한국 피부과/성형외과 웹사이트의 스크린샷을 분석하는 전문가입니다.
이 스크린샷에서 아래 정보를 최대한 빠짐없이 추출하세요.

1. **장비 (equipments)**: 페이지에 보이는 모든 의료 장비명.
   메뉴, 배너, 이벤트 팝업, 본문 어디든 장비명이 보이면 추출.
   이미지 안의 텍스트도 읽어야 합니다.

2. **시술 (treatments)**: 제공하는 모든 시술/서비스명.

3. **가격 (prices)**: 시술명+가격 세트. 이벤트가, 정가, 할인가 구분.
   이미지 배너 안의 가격표를 특히 주의 깊게 확인하세요.
   한국 피부과는 가격을 텍스트가 아닌 이미지(배너/표)로 표시하는 경우가 대부분입니다.

4. **의료진 (doctors)**: 의사 이름, 전문의 여부, 경력

5. **병원 정보**: 진료시간, 주소, 전화번호, 특화 분야

6. **이벤트/프로모션**: 현재 진행 중인 이벤트, 할인, 패키지

JSON 형식으로 응답하세요. 확실하지 않은 정보도 confidence 점수와 함께 포함하세요.
한 글자라도 놓치지 마세요. 이미지 안의 한글 텍스트를 정확하게 읽는 것이 핵심입니다.
```

검증: 바노바기피부과 재크롤링 후 equipments에 울쎄라, 써마지FLX, 인모드, 슈링크, 
튠페이스, 텐써마, 텐쎄라 중 최소 5개 이상 포함되는지 확인.

---

## 핫픽스 4: 이미지 수집 필터 재설계

### 대상 파일: 이미지 다운로드/필터링 담당 파일 (image-downloader.ts 또는 유사 파일)

현재 문제: filterLikelyContentImages가 10건 전부에서 이미지 0개 통과시킴.
이건 필터가 너무 엄격하거나, 이미지 URL 패턴 매칭이 안 되는 것.

작업 순서:

### 4-A. 현재 필터 로직 진단 (수정 전에 반드시 먼저)
1. filterLikelyContentImages 함수의 현재 필터링 조건을 모두 나열하라
2. 바노바기피부과(skinbanobagi.com)의 실제 이미지 URL 5개를 Playwright로 수집하라
3. 각 이미지 URL이 현재 필터의 어떤 조건에서 걸러지는지 하나씩 대조하라
4. 결과를 보고하라 (예: "width 조건에서 탈락", "URL 패턴에서 탈락" 등)

### 4-B. 필터 수정 (진단 결과 기반)
진단 결과를 보고 아래 원칙으로 수정:

1. **화이트리스트 키워드 추가**: 이미지 URL이나 alt 텍스트에 아래 키워드가 포함되면 무조건 통과
   - event, price, 가격, 이벤트, banner, popup, 팝업, 시술, treatment
   - menu, 메뉴, service, 진료, equipment, 장비
   
2. **이미지 크기 기준 완화**:
   - 현재 최소 크기가 있다면 width >= 200px, height >= 150px로 완화
   - 단, 아이콘/로고 제외: 50px 미만은 여전히 제외

3. **블랙리스트는 유지하되 최소화**:
   - 확실한 비콘텐츠만 제외: favicon, icon, logo, avatar, arrow, bullet, spacer
   - sns 아이콘: facebook, instagram, youtube, kakao, naver (16~48px 크기)
   - 트래킹 픽셀: 1x1, 크기 5px 미만

4. **이미지 수 상한**: 한 사이트당 최대 20개까지 OCR 전송 (비용 방어)
   - 20개 초과 시 이미지 크기가 큰 순서로 상위 20개만 선택
   - 이유: 큰 이미지일수록 가격표/배너일 확률이 높음

검증: 바노바기피부과에서 이미지 다운로드 개수가 0개 → 최소 5개 이상으로 증가하는지 확인.

---

## 핫픽스 5: 닥터스피부과/톡스앤필 실패 원인 정밀 진단

이 두 사이트의 실패 원인을 SPA로 단정하지 말고 정확히 찾아라.

### 5-A. 닥터스피부과 신사 (https://www.doctors365.co.kr/branch/sinsa.php)
1. 먼저 curl로 해당 URL에 HTTP 요청을 보내라. 응답 코드, 리다이렉트 여부, 응답 본문 길이 확인
2. Playwright로 해당 URL을 열어라. 최종 도착 URL이 원래 URL과 같은지 확인 (리다이렉트 여부)
3. Playwright에서 page.content()의 길이와 실제 텍스트 내용을 출력하라
4. 위 3단계 결과를 바탕으로 정확한 실패 원인을 진단하라

### 5-B. 톡스앤필 강서 (https://www.toxnfill32.com/)
1. 동일한 3단계 진단 수행
2. 톡스앤필은 모바일 퍼스트 사이트이므로, Playwright에서 모바일 viewport 
   (width: 390, height: 844)로도 시도해 보라
3. 쿠키 동의 팝업이나 나이 확인 팝업이 있는지 확인하라

진단 결과를 먼저 보고하고, 그에 맞는 수정을 적용하라. 
추측으로 고치지 말고 원인을 확인한 뒤 고쳐라.

---

## 핫픽스 6: Playwright 크롤링 강화

### 대상 파일: screenshot-ocr.ts 또는 Playwright를 사용하는 크롤링 파일

현재 Playwright 설정을 아래처럼 강화:

1. **팝업/모달 자동 닫기 강화**:
```typescript
// 페이지 로드 후 일반적인 팝업 닫기 시도
const popupSelectors = [
  '[class*="popup"] [class*="close"]',
  '[class*="modal"] [class*="close"]',
  '[class*="layer"] [class*="close"]',
  'a[href*="popup_close"]',
  'button:has-text("닫기")',
  'button:has-text("하루동안")',
  'button:has-text("오늘 하루")',
  'a:has-text("하루동안 보지 않기")',
  'a:has-text("닫기")',
  '[id*="close"]',
  '.btn_close',
  '.close_btn',
  '.popup_close'
];

for (const selector of popupSelectors) {
  try {
    const elements = await page.locator(selector).all();
    for (const el of elements) {
      if (await el.isVisible({ timeout: 500 })) {
        await el.click({ timeout: 1000 });
        await page.waitForTimeout(300);
      }
    }
  } catch {}
}
```

2. **서브페이지 자동 탐색**:
   현재 메인 페이지만 크롤링하는 경우, 사이트 내 주요 서브페이지도 탐색하라.
   특히 아래 패턴의 링크를 자동 방문:
   - /시술안내, /시술소개, /service, /treatment
   - /장비소개, /equipment, /about
   - /이벤트, /event, /promotion
   - /의료진, /doctor, /staff
   
   단, 같은 도메인 내 링크만 탐색. 최대 10개 서브페이지까지.
   각 서브페이지에서도 텍스트 추출 + 스크린샷 캡처를 수행.

3. **스크린샷 전략 강화**:
   - 풀페이지 스크린샷 1장 (현재)
   - 추가: 주요 섹션별 크롭 스크린샷 (시술 메뉴 영역, 이벤트 배너 영역 등)
   - viewport를 1280x800 (데스크탑)과 390x844 (모바일) 두 가지로 캡처
   - 모바일 뷰에서만 보이는 콘텐츠가 있을 수 있음 (특히 톡스앤필)

---

## 핫픽스 적용 순서

반드시 아래 순서대로 작업하고, 각 단계 완료 후 간단히 보고:

1. 핫픽스 1 (모델 업그레이드) → 모델 변경 확인 보고
2. 핫픽스 2 (파이프라인 생존성) → 가짜 URL 테스트 통과 보고
3. 핫픽스 5 (실패 원인 진단) → 닥터스/톡스앤필 실패 원인 보고 (수정 전 진단만)
4. 핫픽스 3 (프롬프트 강화) → 프롬프트 변경 내용 보고
5. 핫픽스 4 (이미지 필터) → 필터 진단 결과 + 수정 내용 보고
6. 핫픽스 6 (Playwright 강화) → 변경 내용 보고
7. 닥터스/톡스앤필 실패 원인에 맞는 추가 수정 → 수정 내용 보고

---

## 10건 전체 재테스트

모든 핫픽스 적용 완료 후, 10건 전체를 다시 돌린다.
첫 테스트와 동일한 순서:

| 순번 | 병원명 | URL |
|---|---|---|
| 1 | 815의원 | https://www.815clinic.co.kr/ |
| 2 | 리멤버피부과 | https://rememberno1.com/ |
| 3 | 고운세상피부과 명동 | http://www.gowoonss.com/bbs/content.php?co_id=myungdong |
| 4 | 닥터스피부과 신사 | https://www.doctors365.co.kr/branch/sinsa.php |
| 5 | 한미인의원 | https://hanmiin.kr/ |
| 6 | 제로피부과 | https://www.zerodermaclinic.com/ |
| 7 | 톡스앤필 강서 | https://www.toxnfill32.com/ |
| 8 | 이지함피부과 망우 | http://mw.ljh.co.kr/ |
| 9 | 바노바기피부과 | https://www.skinbanobagi.com/web |
| 10 | 신사루비의원 | https://www.rubyclinic-sinsa.com/ |

## 보고 형식

### 병원별 보고 (10건 각각):
```
=== [순번] 병원명 ===
URL: ...
Gemini 모델: (실제 사용된 모델명)
크롤링 상태: 성공/실패

[텍스트 크롤링]
- 추출된 텍스트 길이: __자
- 서브페이지 탐색 수: __개
- 팝업 닫기 실행: Y/N

[이미지 OCR]
- 다운로드 이미지 수: __개 (첫 테스트: 0개)
- OCR 처리 이미지 수: __개
- OCR에서 추출된 핵심 정보: [간략 요약]

[스크린샷 OCR]
- 데스크탑 스크린샷: 성공/실패
- 모바일 스크린샷: 성공/실패
- 서브페이지 스크린샷: __개

[파싱 결과]
- 감지된 장비: [전체 목록] (첫 테스트: __개 → 이번: __개)
- 감지된 시술: [전체 목록] (첫 테스트: __개 → 이번: __개)
- 감지된 가격: [시술명+가격 전체 목록]
- 의사 수: __명
- 진료시간: 추출됨/미추출

[스코어링 결과]
- profiler 점수: __점 (등급) ← 첫 테스트: __점
- profiler 4축: medical_expertise=__, equipment_level=__, service_scope=__, online_presence=__
- TORR RF matcher 점수: __점 (등급) ← 첫 테스트: __점
- matcher 상위 영업각도: bridge_care=__, post_op_care=__, mens_target=__, painless_focus=__, combo_body=__
- top_pitch_points: [목록]

[시그널]
- 장비 변동 감지: [있으면 목록]
- sales_signals 생성: [있으면 목록]
```

### 종합 비교 보고 (마지막에):
```
=== 핫픽스 전후 비교 ===

| # | 병원명 | 1차 장비 | 2차 장비 | 1차 시술 | 2차 시술 | 1차 가격 | 2차 가격 | 1차 profiler | 2차 profiler | 1차 TORR RF | 2차 TORR RF |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 815의원 | 23 | __ | 36 | __ | 0 | __ | PRIME(80) | __ | C(33) | __ |
| 2 | 리멤버피부과 | 37 | __ | 23 | __ | 0 | __ | HIGH(69) | __ | C(10) | __ |
| ... | ... | ... | ... | ... | ... | ... | ... | ... | ... | ... | ... |

성공률: __/10 (1차: 8/10)

[Gemini API 비용]
- 모델: gemini-2.5-pro
- 총 토큰: __ (1차: 427,634)
- 예상 비용: ₩__ (1차: ₩500)

[핵심 개선 지표]
- 평균 장비 감지 수: 1차 __ → 2차 __
- 평균 시술 감지 수: 1차 __ → 2차 __
- 가격 감지 병원 수: 1차 2/10 → 2차 __/10
- 이미지 OCR 활용 병원 수: 1차 0/10 → 2차 __/10
- TORR RF B등급 이상: 1차 1/10 → 2차 __/10

[아직 남은 이슈]
1. ...
2. ...
```

## 주의사항

1. 핫픽스를 적용하면서 기존 코드를 삭제하지 마라. DEPRECATED 주석 처리 원칙 유지.
2. 핫픽스 전에 현재 코드를 git commit 해둬라 (메시지: "pre-hotfix: E2E test baseline")
3. 핫픽스 완료 후에도 git commit (메시지: "hotfix: pipeline resilience + prompt + image filter + model upgrade")
4. 10건 재테스트 사이에 각 병원 간 15초 이상 간격을 둬라.
5. 비용은 신경 쓰지 않는다. 정확도가 최우선이다.
6. 추측으로 고치지 마라. 특히 닥터스피부과/톡스앤필은 원인 진단 먼저, 수정은 그 다음이다.
7. 바노바기피부과 결과가 핵심 벤치마크다. 이 병원의 장비가 5개 이상 안 잡히면 프롬프트를 다시 수정하라.
