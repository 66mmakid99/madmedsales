# PATCH v5.4 UNIFIED — 2단계 파이프라인 + 보고서 결함 수정

> 이 패치는 기존 v5.4(보고서 결함 10개 수정)에 **Gemini 2단계 분리 파이프라인**을 통합한 최종 패치입니다.
> v5.3이 적용된 `scripts/recrawl-v5.ts` 위에 적용하세요.

---

## ⚙️ 핵심 아키텍처 변경: 2단계 분리 파이프라인

### 왜 바꾸는가?
현재는 Gemini에게 "이미지를 읽으면서 동시에 분류하라"고 한 번에 시키고 있음.
→ OCR도 부정확, 분류도 부정확. "기문상"/"문상재" 오류가 대표적 사례.

### 변경 후 구조

```
[크롤링 데이터]
    │
    ├── 텍스트 마크다운 ──────────────────────────┐
    │                                              │
    └── 이미지 스크린샷 ──→ [1단계: OCR 전담] ──→ 텍스트 변환 ──┤
                                                    │
                                              [2단계: 분류/구조화]
                                                    │
                                              ┌─────┴─────┐
                                              │  최종 JSON  │
                                              └───────────┘
```

**1단계 (OCR 전담):** 이미지 → 텍스트만 추출. 분류하지 않음.
**2단계 (분류 전담):** 1단계 텍스트 + 크롤링 마크다운 → 6개 카테고리로 구조화.

---

## 📌 모델 확정

| 단계 | 모델 | 용도 | 이유 |
|------|------|------|------|
| 1단계 OCR | `gemini-2.5-flash-preview-05-20` | 이미지→텍스트 변환 | 한국어 OCR 성능 우수, 비용 효율적 |
| 2단계 분류 | `gemini-2.5-flash-preview-05-20` | 텍스트→구조화 JSON | 추론 능력 충분, 프롬프트로 품질 확보 |
| 의사 이름 검증 | Puppeteer 구글 검색 | OCR 이름 교차검증 | 비용 0원, 정확도 최상 |

> 모든 Gemini 호출에서 모델명을 위 값으로 통일하세요.
> 기존 코드에 다른 모델명이 있으면 전부 교체하세요.

---

## 1단계: OCR 전담 프롬프트

### 함수명: `extractTextFromImage(imageBuffer: Buffer): Promise<string>`

```
이 함수는 이미지를 받아서 순수 텍스트만 반환합니다.
기존의 이미지 분석 함수를 대체합니다.
```

### Gemini 프롬프트 (1단계 OCR 전용)

```text
당신은 한국어 의료/피부과 웹사이트 이미지의 OCR 전문가입니다.

## 임무
이 이미지에 보이는 모든 텍스트를 빠짐없이 정확하게 읽어서 출력하세요.

## 규칙
1. 이미지에 보이는 텍스트를 위→아래, 왼쪽→오른쪽 순서로 읽으세요.
2. 한국어, 영어, 숫자, 특수문자 모두 그대로 옮기세요.
3. 줄바꿈은 원본 레이아웃을 따르세요.
4. 가격 표기 (₩, 원, 만원 등)를 정확히 읽으세요.
5. 의사 이름은 한 글자도 틀리지 않게 정확히 읽으세요.
   - 한국 이름은 보통 2~4글자 (성1 + 이름1~3)
   - 이미지 해상도가 낮으면 "불확실: [추정 이름]"으로 표시
6. 장비 브랜드/모델명은 영문 철자 그대로 옮기세요.
7. 절대 해석하지 마세요. 분류하지 마세요. 보이는 것만 옮기세요.
8. 텍스트가 없는 이미지면 "텍스트_없음"만 출력하세요.

## 출력 형식
이미지 속 텍스트를 그대로 출력. 다른 설명 없이 텍스트만.
```

### 코드 구현 가이드

