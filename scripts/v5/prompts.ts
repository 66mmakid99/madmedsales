/**
 * v5.5 Gemini 프롬프트
 * 시스템 지침서 섹션 3-3, 4-1 구현
 *
 * v5 핵심 변경:
 * - 시술명→장비 분리 추출 (예시 10개)
 * - 내비게이션 메뉴 시술 추출
 * - 장비명 정규화 24종
 * - 다지점 처리
 * - 학술활동/KOL 추출
 *
 * v5.4 핵심 변경:
 * - 2-Step 분리 파이프라인: OCR 전용(Step 1) + 분류 전용(Step 2)
 * - 7-category: doctors, academic_activities, equipment, treatments, events, clinic_categories, contact_info
 * - 시술명 공백 정규화 + ~클리닉 카테고리 분리
 * - 패키지 시술 단가 분석
 *
 * v5.5 핵심 변경:
 * - 규칙사전(R1~R8) + 데이터사전(JSON) 동적 주입
 * - 하드코딩 장비 정규화 테이블 → dictionary-loader 동적 로드
 * - unregistered_equipment, unregistered_treatments, raw_price_texts 필드 추가
 *
 * v5.6 핵심 변경:
 * - 가격 스키마 v2: regular_price/event_price/min/max/quantity/unit/source
 * - 비급여항목표 전수 추출 규칙 + 전처리 분리 섹션
 * - unregistered 필드 강화: source: website|academic_paper
 * - SNS 감지 보강: instagram/youtube/blog URL 패턴
 * - 장비 subcategory 검증: 카테고리별 장비 목록 명시
 */
import {
  getEquipmentPromptSection,
  getTreatmentPromptSection,
  getPricePromptSection,
  getExcludePromptSection,
  getEquipmentNormalizationTable,
} from '../crawler/dictionary-loader.js';

// ============================================================
// 추출 프롬프트 (v5)
// ============================================================
export function buildExtractionPrompt(
  name: string,
  pageType: string,
  contentType: string,  // '텍스트' | '이미지'
  chunkInfo?: string,
  branchInfo?: string,
): string {
  const chunkNote = chunkInfo ? `\n(이 텍스트는 전체의 ${chunkInfo}입니다)` : '';
  const branchNote = branchInfo || '';

  return `당신은 한국 피부과/성형외과 웹사이트 데이터 추출 전문가입니다.
이 ${contentType}은 "${name}" 웹사이트의 ${pageType} 페이지입니다.${chunkNote}
${branchNote}

아래 정보를 빠짐없이 JSON으로 추출하세요.

## 추출 규칙

### 장비 (equipments)
1. 장비 소개 페이지에 있는 장비를 추출
2. ★★★ 시술명 안에 포함된 장비명도 반드시 분리 추출 ★★★
   예시: "울쎄라 리프팅 100샷" → equipments에 "Ulthera" 추가
   예시: "인모드 FX 얼굴전체" → equipments에 "InMode" 추가
   예시: "슈링크 유니버스 100샷" → equipments에 "Shrink Universe" 추가
   예시: "텐쎄라 300라인" → equipments에 "Tensera" 추가
   예시: "레블라이트SI 토닝" → equipments에 "RevLite SI" 추가
   예시: "엑셀V" → equipments에 "Excel V" 추가
   예시: "온다 4만줄" → equipments에 "Onda" 추가
   예시: "제네시스" → equipments에 "Genesis" 추가
   예시: "덴서티 300샷" → equipments에 "Density" 추가
   예시: "원쎄라 2000샷" → equipments에 "Wonsera" 추가
3. 내비게이션 메뉴의 시술 링크에서도 장비명 추출
   예시: 메뉴에 "써마지FLX 이용시술" → equipments에 "Thermage FLX" 추가
   예시: 메뉴에 "울쎄라 이용시술" → equipments에 "Ulthera" 추가
   예시: 메뉴에 "슈링크리프팅 이용시술" → equipments에 "Shrink Universe" 추가

### 시술 (treatments)
1. 시술 소개, 가격표, 이벤트 페이지의 시술을 추출
2. ★★★ 내비게이션 메뉴/사이드바의 시술 링크도 시술 목록으로 추출 ★★★
   메뉴에 "울쎄라 이용시술", "써마지FLX 이용시술" → 각각 시술로 추출
   메뉴에 "색소 > 레드터치 pro 이용시술" → "레드터치 pro 이용시술"로 추출
3. 같은 시술의 다른 회차/샷수는 개별 항목으로 (가격이 다를 수 있으므로)
4. 패키지/콤보 시술도 추출 (combo_with에 구성 기재)

### 의사 (doctors)
1. 의료진 소개 페이지의 의사 정보 추출
2. 다지점 병원인 경우: 해당 지점 소속만 추출
   지점 구분 불가능하면 전체 추출하되 notes에 "전 지점 통합 목록" 표시
3. 학력, 경력, 학술활동은 텍스트에 있는 그대로 추출
4. ★★★ 학술대회 참가, 강연, 저서 편찬, KOL 활동도 academic_activity에 추출 ★★★
5. 이미지 캡션이나 alt 텍스트에 있는 의사 정보도 추출

### 이벤트 (events)
1. 이벤트/할인/프로모션 페이지의 정보 추출
2. 팝업 배너, 슬라이드 배너의 이벤트도 추출
3. 기간 정보가 있으면 description에 포함

## 장비명 정규화 (데이터 사전에서 동적 로드)

${getEquipmentNormalizationTable()}

★ "토르", "TORR", "컴포트듀얼" 관련 언급은 반드시 포함.
★ 사전에 없는 장비명도 반드시 추출 (절대 버리지 마라).
★ 가격 정보가 있으면 반드시 추출. "~부터", "VAT별도" 등 조건도 price_note에.
★ 학술활동, 학회 참가, 강연, 저서 정보가 있으면 반드시 추출.

## JSON 출력 형식

{
  "equipments": [{ "name": "정규화 장비명", "category": "laser|rf|hifu|body|lifting|booster|skin|other", "manufacturer": "제조사 or null" }],
  "treatments": [{ "name": "시술명 원문", "category": "lifting|laser|body|booster|filler_botox|skin|hair|other", "price": 숫자 or null, "price_note": "조건 or null", "is_promoted": true/false, "combo_with": "콤보 or null" }],
  "doctors": [{ "name": "이름", "title": "직함", "specialty": "전문 or null", "education": "학력 or null", "career": "경력 or null", "academic_activity": "학술/KOL or null", "notes": "참고 or null" }],
  "events": [{ "title": "제목", "description": "내용", "discount_type": "percent|fixed|package|free_add|other", "discount_value": "값", "related_treatments": ["시술명"] }]
}

없는 항목은 빈 배열 []. JSON만 응답 (마크다운 코드블록 없이).`;
}

