# MADMEDSALES 데이터 분류 규칙 사전
> **Version:** 1.0.0
> **Last Updated:** 2026-02-25
> **Purpose:** Gemini AI가 한국 피부과/성형외과 웹사이트 데이터를 분류할 때 참조하는 기준 문서
> **Changelog:** 하단 [변경 이력] 참조

---

## 사전 구조 설명

이 문서는 **두 파트**로 구성됩니다.

**PART 1 — 분류 규칙 (Rules)**
- Gemini가 데이터를 "어떻게" 분류해야 하는지의 판단 기준
- 쉽게 바뀌지 않는 로직 (예: "장비명이 시술 소개에 등장하면 장비와 시술 양쪽에 넣어라")

**PART 2 — 데이터 사전 (Dictionary)**
- Gemini가 "무엇을" 인식해야 하는지의 레퍼런스 목록
- 새 장비, 새 시술이 나올 때마다 여기에 추가 (예: 신규 장비 "네오젠 플라즈마" 추가)

이렇게 나누는 이유: 규칙은 고정적이지만, 데이터는 크롤링할 때마다 새로운 항목이 발견됩니다. 데이터만 추가하면 규칙이 자동으로 적용되도록 설계했습니다.

---

# PART 1: 분류 규칙 (Rules)

---

## R1. 장비 분류 규칙

### R1-1. 장비명 = 시술명 이중 분류
한국 피부과에서는 "써마지 했어요" = 써마지라는 장비로 시술했다는 뜻입니다.
PART 2 [장비 사전]에 등록된 브랜드명이 시술 소개, 메뉴, 이벤트, 가격표 어디에든 등장하면:
- **equipments 배열에 반드시 포함**
- **treatments 배열에도 동시 포함 가능**

예시:
- "써마지FLX 리프팅 안내" → equipments: ["써마지FLX"], treatments: ["써마지FLX 리프팅"]
- "울쎄라 300샷 이벤트" → equipments: ["울쎄라"], treatments: ["울쎄라 300샷"]
- "인모드 + 슈링크 패키지" → equipments: ["인모드", "슈링크"], treatments: ["인모드+슈링크 패키지"]

### R1-2. 정규화 (Normalization)
1. PART 2 [장비 사전]의 한영 매핑 테이블에서 원문을 찾아 **표준명**으로 변환
2. 모델/세대 표기(FLX, CPT, Prime, X 등)는 분리하여 별도 필드로 보존
3. 정규화 후 Set으로 중복 제거 → 고유 장비 수만 최종 반환

출력 형식:
```json
{
  "standard_name": "Thermage",
  "original_text": "써마지FLX",
  "generation": "FLX",
  "category": "RF_TIGHTENING"
}
```

### R1-3. TORR RF 특별 감지
PART 2 [TORR RF 키워드]에 해당하는 키워드가 하나라도 있으면 `torr_rf_detected: true`로 판정합니다. 이 판정은 Gemini 분류와 별개로 코드 레벨에서도 이중으로 수행됩니다.

### R1-4. 미등록 장비 처리
PART 2 [장비 사전]에 없는 장비명이 발견되면:
- `equipments`에는 원문 그대로 포함
- `unregistered_equipment` 배열에도 추가 (사전 업데이트 후보)
- 절대 버리지 않음 — 사전에 없다고 무시하면 신규 장비를 놓침

---

## R2. 시술 분류 규칙

### R2-1. 시술명 인식 기준
- 실제 시술 행위의 이름만 추출 (예: "보톡스 시술", "피코토닝")
- 아래는 시술명이 **아닌** 것들 → 제외:
  - `#`으로 시작하는 해시태그
  - 이모지(👍✨💉 등) 포함 문장
  - 감탄문, 설명문, 홍보문구 (예: "당신도 젊어질 수 있습니다!")
  - "~효과", "~개선", "~제거" 같은 결과 설명

### R2-2. 합성어 시술명 처리
한국 피부과는 장비명 + 부위/수량을 조합하여 자체 시술명을 만드는 경우가 많습니다:
- "써마지 아이" → 장비: 써마지, 부위: 눈가, 시술명: "써마지 아이"
- "울쎄라 300샷" → 장비: 울쎄라, 수량: 300샷, 시술명: "울쎄라 300샷"
- "온다 + 슈링크 링크 패키지" → 장비: [온다, 슈링크], 시술명: "온다슈링크 패키지"
- "수면 리쥬란 6cc" → 시술명: "수면 리쥬란 6cc", 특이사항: 수면(sedation) 포함