```typescript
async function extractTextFromImage(imageBuffer: Buffer): Promise<string> {
  const base64 = imageBuffer.toString('base64');
  const response = await gemini.generateContent({
    model: 'gemini-2.5-flash-preview-05-20',
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType: 'image/png', data: base64 } },
        { text: OCR_PROMPT }  // 위의 1단계 프롬프트
      ]
    }],
    generationConfig: {
      temperature: 0.1,  // OCR은 창의성 최소화
      maxOutputTokens: 4096
    }
  });
  return response.text();
}
```

---

## 2단계: 분류/구조화 프롬프트

### 함수명: `classifyHospitalData(allText: string, hospitalName: string): Promise<HospitalAnalysis>`

```
이 함수는 1단계 OCR 텍스트 + 크롤링 마크다운을 합쳐서
7개 카테고리로 구조화된 JSON을 반환합니다.
기존의 Gemini 분석 함수를 대체합니다.
```

### Gemini 프롬프트 (2단계 분류 전용)

```text
당신은 한국 피부과/의료 데이터 분류 전문가입니다.
아래 텍스트는 "${hospitalName}"의 웹사이트에서 수집한 전체 텍스트입니다.

## 임무
텍스트에서 아래 7개 카테고리의 정보를 빠짐없이 추출하여 JSON으로 출력하세요.

## 7개 추출 카테고리

### 1. doctors (의사 정보)
- name: 이름 (정확히)
- title: 직책 (원장, 부원장, 진료원장 등)
- specialty: 전문분야
- career: 경력사항 (배열)
- education: 학력 (배열)
- certifications: 자격/면허 (배열)
- confidence: "confirmed" | "uncertain" (이름이 불확실하면 uncertain)

### 2. academic_activities (학술활동) ⚠️ 의사와 독립 추출
- type: "논문" | "학회발표" | "교과서집필" | "임상연구" | "수상" | "기타"
- title: 활동 제목/내용
- year: 연도 (있으면)
- doctor_name: 관련 의사 이름 (있으면, 없으면 null)
- source_text: 원문 텍스트 (추출 근거)

> 중요: 의사가 0명이어도 학술활동은 반드시 추출.
> 마크다운과 이미지 텍스트 모두에서 빠짐없이 추출.

### 3. equipment (장비 정보)
- brand: 제조사/브랜드명
- model: 모델명
- korean_name: 한국어 통칭 (있으면)
- category: "RF" | "레이저" | "초음파" | "기타"
- description: 용도/특징 설명
- source: "text" | "image_banner" | "image_page"

> 중요: 장비가 텍스트에 없으면 배너/슬라이드 이미지에서 찾아야 함.
> 장비명과 시술명을 혼동하지 마세요.
>   - 장비: 써마지, 울쎄라, 인모드, 슈링크, TORR RF 등 (기계 이름)
>   - 시술: 리프팅, 탄력관리, 피부재생 등 (행위 이름)

### 4. treatments (시술 정보)
각 시술 항목:
- name: 시술명 (정규화: 공백 통일)
- price: 정가 (숫자, 원 단위)
- price_display: 표기 원문 ("15만원", "150,000원" 등)
- is_package: boolean (패키지/세트 여부)
- package_detail: (패키지인 경우) 아래 분석 포함
  - included_treatments: 포함된 개별 시술명 (배열)
  - estimated_unit_prices: 추정 개별 단가 (배열, 불가능하면 null)
  - estimation_method: 추정 근거 설명
- session_info: 회차 정보 ("1회", "10회 기준" 등, 있으면)
- body_part: 시술 부위 (있으면)
- category: 아래 분류 기준 참조

> 시술 분류 기준:
>   - "~클리닉"은 시술이 아니라 **카테고리**로 분류 (예: "탈모클리닉" → category)
>   - "탈모클리닉"과 "탈모 클리닉"은 같은 것 → 공백 정규화 후 중복 제거
>   - 합성어 시술 (예: "울쎄라+써마지") → is_package: true로 처리

> 가격 추출 주의:
>   - "~부터", "~이상" → price에 해당 금액, price_note에 "최저가" 표시
>   - "상담 후 결정", "전화문의" → price: null, price_display: "상담필요"
>   - VAT 포함/별도 표기가 있으면 price_note에 기록

### 5. events (이벤트/할인/행사)
- title: 이벤트명
- type: "할인" | "패키지" | "신규고객" | "시즌" | "기타"
- period: 기간 (시작~종료, 있으면)
- discount_info: 할인 내용 (%, 금액, 조건 등)
- original_price: 원래 가격 (있으면)
- event_price: 이벤트 가격 (있으면)
- conditions: 조건 (배열, "첫방문", "SNS후기 작성 시" 등)
- source: "text" | "popup" | "banner" | "page"

> 중요: 팝업에서 발견된 이벤트도 반드시 포함.
> SUFFICIENT 판정이어도 팝업 이미지가 있으면 이벤트 추출.

### 6. clinic_categories (클리닉 분류)
- name: 클리닉명 ("탈모클리닉", "리프팅클리닉" 등)
- treatments: 해당 클리닉에 속하는 시술명 (배열)

> "~클리닉"은 여기에 넣고, treatments(시술)에는 넣지 마세요.

### 7. contact_info (연락처/컨택 포인트) ⚠️ 영업 필수

병원에 연락할 수 있는 모든 채널을 빠짐없이 수집한다.

- email: 이메일 주소 (배열, 여러 개 가능)
  - address: 이메일 주소
  - type: "대표" | "상담" | "채용" | "기타"
  - source: 발견된 위치 (footer, 문의페이지 등)
- phone: 전화번호 (배열)
  - number: 전화번호 (하이픈 포함 원문 그대로)
  - type: "대표" | "상담" | "예약" | "팩스" | "기타"
- address: 주소
  - full_address: 전체 주소
  - sido: 시/도
  - sigungu: 시/군/구
- kakao_channel: 카카오톡 채널 URL 또는 ID (있으면)
- naver_booking: 네이버 예약 URL (있으면)
- naver_place: 네이버 플레이스 URL (있으면)
- instagram: 인스타그램 URL 또는 @계정 (있으면)
- youtube: 유튜브 채널 URL (있으면)
- blog: 블로그 URL (네이버, 티스토리 등, 있으면)
- website_url: 크롤링한 메인 URL
- operating_hours: 운영시간 (있으면)
  - weekday: 평일
  - saturday: 토요일
  - sunday: 일요일/공휴일
  - lunch_break: 점심시간

> 중요: 이메일은 영업의 핵심 컨택 포인트. 반드시 footer, 문의 페이지, 상담 페이지 등에서 찾을 것.
> 전화번호도 대표번호, 상담번호, 예약번호가 다를 수 있으므로 전부 수집.
> SNS/카카오/네이버 링크는 웹사이트 header, footer, 사이드바에 주로 있음.

## 출력 규칙
1. 반드시 유효한 JSON만 출력. 설명문 없이.
2. 텍스트에 근거 없는 정보는 절대 추가하지 마세요.
3. 확실하지 않은 항목은 confidence: "uncertain" 표시.
4. 같은 정보의 중복 항목은 병합하세요.
5. 가격에서 "만원" → 10000 곱하기, "천원" → 1000 곱하기로 원 단위 변환.

## JSON 스키마
{
  "hospital_name": string,
  "doctors": [...],
  "academic_activities": [...],
  "equipment": [...],
  "treatments": [...],
  "events": [...],
  "clinic_categories": [...],
  "contact_info": {
    "email": [...],
    "phone": [...],
    "address": {...},
    "kakao_channel": string | null,
    "naver_booking": string | null,
    "naver_place": string | null,
    "instagram": string | null,
    "youtube": string | null,
    "blog": string | null,
    "website_url": string,
    "operating_hours": {...} | null
  },
  "extraction_summary": {
    "total_doctors": number,
    "total_academic": number,
    "total_equipment": number,
    "total_treatments": number,
    "total_events": number,
    "total_categories": number,
    "total_contact_channels": number,
    "has_email": boolean,
    "has_phone": boolean,
    "has_kakao": boolean,
    "has_sns": boolean,
    "price_available_ratio": "가격 있는 시술 / 전체 시술 (예: 15/23)"
  }
}
```

