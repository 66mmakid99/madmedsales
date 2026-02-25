# Claude Code 명령문 — TORR RF 재크롤링 + 재분석 (v4)

## 이전 버전(v3)에서 추가된 핵심 변경

1. **이미지 기반 사이트 대응:** Firecrawl screenshot + Gemini Vision 병행
2. **이미지 Supabase Storage 저장:** 최적화(WebP, 1280px, 품질80%) 후 버킷 저장, DB에는 URL만
3. **테스트 우선:** 3개 병원(안산엔비, 동안중심, 포에버) 100% 정상 추출 확인 전까지 49개 전체 실행 절대 금지
4. **용량 최적화:** 병원당 최대 20페이지, 총 980장 기준 ~150MB 이내

---

## 설계 원칙 (v3 유지 + 추가)

1. 원본 마크다운은 Supabase DB에 페이지별 저장
2. 스크린샷 이미지는 Supabase Storage에 WebP 최적화 후 저장, DB에는 URL만
3. Gemini 분석은 페이지별 개별 호출
4. 마크다운 충분하면 텍스트 분석, 부족하면 스크린샷 → Vision 분석
5. 텍스트를 자르지 않는다. 긴 건 청크로 나눠서 전부 분석
6. 모든 중간 결과를 저장한다

---

## DB 스키마 (v3에서 추가)

v3에서 이미 생성한 테이블에 컬럼 추가:

```sql
-- hospital_crawl_pages에 스크린샷 URL 컬럼 추가
ALTER TABLE hospital_crawl_pages ADD COLUMN IF NOT EXISTS screenshot_url TEXT;
-- 분석 방법 기록 (text / vision / both)
ALTER TABLE hospital_crawl_pages ADD COLUMN IF NOT EXISTS analysis_method TEXT DEFAULT 'text';
```

## Supabase Storage 세팅

```typescript
// 버킷 생성 (처음 1회)
const { data, error } = await supabase.storage.createBucket('hospital-screenshots', {
  public: true,  // URL로 바로 열람 가능
  fileSizeLimit: 1048576, // 1MB (최적화 후 이 이하여야 함)
});
```

파일 경로 규칙:
```
hospital-screenshots/
  {hospital_id}/
    {page_type}_{url_slug}_{timestamp}.webp
```

예시:
```
hospital-screenshots/
  abc123/
    main_dongancenter.com_20260224.webp
    doctor_info_doctor.htm_20260224.webp
    treatment_menu01_20260224.webp
```

---

## 이미지 최적화 파이프라인

sharp 라이브러리 사용 (없으면 npm install sharp):

```typescript
import sharp from 'sharp';

async function optimizeScreenshot(imageBuffer: Buffer): Promise<Buffer> {
  return await sharp(imageBuffer)
    .resize(1280, null, {  // 너비 1280px, 높이 비율 유지
      withoutEnlargement: true,  // 원본이 더 작으면 확대 안 함
    })
    .webp({ quality: 80 })  // WebP 변환, 품질 80%
    .toBuffer();
}
```

최적화 효과:
- 원본 PNG ~1.5MB → 최적화 WebP ~0.15MB (90% 감소)
- 1280px 너비면 Gemini Vision이 텍스트 판독하기에 충분
- 품질 80%는 육안 차이 없음

---

## 크롤링 + 분석 파이프라인 (v4)

### 각 페이지 처리 흐름

```
페이지 URL
  ↓
Firecrawl scrapeUrl (formats: ['markdown', 'screenshot'])
  ↓
┌─────────────┬──────────────────┐
│ markdown    │ screenshot       │
│ (텍스트)    │ (이미지 바이너리)│
└─────┬───────┴────────┬─────────┘
      │                │
      │          sharp로 최적화
      │          (WebP, 1280px, q80)
      │                │
      │          Supabase Storage 업로드
      │                │
      ↓                ↓
  DB 저장: hospital_crawl_pages
  (markdown + screenshot_url)
      │
      ↓
  분석 방법 결정:
  ├── 마크다운 500자 이상 → Gemini 텍스트 분석 (analysis_method: 'text')
  ├── 마크다운 500자 미만 & 스크린샷 있음 → Gemini Vision 분석 (analysis_method: 'vision')
  └── 둘 다 없음 → 스킵
      │
      ↓
  분석 결과 (장비/시술/의사/이벤트)
```

### Firecrawl scrape 호출

