# HANDOFF: v5.6 다병원 교차 검증 현황

> 새 대화창에 이 문서를 붙여넣고 이어서 작업하세요.

## 현재 상태 요약

**v5.6 파이프라인 개발 완료, 다병원 교차 검증 3/4 완료.**
바노바기(커밋됨) + 닥터스피부과신사/고운세상피부과명동/톡스앤필강서(미커밋) 테스트 완료.
4곳 종합 비교표 + 공통 문제 분석 + 사전 v1.3 후보 식별 + 커밋이 남음.

---

## 1. 최근 커밋 이력

```
2d1052a feat(scripts): v5.6 사전확장 + 가격스키마v2 + 비급여표전처리 + 프롬프트강화    ← 최신 (pushed)
ff0a52c feat(scripts): v5.5 규칙사전 + 데이터사전 동적 주입
8184de9 feat(scripts): Playwright fallback iframe 텍스트 추출 추가
```

## 2. 미커밋 변경 파일

```
Modified:
  scripts/crawler/dictionary-loader.ts          ← 경로 v1.1→v1.2 변경

Untracked (핵심):
  scripts/crawler/MADMEDSALES_dictionary_v1.2.json  ← 사전 v1.2 (18종 추가)
  scripts/_test-v56-multi.ts                        ← 다병원 테스트 스크립트

Untracked (테스트 결과):
  output/v56-test-고운세상피부과명동.json
  output/v56-test-닥터스피부과신사.json
  output/v56-test-톡스앤필강서.json
  output/v56-multi-test-summary.json
  output/v56-debug-톡스앤필강서.txt
```

## 3. v5.6 아키텍처 (커밋 2d1052a에 반영됨)

### 3-1. 사전 시스템
- **사전 파일**: `scripts/crawler/MADMEDSALES_dictionary_v1.2.json`
  - v1.0 → v1.1: INJECTABLE 카테고리, TenTriple, TuneLiner, Skinvive 등 추가
  - v1.1 → v1.2: 바노바기 미등록 30건 중 18건 반영 (RF 4종, SKINBOOSTER 3종, INJECTABLE 8종 등)
  - normMap: 348항목, catMap: 87항목
- **로더**: `scripts/crawler/dictionary-loader.ts`
  - `getEquipmentNormalizationMap()` — 표기 → 표준명
  - `getEquipmentCategoryMap()` — 표준명 → {category, subtype}
  - `getEquipmentPromptSection()` — Gemini 프롬프트에 주입할 텍스트

### 3-2. 가격 스키마 v2 (`scripts/v5/prompts.ts`)
```
treatments[].regular_price  — 정가/비급여표 가격
treatments[].event_price    — 이벤트/할인가
treatments[].min_price / max_price — 범위 가격
treatments[].quantity / unit / price_per_unit — 수량 단위
treatments[].source — "website" | "nongeubyeo" | "landing" | "academic"
```

### 3-3. 비급여표 전처리
- **함수**: `extractNongeubyeoSection(allText)` (recrawl-v5.ts, _test-v56-multi.ts 양쪽)
- **동작**: 전체 텍스트에서 "비급여항목안내" 등 키워드 → 이후 마크다운 테이블 수집 → 프롬프트 끝에 별도 삽입
- **핵심**: truncation 전에 실행해야 함 (비급여표가 뒤쪽 페이지에 있을 수 있음)

### 3-4. 테스트 스크립트 (`scripts/_test-v56-multi.ts`)
- 사용법: `npx tsx scripts/_test-v56-multi.ts --name "병원명"`
- 기본 3곳: 닥터스피부과신사, 고운세상피부과명동, 톡스앤필강서
- 본문 200K 제한 (비급여표는 별도 보존)
- JSON 파싱 3단계: 직접 → 이스케이프수정 → 코드블록추출

---

## 4. 4곳 교차 검증 결과 비교표

| 항목 | 바노바기 | 닥터스피부과신사 | 고운세상피부과명동 | 톡스앤필강서 |
|------|---------|--------------|--------------|-----------|
| 크롤 페이지 | 49 | 50 | 8 | 50 |
| 텍스트 | 270K | 221K | 40K | 371K |
| 비급여표 | 있음 (86행) | 없음 | 없음 | 있음 (8행) |
| **장비 총** | **56** | **157** | **32** | **44** |
| **장비 매칭** | **36** (v1.2) | **38** | **5** | **15** |
| 미등록장비 | 30 | 119 | 6 | 20 |
| **시술 총** | **128** | **1** | **18** | **65** |
| **가격 수** | **93** | **0** | **0** | **65** |
| 비급여가격 | 86 | 0 | 0 | 0 |
| 정가+이벤트 | 7 | 0 | 0 | 58 |
| 수량+단위 | 46 | 0 | 0 | 24 |
| **의사 수** | **5** | **14** | **1** | **1** |
| 전화 | O | O | - | O |
| 카카오 | O | O | - | O |
| 인스타 | - | - | - | O |
| 유튜브 | O | - | - | O |
| 블로그 | - | - | - | O |
| 토큰(in/out) | 134K/20K | 134K/20K | 29K/32K | 124K/28K |
| 소요시간 | 118초 | 118초 | 208초 | 232초 |