### 코드 구현 가이드

```typescript
async function classifyHospitalData(
  allText: string,       // 크롤링 마크다운 + 1단계 OCR 텍스트 모두 합친 것
  hospitalName: string
): Promise<HospitalAnalysis> {
  const prompt = CLASSIFY_PROMPT.replace('${hospitalName}', hospitalName);
  
  const response = await gemini.generateContent({
    model: 'gemini-2.5-flash-preview-05-20',
    contents: [{
      role: 'user',
      parts: [
        { text: prompt + '\n\n---\n\n## 분석 대상 텍스트:\n\n' + allText }
      ]
    }],
    generationConfig: {
      temperature: 0.2,  // 분류는 약간의 추론 허용
      maxOutputTokens: 8192,
      responseMimeType: 'application/json'  // JSON 강제
    }
  });
  
  return JSON.parse(response.text());
}
```

---

## 전체 실행 흐름 변경

### 기존 (v5.3)
```
크롤링 → 각 페이지마다 Gemini(이미지+텍스트 동시 분석) → 결과 합산
```

### 변경 후 (v5.4)
```
크롤링
  ├── 텍스트 마크다운 수집 → allText에 누적
  └── 이미지 스크린샷 수집
        └── 각 이미지 → extractTextFromImage() → OCR 텍스트 → allText에 누적
                                                              
allText 전체 → classifyHospitalData() 1회 호출 → 최종 JSON
```