이런 합성어는 **시술명은 원문 그대로 보존**하되, 내부의 장비명/수량/부위를 **별도로 파싱**합니다.

### R2-3. 시술 필터링
- 5자 미만 텍스트 → 제외 (너무 짧아서 시술명일 가능성 낮음)
- 50자 초과 텍스트 → 제외 (설명문일 가능성)
- 동일 시술이 여러 페이지에 나오면 1건으로 처리 (중복 제거)

### R2-4. 미등록 시술 처리
PART 2 [시술 키워드]에 없는 시술명도 문맥상 시술로 판단되면 추출합니다.
- `unregistered_treatments` 배열에 추가 (사전 업데이트 후보)
- 예: 병원 자체 브랜딩 시술 "이뻐주사", "물톡스" 등은 사전에 없지만 시술임

---

## R3. 가격 분류 규칙

### R3-1. 가격 인식 패턴
- 숫자 + 단위: "550,000원", "55만원", "55만", "₩550,000"
- 이벤트 표현: "이벤트가 39만원", "2월 특가"
- 할인 표현: "정가 100만 → 할인가 55만", "30% 할인", 취소선 정가 + 실제가
- 수량+가격: "300샷 79만원", "600샷 99만원", "4cc 49만원"

### R3-2. 가격 3분류
| priceType | 인식 기준 | 예시 |
|-----------|----------|------|
| regular | 단독 가격 표기, "정가", "기본가" | "써마지 100만원" |
| event | "이벤트", "특가", "~월 한정", 기간 명시 | "2월 이벤트가 55만원" |
| discount | 정가→할인가 패턴, "%할인", 취소선 | "정가100만 → 55만" |

### R3-3. 수량 + 단위 파싱
가격에 수량이 붙어있으면 분리하여 `price_per_unit` 자동 계산:

```json
{
  "treatment": "울쎄라 300샷",
  "total_price": 790000,
  "quantity": 300,
  "unit": "샷",
  "price_per_unit": 2633,
  "price_type": "event",
  "note": "2월 이벤트, 부가세 별도"
}
```

인식할 단위: PART 2 [가격 단위 사전] 참조

### R3-4. OCR 가격 우선
텍스트 크롤링 가격과 이미지/스크린샷 OCR 가격이 동시에 존재하면:
- OCR 가격을 우선 채택 (이벤트/할인 가격은 대부분 이미지 배너에만 노출)
- 텍스트 가격 중 OCR에 없는 것만 추가로 병합

### R3-5. 미인식 가격 보존
파싱에 실패한 가격 텍스트도 `raw_price_texts` 배열에 원문 보존합니다.
나중에 패턴을 추가하면 재파싱 가능하도록.

---

## R4. 의사 분류 규칙

### R4-1. 의사 정보 추출 항목
| 필드 | 설명 | 필수 |
|------|------|------|
| name | 의사 이름 (한글 2~4자) | ✅ |
| title | 직책 (원장, 부원장, 대표원장 등) | ✅ |
| specialist | 전문의 여부 (피부과/성형외과 전문의) | ⭕ 있으면 |
| career | 경력 사항 | ⭕ 있으면 |
| education | 학력 | ⭕ 있으면 |
| societies | 소속 학회 | ⭕ 있으면 |

### R4-2. 이름 인식 패턴
- "OOO 원장님", "OOO 대표원장", "Dr. OOO", "닥터 OOO"
- 이미지 alt 텍스트에서도 의사 이름 확인
- 2자 이름은 직함이 반드시 붙어있어야 인정 (단독 2자는 일반 명사 혼동 가능)

### R4-3. 카운트 검증
- 의사 수 10명 초과 → ⚠️ 검증 필요 (미용의원 기준 비정상)
- 의사 수 0명 → ⚠️ 품질경고 (보고서에 "의사 정보 없음" 명시)
- 모달/팝업 텍스트를 의사로 오인하지 않도록 주의

---

## R5. 연락처 분류 규칙

### R5-1. 전화번호 화이트리스트
한국 전화번호만 인정: 10~11자리 + 시작번호 `02/031~064/010/070/080/1600/1588/1644/1800/1899`

