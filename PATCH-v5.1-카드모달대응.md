# v5.1 패치 — v5 실행 완료 후 적용

> v5가 돌아가는 중이므로, 완료된 후 이 패치를 적용한다.
> v5 시스템 지침서 + 명령문에 아래 내용을 추가하면 v5.1이 된다.

---

## 이 패치가 필요한 이유

포에버의원 의료진 페이지 확인 결과:
- 의사 47명이 카드(사진+이름+직함) 형태로 나열
- 각 카드에 **"자세히보기" 버튼**이 있음
- 클릭하면 **플로팅 모달**로 학력, 경력, 학술활동 상세 이력이 표시
- v5는 이 버튼을 클릭하지 않으므로 이름만 추출되고 경력/학력 96% 비어있음

이 패턴은 한국 피부과 사이트에서 매우 흔하다. 49개 병원 중 상당수가 동일 구조일 가능성 높음.

---

## 패치 내용

### 1. 카드+모달 자동 감지 + 순차 클릭

**트리거 조건:**
- page_type이 'doctor'인 페이지에서
- 의사 N명 추출됐는데
- education 또는 career가 있는 비율이 30% 미만

**실행 흐름:**
```
의료진 페이지 분석 완료
  ↓
의사 N명, 경력 있는 비율 체크
  ↓
30% 미만 → 카드+모달 패턴 판단
  ↓
Puppeteer로 의료진 페이지 접속
  ↓
"자세히보기" 버튼 목록 수집
  ↓
각 버튼 순차: 클릭 → 모달 캡처 → 닫기 → 다음
  ↓
모달 스크린샷들 → sharp 최적화 → Supabase Storage 저장
  ↓
각 모달 → Gemini Vision 분석 → 해당 의사 데이터 보강
```

**구현:**

```typescript
import puppeteer from 'puppeteer';

async function crawlDoctorModals(doctorPageUrl: string, hospitalId: string) {
  console.log('⚠️ 카드+모달 패턴 감지 → 자세히보기 순차 클릭 시작');
  
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(doctorPageUrl, { waitUntil: 'networkidle2', timeout: 30000 });
  
  // 자세히보기 버튼 셀렉터 (사이트마다 다르므로 여러 패턴 시도)
  const selectors = [
    'a[class*="detail"]', 'button[class*="detail"]',
    'a[class*="more"]', 'button[class*="more"]',
    '[class*="자세히"]', '[class*="상세"]',
    '[onclick*="detail"]', '[onclick*="pop"]', '[onclick*="modal"]',
    '.btn-view', '.btn-detail', '.view-detail',
  ];
  
  let buttonSelector = '';
  for (const sel of selectors) {
    const count = await page.$$eval(sel, els => els.length).catch(() => 0);
    if (count > 0) {
      buttonSelector = sel;
      console.log(`  셀렉터 "${sel}" → ${count}개 버튼 발견`);
      break;
    }
  }
  
  if (!buttonSelector) {
    console.log('  ⚠️ 자세히보기 버튼 셀렉터 못 찾음 → manual_review');
    await browser.close();
    return { success: false, reason: 'no_detail_button_found' };
  }
  
  const buttonCount = await page.$$eval(buttonSelector, els => els.length);
  const modalScreenshots: { index: number; buffer: Buffer; doctorName: string }[] = [];
  
  for (let i = 0; i < buttonCount; i++) {
    try {
      // 버튼 다시 조회 (DOM 변경 대응)
      const buttons = await page.$$(buttonSelector);
      if (!buttons[i]) continue;
      
      // 클릭
      await buttons[i].click();
      await new Promise(r => setTimeout(r, 1000)); // 모달 애니메이션 대기
      
      // 모달 캡처
      const screenshot = await page.screenshot({ type: 'png' });
      
      // 모달에서 이름 텍스트 추출 시도
      const nameText = await page.$eval(
        '.modal-title, .popup-title, .doctor-name, [class*="name"]',
        el => el.textContent?.trim() || ''
      ).catch(() => `doctor_${i}`);
      
      modalScreenshots.push({
        index: i,
        buffer: Buffer.from(screenshot),
        doctorName: nameText,
      });
      
      console.log(`  ✅ ${i+1}/${buttonCount} ${nameText} 모달 캡처`);
      
      // 모달 닫기
      const closeSelectors = ['.modal-close', '[class*="close"]', '.popup-close', '.btn-close', 'button.close'];
      let closed = false;
      for (const cs of closeSelectors) {
        const closeBtn = await page.$(cs);
        if (closeBtn) {
          await closeBtn.click();
          closed = true;
          break;
        }
      }
      if (!closed) await page.keyboard.press('Escape');
      
      await new Promise(r => setTimeout(r, 500));
      
    } catch (e: any) {
      console.log(`  ⚠️ ${i+1}/${buttonCount} 모달 캡처 실패: ${e.message}`);
    }
  }
  
  await browser.close();
  console.log(`  모달 캡처 완료: ${modalScreenshots.length}/${buttonCount}장`);
  
  // sharp 최적화 → Supabase Storage 저장 → Vision 분석
  const results = [];
  for (const ms of modalScreenshots) {
    const optimized = await sharp(ms.buffer)
      .resize(1280, null, { withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    
    const storagePath = `${hospitalId}/doctor_modal_${ms.index}_${Date.now()}.webp`;
    await supabase.storage
      .from('hospital-screenshots')
      .upload(storagePath, optimized, { contentType: 'image/webp' });
    
    const publicUrl = supabase.storage
      .from('hospital-screenshots')
      .getPublicUrl(storagePath).data.publicUrl;
    
    // Gemini Vision 분석 → 해당 의사의 상세 정보 추출
    const analysis = await analyzeWithVision(optimized, 'doctor_modal');
    results.push({ ...ms, publicUrl, analysis });
  }
  
  return { success: true, modals: results };
}
```

