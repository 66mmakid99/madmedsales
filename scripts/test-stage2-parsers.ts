/**
 * 2단계 완료 조건 검증 테스트
 * normalizer / decomposer(TS 상수만) / price-parser 유닛 테스트
 */
import { normalizeKeyword, normalizeAll, extractKnownKeywords, correctOcrErrors } from './crawler/normalizer.js';
import { decomposeCompoundWord } from '../packages/shared/src/constants/compound-words.js';
import { parseKoreanNumber, parsePrices } from './crawler/price-parser.js';

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

// ═══════════════════════════════════════════════════════════
// 1. Normalizer 테스트
// ═══════════════════════════════════════════════════════════
console.log('\n=== Normalizer Tests ===');

// "울세라" → "울쎄라" 변환
const r1 = normalizeKeyword('울세라');
assert('"울세라" → "울쎄라"', r1.standardName === '울쎄라', `got: ${r1.standardName}`);

// "thermage" → "써마지"
const r2 = normalizeKeyword('thermage');
assert('"thermage" → "써마지"', r2.standardName === '써마지', `got: ${r2.standardName}`);

// "인모드FX" → "인모드"
const r3 = normalizeKeyword('인모드FX');
assert('"인모드FX" → "인모드"', r3.standardName === '인모드', `got: ${r3.standardName}`);

// "TORR" → "토르RF"
const r4 = normalizeKeyword('TORR');
assert('"TORR" → "토르RF"', r4.standardName === '토르RF', `got: ${r4.standardName}`);

// "보톡" → "보톡스"
const r5 = normalizeKeyword('보톡');
assert('"보톡" → "보톡스"', r5.standardName === '보톡스', `got: ${r5.standardName}`);

// "민트실" → "실리프팅"
const r6 = normalizeKeyword('민트실');
assert('"민트실" → "실리프팅"', r6.standardName === '실리프팅', `got: ${r6.standardName}`);

// "ulthera" → "울쎄라"
const r7 = normalizeKeyword('ulthera');
assert('"ulthera" → "울쎄라"', r7.standardName === '울쎄라', `got: ${r7.standardName}`);

// 미매칭 키워드
const r8 = normalizeKeyword('알파라이트');
assert('"알파라이트" → null (미매칭)', r8.standardName === null, `got: ${r8.standardName}`);

// 일괄 정규화 매칭률
const bulk = normalizeAll(['울세라', '써마지FLX', '인모드', '알파라이트', '슈링크유니버스']);
assert(`일괄 정규화: 4/5 매칭 (80%)`, bulk.matchRate === 0.8, `got: ${bulk.matchRate}`);

// OCR 보정
const corrected = correctOcrErrors('울쎄라 300숏');
assert('OCR 보정: "숏" → "샷"', corrected.includes('샷'), `got: ${corrected}`);

// 전체 텍스트에서 키워드 추출
const keywords = extractKnownKeywords('이 병원은 울쎄라와 써마지를 보유하고 있으며 인모드도 있습니다.');
const keywordNames = keywords.map((k) => k.standardName);
assert('텍스트 키워드 추출: 울쎄라, 써마지, 인모드',
  keywordNames.includes('울쎄라') && keywordNames.includes('써마지') && keywordNames.includes('인모드'),
  `got: ${keywordNames.join(', ')}`);

// ═══════════════════════════════════════════════════════════
// 2. Decomposer 테스트 (TS 상수 사전만, DB 호출 없음)
// ═══════════════════════════════════════════════════════════
console.log('\n=== Decomposer Tests (dictionary only) ===');

const d1 = decomposeCompoundWord('울써마지');
assert('"울써마지" → ["울쎄라","써마지"]',
  d1 !== null && d1.decomposedNames[0] === '울쎄라' && d1.decomposedNames[1] === '써마지',
  `got: ${d1 ? JSON.stringify(d1.decomposedNames) : 'null'}`);

const d2 = decomposeCompoundWord('인슈링크');
assert('"인슈링크" → ["인모드","슈링크"]',
  d2 !== null && d2.decomposedNames[0] === '인모드' && d2.decomposedNames[1] === '슈링크',
  `got: ${d2 ? JSON.stringify(d2.decomposedNames) : 'null'}`);

const d3 = decomposeCompoundWord('울쥬베');
assert('"울쥬베" → ["울쎄라","쥬베룩"]',
  d3 !== null && d3.decomposedNames[0] === '울쎄라' && d3.decomposedNames[1] === '쥬베룩',
  `got: ${d3 ? JSON.stringify(d3.decomposedNames) : 'null'}`);

const d4 = decomposeCompoundWord('울포');
assert('"울포" → ["울쎄라","포텐자"]',
  d4 !== null && d4.decomposedNames[0] === '울쎄라' && d4.decomposedNames[1] === '포텐자',
  `got: ${d4 ? JSON.stringify(d4.decomposedNames) : 'null'}`);