```typescript
const result = await firecrawl.v1.scrapeUrl(pageUrl, {
  formats: ['markdown', 'screenshot'],
  waitFor: 3000,
});

// result.markdown: string (텍스트)
// result.screenshot: string (base64 인코딩 이미지) 또는 URL
```

주의: Firecrawl v4에서 screenshot 반환 형식 확인 필요.
- base64면 Buffer.from(result.screenshot, 'base64')로 변환
- URL이면 fetch로 다운로드 후 Buffer로
- 형식 모르면 먼저 1개 테스트해서 확인하고 진행

### Gemini Vision 분석 (이미지 기반 페이지용)

```typescript
async function analyzeWithVision(imageBuffer: Buffer, pageType: string): Promise<Analysis> {
  const base64Image = imageBuffer.toString('base64');
  
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inlineData: { mimeType: 'image/webp', data: base64Image } },
          { text: GEMINI_PROMPT(pageType) }
        ]
      }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 8000 },
    }),
    signal: AbortSignal.timeout(60000),
  });
  
  // JSON 파싱...
}
```

Vision에 보낼 때는 최적화된 WebP 이미지를 그대로 base64로 보낸다.
Gemini Vision은 이미지 내 한글 텍스트를 읽을 수 있다.

### Gemini 프롬프트 (v3과 동일, 텍스트/Vision 공용)

```
이 {콘텐츠}는 병원 웹사이트의 {page_type} 페이지입니다.
아래 정보를 빠짐없이 JSON으로 추출하세요.

{
  "equipments": [{
    "name": "정규화된 장비명",
    "category": "laser|rf|hifu|body|lifting|booster|skin|other",
    "manufacturer": "제조사명 (알 수 있으면)"
  }],
  
  "treatments": [{
    "name": "시술명",
    "category": "lifting|laser|body|booster|filler_botox|skin|hair|other",
    "price": 숫자(원 단위, 없으면 null),
    "price_note": "가격 부가설명 (1회 기준, 이벤트가, ~부터 등)",
    "is_promoted": true/false,
    "combo_with": "같이 시술하는 콤보가 있으면 기재"
  }],
  
  "doctors": [{
    "name": "의사 이름",
    "title": "직함 (대표원장, 원장, 부원장 등)",
    "specialty": "전문분야",
    "education": "학력 (의대, 수련병원 등)",
    "career": "주요경력 (학회 활동, 전임의 등)",
    "academic_activity": "논문, 학회 발표, 저서, KOL 활동 등"
  }],
  
  "events": [{
    "title": "이벤트/할인 제목",
    "description": "상세 내용",
    "discount_type": "percent|fixed|package|free_add|other",
    "discount_value": "30%, 50000원, 1+1 등",
    "related_treatments": ["관련 시술명"]
  }]
}

장비명 정규화 규칙:
- 써마지/써마지FLX → "Thermage FLX"
- 울쎄라/울쎄라프라임 → "Ulthera" / "Ulthera Prime"
- 슈링크/슈링크유니버스 → "Shrink Universe"
- 인모드 → "InMode"
- 토르/토르RF/TORR → "TORR RF"
- 토르 컴포트 듀얼/컴포트듀얼 → "TORR Comfort Dual"

★ "토르", "TORR", "컴포트듀얼" 관련 언급은 반드시 포함.
★ 가격 정보가 있으면 반드시 추출. "~부터", "VAT별도" 등 조건도 price_note에.
★ 의사 학력/경력은 텍스트에 있는 그대로 추출.
★ 이벤트/할인 정보가 있으면 반드시 추출.

없는 항목은 빈 배열로. JSON만 응답 (마크다운 없이).
```

텍스트 분석 시: `{콘텐츠}` = "텍스트"
Vision 분석 시: `{콘텐츠}` = "이미지"

---

## 긴 페이지 처리 (텍스트)

텍스트를 자르지 않는다. 청크로 나눈다:

- 25,000자 이하: 그대로 1회 호출
- 25,000자 초과: 25,000자 단위로 문단 경계에서 분할, 각 청크 개별 호출, 결과 병합

```typescript
function splitIntoChunks(text: string, maxChars: number = 25000): string[] {
  if (text.length <= maxChars) return [text];
  
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    if (end < text.length) {
      const lastPara = text.lastIndexOf('\n\n', end);
      if (lastPara > start + maxChars * 0.7) end = lastPara;
      else {
        const lastSentence = text.lastIndexOf('. ', end);
        if (lastSentence > start + maxChars * 0.7) end = lastSentence + 1;
      }
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}
```

