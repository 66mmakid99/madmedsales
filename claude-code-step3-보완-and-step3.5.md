# 3단계 보완 + 3.5단계 통합 실행 지시

> 3단계 보완 + 3.5단계를 연속 진행해.
> 각 파트 완료 후 보고하되, 승인 없이 다음 파트로 넘어가도 됨.
> 단, 빌드가 깨지면 즉시 멈추고 보고.

---

## PART A: 3단계 보완 — 키워드 tier + 시그널 DB

### A-1. SalesAngle 키워드 구조 변경

현재 keywords가 단순 string[] 구조인데, 키워드별 가중치가 필요하다.
SalesKeyword 인터페이스를 새로 만들어서 SalesAngle.keywords 타입을 교체해.

SalesKeyword 인터페이스 필드:
- term: string (키워드 텍스트)
- tier: 'primary' | 'secondary' (중요도)
- point: number (배점)

SalesAngle.keywords 타입: string[] → SalesKeyword[]

하위 호환 필수: 기존에 string[]로 들어온 데이터도 처리 가능해야 함.
string이면 tier='secondary', point=10으로 fallback 처리.

matcher.ts의 evaluateSalesAngles 수정:
- 매칭된 키워드의 point 합산 → 전체 point 합 대비 비율로 0~100 환산
- 예시: bridge_care 키워드 총 point=120, 매칭된 point=80이면 → 점수 67

### A-2. TORR RF scoring_criteria JSONB 업데이트 (Migration)

5개 영업 각도의 keywords를 전부 tier/point 구조로 변경.
배점 기준: primary=20, secondary=10.

bridge_care (weight 45):
- primary(20점): 써마지, 울쎄라
- secondary(10점): 실리프팅, 민트실, 안면거상, 아이써마지

post_op_care (weight 25):
- primary(20점): 안면거상, 지방흡입
- secondary(10점): 이물질 제거, 붓기 관리, 사후관리, 거상술

mens_target (weight 15):
- primary(20점): 남성 피부관리, 맨즈 안티에이징
- secondary(10점): 남성 리프팅, 제모, 옴므, 포맨, 남성 전용

painless_focus (weight 10):
- primary(20점): 무마취, 무통증 리프팅
- secondary(10점): 직장인 점심시간, 논다운타임, 수면마취 없는, 무통

combo_body (weight 5):
- primary(20점): 슈링크, HIFU
- secondary(10점): 눈가 주름, 셀룰라이트, 바디 타이트닝, 이중턱

### A-2-b. scoring_criteria에 sales_signals 규칙 추가

같은 Migration에서 scoring_criteria JSONB에 아래 sales_signals 배열도 추가:

규칙 1:
- trigger: equipment_removed
- match_keywords: 써마지, 울쎄라, 인모드, 슈링크
- priority: HIGH
- title_template: "{{item_name}} 철수 감지"
- description_template: "고가 장비 이탈 → 브릿지 케어 공백, 토르RF 대안 제안 적기"
- related_angle: bridge_care

규칙 2:
- trigger: treatment_added
- match_keywords: 남성, 맨즈, 옴므, 포맨
- priority: MEDIUM
- title_template: "남성 시술 신규 개설"
- description_template: "남성 고객 확장 중 → 무마취 토르 리프팅 제안 적기"
- related_angle: mens_target

규칙 3:
- trigger: equipment_added
- match_keywords: 안면거상, 지방흡입, 거상술
- priority: MEDIUM
- title_template: "수술 라인업 확장 감지"
- description_template: "수술 후 관리 수요 증가 → 토르RF 사후관리 제안"
- related_angle: post_op_care

규칙 4:
- trigger: equipment_removed
- match_keywords: 토르, TORR
- priority: LOW
- title_template: "토르RF 보유 확인 해제"
- description_template: "기존 토르RF 사용 병원에서 장비 미감지 — 리스 종료 또는 데이터 오류 확인 필요"
- related_angle: exclude

### A-3. 신규 테이블 2개 생성 (Migration)

**equipment_changes 테이블:**

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | UUID PK | gen_random_uuid() |
| hospital_id | UUID FK → hospitals | |
| change_type | VARCHAR(20) | ADDED / REMOVED |
| item_type | VARCHAR(20) | EQUIPMENT / TREATMENT |
| item_name | TEXT | 원본 이름 ("써마지 FLX") |
| standard_name | VARCHAR(100) | 표준명 ("써마지") |
| detected_at | TIMESTAMPTZ | 감지 시점 |
| prev_snapshot_id | UUID FK → crawl_snapshots | 이전 스냅샷 |
| curr_snapshot_id | UUID FK → crawl_snapshots | 현재 스냅샷 |
| created_at | TIMESTAMPTZ | DEFAULT NOW() |

인덱스: hospital_id + detected_at, standard_name