// ============================================================
// [v5.4] Step 1: OCR 전용 프롬프트
// ============================================================
export const OCR_PROMPT = `You are an OCR expert for Korean medical/dermatology website images.

## Mission
Read all text visible in this image accurately and completely, then output it.

## Rules
1. Read text from top→bottom, left→right order.
2. Keep all Korean, English, numbers, and special characters as-is.
3. Follow original layout for line breaks.
4. Read price notations (₩, 원, 만원, etc.) accurately.
5. Read doctor names with perfect accuracy—don't miss a single character.
   - Korean names typically 2-4 characters (surname1 + given1-3)
   - Low resolution images: mark as "uncertain: [estimated name]"
6. Transfer English equipment brands/model names as-is in spelling.
7. Never interpret. Never classify. Output only what you see.
8. If image has no text, output only "텍스트_없음".

## Output Format
Output text from image as-is. No other explanation—text only.`;

// ============================================================
// [v5.4] Step 2: 분류/구조화 프롬프트
// ============================================================
export function buildClassifyPrompt(hospitalName: string, navMenuText?: string): string {
  const navSection = navMenuText ? `

=== 네비게이션 메뉴에서 추출된 시술/장비 목록 ===
${navMenuText}

⚠️ 위 네비게이션 메뉴의 항목도 반드시 medical_devices와 treatments에 포함할 것.
"울쎄라 리프팅" → 장비: Ulthera (HIFU) + 시술: 울쎄라 리프팅
"써마지FLX" → 장비: Thermage FLX (RF) + 시술: 써마지FLX
"토르 리프팅" → 장비: TORR RF (RF) + 시술: 토르 리프팅
"스컬트라" → 주사제: 스컬트라 (collagen_stimulator)
메뉴 항목 안에 장비/주사제 이름이 있으면 반드시 medical_devices에 추가하라.
` : '';

  return `당신은 한국 피부과/의료 데이터 분류 전문가입니다.
아래 텍스트는 "${hospitalName}" 웹사이트에서 수집한 전체 텍스트입니다.
${navSection}
## 미션
아래 7개 카테고리에서 정보를 빠짐없이 추출하여 JSON으로 출력하세요.

## 7개 추출 카테고리

### 1. doctors (의사 정보)
- name: 이름 (정확하게)
- title: 직함 (원장, 부원장, 진료원장 등)
- specialty: 전문분야
- career: 경력 (배열)
- education: 학력 (배열)
- certifications: 자격/면허 (배열)
- confidence: "confirmed" | "uncertain" (이름 불확실하면 uncertain)

### 2. academic_activities (학술활동) ⚠️ 의사와 독립 추출
- type: "논문" | "학회발표" | "교과서집필" | "임상연구" | "수상" | "기타"
- title: 활동 제목/내용
- year: 연도 (있으면)
- doctor_name: 관련 의사 이름 (없으면 null)
- source_text: 원문 텍스트 (추출 근거)

> 중요: 의사 0명이어도 학술활동은 추출.
> 마크다운과 이미지 텍스트 모두에서 철저히 추출.

### 3. medical_devices (의료기기 — 장비 + 주사제 모두 포함)

모든 의료기기를 빠짐없이 추출하되, 장비와 주사제를 구분하라.

각 의료기기 항목:
- name: 제품/브랜드명 (정확히)
- korean_name: 한국어 통칭 (있으면)
- manufacturer: 제조사 (알 수 있으면)
- device_type: "device" (장비) 또는 "injectable" (주사제)
- subcategory: 아래 분류표 참조
- description: 용도/특징 설명
- source: "text" | "image_banner" | "image_page" | "ocr"

#### device_type = "device" (장비) 일 때 subcategory:
- "RF": 고주파 (써마지, 인모드, 테너, TORR RF 등)
- "HIFU": 초음파 (울쎄라, 슈링크, 더블로 등)
- "laser": 레이저 (피코슈어, 레블라이트, 젠틀맥스 등)
- "IPL": 광선치료 (M22, BBL 등)
- "microneedle": 마이크로니들 (포텐자, 시크릿RF 등)
- "cryotherapy": 냉각/냉동 (쿨스컬프팅 등)
- "EMS_magnetic": 전자기/자기장 (엠스컬프트 등)
- "other_device": 위에 해당 안 되는 장비

#### device_type = "injectable" (주사제) 일 때 subcategory:
- "filler": 필러 (쥬비덤, 레스틸렌 등)
- "botox": 보톡스/보툴리눔 (보톡스, 제오민, 나보타 등)
- "booster": 스킨부스터 (리쥬란, 쥬베룩, 엑소좀 등)
- "lipolytic": 지방분해 (아디페, 윤곽조각주사 등)
- "collagen_stimulator": 콜라겐자극제 (스컬트라, 올리디아365, 엘란쎄 등)
- "thread": 실리프팅 (PDO실, 코그실 등)
- "other_injectable": 위에 해당 안 되는 주사

> 중요: "장비"와 "주사제"를 혼동하지 마라.
> - 장비 = 기계. 전원을 켜서 사용. 피부에 에너지를 전달.
> - 주사제 = 약물/제품. 주사기로 주입. 체내에서 작용.
> - 스컬트라, 리쥬란, 아디페 → 주사제 (injectable)
> - 써마지, 울쎄라, 인모드 → 장비 (device)
> 텍스트에 장비 없으면 배너/슬라이드 이미지에서 찾기.

⚠️ 시술명 안에 포함된 장비명도 반드시 medical_devices에 추출:
- "울쎄라 이용시술", "울쎄라 리프팅 100샷" → Ulthera (HIFU)
- "써마지FLX 이용시술", "써마지FLX 펜타시스템" → Thermage FLX (RF)
- "토르 리프팅", "토르엔드+바디" → TORR RF / TORR END (RF)
- "인모드 FX 얼굴전체" → InMode (RF)
- "슈링크 유니버스 300라인" → Shrink Universe (HIFU)
- "젤틱 이용시술" → CoolSculpting/Zeltiq (cryotherapy)
- "엠스컬프트 NEO" → Emsculpt NEO (EMS_magnetic)
- "리포소닉" → Liposonic (HIFU)
- "스컬트라/엘란쎄" → Sculptra (collagen_stimulator), Ellanse (collagen_stimulator)

⚠️ 네비게이션 메뉴 텍스트는 "UI 요소"가 아니라 "콘텐츠"다. 메뉴에 나열된 모든 장비/시술을 빠짐없이 추출하라.

### 4. treatments (시술 정보) — 가격 스키마 v2
각 시술 항목별:
- name: 시술명 (정규화: 공백 통일, 원문 그대로)
- regular_price: 정가 (숫자, 원 단위). 비급여표 가격 또는 취소선 가격.
- event_price: 이벤트가/할인가 (숫자, 원 단위). 실제 결제가.
- min_price: 가격 범위일 때 최소가 (예: 보톡스 30,000~180,000의 30,000)
- max_price: 가격 범위일 때 최대가
- price_type: "regular" | "event" | "discount"
- quantity: 수량 (300샷이면 300, 없으면 null)
- unit: "shot" | "cc" | "unit" | "vial" | "syringe" | "session" | "area" | "kJ" | null
- price_per_unit: price ÷ quantity (계산 가능하면)
- event_period: 이벤트 기간 ("2월 한정" 등, 없으면 null)
- includes: 패키지 구성 항목 (배열)
- is_package: boolean (패키지/세트?)
- is_addon: boolean ("추가시" 가격 여부)
- source: "website" | "nongeubyeo" | "landing" | "academic"
- category: 아래 분류 기준 참고
- price_display: 원문 표기 ("15만원", "150,000원" 등)
- session_info: 회차 정보 ("1회", "10회 기준" 등, 있으면)
- body_part: 시술 부위 (있으면)

source 필드 설명:
- "website": 시술 소개/메뉴 페이지의 가격
- "nongeubyeo": 비급여항목안내 테이블의 가격 (병원 공식 정가)
- "landing": 이벤트/프로모션 랜딩페이지의 가격
- "academic": 학술논문에서만 언급된 가격 (참고용)

> 시술 분류 기준:
>   - "~클리닉"은 **카테고리**이지 시술이 아님 (예: "탈모클리닉" → 카테고리)
>   - "탈모클리닉"과 "탈모 클리닉"은 동일 → 공백 정규화, 중복 제거
>   - 복합 시술 (예: "울쎄라+써마지") → is_package: true로 처리

> 가격 추출 주의:
>   - "~부터", "~이상" → min_price에 숫자
>   - "상담 후 결정", "전화문의" → 가격 필드 모두 null, price_display: "상담필요"
>   - VAT 포함/별도 표기 → price_display에 기록
>   - 정가와 이벤트가가 모두 보이면 반드시 둘 다 기록 (이벤트가만 넣고 정가를 버리지 마세요)

### 5. events (이벤트/할인/프로모션)
- title: 이벤트명
- type: "할인" | "패키지" | "신규고객" | "시즌" | "기타"
- period: 기간 (시작~종료, 있으면)
- discount_info: 할인 상세 (%, 금액, 조건 등)
- original_price: 원래 가격 (있으면)
- event_price: 이벤트 가격 (있으면)
- conditions: 조건 (배열, "첫방문", "SNS후기 작성 시" 등)
- source: "text" | "popup" | "banner" | "page"

> 중요: 팝업에서 발견된 이벤트도 포함.
> SUFFICIENT라도 팝업 이미지 있으면 이벤트 추출.

### 6. clinic_categories (클리닉 분류)
- name: 클리닉명 ("탈모클리닉", "리프팅클리닉" 등)
- treatments: 이 클리닉 소속 시술 (배열)

> "~클리닉"은 여기에 넣고, treatments(시술)에는 넣지 말 것.

### 7. contact_info (연락처/컨택 포인트) ⚠️ 영업 필수
병원에 연락할 수 있는 모든 채널을 빠짐없이 수집한다.
- email: 이메일 주소 (배열)
  - address: 이메일 주소
  - type: "대표" | "상담" | "채용" | "기타"
  - source: 발견 위치 (footer, 문의페이지 등)
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

> 중요: 이메일은 영업 핵심 컨택 포인트. footer, 문의/상담 페이지에서 반드시 찾을 것.
> 전화번호는 대표/상담/예약 구분하여 전부 수집.
> SNS/카카오/네이버 링크는 header, footer, 사이드바에 주로 있음.

⚠️ 연락처 추출 필수 규칙:
1. 마크다운에서 [![alt](img)](URL) 패턴의 URL도 반드시 추출할 것 (SNS 아이콘 링크)
2. a태그 href에서 pf.kakao.com, blog.naver.com, instagram.com, facebook.com, youtube.com URL을 빠짐없이 추출
3. 카카오톡은 반드시 pf.kakao.com URL을 우선 사용 (채팅 ID가 아닌 채널 URL)
4. 페이스북, 트위터/X URL도 있으면 수집 (facebook 필드 없으면 contact_info에 추가)
5. "없음"으로 판단하기 전에 마크다운 전체에서 URL 패턴을 한 번 더 검색할 것

## 장비/시술/가격 분류 규칙 (데이터 사전 기반)

${getEquipmentPromptSection()}

${getTreatmentPromptSection()}

${getPricePromptSection()}

${getExcludePromptSection()}

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

## 미등록 장비/시술 처리 (필수)

[장비 사전]에 없는 장비나 약제를 발견하면:

1. medical_devices 배열에 정상 포함 (절대 제외하지 마세요)
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

## SNS 채널 추출

아래 URL 패턴이 보이면 해당 필드에 기록하세요:
- instagram.com/계정명 → instagram 필드
- youtube.com/ 또는 youtu.be/ → youtube 필드
- blog.naver.com/ → blog 필드
- "유튜브 바로보기" 같은 텍스트 + youtube 링크도 포함
- [![alt](img)](URL) 패턴의 URL도 반드시 확인

## 출력 규칙
1. 유효한 JSON만 출력. 설명 텍스트 없음.
2. 텍스트 근거 없는 정보 추가 금지.
3. 불확실한 항목은 confidence: "uncertain" 표시.
4. 중복 정보 병합.
5. 가격 변환: "만원" → ×10000, "천원" → ×1000 하여 원 단위.

## JSON 스키마
{
  "hospital_name": string,
  "doctors": [...],
  "academic_activities": [...],
  "medical_devices": [{"name": "...", "korean_name": "...", "manufacturer": "...", "device_type": "device|injectable", "subcategory": "...", "description": "...", "source": "text|image_banner|image_page|ocr"}],
  "treatments": [...],
  "events": [...],
  "clinic_categories": [...],
  "contact_info": {
    "email": [...],
    "phone": [...],
    "address": {...} | null,
    "kakao_channel": string | null,
    "naver_booking": string | null,
    "naver_place": string | null,
    "instagram": string | null,
    "facebook": string | null,
    "youtube": string | null,
    "blog": string | null,
    "website_url": string,
    "operating_hours": {...} | null
  },
  "unregistered_equipment": [{"name": "영문명 또는 원문", "korean_name": "한글명", "suggested_category": "RF_TIGHTENING|HIFU|LASER|SKINBOOSTER|INJECTABLE|DEVICE", "source": "website|academic_paper", "reason": "판단 근거 한줄"}],
  "unregistered_treatments": [{"name": "사전에 없는 시술명 원문", "source": "website|academic_paper", "context": "발견 문맥 (짧게)"}],
  "raw_price_texts": ["파싱 실패한 가격 원문 텍스트"],
  "extraction_summary": {
    "total_doctors": number,
    "total_academic": number,
    "total_equipment": number,
    "total_devices": number,
    "total_injectables": number,
    "total_treatments": number,
    "total_events": number,
    "total_categories": number,
    "total_contact_channels": number,
    "has_email": boolean,
    "has_phone": boolean,
    "has_kakao": boolean,
    "has_sns": boolean,
    "price_available_ratio": "가격 있는 시술 / 전체 시술 (예: 15/23)",
    "unregistered_equipment_count": number,
    "unregistered_treatments_count": number
  }
}`;
}

