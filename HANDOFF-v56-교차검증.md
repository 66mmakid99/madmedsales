# HANDOFF: v5.6 작업 1-6 완료 현황

> 새 대화창에 이 문서를 붙여넣고 이어서 작업하세요.

## 현재 상태 요약

**v5.6 작업지시서 6개 작업 전부 완료. 커밋+푸시됨.**
비급여표 태깅 수정 / 장비 과다추출 방지 / OCR 도입 / 스마트 정렬 / 사전 v1.3 / 검증 완료.
다음 단계: 49개 병원 일괄 실행 또는 추가 검증.

---

## 1. 커밋 이력

```
38ff43b feat(scripts): v5.6 작업 1-5 — 비급여태깅 + 장비필터링 + OCR + 정렬 + 사전v1.3  ← 최신 (pushed)
4f19c38 feat(scripts): v5.6 사전 v1.2 + 다병원 교차 검증 3곳
2d1052a feat(scripts): v5.6 사전확장 + 가격스키마v2 + 비급여표전처리 + 프롬프트강화
ff0a52c feat(scripts): v5.5 규칙사전 + 데이터사전 동적 주입
```

## 2. 미커밋 파일 (임시/디버그)

```
output/v56-debug-*.txt          ← 디버그 파일 (잘린 JSON 원문)
output/v56-test-바노바기피부과.json  ← 바노바기 테스트 결과 (v1.2 기준)
MADMEDSALES_v56_작업지시서.md    ← 작업 명세서 원본
scripts/_crawl-*, _fix-*, _generate-*, _process-*  ← 일회성 스크립트
```

---

## 3. 완료된 작업 요약

### 작업 1: 비급여표 source 태깅 수정
- `extractNongeubyeoSection()`: 키워드~테이블 50줄 거리 제한 (가짜 테이블 방지)
- 프롬프트: 전처리된 비급여표 섹션 → `source: "nongeubyeo"` 필수 태깅 지시
- **결과**: 톡스앤필 가짜 비급여표(이용약관 테이블) 제거됨

### 작업 2: 장비 과다추출 방지
- 프롬프트: 네거티브 리스트 (주사제/화장품/약품/프로그램명 → medical_devices 제외)
- 코드: injectable subcategory 후처리 분리 + 장비명 정규화 중복 제거
- 코드: `repairTruncatedJson()` — 잘린 JSON 자동 복구 (bracket/brace 닫기)
- **결과**: 닥터스피부과 157→106건 (injectable 48건 제거)

### 작업 3: OCR 도입 (`--ocr` 플래그)
- Playwright `captureScreenshots()` 재활용 → 스냅샷 URL에서 라이브 스크린샷
- 최대 10 URL × 5장 = 50장, Gemini parts에 inlineData로 첨부
- 프롬프트: 이미지 분석 지시 + `source: "screenshot"` 태깅
- **결과**: 닥터스피부과 시술 1→49~129건, 의사 14→65명

### 작업 4: 스마트 정렬 + truncation 제거
- `getPagePriority()`: HIGH(시술/장비/의료진/가격) / MID(기본) / LOW(약관/후기/블로그)
- 본문 truncation 완전 제거 — long context 허용 (200K+ 토큰)
- `recrawl-v5.ts`: 동일 정렬 로직 적용 + 100K truncation 제거
- **결과**: 톡스앤필 시술 68→119건, 가격 68→119건

### 작업 5: 사전 v1.3
- 3곳 미등록 장비 111건 분석 → 범용 25종 선별 추가
- LASER 14종, RF 3종, BODY 3종, OTHER_DEVICE 7종, HIFU 1종
- Shurink Universe/Soprano Titanium alias 추가
- **normMap 348→452, catMap 87→115**

### 작업 6: 커밋 + 검증
- 커밋 `38ff43b` (pushed)
- 톡스앤필: 장비 매칭 7→14/17(82%), 시술 114건
- 닥터스(OCR): 장비 매칭 19→46/106(43%), 시술 49건

---

## 4. 최종 검증 결과 비교표

| 항목 | 닥터스피부과 (OCR) | 톡스앤필강서 | 비고 |
|------|-----------|---------|------|
| 크롤 페이지 | 50 | 50 | |
| 텍스트 | 221K | 371K | truncation 없음 |
| 비급여표 | 없음 | 없음 (실제 미크롤링) | 가짜 테이블 제거됨 |
| **장비 총** | **106** | **17** | injectable 분리 후 |
| **장비 매칭** | **46 (43%)** | **14 (82%)** | v1.3 사전 |
| 미등록장비 | 19 | 0 | |
| **시술 총** | **49** | **114** | OCR 효과 |
| **가격 수** | **0** | **114** | 가격 미공개 사이트 |
| 정가+이벤트 | 0 | 103 | |
| 의사 수 | 14 | 1 | |
| 토큰(in/out) | 148K/27K | 205K/31K | long context |
| 소요시간 | 177초 | 181초 | |

### v5.5 → v5.6 개선 비교 (바노바기 기준)

| 항목 | v5.5 | v5.6 | 변화 |
|------|------|------|------|
| 가격 | 7 | 93 | +1,229% |
| 비급여가격 | 0 | 86 | 신규 |
| 장비 매칭 | 23 | 36 (v1.2) | +57% |
| 수량+단위 | 0 | 46 | 신규 |

---

## 5. 아키텍처 (현재 상태)

### 5-1. 사전 시스템
- **사전 파일**: `scripts/crawler/MADMEDSALES_dictionary_v1.3.json`
  - normMap: 452항목, catMap: 115항목
  - 카테고리: RF_TIGHTENING, HIFU, RF_MICRONEEDLE, LASER, IPL, BODY, SKINBOOSTER, OTHER_DEVICE, INJECTOR, INJECTABLE
