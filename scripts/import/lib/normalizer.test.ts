/**
 * 정규화 단위 테스트
 * 실행: npx tsx scripts/import/lib/normalizer.test.ts
 */
import { normalizeHospitalName, normalizeDoctorName } from './normalizer.js';

interface TestCase { input: string; expected: string; desc: string; }

const nameTests: TestCase[] = [
  { input: '강남성형외과의원',    expected: '강남성형외과',  desc: 'suffix 의원 제거' },
  { input: '닥터킴피부과클리닉',  expected: '닥터킴피부과',  desc: 'suffix 클리닉 제거' },
  { input: '(주)한양외과',        expected: '한양외과',      desc: '괄호 제거' },
  { input: '강남 미래 병원',      expected: '강남미래',      desc: '공백+suffix 제거' },
  { input: '뷰티성형외과 2호점',  expected: '뷰티성형외과',  desc: '체인 구분자 제거' },
  { input: '서울탑피부과의원',    expected: '서울탑피부과',  desc: '복합 suffix' },
  { input: '연세이비인후과의원',  expected: '연세이비인후과', desc: 'suffix 이비인후과의원' },
  // 지점명 제거
  { input: '유앤아이의원 건대점', expected: '유앤아이',      desc: '지점명 제거 (건대점)' },
  { input: '유앤아이 선릉',       expected: '유앤아이',      desc: '지역명 제거 (선릉)' },
  { input: '유앤아이의원 목포점', expected: '유앤아이',      desc: '지점명 제거 (목포점)' },
  { input: '톤즈 광교',           expected: '톤즈',          desc: '지역명 제거 (광교)' },
];

const doctorTests: TestCase[] = [
  { input: '김민준 원장',  expected: '김민준', desc: '원장 제거' },
  { input: 'Dr. 박현우',   expected: '박현우', desc: 'Dr. 제거' },
  { input: '닥터 이수진',  expected: '이수진', desc: '닥터 제거' },
  { input: '최지원의사',   expected: '최지원', desc: '의사 제거' },
];

let passed = 0, failed = 0;

console.log('\n=== 병원명 정규화 테스트 ===');
for (const tc of nameTests) {
  const result = normalizeHospitalName(tc.input);
  const ok     = result === tc.expected;
  console.log(`${ok ? '✅' : '❌'} [${tc.desc}]`);
  if (!ok) console.log(`   input:    "${tc.input}"\n   got:      "${result}"\n   expected: "${tc.expected}"`);
  ok ? passed++ : failed++;
}

console.log('\n=== 의사명 정규화 테스트 ===');
for (const tc of doctorTests) {
  const result = normalizeDoctorName(tc.input);
  const ok     = result === tc.expected;
  console.log(`${ok ? '✅' : '❌'} [${tc.desc}]`);
  if (!ok) console.log(`   input:    "${tc.input}"\n   got:      "${result}"\n   expected: "${tc.expected}"`);
  ok ? passed++ : failed++;
}

console.log(`\n결과: ${passed}/${passed + failed} 통과`);
process.exit(failed > 0 ? 1 : 0);
