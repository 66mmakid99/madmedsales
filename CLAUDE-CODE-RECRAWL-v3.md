# Claude Code 명령문 — TORR RF 재크롤링 + 재분석 (v3)

이전 크롤링의 설계 결함:
1. 멀티페이지 텍스트를 합쳐서 앞에서 잘라 Gemini에 보냄 → 데이터 손실
2. 크롤링 원본 마크다운 미저장 → 자산 폐기
3. Gemini 호출 횟수 고정 → 비효율

전부 고친다. 아래 설계대로 정확히 구현해.

---

## 핵심 원칙

1. **원본 마크다운은 Supabase에 페이지별 저장한다.** 로컬 파일 저장 하지 마.
2. **Gemini 호출은 실제 크롤링된 페이지 수만큼 한다.** 고정 횟수 아님.
3. **텍스트를 자르지 않는다.** 긴 페이지는 청크로 나눠서 Gemini 여러 번 호출하고 결과를 병합한다. 중간을 날리면 안 된다.
4. **수집 데이터를 확장한다.** 장비/시술/의사만이 아니라, 이벤트/할인/행사, 시술 가격, 의료진 학력/경력까지.

---

## DB 스키마 추가

Supabase에 테이블 생성:

```sql
-- 크롤링 원본 마크다운 (페이지별 개별 저장)
CREATE TABLE hospital_crawl_pages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  hospital_id UUID REFERENCES hospitals(id),
  url TEXT NOT NULL,
  page_type TEXT NOT NULL, -- 'main', 'treatment', 'equipment', 'doctor', 'event', 'price', 'other'
  markdown TEXT NOT NULL,
  char_count INTEGER NOT NULL,
  crawled_at TIMESTAMPTZ DEFAULT now(),
  gemini_analyzed BOOLEAN DEFAULT false,
  tenant_id UUID DEFAULT '00000000-0000-0000-0000-000000000001'
);

CREATE INDEX idx_crawl_pages_hospital ON hospital_crawl_pages(hospital_id);

ALTER TABLE hospital_crawl_pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON hospital_crawl_pages
  USING (tenant_id = '00000000-0000-0000-0000-000000000001');
```

또한 기존 hospital_doctors 테이블에 컬럼이 부족하면 확인하고:
- education (학력)
- career (경력)
- academic_activity (논문, 학회, KOL 활동)
이 컬럼들이 없으면 추가해.

기존 hospital_treatments에도:
- price_note (가격 부가설명, "1회 기준", "이벤트가" 등)
- combo_with (같이 시술하는 콤보 정보)
이 컬럼이 없으면 추가해.

이벤트/행사 저장용 테이블도 필요하면 만들어:
```sql
CREATE TABLE hospital_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  hospital_id UUID REFERENCES hospitals(id),
  title TEXT NOT NULL,
  description TEXT,
  discount_type TEXT, -- 'percent', 'fixed', 'package', 'free_add', 'other'
  discount_value TEXT, -- '30%', '50000원', '1+1' 등
  related_treatments TEXT[], -- 관련 시술명 배열
  source_url TEXT,
  crawled_at TIMESTAMPTZ DEFAULT now(),
  tenant_id UUID DEFAULT '00000000-0000-0000-0000-000000000001'
);
```

---

## 크롤링 대상

scripts/data/step2-crawl-targets.json에서 37개 병원.
+ 기존 12개 DONE 병원도 이번에 다시 크롤링해. 이전 크롤링 원본이 없으니까.
= 총 49개 병원 (URL이 있는 전체).

step2-crawl-targets.json에 12개 DONE이 없으면, torr-rf-master-71-v2.json에서 phase가 "DONE"이고 website가 있는 병원도 추가해.

---

## Step 1: Firecrawl 크롤링 + 원본 즉시 저장

```
병원 루프:
  1. mapUrl → 사이트 내 전체 URL 수집
  2. URL 필터링 → 관련 페이지만 선택 (갯수 제한 없음, 관련 있으면 다 가져옴. 단 최대 15페이지)
  3. 각 URL scrapeUrl → 마크다운 획득
  4. 획득 즉시 hospital_crawl_pages에 INSERT (크롤링과 저장이 한 세트)
  5. 다음 페이지로
```

URL 필터링 기준:

포함 (하나라도 매칭되면 포함):
```
/시술|프로그램|장비|기기|의료진|원장|대표원장|doctor|staff|
이벤트|event|할인|가격|price|비용|menu|
리프팅|피부|레이저|rf|hifu|바디|보톡스|필러|
주사|부스터|스킨|케어|토닝|제모|탈모|
info|about|introduce|소개|진료/i
```

제외:
```
/blog|후기|리뷰|review|공지|notice|개인정보|privacy|
채용|recruit|오시는길|map|location|contact|
\.pdf|\.jpg|\.png|login|admin|board|gallery|
예약|booking|reservation|sitemap/i
```

페이지 타입 자동 분류:
```
URL 패턴 → page_type:
/의료진|원장|doctor|staff|대표/ → 'doctor'
/장비|기기|equipment|device/ → 'equipment'  
/시술|프로그램|treatment|menu|진료/ → 'treatment'
/이벤트|event|할인|special|가격|price|비용/ → 'event'
메인 URL과 동일 → 'main'
그 외 → 'other'
```

---

## Step 2: Gemini 페이지별 개별 분석