- **로더**: `scripts/crawler/dictionary-loader.ts` (경로 v1.3)

### 5-2. 가격 스키마 v2
```
treatments[].regular_price / event_price / min_price / max_price
treatments[].quantity / unit / price_per_unit
treatments[].source — "website" | "nongeubyeo" | "landing" | "screenshot" | "academic"
```

### 5-3. 비급여표 전처리
- `extractNongeubyeoSection()`: 키워드 → 50줄 이내 테이블 탐색 → 프롬프트 끝에 삽입
- 가짜 테이블 방지: non-table 줄 50줄 초과 시 중단

### 5-4. 장비 후처리
- injectable subcategory (booster/filler/botox/collagen_stimulator/lipolytic/thread) → treatments로 이동
- 장비명 정규화 중복 제거 (소문자 + 공백/특수문자 제거)
- 프롬프트 네거티브 리스트 (주사제/화장품/약품/프로그램명 제외)

### 5-5. OCR (--ocr 플래그)
- Playwright `captureScreenshots()` → base64 PNG → Gemini inlineData
- 최대 10 URL × 5장 = 50장 (≈63K 토큰)
- 이미지에서만 발견된 정보 → `source: "screenshot"`

### 5-6. 스마트 정렬
- `getPagePriority()`: HIGH(3) / MID(2) / LOW(1) 키워드 기반
- 높은 우선순위 페이지가 프롬프트 앞에 배치
- 본문 truncation 없음 — long context 전체 전송

### 5-7. JSON 복구
- `repairTruncatedJson()`: 잘린 JSON의 열린 bracket/brace/string을 자동 닫기
- 파싱 4단계: 직접 → 이스케이프수정 → 잘린JSON복구 → 코드블록추출+복구

---

## 6. 남은 이슈 / 다음 단계

### 즉시 가능
- [ ] **49개 병원 일괄 실행** — 검증 통과 기준 달성 시 실행
- [ ] **고운세상피부과명동 재검증** — v1.3 사전으로 재테스트 (이전 결과: 장비 5매칭, 시술 18)
- [ ] **바노바기 재검증** — v1.3 + 작업1-4 적용 후 결과 확인 (이전: JSON 잘림)

### 잔존 이슈
- **JSON 잘림**: 대형 입력(200K+ 토큰)에서 out 토큰이 maxOutputTokens(65536) 초과 시 잘림 → `repairTruncatedJson()`으로 복구하나 데이터 손실 있음
- **연락처 누락**: JSON 잘림 시 뒤쪽의 contact_info가 손실됨 → JSON 스키마에서 contact_info를 앞으로 이동 검토
- **닥터스피부과 시술 변동**: 같은 조건에서 129건/49건으로 결과 편차 → Gemini 응답 비결정성 + 잘림 위치 차이
- **OCR URL 선별**: 현재 스냅샷 metadata 순서대로 10개 → 우선순위 정렬 적용 필요

---

## 7. 핵심 파일 위치

| 용도 | 경로 |
|------|------|
| 사전 v1.3 (현재) | `scripts/crawler/MADMEDSALES_dictionary_v1.3.json` |
| 사전 로더 | `scripts/crawler/dictionary-loader.ts` |
| 분류 프롬프트 | `scripts/v5/prompts.ts` → `buildClassifyPrompt()` |
| 메인 파이프라인 | `scripts/recrawl-v5.ts` → `classifyHospitalData()` |
| 비급여표 전처리 | `extractNongeubyeoSection()` (recrawl-v5.ts + _test-v56-multi.ts) |
| 스크린샷 캡처 | `scripts/v5/screenshot-capture.ts` → `captureScreenshots()` |
| 다병원 테스트 | `scripts/_test-v56-multi.ts` |
| 스냅샷 | `snapshots/2026-02-22-v4/{병원명}/page-*/content.md` |
| 테스트 결과 | `output/v56-test-{병원명}.json` |
| 작업지시서 | `MADMEDSALES_v56_작업지시서.md` |

## 8. 실행 명령어

```bash
# 단일 병원 테스트 (텍스트만)
npx tsx scripts/_test-v56-multi.ts --name "병원명"

# 단일 병원 테스트 (OCR 포함)
npx tsx scripts/_test-v56-multi.ts --name "병원명" --ocr

# 기본 3곳 전체 테스트
npx tsx scripts/_test-v56-multi.ts

# 사전 빌드 확인
npx tsx -e "import{getEquipmentNormalizationMap,getEquipmentCategoryMap}from'./scripts/crawler/dictionary-loader.ts';console.log('normMap:',getEquipmentNormalizationMap().size,'catMap:',getEquipmentCategoryMap().size)"
```

## 9. 기술 제약 사항

- **Gemini 2.5 Flash**: maxOutputTokens=65536. 대형 입력(200K+ 토큰)에서 응답 잘림 가능 → repairTruncatedJson()으로 부분 복구
- **Long context 비용**: 200K 토큰 초과 시 $0.30→$0.60/1M (2배), 49개 병원 합계 ≈₩3,000 추가
- **이미지 토큰**: 1024×1024 PNG 1장 ≈ 1,290 토큰. 50장 ≈ 63K 토큰 추가
- **SA 인증**: `scripts/.env`의 GOOGLE_SA_KEY_PATH → JWT RSA-SHA256 서명
- **JSON 파싱**: Gemini가 잘못된 이스케이프 생성 + 응답 잘림 → 4단계 파싱으로 대응
- **mergeAndDeduplicate()**: `_v54` 필드를 보존하지 않음 → 호출 전후 수동 백업/복원 필수
- **Playwright**: headless chromium, 한국 병원 팝업 14+ 셀렉터 자동 닫기
