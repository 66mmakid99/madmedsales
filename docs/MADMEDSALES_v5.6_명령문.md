# MADMEDSALES v5.6 업그레이드 — 사전 확장 + 가격 스키마 개편 + 비급여표 추출

## 배경

v5.5 바노바기피부과 테스트 결과 가격 7건만 감지됨. 실제는 100건+.
원인 3가지:
1. 비급여항목표 80건+가 page-030/031에 텍스트로 크롤링되어 있는데 Gemini가 전부 무시
2. landing/index2.html(프로모션 가격 22건+)이 크롤 대상 50페이지에 미포함
3. priced_treatments 스키마에 정가/이벤트가 구분, 수량/단위 파싱, 비급여표 추출 지시가 없음

추가로:
- 장비 정규화율 35% (11/31) — 사전에 약제 카테고리 없고, 신규 장비 미등록
- unregistered_equipment 필드를 Gemini가 0개 반환 — 프롬프트 지시 부족
- Instagram/YouTube 감지 누락
- 학술논문 출처 장비(IFU, CPMHA)가 실제 보유 장비와 혼합

아래 작업을 순서대로 수행해라. 각 작업 완료 후 빌드 확인.

---

## 작업 1: 사전 JSON 업데이트 (v1.0 → v1.1)

파일: scripts/crawler/MADMEDSALES_dictionary_v1.0.json
(파일명도 v1.1로 변경하고, 코드에서 참조하는 경로도 함께 수정)

### 1-1. equipment에 신규 장비 추가

HIFU 카테고리에:
- { "standard": "TenTriple", "ko": ["텐트리플"], "en": ["TenTriple"], "gen": [] }
- { "standard": "TuneLiner", "ko": ["튠라이너"], "en": ["TuneLiner"], "gen": [] }

SKINBOOSTER 카테고리에:
- { "standard": "Skinvive", "ko": ["스킨바이브"], "en": ["Skinvive", "SkinVive"], "gen": [] }
- { "standard": "Youtheal", "ko": ["유스힐"], "en": ["Youtheal"], "gen": [] }
- { "standard": "Laetigen", "ko": ["래티젠", "레티젠"], "en": ["Laetigen"], "gen": [] }
- { "standard": "ASCE", "ko": ["에이에스씨이"], "en": ["ASCE"], "gen": [] }

새 카테고리 "INJECTOR" 추가:
- { "standard": "Dermashine", "ko": ["더마샤인"], "en": ["Dermashine"], "gen": [] }

### 1-2. 기존 장비 변형 보강

- Tensera: en 배열에 "Tenssera" 추가
- SopranoICE: gen 배열에 "Titanium" 추가
- Fraxel: gen 배열에 "Dual" 추가

### 1-3. 약제 카테고리 신설

equipment 안에 "INJECTABLE" 키 추가:

```json
"INJECTABLE": [
  { "standard": "Xeomin", "ko": ["제오민"], "en": ["Xeomin", "XEOMIN"], "gen": [], "subtype": "botox" },
  { "standard": "Botox", "ko": ["보톡스"], "en": ["Botox", "BOTOX"], "gen": [], "subtype": "botox" },
  { "standard": "Nabota", "ko": ["나보타"], "en": ["Nabota"], "gen": [], "subtype": "botox" },
  { "standard": "Botulax", "ko": ["보툴렉스"], "en": ["Botulax"], "gen": [], "subtype": "botox" },
  { "standard": "Dysport", "ko": ["디스포트"], "en": ["Dysport"], "gen": [], "subtype": "botox" },
  { "standard": "Coretox", "ko": ["코어톡스"], "en": ["Coretox"], "gen": [], "subtype": "botox" },
  { "standard": "Juvederm", "ko": ["쥬비덤"], "en": ["Juvederm", "JUVEDERM"], "gen": ["볼륨", "볼루마", "볼벨라", "울트라"], "subtype": "filler" },
  { "standard": "Restylane", "ko": ["레스틸렌"], "en": ["Restylane"], "gen": ["리도"], "subtype": "filler" },
  { "standard": "Belotero", "ko": ["벨로테로"], "en": ["Belotero"], "gen": ["Soft", "Balance", "Intense", "Volume"], "subtype": "filler" }
]
```

### 1-4. 시술 키워드 추가

- treatment_keywords.other에: "백옥주사"
- treatment_keywords.skinbooster에: "스킨바이브", "유스힐", "래티젠", "ASCE"
- treatment_keywords.laser에: "프락셀듀얼"

### 1-5. _meta 업데이트

version: "1.1.0", updated: "2026-02-26"

### 1-6. dictionary-loader.ts 수정

getEquipmentNormalizationMap()이 INJECTABLE, INJECTOR 카테고리도 포함하도록 수정.
INJECTABLE의 subtype 필드도 매핑에 포함시켜라.

---

## 작업 2: Gemini 응답 스키마 v2 — 가격 구조 개편

Gemini에게 보내는 응답 스키마에서 priced_treatments 항목 구조를 아래로 교체:

```json
{
  "name": "string — 시술명 원문 그대로",
  "regular_price": "number|null — 정가 (취소선 가격, 비급여표 가격)",
  "event_price": "number|null — 이벤트가, 할인가, 실제 결제가",
  "min_price": "number|null — 가격 범위일 때 최소가 (보톡스 30,000~180,000의 30,000)",
  "max_price": "number|null — 가격 범위일 때 최대가",
  "price_type": "regular|event|discount",
  "quantity": "number|null — 300샷이면 300",
  "unit": "shot|cc|unit|vial|syringe|session|area|kJ|null",
  "price_per_unit": "number|null — price ÷ quantity",
  "event_period": "string|null — '2월 한정' 등",
  "includes": ["string — 패키지 구성 항목"],
  "is_package": "boolean",
  "is_addon": "boolean — '추가시' 가격 여부",
  "source": "website|nongeubyeo|landing|academic — 가격 출처",
  "category": ["string"]
}
```

source 필드 설명:
- "website": 시술 소개/메뉴 페이지의 가격
- "nongeubyeo": 비급여항목안내 테이블의 가격 (정가)
- "landing": 이벤트/프로모션 랜딩페이지의 가격
- "academic": 학술논문에서만 언급된 가격 (참고용)

---

## 작업 3: Gemini 프롬프트 개편 — 가격 추출 강화

기존 가격 관련 프롬프트를 찾아서 아래 내용으로 교체/추가해라.

### 3-1. 비급여항목표 전수 추출 규칙 (가장 중요!)

```
## ★ 비급여항목표 추출 (절대 건너뛰지 마세요) ★

크롤링 텍스트에 "비급여", "비급여항목", "비급여안내", "비급여 진료비" 키워드와
함께 테이블(마크다운 |...|...| 형태 또는 명칭-비용 나열)이 있으면:

1. 테이블의 모든 행을 빠짐없이 추출하세요
2. 각 행 형태: { name: "시술명", regular_price: 금액, price_type: "regular", source: "nongeubyeo" }
3. 가격 범위 "30,000~180,000" → min_price: 30000, max_price: 180000
4. 동일 테이블이 여러 페이지에 중복이면 1벌만 추출
5. 비급여표는 병원의 공식 정가이므로 가장 신뢰도가 높습니다

비급여표가 50페이지 텍스트 중간에 있어도 반드시 찾아서 전수 추출하세요.
이 테이블 하나가 보통 80~100건의 가격 데이터를 포함합니다.
```

### 3-2. 정가/이벤트가 쌍 추출 규칙

```
## 이벤트 가격 추출 규칙

1. 취소선 가격 또는 큰 숫자 → 작은 숫자 패턴:
   - 큰 숫자 = regular_price (정가)
   - 작은 숫자 = event_price (이벤트가)
   - price_type = "event"
   하나의 시술에 정가와 이벤트가 모두 보이면 반드시 둘 다 기록하세요.
   이벤트가만 넣고 정가를 버리지 마세요.

2. 수량+단위 파싱:
   "울쎄라 300샷 79만원" → quantity: 300, unit: "shot"
   "리쥬란 2CC 25만원" → quantity: 2, unit: "cc"
   "티타늄 50KJ" → quantity: 50, unit: "kJ"
   price_per_unit = price ÷ quantity

3. 패키지 구성 분리:
   "텐텐리프팅 1500 = 텐트리플 300샷 + 텐써마 600샷"
   → includes: ["텐트리플 300샷", "텐써마 600샷"], is_package: true

4. "추가시" 가격:
   "★써마지FLX ONLY★ 쥬베룩물광 2.5cc 220,000원"
   → is_addon: true
```

### 3-3. 비급여표 전처리 로직 (코드 레벨)

Gemini에게 150,000자를 한꺼번에 보내면 비급여표가 텍스트에 묻혀서 무시됨.
크롤링 데이터를 Gemini에게 보내기 전에 전처리를 추가해라:

1. 크롤링된 전체 텍스트에서 "비급여" 키워드가 포함된 섹션을 찾아라
2. 해당 섹션의 테이블 데이터를 별도 변수로 추출
3. Gemini 프롬프트 조립 시, 메인 텍스트 뒤에 별도 섹션으로 삽입:

```
[메인 텍스트]
... 150,000자 크롤링 텍스트 ...

========================================
★★★ 아래는 비급여항목 가격표입니다. 모든 행을 추출하세요. ★★★
========================================
[비급여표 테이블 텍스트]
```

이렇게 하면 비급여표가 프롬프트 끝부분에 별도로 위치하여 Gemini가 놓치지 않음.
비급여표가 여러 페이지에 중복이면 1벌만 포함 (중복 제거).

---

## 작업 4: unregistered 필드 프롬프트 강화

Gemini 프롬프트에 아래 섹션 추가:

```
## 미등록 장비/시술 처리 (필수)

[장비 사전]에 없는 장비나 약제를 발견하면:

1. equipments 배열에 정상 포함 (절대 제외하지 마세요)
2. unregistered_equipment 배열에도 추가:
{
  "name": "영문명 또는 원문",
  "korean_name": "한글명",
  "suggested_category": "RF_TIGHTENING|HIFU|LASER|SKINBOOSTER|INJECTABLE|DEVICE",
  "source": "website|academic_paper",
  "reason": "판단 근거 한줄"
}

source 구분:
- "website": 시술 메뉴, 이벤트, 가격표, 장비 소개에 있는 것
- "academic_paper": 학술활동, 논문, 연구발표에서만 언급된 것 (IFU, CPMHA 등)

시술도 동일: [시술 키워드]에 없는 시술명 → unregistered_treatments에 추가.
사전에 없다고 버리지 마세요. 반드시 양쪽 모두에 넣으세요.
```

---

## 작업 5: SNS 감지 보강

연락처 추출 관련 프롬프트 또는 코드에서:

바노바기 메인에 youtube.com/channel/... 링크와 instagram @banobagi_skin이 있는데 못 잡음.
아래 패턴을 Gemini 프롬프트에 명시:

```
## SNS 채널 추출

아래 URL 패턴이 보이면 해당 필드에 기록하세요:
- instagram.com/계정명 → instagram 필드
- youtube.com/ 또는 youtu.be/ → youtube 필드  
- blog.naver.com/ → blog 필드
- "유튜브 바로보기" 같은 텍스트 + youtube 링크도 포함
```

코드 레벨에서도 크롤링 텍스트에서 이 URL 패턴을 정규식으로 별도 추출하는 로직이 있는지 확인.
없으면 추가해라.

---

## 작업 6: 장비 subcategory 검증

getEquipmentPromptSection()이 생성하는 프롬프트 텍스트에 각 장비의 카테고리를 명시:

```
RF 타이트닝 장비: 써마지, 올리지오, 인모드, 페어티타늄, 튠페이스, 텐써마, 볼뉴머, 온다, TORR RF ...
HIFU 장비: 울쎄라, 슈링크, 리프테라, 더블로, 울트라포머, 텐트리플, 튠라이너 ...
RF 마이크로니들 장비: 포텐자, 실펌, 아그네스, 스카렛, 시크릿RF ...
```

이렇게 하면 Gemini가 FairTitanium을 "laser"로 잘못 분류하는 문제 방지됨.

---

## 작업 7: 크롤링 서브페이지 패턴 확장

크롤링 설정(Firecrawl config 또는 서브페이지 탐색 스크립트)에서
서브페이지 URL 패턴 목록을 찾아라. 아마 이런 형태일 것:

```
/시술안내, /service, /treatment
/장비소개, /equipment
/이벤트, /event, /promotion
/의료진, /doctor
/가격, /price, /비용
```

여기에 추가:
```
/landing, /landing/*, /special, /campaign
```

한국 피부과들이 이벤트 가격을 별도 랜딩페이지(/landing/)로 만드는 경우가 많음.
바노바기의 landing/index2.html이 대표적 사례.

또한 메인 페이지 배너(슬라이더) 영역의 <a href> 링크 중 같은 도메인 내부 링크를
자동으로 크롤 대상에 추가하는 로직이 있는지 확인. 없으면:
- 메인 페이지 크롤링 후 배너/슬라이더 영역의 내부 링크 수집
- 해당 URL을 서브페이지 크롤 대상에 추가
이 로직 추가를 검토하고, 복잡하면 TODO 주석으로 남겨라.

---

## 검증

모든 작업 완료 후 바노바기피부과 1건 재테스트 실행.

비교 항목 (v5.5 → v5.6):

1. priced_treatments 개수: 7 → 목표 80+ (비급여표 포함)
2. price_type: "regular" 항목이 있는지 (비급여표 출처)
3. min_price, max_price가 파싱되었는지 (보톡스 30,000~180,000 등)
4. regular_price + event_price 쌍이 있는 항목이 있는지
5. quantity, unit, price_per_unit이 채워진 항목이 있는지
6. source: "nongeubyeo" 항목이 있는지
7. matched_devices 개수: 11 → 목표 18+ (INJECTABLE 포함)
8. unregistered_equipment 개수: 0 → 목표 5+ (Gemini가 직접 분류)
9. unregistered 중 source: "academic_paper" 분리 확인 (IFU, CPMHA)
10. instagram, youtube 필드 채워졌는지
11. FairTitanium subcategory가 RF인지 (laser 아님)

결과를 v5.5 대비 비교표로 보여줘라.

## 주의사항

1. 기존 동작하는 코드를 깨뜨리지 마라. 새 필드는 optional로 추가.
2. 비급여표 전처리(작업 3-3)가 가장 임팩트 큰 변경. 이것만 해도 가격 7→80+ 가능.
3. dictionary JSON 파일 수정 후 빌드 확인 필수. JSON syntax error 주의.
4. 프롬프트 토큰 관리: 비급여표를 별도 섹션으로 분리하되, 전체 토큰이 너무 커지면 안됨. 비급여표 중복 제거 필수.
5. landing 서브페이지 추가는 Firecrawl 재크롤링이 필요할 수 있음. 현재 스냅샷에 landing이 없으면, 이번 테스트에서는 비급여표 추출 개선만으로 효과 확인하고, landing 크롤은 다음 전체 크롤링 시 반영.