### R5-2. 이미지 경로 숫자 제외
`/_data/`, `/img/`, `/images/`, `/uploads/`, `.png`, `.jpg`, `.gif`, `.webp` 경로 안의 숫자열은 전화번호 후보에서 완전 제외

### R5-3. 대표전화 우선순위
1순위: `<a href="tel:">` 링크 → 2순위: 1600/1588 대표번호 → 3순위: 일반 번호

### R5-4. SNS 채널 인식
- 카카오톡: `pf.kakao.com/`, 마크다운 이미지 링크의 alt="카카오톡"
- 인스타그램: `instagram.com/`
- 유튜브: `youtube.com/`, `youtu.be/`
- 네이버: `naver.me/`, `blog.naver.com/`, `booking.naver.com/`, `map.naver.com/`
- 해외 메신저: LINE(`line.me/`), WeChat("위챗"/"微信"), WhatsApp(`wa.me/`)

### R5-5. 최소 기준
전화번호 0건 + SNS 0건 → ⚠️ 품질경고 + 재검토 대상

---

## R6. 외부 콘텐츠 차단 규칙

### R6-1. 도메인 필터
크롤링 대상 병원의 도메인과 다른 도메인 콘텐츠는 분석 대상에서 제외

### R6-2. 리뷰/비교 사이트 블랙리스트
성예사(sungyesa), 모두닥(modoodoc), 바비톡(babitalk), 강남언니(gangnamunni), 여신티켓(yeoshin), 굿닥(goodoc) → 이 사이트에서 온 콘텐츠는 제외

### R6-3. 비콘텐츠 페이지 제외
- "자동등록방지", "Please prove that you are human", "보안절차" → 캡차 페이지
- "서비스를 종료하였습니다" → 폐쇄 페이지
- "Copyright ⓒ" + 다른 회사명 → 외부 푸터
- "사업자번호", "통신판매업" 포함 텍스트 블록 → 푸터/법적 고지

---

## R7. 품질 검증 규칙

### R7-1. 자동 품질 기준표

| 항목 | 최소 기준 | 기준 미달 시 |
|------|----------|-------------|
| 전화번호 | 1건 | ⚠️ 재검토 |
| SNS 채널 | 1건 | ⚠️ 재검토 |
| 의사 | 1명 | ⚠️ 재검토 |
| 의료기기 | 1종 | ⚠️ 재검토 |
| 시술 | 5개 | ⚠️ 재검토 |
| 의사 수 | ≤10명 | ⚠️ 과다 — 검증 필요 |
| 시술 수 | ≤100개 | ⚠️ 과다 추출 — 점검 |

기준 미달 항목 2개 이상 → "재크롤링 권장" 플래그

### R7-2. 수상/인증 내역 예외
- 대괄호 `[]` 안에 수상 내역 + "수상/선정/인증/대상" 키워드 → 긍정 시그널, 위반 아님
- 수상 주체(언론사, 기관명)가 명시되어 있으면 객관적 사실로 판단

---

## R8. 크롤링 실행 규칙

### R8-1. 서브페이지 필수 탐색
메인 페이지만으로는 정보가 부족합니다. 아래 패턴의 서브페이지를 반드시 탐색:
- 시술: /시술안내, /시술소개, /service, /treatment
- 장비: /장비소개, /equipment, /device
- 이벤트: /이벤트, /event, /promotion
- 의료진: /의료진, /doctor, /staff
- 가격: /가격, /price, /비용

같은 도메인 내 링크만 탐색. 최대 20개.

### R8-2. 텍스트 부족 시 OCR 강제
텍스트 크롤링 결과 500자 미만 → 스크린샷 OCR 강제 실행

### R8-3. 크롤링 실패 시 계속 진행
텍스트 크롤링 실패 → 빈 결과로 Pass 1 완료 → Pass 2(OCR) 무조건 실행
Pass 1 + Pass 2 모두 실패 → FAILED 기록 + 다음 병원으로 이동 (파이프라인 중단 금지)

### R8-4. DB URL 정합성
크롤링 시작 전 DB URL과 실제 크롤링 URL 일치 확인. 리다이렉트 발생 시 최종 URL로 DB 업데이트.

---

# PART 2: 데이터 사전 (Dictionary)

