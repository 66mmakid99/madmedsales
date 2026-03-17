/**
 * v2 결과에서 여전히 미매칭/모호인 케이스 분석
 * 새로운 매칭 전략 도출용
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx') as typeof import('xlsx');
import path from 'path';
import { fileURLToPath } from 'url';
import { readdirSync } from 'fs';
import { normalizeHospitalName } from './lib/normalizer.js';
import { generateCandidates } from './lib/name-transformer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.resolve(__dirname, '../../output');

// 최신 v2 결과 파일
const files = readdirSync(outputDir)
  .filter(f => f.startsWith('name-disambig-result-') && f.endsWith('.xlsx'))
  .sort().reverse();
if (files.length === 0) throw new Error('v2 결과 파일 없음');
const resultFile = path.join(outputDir, files[0]);
console.log('분석 파일:', resultFile, '\n');

const wb = XLSX.readFile(resultFile);
const sheet = wb.Sheets[wb.SheetNames[0]]; // 전체결과 시트
const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet);

const unmatched = rows.filter(r => r['매칭상태']?.includes('미매칭'));
const ambiguous = rows.filter(r => r['매칭상태']?.includes('모호'));

console.log(`미매칭: ${unmatched.length}건, 모호: ${ambiguous.length}건\n`);

// ─── 미매칭 패턴 분류 ──────────────────────────────────
const patterns = {
  hasPhone:        [] as string[],  // 전화번호가 있는 경우 (phone-only 가능성)
  hasParenthesis:  [] as string[],  // 아직 괄호 남은 경우
  hasUnderscore:   [] as string[],  // _ 가 남은 경우 (변환 실패)
  veryShort:       [] as string[],  // 정규화 후 2자 이하
  longName:        [] as string[],  // 긴 이름 (체인 패턴?)
  englishMixed:    [] as string[],  // 영문 포함
  noSpecialPattern:[] as string[],  // 특별 패턴 없음 (정상 병원명이지만 DB 없음)
};

for (const r of unmatched) {
  const name = r['병원명(엑셀)'] ?? '';
  const phone = r['전화번호'] ?? '';
  const norm = normalizeHospitalName(name);

  if (phone && phone.replace(/[^0-9]/g, '').length >= 9) {
    patterns.hasPhone.push(name);
  }
  if (/[（(（]/.test(name)) patterns.hasParenthesis.push(name);
  if (name.includes('_')) patterns.hasUnderscore.push(name);
  if (norm.length <= 2) patterns.veryShort.push(name);
  if (norm.length >= 10) patterns.longName.push(name);
  if (/[a-zA-Z]{2,}/.test(name)) patterns.englishMixed.push(name);
  if (!phone && !name.includes('_') && !name.includes('(') && norm.length > 2 && !/[a-zA-Z]{2,}/.test(name)) {
    patterns.noSpecialPattern.push(name);
  }
}

console.log('=== 미매칭 패턴 분류 ===');
console.log(`전화번호 있음 (phone-only 재시도 가능): ${patterns.hasPhone.length}건`);
console.log(`괄호 포함 (추출 실패):                  ${patterns.hasParenthesis.length}건`);
console.log(`언더스코어 남음 (변환 실패):             ${patterns.hasUnderscore.length}건`);
console.log(`이름 너무 짧음 (2자 이하):               ${patterns.veryShort.length}건`);
console.log(`긴 이름 (10자 이상):                     ${patterns.longName.length}건`);
console.log(`영문 혼용:                               ${patterns.englishMixed.length}건`);
console.log(`특이 패턴 없음 (DB 미등록 추정):         ${patterns.noSpecialPattern.length}건`);

// ─── 전화번호 있는 미매칭 샘플 ────────────────────────
console.log('\n=== 전화번호 있는 미매칭 (상위 20) — phone-only 시도 필요 ===');
unmatched
  .filter(r => (r['전화번호'] ?? '').replace(/[^0-9]/g, '').length >= 9)
  .slice(0, 20)
  .forEach(r => console.log(`  [${r['전화번호']}] ${r['병원명(엑셀)']}`));

// ─── 변환 실패 케이스 분석 ─────────────────────────────
console.log('\n=== _ 포함 미매칭 (변환 후에도 실패) — 샘플 15 ===');
unmatched
  .filter(r => (r['병원명(엑셀)'] ?? '').includes('_'))
  .slice(0, 15)
  .forEach(r => {
    const cands = generateCandidates(r['병원명(엑셀)'] ?? '');
    console.log(`  원본: ${r['병원명(엑셀)']}`);
    cands.slice(0, 2).forEach(c => console.log(`    → [${c.priority}] ${c.transformType}: "${c.name}"`));
  });

// ─── 이름 길이 분포 (정규화 후) ────────────────────────
console.log('\n=== 미매칭 정규화 이름 길이 분포 ===');
const lenDist: Record<number, number> = {};
for (const r of unmatched) {
  const l = normalizeHospitalName(r['병원명(엑셀)'] ?? '').length;
  lenDist[l] = (lenDist[l] ?? 0) + 1;
}
Object.entries(lenDist).sort(([a], [b]) => +a - +b)
  .forEach(([l, c]) => console.log(`  길이 ${l}: ${c}건`));

// ─── 모호 225건 상세 분석 ──────────────────────────────
console.log('\n=== 모호건 패턴 ===');
const ambigByType: Record<string, number> = {};
for (const r of ambiguous) {
  const t = r['변환타입'] ?? 'original';
  ambigByType[t] = (ambigByType[t] ?? 0) + 1;
}
Object.entries(ambigByType).sort((a, b) => b[1] - a[1])
  .forEach(([t, c]) => console.log(`  ${t}: ${c}건`));

console.log('\n=== 모호건 샘플 15 ===');
ambiguous.slice(0, 15).forEach(r =>
  console.log(`  [${r['변환타입']}] "${r['병원명(엑셀)']}" → "${r['변환된이름']}" (유사도: ${r['이름유사도']})`)
);

// ─── 특이 패턴 없는 정상명 미매칭 샘플 ───────────────
console.log('\n=== 특이 패턴 없는 미매칭 (DB 미등록 추정) 상위 30 ===');
patterns.noSpecialPattern.slice(0, 30).forEach(n => console.log(`  ${n}`));

// ─── 영문 혼용 샘플 ────────────────────────────────────
console.log('\n=== 영문 혼용 미매칭 상위 20 ===');
unmatched
  .filter(r => /[a-zA-Z]{2,}/.test(r['병원명(엑셀)'] ?? ''))
  .slice(0, 20)
  .forEach(r => console.log(`  ${r['병원명(엑셀)']}`));