### 장점
1. **OCR 정확도 향상**: 읽기만 전담하니 글자 오류 감소
2. **분류 정확도 향상**: 전체 텍스트를 한 번에 보고 판단하니 맥락 파악 우수
3. **중복 자동 제거**: 페이지별 분석이 아니라 전체 한 번에 하니 중복 발생 안 함
4. **비용 절감**: Gemini 호출 횟수 감소 (페이지별 → 병원별 1회)
5. **디버깅 용이**: OCR 텍스트를 별도 저장하면 어디서 오류났는지 추적 가능

---

## v5.4 결함 수정 (기존 10개 항목)

### 🔴 심각

**1. 의사 이름 웹 검색 교차검증**
- OCR에서 이름을 읽은 후, confidence가 "uncertain"이거나 의사 5명 이하일 때
- Puppeteer 구글 검색으로 교차검증:
  - 1차: "병원명 + OCR이름" 검색 → 결과 있으면 confirmed
  - 2차: 결과 없으면 "병원명 + 원장" 검색 → 정확한 이름 발견 시 교정
- 교정된 이름은 `name_source: "web_corrected"`, 검증된 이름은 `name_source: "web_verified"`

**2. 학술활동 독립 추출** → 2단계 프롬프트에 이미 반영 완료

### 🟡 구조적

**3. 커버리지 0/0=100% 방지**
- 기대 항목이 0개인 카테고리: 커버리지를 "N/A"로 표기
- 보고서에 "N/A"와 실제 퍼센트가 혼재하면 안 됨

**4. URL trailing slash 정규화**
```typescript
function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '').replace(/^https?:\/\/(www\.)?/, 'https://');
}
```
- 크롤 목록에 추가하기 전에 정규화 → 중복 크롤 방지

**5. 콘텐츠 해시 중복 감지 (SPA 대응)**
```typescript
import crypto from 'crypto';
function contentHash(text: string): string {
  return crypto.createHash('md5').update(text.trim()).digest('hex');
}
```
- 크롤한 페이지의 본문 해시를 비교
- 같은 해시가 이미 있으면 "SPA 중복"으로 스킵

**6. 시술명 공백 정규화** → 2단계 프롬프트에서 처리 (중복 병합 지시)

**7. "~클리닉" 카테고리 분리** → 2단계 프롬프트에서 처리 (clinic_categories 분리)

**8. SUFFICIENT여도 팝업 이미지 Vision 실행**
- `crawlResult.status === 'SUFFICIENT'`여도 팝업 이미지가 있으면
- 1단계 OCR → allText에 추가 (이벤트 정보 놓치지 않음)

**9. 장비 0이면 배너 슬라이드 캡처**
- 2단계 분류 결과에서 equipment가 빈 배열이면
- 메인 페이지 배너/슬라이드 스크린샷 → 1단계 OCR → 2단계 재분류
- 재분류 시 equipment 필드만 추가 분석하는 경량 프롬프트 사용