> 이 섹션은 새로운 장비, 시술, 가격 패턴이 발견될 때마다 업데이트합니다.
> 항목 추가 시 [변경 이력]에 기록하세요.

---

## D1. 장비 사전

### D1-1. 리프팅 / 타이트닝 장비

| 표준명 | 한글 변형 | 영문 변형 | 모델/세대 | 카테고리 코드 |
|--------|----------|----------|-----------|-------------|
| Thermage | 써마지 | Thermage, THERMAGE | FLX, CPT | RF_TIGHTENING |
| Ulthera | 울쎄라, 유쎄라 | Ulthera, ULTHERA | Prime, 울쎄라피 | HIFU |
| InMode | 인모드 | Inmode, INMODE | FX, 미니FX | RF_TIGHTENING |
| Shurink | 슈링크 | Shurink, SHURINK | 유니버스, Universe | HIFU |
| TuneFace | 튠페이스 | TuneFace, TUNEFACE | | RF_TIGHTENING |
| Tensera | 텐써마, 텐쎄라 | Tensera | | RF_TIGHTENING |
| Oligio | 올리지오 | Oligio, OLIGIO | X | RF_TIGHTENING |
| Liftera | 리프테라 | Liftera, LIFTERA | | HIFU |
| Potenza | 포텐자 | Potenza, POTENZA | | RF_MICRONEEDLE |
| Sofwave | 소프웨이브 | Sofwave, SOFWAVE | | HIFU |
| Volnewmer | 볼뉴머 | Volnewmer | | RF_TIGHTENING |
| Ulfit | 울핏 | Ulfit, ULFIT | | HIFU |
| Doublo | 더블로 | Doublo, DOUBLO | 골드, Gold | HIFU |
| Linearge | 리니어지 | Linearge | | RF_TIGHTENING |
| LinearFirm | 리니어펌 | LinearFirm | | RF_TIGHTENING |
| Titanium | 티타늄 | Titanium | 티타늄리프팅 | RF_TIGHTENING |
| Onda | 온다 | Onda, ONDA | 온다리프팅 | RF_TIGHTENING |
| CERP | 세르프 | CERP | | RF_TIGHTENING |
| 3DEEP | 쓰리딥 | 3DEEP | | RF_TIGHTENING |
| FairTitanium | 페어티타늄 | FairTitanium | | RF_TIGHTENING |
| Ultraformer | 울트라포머 | Ultraformer | MPT | HIFU |
| TORR RF | 토르, 토르RF | TORR, Torr, TORR RF | MPR, 토로이달 | RF_TIGHTENING |
| Sylfirm | 실펌 | Sylfirm, SYLFIRM | X | RF_MICRONEEDLE |
| Agnes | 아그네스 | Agnes, AGNES | | RF_MICRONEEDLE |
| Scarlet | 스카렛, 스카젠 | Scarlet | | RF_MICRONEEDLE |
| SecretRF | 시크릿RF | SecretRF, Secret RF | | RF_MICRONEEDLE |
| Vivace | 비바체 | Vivace | | RF_MICRONEEDLE |
| Profound | 프로파운드 | Profound | | RF_MICRONEEDLE |
| Exilis | 엑실리스 | Exilis | | RF_TIGHTENING |

### D1-2. 레이저 장비

| 표준명 | 한글 변형 | 영문 변형 | 모델/세대 | 카테고리 코드 |
|--------|----------|----------|-----------|-------------|
| ExcelV | 엑셀브이, 엑셀V | ExcelV, Excel V | | LASER_VASCULAR |
| PicoSure | 피코슈어 | PicoSure, PICOSURE | | LASER_PICO |
| PicoWay | 피코웨이 | PicoWay, PICOWAY | | LASER_PICO |
| PicoPlus | 피코플러스 | PicoPlus | | LASER_PICO |
| RevLite | 레블라이트 | RevLite, REVLITE | | LASER_TONING |
| Fraxel | 프락셀 | Fraxel, FRAXEL | | LASER_FRACTIONAL |
| Clarity | 클라리티 | Clarity, CLARITY | II | LASER_HAIR |
| GentleMax | 젠틀맥스 | GentleMax, GENTLEMAX | Pro | LASER_HAIR |
| StellarM22 | 스텔라M22 | StellarM22, Stellar M22 | | IPL |
| Accufit | 아큐핏 | Accufit, ACCUFIT | | LASER_BODY |
| Spectra | 스펙트라 | Spectra | | LASER_TONING |
| Genesis | 제네시스 | Genesis | | LASER_REJUV |
| IPL | 아이피엘 | IPL | | IPL |
| BBL | 비비엘 | BBL | | IPL |
| LDM | 엘디엠 | LDM | | ULTRASOUND |
| SopranoICE | 소프라노 | Soprano, SopranoICE | Titanium | LASER_HAIR |

