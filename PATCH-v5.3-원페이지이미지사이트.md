# v5.3 패치 — 원페이지 + 이미지 기반 사이트 대응

---

## 발견된 문제

안산엔비의원(talmostop.com) 실제 사이트 분석 결과:

**사이트 특성:**
- 서브페이지가 거의 없는 **원페이지 사이트**
- 의료진 소개 페이지 자체가 존재하지 않음
- 시술/장비 정보가 전부 **이미지 배너**로만 존재 (텍스트 없음)
- 원장 이름("문상재")이 HTML 텍스트에 한 번도 안 나옴
- 학술활동만 이미지+캡션 텍스트로 존재

**현재 시스템 한계:**
- 텍스트 분석: 이미지 배너에서 정보 추출 불가
- Vision 분석: 스크롤 다중 캡처로 배너 이미지를 읽을 수 있지만, 현재 배너 슬라이드는 1장만 보임 (나머지는 JS로 넘겨야)
- 보강 크롤(v5.2): /doctor 경로 시도해도 페이지 자체가 없음 → 404
- 결과: 의사 0명, 장비 0개가 "크롤 부족"이 아니라 "사이트에 텍스트로 없음"

---

## 이 유형이 49개 병원에서 얼마나 될까

한국 소규모 피부과/의원 중 상당수가 이 패턴:
- 원장 1~2명인 동네 의원
- 홈페이지는 외주 제작, 이미지 위주
- 서브페이지 없이 원페이지 또는 2~3페이지
- 의료진 소개 = 없거나 메인에 사진 1장

49개 중 예상 10~15개가 이 유형일 수 있음.

---

## 수정 방안

### 1. 이미지 배너 슬라이드 순차 캡처

메인 페이지의 슬라이드 배너(mainslide_01~08)에 장비/시술 정보가 들어있음.
하지만 한 번에 1장만 보이고 나머지는 JS 슬라이드로 넘겨야 함.

**Puppeteer로 슬라이드 순차 캡처:**

```typescript
async function captureSliderImages(pageUrl: string, hospitalId: string) {
  console.log('🖼️ 슬라이드 배너 순차 캡처 시작');
  
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 30000 });
  
  // 팝업 닫기 시도
  await closePopups(page);
  
  // 슬라이더 "다음" 버튼 찾기 (일반적 셀렉터)
  const nextBtnSelectors = [
    '.swiper-button-next', '.slick-next', '.owl-next',
    '[class*="next"]', '[class*="arrow-right"]',
    'button[aria-label="Next"]', '.slide-next',
  ];
  
  let nextBtn = null;
  for (const sel of nextBtnSelectors) {
    nextBtn = await page.$(sel);
    if (nextBtn) break;
  }
  
  const screenshots: Buffer[] = [];
  
  // 첫 슬라이드 캡처
  screenshots.push(Buffer.from(await page.screenshot({ type: 'png' })));
  
  if (nextBtn) {
    // 슬라이드 수 추정 (최대 10회 클릭)
    for (let i = 0; i < 10; i++) {
      try {
        await nextBtn.click();
        await new Promise(r => setTimeout(r, 800)); // 슬라이드 애니메이션 대기
        screenshots.push(Buffer.from(await page.screenshot({ type: 'png' })));
      } catch { break; }
    }
    console.log(`  📸 슬라이드 ${screenshots.length}장 캡처`);
  } else {
    console.log('  ⚠️ 슬라이드 넘김 버튼 못 찾음 — 1장만 캡처');
  }
  
  await browser.close();
  
  // 각 스크린샷 → sharp 최적화 → Supabase Storage 저장
  for (let i = 0; i < screenshots.length; i++) {
    const optimized = await sharp(screenshots[i])
      .resize(1280, null, { withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    
    const path = `${hospitalId}/slider_${i}_${Date.now()}.webp`;
    await supabase.storage
      .from('hospital-screenshots')
      .upload(path, optimized, { contentType: 'image/webp' });
  }
  
  // 전체 슬라이드 스크린샷 → Gemini Vision 분석
  // "이 이미지들은 피부과 메인 배너 슬라이드입니다. 장비명, 시술명, 이벤트 정보를 추출하세요."
  return screenshots;
}
```

### 2. 팝업 이미지 Vision 분석

안산엔비의원 팝업 3개:
- `pop_251203.jpg` — 학술대회 (이미지)
- `pop_260211_01.jpg` — 윤곽조각주사 (이미지)
- `pop_260211_02.jpg` — 스킨부스터 (이미지)

