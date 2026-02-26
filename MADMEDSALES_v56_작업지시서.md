# MADMEDSALES v5.6 통합 작업지시서

**작성일**: 2026-02-26
**현재 버전**: v5.6 (교차검증 3/4 완료, 미커밋 상태)
**목표**: 4곳 교차검증 결과 기반 품질 개선 + OCR 도입 + 정확도 90%+ 달성

---

## 핵심 원칙

> **"데이터 온전성 > 비용 절감"**
> **"1회차는 전체 수집, 2회차부터 선별 최적화"**
> **"일시적 수정이 아닌 시스템 규칙. 2,700개 병원 전부에 적용."**

---

## 최신 커밋 상태

```
최신 커밋: 2d1052a feat(scripts): v5.6 사전확장 + 가격스키마v2 + 비급여표전처리 + 프롬프트강화

미커밋 파일:
  Modified:  scripts/crawler/dictionary-loader.ts (경로 v1.1→v1.2)
  Untracked: scripts/crawler/MADMEDSALES_dictionary_v1.2.json (사전 v1.2)
  Untracked: scripts/_test-v56-multi.ts (다병원 테스트)
  Untracked: output/v56-test-*.json (테스트 결과 4건)
```

---

## 작업 목록 (순서대로)

---

### 작업 1: 비급여표 source 태깅 점검 및 수정

**문제**: 톡스앤필강서 — 비급여표 8행이 있는데 source="nongeubyeo" 태깅 0건. 바노바기는 86건 정상.

**확인 방법**:
1. `output/v56-debug-톡스앤필강서.txt` 열어서 비급여표 섹션이 프롬프트에 포함되었는지 확인
2. 포함됐는데 태깅 안 됐으면 → 프롬프트 문제
3. 포함 안 됐으면 → `extractNongeubyeoSection()` 코드 문제

**수정 방향**:
- 프롬프트 문제인 경우: `scripts/v5/prompts.ts`의 `buildClassifyPrompt()`에서 비급여표 섹션에 대한 지시 강화
  ```
  비급여항목안내 섹션에서 추출한 가격은 반드시 source="nongeubyeo"로 태깅하세요.
  비급여표에 나온 시술명과 가격을 빠짐없이 추출하세요.
  ```
- 코드 문제인 경우: `extractNongeubyeoSection()` 함수의 키워드 매칭 패턴 확인 및 수정

**검증**: 톡스앤필강서 재테스트 → source="nongeubyeo" 건수 확인

---

### 작업 2: 장비 과다추출 방지

**문제**: 닥터스피부과신사 157건(매칭 38, 미등록 119). 장비가 아닌 것(주사제, 화장품, 시술명 등)을 장비로 오분류.

**수정 1 — Gemini 프롬프트에 네거티브 리스트 추가** (`scripts/v5/prompts.ts`):

```
의료기기/레이저/에너지디바이스만 추출하세요.
아래는 장비가 아닙니다. 절대 장비 목록에 포함하지 마세요:

[주사제/필러] 보톡스, 쥬비덤, 레스틸렌, 리쥬란, 볼루마, 벨로테로, 스킨부스터, 프로파일로, 엘란쎄, 스컬트라, 래디에스, 수베란
[화장품/스킨케어] 세럼, 크림, 앰플, 마스크팩, 필링제, 선크림, 토너, 에센스
[시술 프로그램명] "프리미엄 리프팅 패키지", "안티에이징 프로그램", "VIP 관리" 등 패키지/프로그램명
[약품/성분] 성장인자, PRP, 줄기세포, 엑소좀, 비타민, 글루타치온, 태반주사
[기타 비장비] 실(PDO, PCL, 녹는실), 봉합사, 보형물, 임플란트(치과), 교정기
```

**수정 2 — 코드 레벨 중복 제거 강화** (`scripts/v5/equipment-normalizer.ts` 또는 해당 로직):

```typescript
// 미등록 장비도 소문자 + 공백/특수문자 제거 후 Set으로 중복 제거
function deduplicateEquipment(equipmentList: string[]): string[] {
  const seen = new Set<string>();
  return equipmentList.filter(name => {
    const normalized = name.toLowerCase().replace(/[\s\-_\.]/g, '');
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}
```

**검증**: 닥터스피부과신사 재테스트 → 장비 수 157건에서 대폭 감소 확인

---

### 작업 3: OCR 도입 — 전체 페이지 스크린샷 + Gemini 멀티모달 분석

**배경**: 닥터스피부과신사처럼 이미지 기반 사이트는 텍스트만으로 시술 1건밖에 못 잡음. Gemini 2.5 Flash가 멀티모달(텍스트+이미지)을 지원하므로 스크린샷을 함께 보내면 이미지 안의 시술명/가격/의사 정보도 추출 가능.

**비용**: 이미지 1장(1024×1024) = 약 1,290 토큰 = ₩0.56. 50장 보내도 병원당 ₩28 추가. 49개 전체 해도 ₩1,400.