// ============================================================
// 이미지 배너/팝업 전용 Vision 프롬프트 (v5.3)
// ============================================================
export function buildImageBannerPrompt(
  hospitalName: string,
  imageType: string,  // '메인 배너 슬라이드' | '팝업 배너' | '이벤트 배너' | '시술 소개 이미지'
): string {
  return `당신은 한국 피부과 웹사이트 이미지 분석 전문가입니다.

이 이미지는 "${hospitalName}" 홈페이지의 ${imageType}입니다.

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

## 장비명 정규화 (데이터 사전)
${getEquipmentNormalizationTable()}

★ 사전에 없는 장비도 원문 그대로 추출. 절대 버리지 마라.

JSON으로 응답:
{
  "equipments": [{ "name": "정규화 장비명", "category": "laser|rf|hifu|body|lifting|booster|skin|other", "manufacturer": null }],
  "treatments": [{ "name": "시술명 원문", "category": "lifting|laser|body|booster|filler_botox|skin|hair|other", "price": null, "price_note": null, "is_promoted": false, "combo_with": null }],
  "doctors": [{ "name": "이름 or null", "title": "원장", "specialty": null, "education": null, "career": null, "academic_activity": "활동 내용 or null", "notes": null }],
  "events": [{ "title": "이벤트명", "description": "내용", "discount_type": "percent|fixed|package|free_add|other", "discount_value": null, "related_treatments": [] }]
}

없는 항목은 빈 배열 []. JSON만 응답 (마크다운 코드블록 없이).`;
}