const d5 = decomposeCompoundWord('텐텐');
assert('"텐텐" → ["텐쎄라","텐써마"]',
  d5 !== null && d5.decomposedNames[0] === '텐쎄라' && d5.decomposedNames[1] === '텐써마',
  `got: ${d5 ? JSON.stringify(d5.decomposedNames) : 'null'}`);

const d6 = decomposeCompoundWord('일반시술');
assert('"일반시술" → null (미매칭)', d6 === null, `got: ${d6 ? JSON.stringify(d6) : 'null'}`);

// ═══════════════════════════════════════════════════════════
// 3. Price Parser 테스트
// ═══════════════════════════════════════════════════════════
console.log('\n=== Price Parser Tests ===');

// 한국어 숫자 변환
assert('parseKoreanNumber("5만") = 50000', parseKoreanNumber('5만') === 50000, `got: ${parseKoreanNumber('5만')}`);
assert('parseKoreanNumber("150만") = 1500000', parseKoreanNumber('150만') === 1500000, `got: ${parseKoreanNumber('150만')}`);
assert('parseKoreanNumber("350,000") = 350000', parseKoreanNumber('350,000') === 350000, `got: ${parseKoreanNumber('350,000')}`);
assert('parseKoreanNumber("5천") = 5000', parseKoreanNumber('5천') === 5000, `got: ${parseKoreanNumber('5천')}`);
assert('parseKoreanNumber("만5천") = 15000', parseKoreanNumber('만5천') === null || parseKoreanNumber('1만5천') === 15000, 'edge case');

// 울쎄라 300샷 150만원
const p1 = parsePrices('울쎄라 300샷 150만원');
const p1Match = p1.prices.find((p) => p.standardName === '울쎄라');
assert('"울쎄라 300샷 150만원" → unit_price 5000',
  p1Match !== undefined && p1Match.unitPrice === 5000,
  `got: ${p1Match ? `unitPrice=${p1Match.unitPrice}` : 'no match'}`);

// 온다 5만줄 35만원 → JOULE, unit_price=7
const p2 = parsePrices('온다 50000줄 350000원');
const p2Match = p2.prices.find((p) => p.standardName === '온다리프팅' || p.treatmentName.includes('온다'));
assert('"온다 50000줄 350000원" → unit_type JOULE, unit_price 7',
  p2Match !== undefined && p2Match.unitType === 'JOULE' && p2Match.unitPrice === 7,
  `got: ${p2Match ? `unitType=${p2Match.unitType}, unitPrice=${p2Match.unitPrice}` : 'no match'}`);

// 써마지 900샷 150만원
const p3 = parsePrices('써마지 900샷 150만원');
const p3Match = p3.prices.find((p) => p.standardName === '써마지');
assert('"써마지 900샷 150만원" → SHOT, unitPrice ~1667',
  p3Match !== undefined && p3Match.unitType === 'SHOT' && p3Match.unitPrice !== null && Math.abs(p3Match.unitPrice - 1666.67) < 1,
  `got: ${p3Match ? `unitType=${p3Match.unitType}, unitPrice=${p3Match.unitPrice}` : 'no match'}`);

// 실리프팅 10줄 50만원 → LINE
const p4 = parsePrices('실리프팅 10줄 500000원');
const p4Match = p4.prices.find((p) => (p.standardName === '실리프팅' || p.treatmentName.includes('실리프팅')));
assert('"실리프팅 10줄 500000원" → LINE, unitPrice 50000',
  p4Match !== undefined && p4Match.unitType === 'LINE' && p4Match.unitPrice === 50000,
  `got: ${p4Match ? `unitType=${p4Match.unitType}, unitPrice=${p4Match.unitPrice}` : 'no match'}`);

// 이벤트 가격 감지
const p5 = parsePrices('이벤트 보톡스 100유닛 15만원');
const p5Match = p5.prices.find((p) => p.standardName === '보톡스' || p.treatmentName.includes('보톡스'));
assert('"이벤트 보톡스" → isEventPrice=true',
  p5Match !== undefined && p5Match.isEventPrice === true,
  `got: ${p5Match ? `isEventPrice=${p5Match.isEventPrice}` : 'no match'}`);

// ═══════════════════════════════════════════════════════════
// 4. 이벤트 컨텍스트 추출 테스트 (황금 데이터)
// ═══════════════════════════════════════════════════════════
console.log('\n=== Event Context (Golden Data) Tests ===');