**전략**: 
- 1회차(v5.6): 전체 페이지 스크린샷 전부 캡처, 전부 Gemini에 전송. 선별 없음.
- 2회차(v5.7 이후): 1회차 결과 분석 후 효과 높은 페이지 유형만 선별 캡처로 최적화.

**구현 4단계**:

#### 3-1. Playwright 스크린샷 함수 확장

현재 Playwright fallback이 이미 존재함. 이를 확장하여 "크롤링한 모든 페이지의 스크린샷을 찍고 base64로 반환"하는 함수 생성.

```typescript
// 의사 코드
async function captureAllScreenshots(urls: string[]): Promise<{url: string, base64: string}[]> {
  const browser = await chromium.launch();
  const results = [];
  for (const url of urls) {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
    // 풀페이지 스크린샷
    const screenshot = await page.screenshot({ fullPage: true, type: 'png' });
    const base64 = screenshot.toString('base64');
    results.push({ url, base64 });
    await page.close();
  }
  await browser.close();
  return results;
}
```

**주의**: 풀페이지 스크린샷이 세로 10,000px 초과 시 Gemini가 제대로 읽지 못할 수 있음. 
이 경우 뷰포트 단위(1280×800)로 잘라서 여러 장으로 분할하는 처리 필요. 테스트 후 판단.

#### 3-2. Gemini API 호출에 이미지 첨부

`scripts/v5/prompts.ts`의 `buildClassifyPrompt()` 또는 Gemini 호출 부분 수정:

```typescript
// 현재: 텍스트만
contents: [{ role: "user", parts: [{ text: promptText }] }]

// 변경: 텍스트 + 이미지
const parts: Part[] = [{ text: promptText }];
for (const screenshot of screenshots) {
  parts.push({
    inlineData: {
      mimeType: "image/png",
      data: screenshot.base64
    }
  });
}
contents: [{ role: "user", parts }]
```

#### 3-3. 프롬프트 보강

프롬프트에 이미지 분석 지시 추가:

```
추가 지시사항:
- 첨부된 스크린샷 이미지에 보이는 시술명, 가격, 의사 정보, 장비 사진도 분석하세요.
- 텍스트에서 추출한 정보와 이미지에서 추출한 정보를 합쳐서 최종 결과를 만드세요.
- 이미지에서만 확인 가능한 정보는 source="screenshot"으로 표기하세요.
- 이미지 안의 한국어 텍스트를 정확히 읽어주세요.
```

#### 3-4. 테스트

닥터스피부과신사로 검증:
```
Before (텍스트만): 시술 1건, 가격 0건
After (텍스트+이미지): 시술 ?건, 가격 ?건
```

---

### 작업 4: 스마트 정렬 + 200K 초과 허용

**배경**: 톡스앤필 텍스트 371K + 이미지 추가 시 토큰이 200K를 초과할 수 있음.

**전략**: 
- 페이지를 중요도 순으로 정렬하여 중요한 것을 앞에 배치
- 텍스트를 자르지 않음 — 전체 텍스트 + 전체 이미지 다 보냄
- 200K 토큰 초과해도 허용 (long context 요금 $0.60/1M으로 2배이지만 49개 병원 합계 ₩3,000 추가로 무시 가능)

**페이지 우선순위 정렬 로직** (파이프라인에 추가):

```typescript
function sortPagesByPriority(pages: CrawledPage[]): CrawledPage[] {
  const priorityKeywords = {
    high: ["시술", "치료", "장비", "의료진", "의사", "가격", "비용", "비급여", "이벤트", "프로모션", "진료"],
    medium: ["소개", "클리닉", "센터", "프로그램", "before", "after"],
    low: ["블로그", "후기", "리뷰", "공지", "뉴스", "오시는길", "오시는 길", "개인정보", "이용약관", "사이트맵"]
  };
  
  return pages.sort((a, b) => {
    const scoreA = getPagePriorityScore(a, priorityKeywords);
    const scoreB = getPagePriorityScore(b, priorityKeywords);
    return scoreB - scoreA; // 높은 점수가 앞으로
  });
}

function getPagePriorityScore(page: CrawledPage, keywords: Record<string, string[]>): number {
  const text = (page.url + ' ' + page.title).toLowerCase();
  if (keywords.high.some(k => text.includes(k))) return 3;
  if (keywords.medium.some(k => text.includes(k))) return 2;
  if (keywords.low.some(k => text.includes(k))) return 1;
  return 2; // 기본값은 중간
}
```

**비급여표는 별도 보존**: 이미 `extractNongeubyeoSection()`에서 처리 중. 변경 불필요.

**핵심**: 데이터를 자르지 않음. 정렬만 하고 전부 보냄. Gemini가 긴 입력에서 뒤쪽을 놓치더라도 뒤쪽은 낮은 우선순위 페이지.

---

### 작업 5: 사전 v1.3 후보 정리

**배경**: 교차검증 3곳의 미등록 장비 합계 145건(닥터스 119 + 고운세상 6 + 톡스앤필 20). 여기서 범용 장비를 골라 사전에 추가.

**작업 방법**:
1. 아래 테스트 결과 파일에서 미등록 장비 목록 추출:
   - `output/v56-test-닥터스피부과신사.json`
   - `output/v56-test-고운세상피부과명동.json`
   - `output/v56-test-톡스앤필강서.json`