// ============================================================
// 검증 프롬프트 (v5)
// ============================================================
export function buildValidationPrompt(
  _allMarkdown: string,
  extractedEquipments: string[],
  extractedTreatments: string[],
  extractedDoctors: string[],
): string {
  return `당신은 한국 피부과/성형외과 데이터 품질 검증 전문가입니다.

[원본 마크다운]
{MARKDOWN}

[추출 결과]
장비: ${extractedEquipments.join(', ') || '(없음)'}
시술: ${extractedTreatments.join(', ') || '(없음)'}
의사: ${extractedDoctors.join(', ') || '(없음)'}

[검증 지시]
원본 마크다운에 있지만 추출 결과에 빠진 **의료 장비, 시술, 의사**를 찾으세요.

★★★ 중요: 아래는 장비/시술이 아닙니다. missing에 넣지 마세요 ★★★
- 페이지 이름: "원장님인사말", "병원소개", "내부둘러보기", "오시는길", "의료진안내"
- 카테고리명/섹션명: "색소", "리프팅", "피지·모공", "흉터", "모발", "바디" (이것은 시술 분류명이지 개별 시술이 아님)
- 내비게이션 메뉴 링크 자체 (메뉴 링크는 카테고리일 뿐, 구체적 시술이 아님)

★★★ 장비란: 구체적 의료기기 이름 (Thermage FLX, Ulthera, Shrink Universe, TORR RF 등)
★★★ 시술이란: 구체적 시술 메뉴 (써마지리프팅 100샷, 울쎄라 전체, 보톡스 50유닛 등)
★★★ 의사란: 실명이 있는 의사 (홍길동 원장, 김철수 대표원장 등)

검증 항목:
1. 시술 소개 텍스트에 구체적으로 설명된 장비 중 추출 안 된 것
2. 가격표에 나열된 구체적 시술 메뉴 중 추출 안 된 것
3. 의료진 페이지에서 실명이 나온 의사 중 추출 안 된 것
4. 가격 정보가 있는데 price가 null인 시술

coverage_score는 원본 대비 추출 비율을 0~100으로 평가하세요.
- equipment: 원본에 구체적으로 설명/사용된 의료기기 수 대비 추출 비율
- treatment: 원본에 구체적으로 나열된 시술 메뉴 수 대비 추출 비율
- doctor: 원본에 실명이 나온 의사 수 대비 추출 비율
- overall: 세 항목의 가중 평균 (장비 30%, 시술 40%, 의사 30%)
- ★★★ 0/0 규칙: 원본에 해당 정보가 아예 없으면 (구체적 장비/시술/의사 언급 0개) -1로 평가 (판정 불가, 100%가 아님) ★★★
- 단, 추출 결과가 있는데 원본에 없는 경우 (추출>0, 원본=0): 다른 페이지에서 추출한 것이므로 해당 항목은 100%로 평가

JSON으로 응답:
{
  "missing_equipments": ["누락된 구체적 의료기기명"],
  "missing_treatments": ["누락된 구체적 시술 메뉴명 (상위 20개)"],
  "missing_doctors": ["누락된 의사 실명"],
  "missing_prices": ["가격 누락 시술명"],
  "coverage_score": {
    "equipment": 0~100,
    "treatment": 0~100,
    "doctor": 0~100,
    "overall": 0~100
  },
  "issues": ["기타 발견된 문제"]
}

JSON만 응답 (마크다운 코드블록 없이).`;
}