**10. 보강 크롤 다중 캡처**
- 보강 크롤 시 스크린샷 1장 → 4장 (기존 다중 캡처 함수 재사용)

---

## OCR 텍스트 저장 (디버깅용)

각 병원의 OCR 결과를 별도 파일로 저장하여 추후 검증에 활용:

```typescript
// 각 이미지 OCR 결과를 누적
const ocrResults: { source: string; text: string }[] = [];

// 이미지 처리 후
ocrResults.push({
  source: `screenshot_page_${pageIndex}_capture_${captureIndex}`,
  text: ocrText
});

// 병원 처리 완료 후 저장
fs.writeFileSync(
  `output/${hospitalId}_ocr_raw.json`,
  JSON.stringify(ocrResults, null, 2)
);
```

---

## 검증 체크리스트 업데이트

### 안산엔비의원 테스트 시 확인:
```
□ 1단계 OCR: output/ansan-enbi_ocr_raw.json 파일 생성됨
□ 의사 이름: "문상재" (web_corrected 또는 web_verified)
□ 이름 source 필드 존재: "web_corrected" | "web_verified" | "ocr_confirmed"
□ 학술활동: 8건 전부 추출 (academic_activities 배열 길이 >= 8)
□ 시술: 중복 없음 ("탈모클리닉"과 "탈모 클리닉" 따로 안 나옴)
□ 시술: "~클리닉"은 clinic_categories에 있고 treatments에 없음
□ 장비: 1개 이상 (source: "image_banner" 포함)
□ 이벤트: 팝업에서 추출된 항목 있음 (source: "popup")
□ 크롤: 같은 URL 2번 크롤 안 됨 (trailing slash 정규화)
□ 크롤: 동일 콘텐츠 해시 페이지 스킵됨
□ 보고서: 커버리지에 0/0=100% 없음 (N/A로 표기)
□ 가격: price는 원 단위 숫자, price_display는 원문 표기
□ 패키지: is_package=true인 시술에 package_detail 있음
□ 연락처: contact_info.email 또는 contact_info.phone 최소 1개 존재
□ 연락처: website_url 정확히 기록됨
□ 연락처: SNS/카카오/네이버 링크 있으면 수집됨
□ extraction_summary: 각 카테고리 숫자가 실제 배열 길이와 일치
□ Gemini 모델: gemini-2.5-flash-preview-05-20 사용 확인
```

---

## 금지사항 추가 (28~33번)

기존 1~27번 유지 + 아래 추가:

28. OCR과 분류를 한 번의 Gemini 호출에서 동시에 시키기 금지 (반드시 2단계 분리)
29. 1단계 OCR 프롬프트에서 "분류하라", "정리하라", "카테고리" 등 분류 지시 금지
30. 2단계 분류에서 텍스트에 없는 정보를 추측으로 생성 금지
31. 장비명과 시술명 혼동 금지 (써마지=장비, 리프팅=시술)
32. 가격 단위 변환 누락 금지 ("15만원" → 반드시 150000으로 변환)
33. OCR raw 텍스트 파일 저장 누락 금지 (디버깅 필수)
34. 연락처(이메일, 전화, SNS) 수집 누락 금지 — 영업 플랫폼의 존재 이유

---

## 적용 순서 요약

```
1. 모델명 전체 교체 → gemini-2.5-flash-preview-05-20
2. extractTextFromImage() 함수 생성 (1단계 OCR)
3. classifyHospitalData() 함수 생성 (2단계 분류)
4. 기존 Gemini 분석 로직을 2단계 파이프라인으로 교체
5. URL 정규화 + 콘텐츠 해시 중복 감지 추가
6. 의사 이름 웹 검색 교차검증 추가
7. 팝업 이미지 무조건 OCR 처리 추가
8. 장비 0일 때 배너 재캡처 로직 추가
9. OCR raw 텍스트 저장 추가
10. 안산엔비의원 테스트 실행 → 체크리스트 검증
```