2. 작업 2(네거티브 리스트)로 걸러지는 비장비(주사제, 화장품 등) 제거
3. 남은 것 중 실제 의료기기인 항목을 식별
4. `scripts/crawler/MADMEDSALES_dictionary_v1.2.json`에 추가 → v1.3 생성
5. `dictionary-loader.ts`의 경로를 v1.3으로 변경

**판단 기준**: 2곳 이상에서 등장한 장비 = 범용 장비로 우선 추가. 1곳에서만 등장한 것은 보류.

---

### 작업 6: 커밋 및 검증

**커밋 대상**:
```
Modified:
  scripts/crawler/dictionary-loader.ts
  scripts/v5/prompts.ts
  scripts/v5/equipment-normalizer.ts (또는 해당 파일)
  scripts/recrawl-v5.ts (또는 파이프라인 파일)

New:
  scripts/crawler/MADMEDSALES_dictionary_v1.3.json
  scripts/_test-v56-multi.ts
  output/v56-test-*.json (참고용)
```

**검증 순서**:
1. 닥터스피부과신사 재테스트 — OCR 효과 확인 (시술 1건 → 증가 여부)
2. 톡스앤필강서 재테스트 — 비급여표 태깅 확인 (source="nongeubyeo" 건수)
3. 바노바기 재테스트 — 기존 결과 유지 확인 (퇴행 방지)
4. 4곳 전부 재테스트 — 모든 항목 90% 이상 목표

**검증 통과 기준**:
```
| 항목 | 목표 |
|------|------|
| 연락처 | 실제 채널의 90% 이상 감지 |
| 장비 | 중복 제거 후 실제 장비의 90% 이상, 오분류 10% 미만 |
| 시술 | 노이즈 제거 후 실제 시술의 80% 이상 |
| 가격 | 비급여표 있는 병원은 90% 이상, 없는 병원은 이벤트가격 추출 여부 |
| 의사 | 실제 의사 수의 90% 이상 |
```

**검증 통과 시** → 49개 병원 일괄 실행

---

## 파일 경로 참고

| 용도 | 경로 |
|------|------|
| 사전 v1.2 (현재) | `scripts/crawler/MADMEDSALES_dictionary_v1.2.json` |
| 사전 로더 | `scripts/crawler/dictionary-loader.ts` |
| 분류 프롬프트 | `scripts/v5/prompts.ts` → `buildClassifyPrompt()` |
| 메인 파이프라인 | `scripts/recrawl-v5.ts` → `classifyHospitalData()` |
| 비급여표 전처리 | `scripts/recrawl-v5.ts` + `scripts/_test-v56-multi.ts` → `extractNongeubyeoSection()` |
| 다병원 테스트 | `scripts/_test-v56-multi.ts` |
| 테스트 결과 | `output/v56-test-{병원명}.json` |
| 디버그 로그 | `output/v56-debug-톡스앤필강서.txt` |

## 실행 명령어

```bash
# 단일 병원 테스트
npx tsx scripts/_test-v56-multi.ts --name "병원명"

# 기본 3곳 전체 테스트
npx tsx scripts/_test-v56-multi.ts

# 사전 빌드 확인
npx tsx -e "import{getEquipmentNormalizationMap,getEquipmentCategoryMap}from'./scripts/crawler/dictionary-loader.js';console.log('normMap:',getEquipmentNormalizationMap().size,'catMap:',getEquipmentCategoryMap().size)"
```

## 기술 제약 사항

- **Gemini 2.5 Flash**: maxOutputTokens=65536, 200K 토큰 초과 시 long context 요금 ($0.30→$0.60/1M)
- **이미지 토큰**: 1024×1024 이미지 1장 = 약 1,290 토큰
- **풀페이지 스크린샷**: 세로 10,000px 초과 시 Gemini 인식 성능 저하 가능 → 테스트 후 분할 여부 판단
- **SA 인증**: `scripts/.env`의 GOOGLE_SA_KEY_PATH → JWT RSA-SHA256 서명
- **JSON 파싱**: Gemini가 잘못된 이스케이프 생성하는 경우 있음 → 3단계 파싱 (직접→이스케이프수정→코드블록추출)
- **mergeAndDeduplicate()**: `_v54` 필드를 보존하지 않음 → 호출 전후 수동 백업/복원 필수

---

## 작업 순서 요약

```
1. 비급여표 태깅 점검/수정 (디버그 파일 확인 → 프롬프트 또는 코드 수정)
2. 장비 과다추출 방지 (프롬프트 네거티브 리스트 + 코드 중복 제거)
3. OCR 도입 (Playwright 스크린샷 → Gemini 멀티모달 호출)
4. 스마트 정렬 + 200K 초과 허용 (페이지 우선순위 정렬, 자르지 않음)
5. 사전 v1.3 (미등록 장비에서 범용 장비 추출 → 사전 추가)
6. 커밋 + 4곳 재검증 → 90%+ 확인 → 49개 일괄 실행
```