**Puppeteer 설치:**
```bash
cd C:\Users\J\Projects\madmedsales
npm install puppeteer
```

### 2. 탭/아코디언 콘텐츠 대응

시술 소개가 탭 형태인 경우 (리프팅 탭, 레이저 탭, 바디 탭 등):
- 기본 탭만 마크다운에 포함, 나머지 탭은 클릭 필요

**트리거:** 시술 페이지인데 추출 시술이 비정상적으로 적을 때

**대응:** 카드+모달과 동일 — Puppeteer로 각 탭 클릭 → 내용 캡처

### 3. 시스템 지침서 추가 항목

시스템 지침서 섹션 5에 추가:

```
### 5-11. 카드 + 모달(플로팅) 패턴 ★★★

패턴: 의료진 카드 나열 → "자세히보기" 클릭 → 플로팅 모달로 상세 이력
문제: 클릭 안 하면 이름만 나오고 경력/학력 전부 빈 배열
대응: 경력 비율 30% 미만이면 Puppeteer로 순차 클릭 → 모달 캡처 → Vision 분석

### 5-12. 탭/아코디언 콘텐츠

패턴: 시술 소개가 탭으로 구분 (리프팅, 레이저, 바디 등)
문제: 기본 탭만 마크다운에 포함
대응: 추출 시술이 비정상적으로 적으면 Puppeteer로 탭 순차 클릭
```

### 4. 금지사항 추가

```
18. ❌ "자세히보기", "더보기" 같은 상세 정보 버튼을 클릭하지 않고 넘어가기
    (이름만 나오고 경력 비어있으면 반드시 원인 파악)
```

### 5. DB 변경

없음. v5 스키마 그대로 사용.
모달 스크린샷은 기존 hospital-screenshots 버킷에 저장.
파일명 규칙: `{hospital_id}/doctor_modal_{index}_{timestamp}.webp`

### 6. 사전 체크리스트 추가 항목

```
[인터랙션 체크]
  Puppeteer 설치: ✅/❌
  카드+모달 자동 감지: ✅/❌
  자세히보기 순차 클릭→캡처: ✅/❌
  탭/아코디언 클릭 대응: ✅/❌
```

### 7. 포에버의원 테스트 기준 변경

v5 기준:
> 의사: 다지점 통합 시 47명, 신사점만이면 2~5명

v5.1 기준:
> 의사: 이름 + **경력/학력 추출 필수.** 이름만 나오고 경력 빈 배열이면 **실패.**
> 모달 클릭으로 상세 정보 추출. 경력/학력 채워진 비율 70% 이상이어야 PASS.

---

## 적용 순서

```
v5 실행 완료 대기
  ↓
v5 결과 확인 (특히 의사 경력/학력 비율)
  ↓
npm install puppeteer
  ↓
recrawl-v5.ts에 crawlDoctorModals 함수 추가
  ↓
분석 후 경력 비율 30% 미만이면 자동 트리거되도록 로직 삽입
  ↓
포에버의원(신사)으로 테스트
  ↓
의사 경력/학력 채워진 비율 70%+ 확인
  ↓
전체 재실행 (의사 데이터 보강분만)
```

---

## 비용 영향

- Puppeteer: 로컬 실행이므로 추가 비용 없음
- 모달 스크린샷: 의사 1명당 1장 → 47명이면 47장 × 0.15MB = ~7MB (무시 수준)
- Gemini Vision: 모달당 1회 → 47회 추가 (Gemini Flash 비용 무시 수준)
- Firecrawl: 크레딧 소모 없음 (Puppeteer 직접 크롤)