---

## 결과 병합 + 중복 제거

한 병원의 모든 페이지(텍스트+Vision) 분석 결과를 모아서:

- 장비: equipment_name 정규화 후 중복 제거
- 시술: treatment_name 기준 중복 제거. 가격 있는 쪽 우선.
- 의사: name 기준 중복 제거. 정보 더 많은 쪽 우선.
- 이벤트: title 기준 중복 제거.

---

## DB 저장

v3과 동일:
- hospital_crawl_pages: 마크다운 + screenshot_url + analysis_method
- hospital_equipments: DELETE 후 INSERT (source: 'firecrawl_gemini_v4')
- hospital_treatments: DELETE 후 INSERT
- hospital_doctors: DELETE 후 INSERT
- hospital_events: DELETE 후 INSERT

---

## ⚠️ 실행 규칙: 테스트 먼저, 100% 확인 후 전체

### 1단계: 환경 세팅
- sharp 설치
- Supabase Storage 버킷 생성
- hospital_crawl_pages에 screenshot_url, analysis_method 컬럼 추가
- Firecrawl screenshot 반환 형식 확인 (base64인지 URL인지, 1개만 테스트)

### 2단계: 3개 병원 테스트 (반드시 100% 추출)

대상: 안산엔비의원, 동안중심의원, 포에버의원(신사)

이 3개 병원에서 아래 전부 정상 확인될 때까지 반복 수정:

| 병원 | 확인 항목 |
|------|-----------|
| 안산엔비의원 | 시술 추출됨, 이벤트 추출됨 |
| 동안중심의원 | ★ 의료진 2명 추출됨 (이미지 사이트 → Vision으로 해결) |
| 포에버의원(신사) | 의사 추출됨, 시술 추출됨 (이전에 시술 0이었음), 이벤트 추출됨 |

특히 동안중심의원:
- 이전에 텍스트만으로 0건이었음
- 이번에 스크린샷 → Vision으로 의료진 2명 + 시술 데이터 추출되어야 함
- 안 되면 원인 파악 후 수정, 될 때까지 반복

포에버의원(신사):
- 이전에 시술 0건이었음 (Gemini가 전부 이벤트로 분류)
- 시술과 이벤트가 적절히 분류되어야 함

**3개 병원 전부 정상일 때 결과를 보고해. 내가 확인하고 승인하면 그때 전체 실행.**

### 3단계: 전체 49개 병원 실행 (승인 후)

- 기존 12개 DONE + 37개 대상 = 49개
- 중간 진행률 보고 (10개 단위)
- 크레딧 소모 보고
- 완료 후 이전 vs 이번 비교표 + export JSON

---

## 크레딧/비용 예상

| 항목 | 수량 | 크레딧 |
|------|------|--------|
| mapUrl | 49개 | 49 |
| scrapeUrl (markdown+screenshot) | 49 × 평균 8페이지 | ~392 |
| **합계** | | **~441** |
| 잔여 (현재 2,257) | | **~1,816** |

Gemini 호출: 텍스트 분석 + Vision 분석 합쳐서 병원당 평균 10회 × 49개 = ~490회
Gemini Flash 비용: 무시할 수준 (SA 인증)

---

## 환경 정보
- 프로젝트: C:\Users\J\Projects\madmedsales
- Firecrawl SDK: @mendable/firecrawl-js v4.13.0 (firecrawl.v1.xxx)
- Supabase: https://grtkcrzgwapsjcqkxlmj.supabase.co
- Supabase Storage: hospital-screenshots 버킷
- TENANT_ID: 00000000-0000-0000-0000-000000000001
- .env: scripts/.env
- Gemini 인증: scripts/analysis/gemini-auth.js
- Supabase 유틸: scripts/utils/supabase.js
- 이미지 최적화: sharp (npm install sharp)

## 주의사항

- 3개 병원 100% 추출 전까지 전체 실행 절대 금지
- 이미지는 반드시 WebP 최적화 후 Storage 업로드
- 원본 마크다운 + 스크린샷 URL 둘 다 DB 저장
- Gemini 호출 횟수는 실제 크롤된 페이지 수에 따라 동적
- 텍스트 자르지 않음, 긴 건 청크 분할
- 크레딧 소모 중간 보고
- 컨텍스트 70% 차면 진행 현황 요약 + 다음 단계 명시
- 빌드/실행 전 반드시 확인. 추측하지 마.