hospital_crawl_pages에서 해당 병원의 저장된 페이지를 읽는다.
**페이지마다 개별 Gemini 호출.**

### 긴 페이지 처리 (텍스트를 자르지 않는다)

- 25,000자 이하: 그대로 1회 호출
- 25,000자 초과: 25,000자 단위로 청크 분할. 청크 경계는 문장/문단 단위로 자른다 (단어 중간에서 자르지 않는다). 각 청크를 개별 호출하고 결과를 병합.

```typescript
function splitIntoChunks(text: string, maxChars: number = 25000): string[] {
  if (text.length <= maxChars) return [text];
  
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    // 문단 경계에서 자르기
    if (end < text.length) {
      const lastNewline = text.lastIndexOf('\n\n', end);
      if (lastNewline > start + maxChars * 0.7) end = lastNewline;
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

### Gemini 프롬프트 (확장된 추출 항목)

```
이 텍스트는 병원 웹사이트의 {page_type} 페이지입니다.
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

### 결과 병합 + 중복 제거

한 병원의 모든 페이지 분석 결과를 모아서:
- 장비: equipment_name 정규화 후 중복 제거 (동일 장비가 시술 페이지와 장비 페이지 양쪽에 나올 수 있음)
- 시술: treatment_name 기준 중복 제거. 같은 시술인데 가격이 다르면 가격 있는 쪽 우선.
- 의사: name 기준 중복 제거. 정보가 더 많은 쪽 우선 (education, career 등).
- 이벤트: title 기준 중복 제거.

---

## Step 3: DB 저장

해당 hospital_id의 기존 데이터:
- hospital_equipments → DELETE 후 INSERT
- hospital_treatments → DELETE 후 INSERT  
- hospital_doctors → DELETE 후 INSERT
- hospital_events → DELETE 후 INSERT (새 테이블)

컬럼명:
- hospital_equipments: equipment_name, equipment_category, manufacturer, source('firecrawl_gemini_v3')
- hospital_treatments: treatment_name, treatment_category, price, price_note, is_promoted, combo_with, source
- hospital_doctors: name, title, specialty, education, career, academic_activity
- hospital_events: title, description, discount_type, discount_value, related_treatments, source_url

hospital_crawl_pages에서 해당 페이지의 gemini_analyzed = true로 업데이트.

---

## Step 4: 결과 검증 + Export

전체 완료 후:

1. 병원별 결과 요약 (이전 vs 이번 비교):
```
병원명 | 이전 장비 | 이번 장비 | 이전 시술 | 이번 시술 | 이전 의사 | 이번 의사 | 이벤트
동안중심의원 | 0 | ? | 169 | ? | 0 | ? | ?
...
```

2. 전체 통계:
- 총 크롤 페이지 수
- 총 Gemini 호출 수
- 총 장비/시술/의사/이벤트 수
- 크레딧 사용량

3. Export: torr-rf-hospitals-full-export-v3.json 생성
```json
{
  "stats": { ... },
  "hospitals": [
    {
      "crm_id": "...",
      "hospital_id": "...",
      "name": "...",
      "equipments": [...],
      "treatments": [...],
      "doctors": [...],
      "events": [...],
      "crawl_pages": [{ "url": "...", "page_type": "...", "char_count": ... }],
      "data_status": "rich|partial|empty"
    }
  ]
}
```

---

## Gemini 호출 관련

- 모델: scripts/.env의 GEMINI_MODEL
- 인증: scripts/analysis/gemini-auth.js의 getAccessToken()
- 타임아웃: 60초
- 429 에러: 30초 대기 후 1회 재시도
- JSON 파싱 에러: 마크다운 코드블록 제거 후 재파싱 시도
- 500자 미만 페이지: Gemini 호출 스킵 (메뉴, 푸터 등 의미없음)

## 크레딧 예상

- 49개 병원 × (map 1 + 평균 5~7페이지) = ~350 크레딧
- 현재 잔여: 2,257
- 실행 후 잔여: ~1,900

## 환경 정보
- 프로젝트: C:\Users\J\Projects\madmedsales
- Firecrawl SDK: @mendable/firecrawl-js v4.13.0 (firecrawl.v1.xxx)
- Supabase: https://grtkcrzgwapsjcqkxlmj.supabase.co
- TENANT_ID: 00000000-0000-0000-0000-000000000001
- .env: scripts/.env
- Gemini 인증: scripts/analysis/gemini-auth.js
- Supabase 유틸: scripts/utils/supabase.js

## 실행 순서

1. DB 스키마 변경 (테이블 생성, 컬럼 추가)
2. 3개 병원 테스트 (동안중심의원 포함 필수 — 이전에 의사 0명이었으니 검증)
3. 테스트 결과 출력해서 확인시켜줘
4. 확인 후 나머지 전체 실행
5. 결과 비교표 + export JSON 생성

## 주의사항

- 원본 마크다운은 Supabase에만 저장. 로컬 파일 백업 하지 마.
- Gemini 호출 횟수는 실제 크롤링된 페이지 수에 따라 동적. 고정 아님.
- 텍스트를 자르지 않는다. 긴 건 청크로 나눠서 전부 분석.
- 중간에 실패해도 이미 저장된 hospital_crawl_pages는 유지.
- 크레딧 소모 상황 중간중간 알려줘.
- 컨텍스트 70% 차면 진행 현황 요약 + 다음 단계 명시하고 새 대화 제안.
- 빌드/실행 전 반드시 확인. 추측하지 마.