### D1-3. 바디/체형 장비

| 표준명 | 한글 변형 | 영문 변형 | 카테고리 코드 |
|--------|----------|----------|-------------|
| CoolSculpting | 쿨스컬프팅, 쿨스컬프팅엘리트 | CoolSculpting | BODY_CRYO |
| Vanquish | 바넥스 | Vanquish | BODY_RF |
| Emsculpt | 엠스컬프트 | Emsculpt, EMSCULPT | BODY_EMS |
| LipoCell | 리포셀 | LipoCell | BODY_LIPO |

### D1-4. TORR RF 전용 키워드
아래 키워드 중 하나라도 발견되면 `torr_rf_detected: true`:
```
토르, TORR, Torr, torr, 토르리프팅, 토르RF, TORR RF, MPR, 토로이달
```

---

## D2. 시술 키워드 사전

### D2-1. HIFU 시술 (13종)
울쎄라, 슈링크, 슈링크유니버스, 리프테라, 더블로, 더블로골드, 울트라포머, 울트라포머MPT, 유쎄라, 하이푸, 울핏, HIFU

### D2-2. RF 시술 (22종)
써마지, 써마지FLX, 써마지CPT, 올리지오, 인모드, 인모드FX, 인모드미니FX, 텐써마, 엑실리스, 토르RF, 아그네스, 스카렛, 시크릿RF, 인피니, 포텐자, 비바체, 볼뉴머, 실펌, 실펌X

### D2-3. 스킨부스터/주사 (28종)
리쥬란, 리쥬란힐러, 리쥬란아이, 리쥬란HB, 리쥬란톤, 쥬베룩, 쥬베룩볼륨, 쥬베룩울트라, 물광주사, 연어주사, 아기주사, 스킨보톡스, 윤광주사, 핑크주사, 백옥주사, 신데렐라주사, 비타민주사, 엑소좀, 줄기세포주사, 프로파일로, 스컬트라, 엘란쎄, 레디에스, 리투오, PDRN, 태반주사

### D2-4. 보톡스 (17종)
보톡스, 제오민, 나보타, 보툴렉스, 디스포트, 리즈톡스, 코어톡스, 이노톡스, 메디톡신, 스킨보톡스, 미소보톡스, 턱보톡스, 광대보톡스, 승모근보톡스, 종아리보톡스, 이마보톡스, 미간보톡스

### D2-5. 필러 (28종)
쥬비덤, 쥬비덤볼륨, 쥬비덤볼루마, 쥬비덤볼벨라, 레스틸렌, 레스틸렌리도, 벨로테로, 테오시알, 이브아르, 클레비엘, 스타일레이지, 프린세스, 코필러, 팔자필러, 볼필러, 턱필러, 이마필러, 입술필러, 눈밑필러, 애교살필러

### D2-6. 레이저/토닝 (30종)
피코레이저, 피코슈어, 피코웨이, 피코플러스, 피코토닝, 레이저토닝, 클라리티, 제네시스, 프락셀, 스펙트라, 레블라이트, IPL, BBL, LDM, 아쿠아필, 제트필, 탄소레이저, 블랙돌, 레이저제모, 젠틀맥스, 소프라노, 엑셀브이, 루비레이저

### D2-7. 리프팅/실 (20종)
실리프팅, 미니실리프팅, 민트실, 녹는실, 코그실, 브이리프팅, 아큐리프트, 애플라인, 미스코실, PDO실, PCL실, PLLA실, 코그리프팅, 울핏리프팅

### D2-8. 기타 시술
여드름압출, 여드름치료, MTS, 더마펜, 모공치료, 흉터치료, 기미치료, 색소치료, 지방분해주사, 지방흡입, 카복시, LLD, 동안주사, 물방울리프팅

---

## D3. 가격 단위 사전

