/**
 * 미매칭/모호 케이스 패턴 분석
 * 결과 Excel에서 unmatched/ambiguous 행을 읽어 패턴 분류
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx') as typeof import('xlsx');
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeHospitalName } from './lib/normalizer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 최신 결과 파일 찾기
const outputDir = path.resolve(__dirname, '../../output');
import { readdirSync } from 'fs';
const files = readdirSync(outputDir)
  .filter(f => f.startsWith('email-match-result-') && f.endsWith('.xlsx'))
  .sort().reverse();

if (files.length === 0) throw new Error('결과 파일 없음');
const resultFile = path.join(outputDir, files[0]);
console.log('분석 파일:', resultFile);

const wb = XLSX.readFile(resultFile);
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet);

const unmatched = rows.filter(r => r['매칭상태']?.includes('미매칭'));
const ambiguous = rows.filter(r => r['매칭상태']?.includes('모호'));
const all = [...unmatched, ...ambiguous];

console.log(`\n분석 대상: 미매칭 ${unmatched.length}건 + 모호 ${ambiguous.length}건 = ${all.length}건`);

// ─── 패턴 분류 ────────────────────────────────────────
const patterns = {
  branchKeyword: [] as string[],   // 지점/지역명 포함
  shortName: [] as string[],       // 2자 이하 (너무 짧음)
  nonClinic: [] as string[],       // 병원/의원 아닌 기관
  chainPattern: [] as string[],    // 체인명 패턴 (_지역, -지역)
  foreignChar: [] as string[],     // 영문/특수문자 혼용
  normalForm: [] as string[],      // 정상적 병원명이지만 미매칭
};

// 지점 관련 키워드
const BRANCH_KEYWORDS = [
  '지점', '지부', '분원', '분점', '본점', '본원',
  '강남', '강북', '홍대', '신촌', '건대', '신도림', '광교', '판교', '수원',
  '부산', '대구', '인천', '광주', '대전', '울산', '제주',
  '논현', '역삼', '청담', '압구정', '서초', '방배', '잠실', '송파',
  '명동', '신사', '선릉', '삼성', '도곡', '개포', '수서',
];

// 비병원 키워드
const NON_CLINIC = ['보건소', '대학교', '대학병원', '종합병원', '요양원', '약국', '연구소'];

for (const row of all) {
  const name: string = row['병원명(엑셀)'] ?? '';
  const norm = normalizeHospitalName(name);

  // 지점 패턴
  const hasBranch = BRANCH_KEYWORDS.some(k => {
    const nameNoSpace = name.replace(/\s/g, '');
    return nameNoSpace.includes(k) && !nameNoSpace.startsWith(k);
  });
  const hasUnderscore = name.includes('_');
  const hasDash = /[가-힣]-[가-힣]/.test(name);

  if (NON_CLINIC.some(k => name.includes(k))) {
    patterns.nonClinic.push(name);
  } else if (hasUnderscore || hasDash) {
    patterns.chainPattern.push(name);
  } else if (hasBranch) {
    patterns.branchKeyword.push(name);
  } else if (norm.length <= 2) {
    patterns.shortName.push(name);
  } else if (/[a-zA-Z]{3,}/.test(name)) {
    patterns.foreignChar.push(name);
  } else {
    patterns.normalForm.push(name);
  }
}

console.log('\n=== 패턴 분류 결과 ===')
console.log(`지점/지역명 포함:     ${patterns.branchKeyword.length}건`);
console.log(`체인 구분자(_/-):    ${patterns.chainPattern.length}건`);
console.log(`비병원 기관:          ${patterns.nonClinic.length}건`);
console.log(`영문 혼용:            ${patterns.foreignChar.length}건`);
console.log(`이름 너무 짧음:       ${patterns.shortName.length}건`);
console.log(`정상명 미매칭:        ${patterns.normalForm.length}건`);

console.log('\n=== 체인 구분자(_/-) 샘플 ===');
patterns.chainPattern.slice(0, 15).forEach(n => console.log(' ', n));

console.log('\n=== 지점/지역명 포함 샘플 ===');
patterns.branchKeyword.slice(0, 15).forEach(n => console.log(' ', n));

console.log('\n=== 정상명 미매칭 샘플 (상위 30개) ===');
patterns.normalForm.slice(0, 30).forEach(n => console.log(' ', n));

// 정규화 후 길이별 분포
console.log('\n=== 정규화 후 이름 길이 분포 (정상명 미매칭) ===');
const lenDist: Record<number, number> = {};
for (const name of patterns.normalForm) {
  const l = normalizeHospitalName(name).length;
  lenDist[l] = (lenDist[l] ?? 0) + 1;
}
Object.entries(lenDist).sort(([a], [b]) => +a - +b)
  .forEach(([l, c]) => console.log(`  길이 ${l}: ${c}건`));