팝업 이미지 URL을 마크다운에서 추출 → 직접 다운로드 → Vision 분석:

```typescript
async function extractPopupImages(markdown: string, baseUrl: string): Promise<string[]> {
  // 마크다운에서 팝업 이미지 URL 추출
  const popupRegex = /!\[([^\]]*)\]\(([^)]*pop[^)]*)\)/gi;
  const urls: string[] = [];
  let match;
  while ((match = popupRegex.exec(markdown)) !== null) {
    const imgUrl = new URL(match[2], baseUrl).href;
    urls.push(imgUrl);
  }
  return urls; 
  // → 각 URL 다운로드 → Gemini Vision 분석
  // "이 이미지는 피부과 팝업 배너입니다. 시술명, 장비명, 이벤트, 가격 정보를 추출하세요."
}
```

### 3. 이미지 URL 직접 다운로드 + Vision

배너/팝업 이미지 URL이 마크다운에 있으면 Firecrawl 없이 직접 다운로드 가능:

```typescript
import fetch from 'node-fetch';

async function downloadAndAnalyzeImage(imageUrl: string): Promise<any> {
  const response = await fetch(imageUrl);
  const buffer = Buffer.from(await response.arrayBuffer());
  
  // base64 → Gemini Vision
  const base64 = buffer.toString('base64');
  const mimeType = imageUrl.endsWith('.png') ? 'image/png' : 'image/jpeg';
  
  return await geminiVisionAnalyze(base64, mimeType, 
    '이 이미지는 한국 피부과 홈페이지의 배너/팝업입니다. 장비명, 시술명, 의사 이름, 가격, 이벤트 정보를 추출하세요.'
  );
}
```

**이 방법이면 Firecrawl 크레딧 소모 없이 이미지 분석 가능.**

### 4. 학술활동 → 원장 연결 로직

안산엔비의원처럼 원장 이름은 없지만 학술활동 텍스트가 있는 경우:

```
마크다운에서 추출 가능:
- "2025 ASLS와 ICAP 학술대회 참가 및 강연"
- "[책 편찬] 대한레이저피부모발학회에서 '모발학' 탈모책 편찬"
- "2024 K-Med Expo Vietnam 2024 베트남 의료기기 박람회"
- 외 5건
```

이 학술활동은 누군가의 활동인데 이름이 없음.

**처리:**
```typescript
if (doctors.length === 0 && academicActivities.length > 0) {
  // 학술활동이 있는데 의사가 없으면
  // → 의사 1명 생성 (이름: "원장", notes: "이름 미확인 — 수동 입력 필요")
  // → academic_activity에 학술활동 연결
  doctors.push({
    name: '원장 (이름 미확인)',
    title: '원장',
    academic_activity: academicActivities.join(', '),
    notes: 'manual_input_required: 사이트에 원장 이름 텍스트 없음. 학술활동에서 KOL 활동 확인됨.',
  });
}
```

이렇게 하면:
- 의사 0명 → 1명 (이름 미확인이지만 학술활동은 보존)
- KOL 판별은 가능 (학술활동 데이터 있으므로)
- 이름은 manual_review에서 수동 입력

### 5. 원페이지 사이트 감지 + 자동 강화

**트리거 조건:**
```typescript
function isOnePageSite(crawlResult: CrawlResult): boolean {
  return (
    crawlResult.totalPages <= 3 &&                    // 페이지 3개 이하
    crawlResult.mainPageCharCount > 5000 &&           // 메인이 상대적으로 큼
    crawlResult.imageCount > crawlResult.textBlocks   // 이미지가 텍스트보다 많음
  );
}
```

**트리거 시 자동 실행:**
1. 슬라이드 배너 순차 캡처 (Puppeteer)
2. 팝업 이미지 직접 다운로드 + Vision
3. 메인 페이지 전체 스크롤 다중 캡처 + Vision
4. 마크다운에서 이미지 URL 추출 → 주요 이미지 직접 Vision
5. 학술활동 텍스트 → 이름 없는 원장 생성

### 6. Gemini Vision 프롬프트 (이미지 배너 전용)

