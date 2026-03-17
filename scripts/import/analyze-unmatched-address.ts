/**
 * 미매칭 Excel의 주소 데이터 분포 분석
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx') as typeof import('xlsx');
import path from 'path';
import { fileURLToPath } from 'url';
import { readdirSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.resolve(__dirname, '../../output');

// 가장 최근 미매칭 Excel 찾기
const files = readdirSync(outputDir)
  .filter(f => f.startsWith('unmatched-emails-') && f.endsWith('.xlsx'))
  .sort().reverse();
if (files.length === 0) throw new Error('미매칭 Excel 없음');
const filePath = path.join(outputDir, files[0]);
console.log('분석 파일:', filePath, '\n');

const wb = XLSX.readFile(filePath);
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet);

const total = rows.length;
const hasAddress = rows.filter(r => (r['주소'] ?? '').length > 5);
const hasEmail   = rows.filter(r => (r['이메일(원장)'] ?? '').includes('@') || (r['이메일(세금계산서)'] ?? '').includes('@'));

console.log(`전체 미매칭/모호: ${total}건`);
console.log(`주소 있음:        ${hasAddress.length}건 (${((hasAddress.length/total)*100).toFixed(1)}%)`);
console.log(`이메일 있음:      ${hasEmail.length}건 (${((hasEmail.length/total)*100).toFixed(1)}%)`);
console.log(`주소+이메일 모두: ${hasAddress.filter(r => (r['이메일(원장)'] ?? '').includes('@')).length}건`);

// 주소 형식 샘플
console.log('\n=== 주소 샘플 (상위 20) ===');
hasAddress.slice(0, 20).forEach(r =>
  console.log(`  [${r['병원명(엑셀)']?.slice(0, 15)}] → "${r['주소']?.slice(0, 50)}"`)
);

// 주소 패턴 분류
const roadAddr    = hasAddress.filter(r => /로\s*\d+|길\s*\d+/.test(r['주소'] ?? '')); // 도로명
const jibunAddr   = hasAddress.filter(r => /\d+-\d+/.test(r['주소'] ?? ''));            // 지번
const sigunguOnly = hasAddress.filter(r => !/로\s*\d+|길\s*\d+/.test(r['주소'] ?? '') && !/\d+-\d+/.test(r['주소'] ?? ''));

console.log('\n=== 주소 형식 분류 ===');
console.log(`도로명 주소:  ${roadAddr.length}건`);
console.log(`지번 주소:    ${jibunAddr.length}건`);
console.log(`기타 (구명만): ${sigunguOnly.length}건`);

// 도로명 추출 테스트
function extractRoad(addr: string): string {
  const m = addr.match(/([가-힣0-9a-zA-Z]+로|[가-힣0-9a-zA-Z]+길)\s*(\d+)/);
  return m ? `${m[1]} ${m[2]}` : '';
}

console.log('\n=== 도로명 추출 샘플 ===');
roadAddr.slice(0, 10).forEach(r => {
  const road = extractRoad(r['주소'] ?? '');
  console.log(`  "${r['주소']?.slice(0, 40)}" → 도로명: "${road}"`);
});

// 미사유 분포
const reasons: Record<string, number> = {};
rows.forEach(r => {
  const reason = (r['미매칭사유'] ?? '').split(' ')[0];
  reasons[reason] = (reasons[reason] ?? 0) + 1;
});
console.log('\n=== 미매칭 사유 분포 ===');
Object.entries(reasons).sort((a, b) => b[1] - a[1])
  .forEach(([r, c]) => console.log(`  ${r}: ${c}건`));