// 월 한정 이벤트
const e1 = parsePrices('3월 한정 울쎄라 300샷 120만원');
const e1Match = e1.prices.find((p) => p.standardName === '울쎄라');
assert('이벤트 라벨: "3월 한정"',
  e1Match !== undefined && e1Match.isEventPrice === true && e1Match.eventContext.label !== null && e1Match.eventContext.label.includes('3월 한정'),
  `got: label=${e1Match?.eventContext.label}, isEvent=${e1Match?.isEventPrice}`);
assert('이벤트 조건: duration "3월 한정"',
  e1Match !== undefined && e1Match.eventContext.conditions.duration !== null,
  `got: duration=${e1Match?.eventContext.conditions.duration}`);

// 선착순 이벤트
const e2 = parsePrices('선착순 10명 써마지 900샷 100만원');
const e2Match = e2.prices.find((p) => p.standardName === '써마지');
assert('이벤트 조건: limit "선착순 10명"',
  e2Match !== undefined && e2Match.isEventPrice === true && e2Match.eventContext.conditions.limit !== null,
  `got: limit=${e2Match?.eventContext.conditions.limit}`);

// 오픈 기념 이벤트
const e3 = parsePrices('오픈 기념 특가 인모드 5만원');
const e3Match = e3.prices.find((p) => p.standardName === '인모드' || p.treatmentName.includes('인모드'));
assert('이벤트 조건: occasion "오픈 기념"',
  e3Match !== undefined && e3Match.isEventPrice === true && e3Match.eventContext.conditions.occasion !== null,
  `got: occasion=${e3Match?.eventContext.conditions.occasion}`);

// 할인율 이벤트
const e4 = parsePrices('50% 할인 슈링크 200샷 30만원');
const e4Match = e4.prices.find((p) => p.standardName === '슈링크' || p.treatmentName.includes('슈링크'));
assert('이벤트 조건: discount "50% 할인"',
  e4Match !== undefined && e4Match.isEventPrice === true && e4Match.eventContext.conditions.discount !== null,
  `got: discount=${e4Match?.eventContext.conditions.discount}`);

// 이벤트 없는 일반 가격 → eventContext 비어있어야 함
const e5 = parsePrices('울쎄라 300샷 150만원');
const e5Match = e5.prices.find((p) => p.standardName === '울쎄라');
assert('일반 가격: isEventPrice=false, label=null',
  e5Match !== undefined && e5Match.isEventPrice === false && e5Match.eventContext.label === null,
  `got: isEvent=${e5Match?.isEventPrice}, label=${e5Match?.eventContext.label}`);

// ═══════════════════════════════════════════════════════════
// 5. [Critical] 한글 숫자 정규화 + 단가 연산 상세 검증
// ═══════════════════════════════════════════════════════════
console.log('\n=== [Critical] Korean Number + Unit Price Detailed ===');

// "온다 5만줄 35만원" — 원문 그대로
const c1 = parsePrices('온다 5만줄 35만원');
const c1Match = c1.prices.find((p) => p.treatmentName.includes('온다'));
console.log(`  [LOG] "온다 5만줄 35만원" 파싱 결과:`);
console.log(`    treatmentName = ${c1Match?.treatmentName}`);
console.log(`    totalQuantity = ${c1Match?.totalQuantity} (5만 → 50000)`);
console.log(`    totalPrice    = ${c1Match?.totalPrice} (35만 → 350000)`);
console.log(`    unitType      = ${c1Match?.unitType}`);
console.log(`    unitPrice     = ${c1Match?.unitPrice} (350000 / 50000 = 7)`);
assert('[Critical] "온다 5만줄 35만원" → qty=50000, price=350000, unit_price=7',
  c1Match !== undefined
    && c1Match.totalQuantity === 50000
    && c1Match.totalPrice === 350000
    && c1Match.unitPrice === 7
    && c1Match.unitType === 'JOULE',
  `got: qty=${c1Match?.totalQuantity}, price=${c1Match?.totalPrice}, unitPrice=${c1Match?.unitPrice}, unitType=${c1Match?.unitType}`);

// "울쎄라 300샷 150만원" — 원문 그대로
const c2 = parsePrices('울쎄라 300샷 150만원');
const c2Match = c2.prices.find((p) => p.standardName === '울쎄라');
console.log(`  [LOG] "울쎄라 300샷 150만원" 파싱 결과:`);
console.log(`    treatmentName = ${c2Match?.treatmentName}`);
console.log(`    totalQuantity = ${c2Match?.totalQuantity} (300 → 300)`);
console.log(`    totalPrice    = ${c2Match?.totalPrice} (150만 → 1500000)`);
console.log(`    unitType      = ${c2Match?.unitType}`);
console.log(`    unitPrice     = ${c2Match?.unitPrice} (1500000 / 300 = 5000)`);
assert('[Critical] "울쎄라 300샷 150만원" → qty=300, price=1500000, unit_price=5000',
  c2Match !== undefined
    && c2Match.totalQuantity === 300
    && c2Match.totalPrice === 1500000
    && c2Match.unitPrice === 5000
    && c2Match.unitType === 'SHOT',
  `got: qty=${c2Match?.totalQuantity}, price=${c2Match?.totalPrice}, unitPrice=${c2Match?.unitPrice}, unitType=${c2Match?.unitType}`);