```
당신은 한국 피부과 웹사이트 이미지 분석 전문가입니다.

이 이미지는 "{병원명}" 홈페이지의 {이미지_유형}입니다.
{이미지_유형}: 메인 배너 슬라이드 / 팝업 배너 / 이벤트 배너 / 시술 소개 이미지

이미지에서 다음 정보를 추출하세요:

1. 장비명 (예: 써마지, 울쎄라, 슈링크, TORR RF 등)
2. 시술명 (예: 리프팅, 토닝, 모발이식, 두피문신 등)
3. 의사 이름 (이미지에 표시된 경우)
4. 가격 (숫자가 보이면)
5. 이벤트/프로모션 내용
6. 학술활동 (학회, 강연, 수상 등)
7. KOL 활동 (해외 학회 강연, 교과서 편찬, 논문 등)

★ 이미지에 한국어 텍스트가 있으면 그대로 읽어서 추출하세요.
★ 장비 사진이 있으면 장비명을 식별하세요.
★ 학술대회 사진이 있으면 발표자/참가자 이름을 읽으세요.

JSON으로 응답:
{
  "equipments": ["장비명"],
  "treatments": ["시술명"],
  "doctors": [{ "name": "이름 or null", "activity": "활동 내용" }],
  "events": [{ "title": "이벤트명", "detail": "내용" }],
  "prices": [{ "treatment": "시술명", "price": "가격" }],
  "raw_text": "이미지에서 읽은 전체 텍스트 (참고용)"
}
```

---

## 시스템 지침서 추가 항목

섹션 5에 추가:

```
### 5-13. 원페이지 + 이미지 기반 사이트 ★★★

특징:
- 서브페이지가 거의 없음 (메인 1개 또는 2~3개)
- 의료진 소개 페이지 자체가 없음
- 시술/장비 정보가 이미지 배너로만 존재
- 원장 이름이 HTML에 텍스트로 없을 수 있음
- 학술활동만 이미지+캡션 텍스트로 존재하는 경우 있음

감지 기준:
- 크롤 페이지 3개 이하 + 메인 5000자 이상 + 이미지 비중 높음

대응:
1. 슬라이드 배너: Puppeteer로 순차 넘김 캡처 (최대 10장)
2. 팝업 이미지: URL 직접 다운로드 → Vision 분석 (크레딧 0)
3. 메인 이미지 URL: 마크다운에서 추출 → 직접 다운로드 → Vision
4. 학술활동 있는데 원장 이름 없으면: 이름 미확인 원장 생성 + manual_input 플래그
5. 전부 해도 장비/시술 부족하면: manual_review
```

---

## 금지사항 추가

```
21. ❌ 원페이지 사이트에서 "페이지가 적으니 정보가 없다"고 단정 (이미지 배너에 정보가 있을 수 있음)
22. ❌ 이미지 URL이 마크다운에 있는데 Vision 분석 안 하고 넘어가기
```

---

## 적용 순서

```
v5.2 적용 완료 상태
  ↓
recrawl-v5.ts에 추가:
  - captureSliderImages() 함수
  - extractPopupImages() 함수
  - downloadAndAnalyzeImage() 함수
  - isOnePageSite() 감지 로직
  - 학술활동→이름없는 원장 생성 로직
  ↓
안산엔비의원 단독 재테스트
  ↓
확인할 것:
  - 슬라이드 배너에서 장비/시술 추출됐는가
  - 팝업 이미지에서 추가 정보 추출됐는가
  - 학술활동 텍스트 추출됐는가
  - 원장(이름 미확인) 생성 + 학술활동 연결됐는가
  ↓
검증 PASS → 전체 실행 진행
```

---

## 비용 영향

- 이미지 직접 다운로드: Firecrawl 크레딧 **0** (HTTP fetch만)
- Puppeteer 슬라이드 캡처: 크레딧 **0** (로컬 실행)
- Gemini Vision 추가 호출: 배너 10장 + 팝업 3장 = 13회 (Gemini Flash 비용 무시 수준)
- 원페이지 사이트 예상 10~15개 × 13회 = 130~195회 Vision 추가
- 비용 영향: 거의 없음

---

## 안산엔비의원 기대 결과 (v5.3 적용 후)

| 항목 | v5.1 | v5.3 예상 |
|------|------|-----------|
| 의사 | 0명 | 1명 (이름 미확인 + 학술활동 8건 연결) |
| 시술 | 6개 | 10개+ (팝업에서 윤곽조각주사, 스킨부스터 추가 + 배너 Vision) |
| 장비 | 0개 | 2~5개 (배너 이미지 Vision에서 추출) |
| 이벤트 | 2개 | 2~3개 (팝업 Vision에서 추가) |
| 학술활동 | 0건 | 8건 (텍스트 캡션에서 추출) |
| KOL 판별 | 불가 | **가능** (국제학회 강연, 교과서 편찬 확인) |