### 주요 발견

1. **닥터스피부과신사: 장비 157개 과다, 시술 1개 과소**
   - 이미지 기반 사이트 → 마크다운에 시술/가격 정보 미포함
   - 장비가 157개로 비정상적 (중복 또는 오분류 가능성)
   - 비급여표 없음 → 가격 0건

2. **고운세상피부과명동: 전체적으로 빈약 (8페이지, 40K)**
   - 소형 사이트 → 데이터 자체가 부족
   - 장비 5개만 매칭, 가격 0건
   - SNS 채널 전혀 미감지

3. **톡스앤필강서: 가장 균형 잡힌 결과**
   - 65개 시술 전부 가격 있음, 정가+이벤트 58쌍
   - 비급여표 있으나 source="nongeubyeo"로 태깅된 것은 0건 (비급여표 8행이 적어서 시술과 미매칭 가능)
   - 371K 텍스트 → 200K 제한 적용 (JSON 파싱 실패 방지)
   - SNS 4채널 전부 감지 (카카오/인스타/유튜브/블로그)

4. **바노바기: 비급여표 추출 성공 (93건 가격)**
   - v5.5 대비: 가격 7→93, 장비매칭 23→36(v1.2)
   - 비급여표 86건 source="nongeubyeo" 정상 태깅

---

## 5. 남은 작업

### 즉시 해야 할 것
- [ ] **4곳 비교 분석 마무리** — 공통 문제 패턴 식별
- [ ] **사전 v1.3 후보 정리** — 3곳 미등록 장비(119+6+20=145건)에서 범용 장비 추출
- [ ] **커밋** — 사전 v1.2 + 테스트 스크립트 + 결과 파일

### 구조적 이슈 (판단 필요)
- [ ] **이미지 기반 사이트 대응** — 닥터스피부과 같은 이미지 중심 사이트는 OCR 없이는 시술/가격 추출 불가
- [ ] **비급여표 source 태깅** — 톡스앤필은 비급여표 있지만 source="nongeubyeo" 0건 (태깅 로직 점검 필요)
- [ ] **장비 과다추출** — 닥터스피부과 157건 (페이지별 중복 제거 또는 Gemini 프롬프트 강화 필요)
- [ ] **200K 제한의 영향** — 대형 사이트(370K+)에서 뒷부분 손실 → 2-pass 또는 분할 호출 검토

---

## 6. 핵심 파일 위치

| 용도 | 경로 |
|------|------|
| 사전 v1.2 | `scripts/crawler/MADMEDSALES_dictionary_v1.2.json` |
| 사전 로더 | `scripts/crawler/dictionary-loader.ts` |
| 분류 프롬프트 | `scripts/v5/prompts.ts` → `buildClassifyPrompt()` |
| 메인 파이프라인 | `scripts/recrawl-v5.ts` → `classifyHospitalData()` |
| 비급여표 전처리 | `scripts/recrawl-v5.ts` + `scripts/_test-v56-multi.ts` → `extractNongeubyeoSection()` |
| 서브페이지 발견 | `scripts/crawler/subpage-finder.ts` |
| 다병원 테스트 | `scripts/_test-v56-multi.ts` |
| 바노바기 테스트 | `scripts/_test-v56-banobagi.ts` |
| 스냅샷 | `snapshots/2026-02-22-v4/{병원명}/page-*/content.md` |
| 테스트 결과 | `output/v56-test-{병원명}.json` |
| v5.6 명세서 | `docs/MADMEDSALES_v5.6_명령문.md` |

## 7. 실행 명령어

```bash
# 단일 병원 테스트
npx tsx scripts/_test-v56-multi.ts --name "병원명"

# 기본 3곳 전체 테스트
npx tsx scripts/_test-v56-multi.ts

# 바노바기 전용 테스트 (v5.5 비교 포함)
npx tsx scripts/_test-v56-banobagi.ts

# 사전 빌드 확인
npx tsx -e "import{getEquipmentNormalizationMap,getEquipmentCategoryMap}from'./scripts/crawler/dictionary-loader.js';console.log('normMap:',getEquipmentNormalizationMap().size,'catMap:',getEquipmentCategoryMap().size)"
```

## 8. 기술 제약 사항

- **Gemini 2.5 Flash**: maxOutputTokens=65536, 입력 200K 초과 시 출력 잘림 현상
- **SA 인증**: `scripts/.env`의 GOOGLE_SA_KEY_PATH → JWT RSA-SHA256 서명
- **JSON 파싱**: Gemini가 `responseMimeType: 'application/json'` 설정에도 잘못된 이스케이프 생성하는 경우 있음
- **비급여표**: truncation 전에 전체 텍스트에서 추출해야 함 (이전 버그: 150K 제한으로 비급여표 손실)
- **mergeAndDeduplicate()**: `_v54` 필드를 보존하지 않음 → 호출 전후 수동 백업/복원 필수