| 단위 | 정규화 표기 | 설명 |
|------|-----------|------|
| 샷 | shot | 울쎄라, 슈링크, 올리지오 등 에너지 장비 |
| cc | cc | 리쥬란, 필러, 스킨부스터 |
| 줄(kJ) | line | 온다 (만줄 = 만 line) |
| 유닛 | unit | 보톡스 (50유닛, 100유닛) |
| 바이알 | vial | 스컬트라, 엘란쎄 |
| 시린지 | syringe | 필러 |
| 회 | session | 일반 시술 횟수 |
| 부위 | area | "주름 4부위", "전체" |

**가격 정규식 패턴:**
```
/(\d{1,3}[,.]?\d{0,3})\s*(만\s*원|원|만|천\s*원)/g
/정가\s*(\d+(?:,\d+)*)\s*원?\s*→?\s*(\d+(?:,\d+)*)\s*원/g
/(\d+)%\s*할인/g
/특가\s*(\d+(?:,\d+)*)\s*원/g
```

---

## D4. 제외 키워드 사전

### D4-1. 비피부과 진료과목 (이 키워드만 있으면 피부시술 병원 아님)
한의원, 한방, 침, 뜸, 부항, 추나, 정형외과, 내과, 소아과, 이비인후과, 비뇨기과, 산부인과, 치과, 안과, 정신과, 신경과

### D4-2. 시술 노이즈 패턴
"전후 사진", "효과를 확인", "영상으로 보는", "지금 예약", "이벤트 진행중"

### D4-3. 외부 사이트 도메인 블랙리스트
sungyesa.com, modoodoc.com, babitalk.com, gangnamunni.com, yeoshin.co.kr, goodoc.co.kr

---

## D5. 팝업 닫기 셀렉터 사전

한국 피부과 사이트에서 자주 쓰이는 팝업 닫기 버튼:
```
[class*="popup"] [class*="close"]
[class*="modal"] [class*="close"]
[class*="layer"] [class*="close"]
a[href*="popup_close"]
button:has-text("닫기")
button:has-text("하루동안")
button:has-text("오늘 하루")
a:has-text("하루동안 보지 않기")
a:has-text("닫기")
[id*="close"]
.btn_close
.close_btn
.popup_close
```

---

# 변경 이력

| 버전 | 날짜 | 변경 내용 | 변경자 |
|------|------|----------|--------|
| 1.0.0 | 2026-02-25 | 초기 버전. 8개 규칙 그룹(R1~R8) + 5개 데이터 사전(D1~D5) 작성. 6세션 4병원 검증 기반 23개 규칙 + 15개 추가 규칙 = 38개 통합. | MMAKID |

---

# 부록: Gemini 프롬프트 주입 가이드

## 사전을 Gemini에게 보내는 방법

이 문서 전체를 프롬프트에 넣으면 토큰 낭비입니다. 상황에 따라 필요한 섹션만 주입하세요:

### 장비/시술 분류 프롬프트에 넣을 것:
- R1 (장비 분류 규칙) 전체
- R2 (시술 분류 규칙) 전체
- D1 (장비 사전) 전체
- D2 (시술 키워드) 전체

### 가격 추출 프롬프트에 넣을 것:
- R3 (가격 분류 규칙) 전체
- D3 (가격 단위 사전) 전체

### 의사/연락처 추출 프롬프트에 넣을 것:
- R4 (의사 분류 규칙) 전체
- R5 (연락처 분류 규칙) 전체

### 품질 검증 프롬프트에 넣을 것:
- R6 (외부 콘텐츠 차단) 전체
- R7 (품질 검증) 전체

## 사전 업데이트 절차

새로운 장비/시술이 발견되면:
1. 크롤링 결과의 `unregistered_equipment` 또는 `unregistered_treatments` 확인
2. 실제 의료기기/시술인지 확인 (단순 오탐인지 구분)
3. PART 2 해당 섹션에 추가
4. 버전 올리기: 1.0.0 → 1.1.0 (데이터 추가) 또는 2.0.0 (규칙 변경)
5. [변경 이력]에 기록

**버전 규칙:**
- X.0.0 → 규칙(PART 1) 변경 시 (분류 로직 변경)
- 0.X.0 → 데이터(PART 2) 추가 시 (새 장비, 새 시술)
- 0.0.X → 오탈자/서식 수정