**sales_signals 테이블:**

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | UUID PK | gen_random_uuid() |
| hospital_id | UUID FK → hospitals | |
| product_id | UUID FK → products | 어떤 제품 관점의 시그널인지 |
| signal_type | VARCHAR(50) | EQUIPMENT_REMOVED / EQUIPMENT_ADDED / TREATMENT_ADDED / PRICE_CHANGE |
| priority | VARCHAR(10) | HIGH / MEDIUM / LOW |
| title | TEXT | 시그널 제목 |
| description | TEXT | 상세 설명 + 영업 액션 가이드 |
| related_angle | VARCHAR(50) | bridge_care, mens_target 등 |
| source_change_id | UUID FK → equipment_changes | 원인 변동 |
| status | VARCHAR(20) DEFAULT 'NEW' | NEW / CONTACTED / DISMISSED |
| detected_at | TIMESTAMPTZ | 감지 시점 |
| acted_at | TIMESTAMPTZ | 영업팀 조치 시점 (nullable) |
| created_at | TIMESTAMPTZ | DEFAULT NOW() |

인덱스: hospital_id, status + priority, detected_at

### A-4. matcher.ts 키워드 매칭 방식 확인 + 수정

evaluateSalesAngles에서 키워드 비교 시 공백 제거 후 Contains 비교가 되어야 함.
양쪽(키워드, 병원 데이터) 모두 공백 제거(.replace(/\s/g, '')) 후 비교.

테스트: "남성 피부관리" 키워드가 "남성피부관리"(공백 없음) 데이터와 매칭되는지 확인.

### A-5. scoring_change_history 실제 DB 기록 확인

matcher.ts에서 product_match_scores upsert 시:
1. 먼저 기존 grade를 SELECT
2. 새 grade와 비교
3. 변동 시 scoring_change_history에 INSERT
4. change_reason에 구체적 사유 기록 (예: "bridge_care: 써마지(primary) 이탈로 점수 하락")

이 코드가 없으면 추가.

### A-검증 (필수 테스트)

시나리오 C 재테스트 — 써마지 1개만 제거:
- bridge_care 점수 하락 확인 (primary 20점분 → 전체 point 120 중 20 감소)
- 등급 변동 확인 (S→A 예상)
- scoring_change_history에 "bridge_care: 써마지(primary) 이탈" 기록

시나리오 D — 울쎄라 1개만 제거:
- 동일하게 bridge_care primary 이탈 → 점수 하락 + 등급 변동 확인

공백 매칭 테스트:
- "남성 피부관리" 키워드 ↔ "남성피부관리" 데이터 매칭 PASS 확인

---

## PART B: 3.5단계 — 시그널 감지 로직

### B-1. change-detector.ts 확장 — 장비/시술 diff 추출

기존 change-detector.ts에 함수 추가:

detectEquipmentChanges(prevSnapshot, currSnapshot) 함수:
- prevSnapshot.equipments_found vs currSnapshot.equipments_found 비교
- 추가된 항목 → change_type: 'ADDED'
- 사라진 항목 → change_type: 'REMOVED'
- normalizer로 standard_name 변환
- equipment_changes 테이블에 INSERT
- 반환: EquipmentChange[]

treatments_found도 동일하게 비교하여 item_type: 'TREATMENT'으로 기록.

### B-2. signal-classifier.ts 신규 생성

경로: scripts/crawler/signal-classifier.ts

classifySignals(changes, product) 함수:
- product.scoring_criteria.sales_signals 규칙을 루프
- 각 규칙의 trigger와 change.change_type 매칭
- 각 규칙의 match_keywords와 change.standard_name 매칭
- 매칭 시 sales_signals에 INSERT:
  - title: title_template의 {{item_name}}을 change.item_name으로 치환
  - description: description_template 치환
  - priority: 규칙에서 가져옴
  - related_angle: 규칙에서 가져옴
  - source_change_id: change.id
  - status: 'NEW'

### B-3. run-batch-pipeline.ts에 시그널 파이프라인 연결

기존 Stage 5(저장) 이후에 추가:

Stage 6: 변동 감지 + 시그널 분류
1. 이전 crawl_snapshots 조회 (해당 hospital의 가장 최근 스냅샷)
2. detectEquipmentChanges(이전, 현재) 호출
3. 변동이 있으면 → classifySignals(변동목록, 제품) 호출 (등록된 모든 제품에 대해)

### B-검증 (필수 테스트)

테스트 1 — 써마지 철수:
- 이전 스냅샷: equipments_found에 써마지 있음
- 현재 스냅샷: 써마지 없음
- 결과 확인:
  - equipment_changes에 {change_type: 'REMOVED', standard_name: '써마지'} INSERT
  - sales_signals에 {signal_type: 'EQUIPMENT_REMOVED', priority: 'HIGH', related_angle: 'bridge_care', status: 'NEW'} INSERT

테스트 2 — 남성 시술 추가:
- 이전: treatments_found에 남성 관련 없음
- 현재: "남성 피부관리" 추가
- 결과 확인:
  - equipment_changes에 {change_type: 'ADDED', item_type: 'TREATMENT'}
  - sales_signals에 {priority: 'MEDIUM', related_angle: 'mens_target'}

---

## 완료 보고 형식

PART A, PART B 각각:
1. 생성/수정한 파일 목록
2. Migration 파일 목록
3. 테스트 결과 (각 항목 PASS/FAIL)
4. 빌드 결과 (수정한 파일에 TS 에러 0건 확인)
