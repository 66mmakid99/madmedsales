/**
 * PART B 검증 테스트: 시그널 감지 로직
 *
 * - 테스트 1: 써마지 철수 → equipment_changes REMOVED + sales_signals HIGH/bridge_care
 * - 테스트 2: 남성 시술 추가 → equipment_changes ADDED/TREATMENT + sales_signals MEDIUM/mens_target
 *
 * 실행: npx tsx scripts/test-signals.ts
 */
import type { SalesSignalRule } from '@madmedsales/shared';
import type { CrawlSnapshotData, EquipmentChange } from './crawler/change-detector.js';
import { classifySignals, type ClassifiedSignal } from './crawler/signal-classifier.js';

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail: string = ''): void {
  if (condition) {
    console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ''}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

// TORR RF sales_signals 규칙 (migration 017에서 DB에 저장된 것과 동일)
const SALES_SIGNAL_RULES: SalesSignalRule[] = [
  {
    trigger: 'equipment_removed',
    match_keywords: ['써마지', '울쎄라', '인모드', '슈링크'],
    priority: 'HIGH',
    title_template: '{{item_name}} 철수 감지',
    description_template: '고가 장비 이탈 → 브릿지 케어 공백, 토르RF 대안 제안 적기',
    related_angle: 'bridge_care',
  },
  {
    trigger: 'treatment_added',
    match_keywords: ['남성', '맨즈', '옴므', '포맨'],
    priority: 'MEDIUM',
    title_template: '남성 시술 신규 개설',
    description_template: '남성 고객 확장 중 → 무마취 토르 리프팅 제안 적기',
    related_angle: 'mens_target',
  },
  {
    trigger: 'equipment_added',
    match_keywords: ['안면거상', '지방흡입', '거상술'],
    priority: 'MEDIUM',
    title_template: '수술 라인업 확장 감지',
    description_template: '수술 후 관리 수요 증가 → 토르RF 사후관리 제안',
    related_angle: 'post_op_care',
  },
  {
    trigger: 'equipment_removed',
    match_keywords: ['토르', 'TORR'],
    priority: 'LOW',
    title_template: '토르RF 보유 확인 해제',
    description_template: '기존 토르RF 사용 병원에서 장비 미감지',
    related_angle: 'exclude',
  },
];

const HOSPITAL_ID = 'test-hospital-001';
const PRODUCT_ID = 'test-product-001';

// ════════════════════════════════════════════════════
// 테스트 1: 써마지 철수
// ════════════════════════════════════════════════════

console.log('\n══════════════════════════════════════════');
console.log('테스트 1: 써마지 철수');
console.log('══════════════════════════════════════════');

// detectEquipmentChanges의 결과를 시뮬레이션
const changes1: EquipmentChange[] = [
  {
    id: 'change-001',
    hospital_id: HOSPITAL_ID,
    change_type: 'REMOVED',
    item_type: 'EQUIPMENT',
    item_name: '써마지 FLX',
    standard_name: '써마지',
    detected_at: new Date().toISOString(),
    prev_snapshot_id: 'snap-prev',
    curr_snapshot_id: 'snap-curr',
  },
];

// classifySignals 호출 (DB INSERT는 supabase 미연결이므로 skip — 로직만 검증)
// 실제 함수는 DB INSERT가 try-catch로 non-fatal이므로 DB 없이도 signals 배열은 반환됨
const signals1 = await classifySignals(changes1, PRODUCT_ID, SALES_SIGNAL_RULES);

console.log(`  생성된 시그널: ${signals1.length}건`);
for (const s of signals1) {
  console.log(`    - ${s.signal_type} | ${s.priority} | ${s.title} | angle=${s.related_angle}`);
}

assert('시그널 1건 생성', signals1.length === 1, `count=${signals1.length}`);
if (signals1.length > 0) {
  assert('signal_type = EQUIPMENT_REMOVED', signals1[0].signal_type === 'EQUIPMENT_REMOVED');
  assert('priority = HIGH', signals1[0].priority === 'HIGH');
  assert('related_angle = bridge_care', signals1[0].related_angle === 'bridge_care');
  assert('title에 "써마지 FLX" 포함', signals1[0].title.includes('써마지 FLX'), `title="${signals1[0].title}"`);
  assert('status = NEW', signals1[0].status === 'NEW');
}

// ════════════════════════════════════════════════════
// 테스트 2: 남성 시술 추가
// ════════════════════════════════════════════════════

console.log('\n══════════════════════════════════════════');
console.log('테스트 2: 남성 시술 추가');
console.log('══════════════════════════════════════════');

const changes2: EquipmentChange[] = [
  {
    id: 'change-002',
    hospital_id: HOSPITAL_ID,
    change_type: 'ADDED',
    item_type: 'TREATMENT',
    item_name: '남성 피부관리',
    standard_name: '남성 피부관리',
    detected_at: new Date().toISOString(),
    prev_snapshot_id: 'snap-prev',
    curr_snapshot_id: 'snap-curr',
  },
];

const signals2 = await classifySignals(changes2, PRODUCT_ID, SALES_SIGNAL_RULES);

console.log(`  생성된 시그널: ${signals2.length}건`);
for (const s of signals2) {
  console.log(`    - ${s.signal_type} | ${s.priority} | ${s.title} | angle=${s.related_angle}`);
}

assert('시그널 1건 생성', signals2.length === 1, `count=${signals2.length}`);
if (signals2.length > 0) {
  assert('signal_type = TREATMENT_ADDED', signals2[0].signal_type === 'TREATMENT_ADDED');
  assert('priority = MEDIUM', signals2[0].priority === 'MEDIUM');
  assert('related_angle = mens_target', signals2[0].related_angle === 'mens_target');
}

// ════════════════════════════════════════════════════
// 테스트 3: 매칭 안 되는 변동
// ════════════════════════════════════════════════════

console.log('\n══════════════════════════════════════════');
console.log('테스트 3: 매칭 안 되는 변동 (보톡스 추가)');
console.log('══════════════════════════════════════════');

const changes3: EquipmentChange[] = [
  {
    id: 'change-003',
    hospital_id: HOSPITAL_ID,
    change_type: 'ADDED',
    item_type: 'TREATMENT',
    item_name: '보톡스 50단위',
    standard_name: '보톡스',
    detected_at: new Date().toISOString(),
    prev_snapshot_id: null,
    curr_snapshot_id: null,
  },
];

const signals3 = await classifySignals(changes3, PRODUCT_ID, SALES_SIGNAL_RULES);

console.log(`  생성된 시그널: ${signals3.length}건 (기대: 0건)`);
assert('매칭 안 되면 시그널 미생성', signals3.length === 0, `count=${signals3.length}`);

// ════════════════════════════════════════════════════
// 테스트 4: 복수 변동 → 복수 시그널
// ════════════════════════════════════════════════════

console.log('\n══════════════════════════════════════════');
console.log('테스트 4: 복수 변동 → 복수 시그널');
console.log('══════════════════════════════════════════');

const changes4: EquipmentChange[] = [
  {
    id: 'change-004a',
    hospital_id: HOSPITAL_ID,
    change_type: 'REMOVED',
    item_type: 'EQUIPMENT',
    item_name: '울쎄라',
    standard_name: '울쎄라',
    detected_at: new Date().toISOString(),
    prev_snapshot_id: null,
    curr_snapshot_id: null,
  },
  {
    id: 'change-004b',
    hospital_id: HOSPITAL_ID,
    change_type: 'ADDED',
    item_type: 'EQUIPMENT',
    item_name: '안면거상 장비',
    standard_name: '안면거상',
    detected_at: new Date().toISOString(),
    prev_snapshot_id: null,
    curr_snapshot_id: null,
  },
];

const signals4 = await classifySignals(changes4, PRODUCT_ID, SALES_SIGNAL_RULES);

console.log(`  생성된 시그널: ${signals4.length}건`);
for (const s of signals4) {
  console.log(`    - ${s.signal_type} | ${s.priority} | ${s.related_angle} | "${s.title}"`);
}

assert('시그널 2건 생성', signals4.length === 2, `count=${signals4.length}`);
const hasHighBridge = signals4.some((s) => s.priority === 'HIGH' && s.related_angle === 'bridge_care');
const hasMedPost = signals4.some((s) => s.priority === 'MEDIUM' && s.related_angle === 'post_op_care');
assert('HIGH/bridge_care 시그널 포함', hasHighBridge);
assert('MEDIUM/post_op_care 시그널 포함', hasMedPost);

// ═══════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════');
console.log(`PART B 테스트 결과: ${passed} passed, ${failed} failed (총 ${passed + failed})`);
console.log('══════════════════════════════════════════\n');

if (failed > 0) process.exit(1);