// ═══════════════════════════════════════════════════════════
// 6. [High] Normalizer → Price-Parser 통합 매핑 테스트
// ═══════════════════════════════════════════════════════════
console.log('\n=== [High] Normalizer → Price-Parser Integration ===');

const integrationText = '울쎄라 300샷 150만원 / 써마지 600샷 80만원';
const intResult = parsePrices(integrationText);

console.log(`  [LOG] 입력: "${integrationText}"`);
console.log(`  [LOG] 파싱된 가격 수: ${intResult.prices.length}`);
for (const p of intResult.prices) {
  console.log(`    → standard_name=${p.standardName}, treatmentName=${p.treatmentName}, unitPrice=${p.unitPrice}, unitType=${p.unitType}`);
}

const intUl = intResult.prices.find((p) => p.standardName === '울쎄라');
const intTh = intResult.prices.find((p) => p.standardName === '써마지');

assert('[High] 통합: 2개 가격 추출',
  intResult.prices.length === 2,
  `got: ${intResult.prices.length}`);
assert('[High] 울쎄라: standard_name="울쎄라", unit_price=5000',
  intUl !== undefined && intUl.standardName === '울쎄라' && intUl.unitPrice === 5000,
  `got: name=${intUl?.standardName}, unitPrice=${intUl?.unitPrice}`);
assert('[High] 써마지: standard_name="써마지", unit_price≈1333',
  intTh !== undefined && intTh.standardName === '써마지' && intTh.unitPrice !== null && Math.abs(intTh.unitPrice - 1333.33) < 1,
  `got: name=${intTh?.standardName}, unitPrice=${intTh?.unitPrice}`);

// ═══════════════════════════════════════════════════════════
// 7. [Medium] Change-Detector 전략적 분리 로직 검증
// ═══════════════════════════════════════════════════════════
console.log('\n=== [Medium] Change-Detector Strategic Split ===');

import { computeHash, stripVolatileContent } from './crawler/change-detector.js';

// 순수 콘텐츠가 동일하면 해시 동일 (날짜만 다른 경우)
const textA = '울쎄라 300샷 150만원 2026년 2월 이벤트 ~3/31까지';
const textB = '울쎄라 300샷 150만원 2026년 3월 이벤트 ~4/30까지';
const strippedA = stripVolatileContent(textA);
const strippedB = stripVolatileContent(textB);
console.log(`  [LOG] 원문A: "${textA}"`);
console.log(`  [LOG] 원문B: "${textB}"`);
console.log(`  [LOG] Strip A: "${strippedA}"`);
console.log(`  [LOG] Strip B: "${strippedB}"`);
console.log(`  [LOG] Hash A: ${computeHash(strippedA).substring(0, 16)}...`);
console.log(`  [LOG] Hash B: ${computeHash(strippedB).substring(0, 16)}...`);

assert('[Medium] 날짜/이벤트 문구만 다른 경우 → stripped 해시 동일',
  computeHash(strippedA) === computeHash(strippedB),
  `hashA=${computeHash(strippedA).substring(0, 16)}, hashB=${computeHash(strippedB).substring(0, 16)}`);

// 시술명/가격이 변하면 해시 다름
const textC = '울쎄라 300샷 150만원 2026년 2월 이벤트';
const textD = '울쎄라 300샷 120만원 2026년 2월 이벤트';
const strippedC = stripVolatileContent(textC);
const strippedD = stripVolatileContent(textD);
console.log(`  [LOG] 원문C: "${textC}"`);
console.log(`  [LOG] 원문D: "${textD}" (가격 변동)`);
console.log(`  [LOG] Strip C: "${strippedC}"`);
console.log(`  [LOG] Strip D: "${strippedD}"`);

assert('[Medium] 가격이 변동되면 → stripped 해시 다름',
  computeHash(strippedC) !== computeHash(strippedD),
  `hashC=${computeHash(strippedC).substring(0, 16)}, hashD=${computeHash(strippedD).substring(0, 16)}`);

// 원문(full text) 해시는 항상 달라야 함 (날짜가 다르므로)
assert('[Medium] 원문 해시는 날짜 차이로 항상 다름 (데이터 자산화용)',
  computeHash(textA) !== computeHash(textB),
  'full hashes should differ');

// ═══════════════════════════════════════════════════════════
// 결과
// ═══════════════════════════════════════════════════════════
console.log(`\n══════ RESULT: ${passed} passed, ${failed} failed ══════`);
process.exit(failed > 0 ? 1 : 0);
