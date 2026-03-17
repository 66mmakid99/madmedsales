/**
 * 병원명 불일치 해소 스크립트 (v2)
 *
 * 기존 match-by-fields.ts 결과 Excel에서 미매칭/모호 행을 읽어
 * 4단계 변환 파이프라인으로 재매칭 시도
 *
 * 실행:
 *   npx tsx scripts/import/match-by-fields-v2.ts [--result <result-xlsx>] [--output <dir>]
 *
 * 결과: Excel 파일로 출력 (DB 저장 없음)
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { readdirSync } from 'fs';
import dotenv from 'dotenv';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx') as typeof import('xlsx');

import { supabase } from '../utils/supabase.js';
import { createLogger } from '../utils/logger.js';
import { normalizeHospitalName, normalizeDoctorName } from './lib/normalizer.js';
import { generateCandidates } from './lib/name-transformer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const log = createLogger('match-by-fields-v2');

// ─── 타입 ──────────────────────────────────────────────
interface InputRow {
  rowIndex: number;
  hospitalName: string;    // 병원명(엑셀)
  directorName: string;
  directorEmail: string;
  taxEmail: string;
  phone: string;
  address: string;
  originalStatus: string;  // 기존 매칭 상태
}

interface DbHospital {
  id: string;
  name: string;
  normalizedName: string;
  email: string | null;
  doctorName: string | null;
  normalizedDoctorName: string | null;
  phone: string | null;
  normalizedPhone: string | null;
  address: string | null;
  sido: string | null;
  sigungu: string | null;
}

type MatchStatus = 'matched' | 'ambiguous' | 'unmatched';

interface ResultRow {
  rowIndex: number;
  // Excel 원본
  hospitalName: string;
  directorName: string;
  directorEmail: string;
  taxEmail: string;
  phone: string;
  address: string;
  originalStatus: string;
  // 변환 정보
  transformedName: string;
  transformType: string;
  transformPriority: number;
  // 매칭 결과
  status: MatchStatus;
  matchedFields: string;
  nameMatchType: string;
  nameScore: string;
  // DB 병원 정보
  dbHospitalId: string;
  dbHospitalName: string;
  dbDoctorName: string;
  dbPhone: string;
  dbAddress: string;
  dbExistingEmail: string;
}

// ─── 유틸 ─────────────────────────────────────────────
function normalizePhone(phone: string): string {
  return phone ? phone.replace(/[^0-9]/g, '') : '';
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return 1 - dp[m][n] / Math.max(m, n);
}

function extractRoad(addr: string): string {
  const m = addr.match(/([가-힣0-9]+로|[가-힣0-9]+길)\s*\d+/);
  return m ? m[0].replace(/\s/g, '') : '';
}

function addressSimilarity(a: string, b: string): boolean {
  if (!a || !b) return false;
  const na = a.replace(/\s+/g, '').toLowerCase();
  const nb = b.replace(/\s+/g, '').toLowerCase();
  if (na.includes(nb.slice(0, 12)) || nb.includes(na.slice(0, 12))) return true;
  const roadA = extractRoad(a);
  const roadB = extractRoad(b);
  return !!roadA && !!roadB && roadA === roadB;
}

// ─── 최신 결과 파일 자동 탐지 ─────────────────────────
function findLatestResultFile(outputDir: string): string {
  const files = readdirSync(outputDir)
    .filter(f => f.startsWith('email-match-result-') && f.endsWith('.xlsx'))
    .sort()
    .reverse();
  if (files.length === 0) throw new Error(`결과 파일 없음: ${outputDir}`);
  return path.join(outputDir, files[0]);
}

// ─── 기존 결과 Excel 파싱 ──────────────────────────────
function parseResultExcel(filePath: string): InputRow[] {
  log.info(`Reading result: ${filePath}`);
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet);

  const result: InputRow[] = [];
  for (const r of rows) {
    const status = r['매칭상태'] ?? '';
    // 미매칭 또는 모호만 처리
    if (!status.includes('미매칭') && !status.includes('모호')) continue;

    const hospitalName = r['병원명(엑셀)']?.toString().trim() ?? '';
    if (!hospitalName) continue;

    result.push({
      rowIndex:       Number(r['행번호']) || 0,
      hospitalName,
      directorName:   r['원장명(엑셀)']?.toString().trim() ?? '',
      directorEmail:  r['이메일(엑셀)']?.toString().trim() ?? '',
      taxEmail:       r['세금계산서이메일']?.toString().trim() ?? '',
      phone:          r['전화번호(엑셀)']?.toString().trim() ?? '',
      address:        r['주소(엑셀)']?.toString().trim() ?? '',
      originalStatus: status,
    });
  }

  log.info(`재매칭 대상: ${result.length}건`);
  return result;
}

// ─── DB 로드 ───────────────────────────────────────────
async function loadHospitals(): Promise<DbHospital[]> {
  log.info('Loading hospitals (피부과+성형외과)...');
  const PAGE_SIZE = 1000;
  const all: DbHospital[] = [];
  let page = 0;

  while (true) {
    const { data, error } = await supabase
      .from('hospitals')
      .select('id, name, email, doctor_name, phone, address, sido, sigungu')
      .eq('status', 'active')
      .in('department', ['피부과', '성형외과'])
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;

    for (const h of data) {
      all.push({
        id:                   h.id,
        name:                 h.name,
        normalizedName:       normalizeHospitalName(h.name),
        email:                h.email,
        doctorName:           h.doctor_name,
        normalizedDoctorName: h.doctor_name ? normalizeDoctorName(h.doctor_name) : null,
        phone:                h.phone,
        normalizedPhone:      h.phone ? normalizePhone(h.phone) : null,
        address:              h.address,
        sido:                 h.sido,
        sigungu:              h.sigungu,
      });
    }

    if (data.length < PAGE_SIZE) break;
    page++;
    if (page % 5 === 0) log.info(`  page ${page}: ${all.length} loaded`);
  }

  log.info(`Total hospitals: ${all.length}`);
  return all;
}

// ─── 단일 후보명으로 매칭 시도 ─────────────────────────
interface SingleMatchResult {
  matched: boolean;
  ambiguous: boolean;
  hospital: DbHospital | null;
  nameMatchType: string;
  nameScore: number;
  matchedFields: string;
}

function tryMatchName(
  candidateName: string,
  row: InputRow,
  hospitals: DbHospital[],
  nameIndex: Map<string, DbHospital[]>,
): SingleMatchResult {
  const normName   = normalizeHospitalName(candidateName);
  const normDoctor = normalizeDoctorName(row.directorName);
  const normPhone  = normalizePhone(row.phone);

  // exact
  let nameCandidates: Array<{ h: DbHospital; nameScore: number }> = [];
  const exactCandidates = nameIndex.get(normName) ?? [];

  if (exactCandidates.length > 0) {
    nameCandidates = exactCandidates.map(h => ({ h, nameScore: 1.0 }));
  } else {
    // fuzzy (threshold 0.85)
    for (const h of hospitals) {
      const s = similarity(normName, h.normalizedName);
      if (s >= 0.85) nameCandidates.push({ h, nameScore: s });
    }
    nameCandidates.sort((a, b) => b.nameScore - a.nameScore);
    nameCandidates = nameCandidates.slice(0, 10);
  }

  if (nameCandidates.length === 0) {
    // 전화번호 단독
    if (normPhone.length >= 9) {
      const byPhone = hospitals.find(h => h.normalizedPhone === normPhone);
      if (byPhone) {
        return {
          matched: true, ambiguous: false, hospital: byPhone,
          nameMatchType: 'none', nameScore: 0, matchedFields: '전화번호',
        };
      }
    }
    return { matched: false, ambiguous: false, hospital: null, nameMatchType: 'none', nameScore: 0, matchedFields: '' };
  }

  // tiebreak
  interface Scored { h: DbHospital; nameScore: number; bonus: number; fields: string[] }
  const scored: Scored[] = [];

  for (const { h, nameScore } of nameCandidates) {
    const doctorMatch  = !!(normDoctor && h.normalizedDoctorName &&
                           similarity(normDoctor, h.normalizedDoctorName) >= 0.85);
    const phoneMatch   = !!(normPhone.length >= 9 && h.normalizedPhone === normPhone);
    const addressMatch = addressSimilarity(row.address, h.address ?? '');

    const fields: string[] = ['병원명'];
    if (doctorMatch) fields.push('의사명');
    if (phoneMatch) fields.push('전화번호');
    if (addressMatch) fields.push('주소');

    const bonus = (doctorMatch ? 3 : 0) + (phoneMatch ? 3 : 0) + (addressMatch ? 2 : 0);
    scored.push({ h, nameScore, bonus, fields });
  }

  scored.sort((a, b) => (b.nameScore + b.bonus * 0.1) - (a.nameScore + a.bonus * 0.1));

  const top    = scored[0];
  const second = scored[1];
  const nameMatchType = top.nameScore === 1.0 ? 'exact' : 'fuzzy';

  if (scored.length === 1) {
    return {
      matched: true, ambiguous: false, hospital: top.h,
      nameMatchType, nameScore: top.nameScore, matchedFields: top.fields.join(', '),
    };
  }

  const topTotal    = top.nameScore    + top.bonus    * 0.1;
  const secondTotal = second.nameScore + second.bonus * 0.1;

  if (top.bonus > 0 && topTotal - secondTotal >= 0.05) {
    return {
      matched: true, ambiguous: false, hospital: top.h,
      nameMatchType, nameScore: top.nameScore, matchedFields: top.fields.join(', '),
    };
  }

  return {
    matched: false, ambiguous: true, hospital: top.h,
    nameMatchType, nameScore: top.nameScore, matchedFields: top.fields.join(', '),
  };
}

// ─── 변환 후보 순서로 재매칭 ───────────────────────────
function matchWithTransform(
  row: InputRow,
  hospitals: DbHospital[],
  nameIndex: Map<string, DbHospital[]>,
): ResultRow {
  const candidates = generateCandidates(row.hospitalName);

  const base = {
    rowIndex:       row.rowIndex,
    hospitalName:   row.hospitalName,
    directorName:   row.directorName,
    directorEmail:  row.directorEmail,
    taxEmail:       row.taxEmail,
    phone:          row.phone,
    address:        row.address,
    originalStatus: row.originalStatus,
  };

  for (const cand of candidates) {
    const res = tryMatchName(cand.name, row, hospitals, nameIndex);

    if (res.matched) {
      return {
        ...base,
        transformedName:   cand.name,
        transformType:     cand.transformType,
        transformPriority: cand.priority,
        status:            'matched',
        matchedFields:     res.matchedFields,
        nameMatchType:     res.nameMatchType,
        nameScore:         res.nameScore.toFixed(3),
        dbHospitalId:      res.hospital?.id ?? '',
        dbHospitalName:    res.hospital?.name ?? '',
        dbDoctorName:      res.hospital?.doctorName ?? '',
        dbPhone:           res.hospital?.phone ?? '',
        dbAddress:         res.hospital?.address ?? '',
        dbExistingEmail:   res.hospital?.email ?? '',
      };
    }

    if (res.ambiguous) {
      // ambiguous는 계속 시도 (더 확정적인 후보가 있을 수 있음)
      continue;
    }
  }

  // 마지막으로 ambiguous가 있었으면 그걸 반환
  for (const cand of candidates) {
    const res = tryMatchName(cand.name, row, hospitals, nameIndex);
    if (res.ambiguous) {
      return {
        ...base,
        transformedName:   cand.name,
        transformType:     cand.transformType,
        transformPriority: cand.priority,
        status:            'ambiguous',
        matchedFields:     res.matchedFields,
        nameMatchType:     res.nameMatchType,
        nameScore:         res.nameScore.toFixed(3),
        dbHospitalId:      '',
        dbHospitalName:    res.hospital?.name ?? '',
        dbDoctorName:      res.hospital?.doctorName ?? '',
        dbPhone:           res.hospital?.phone ?? '',
        dbAddress:         res.hospital?.address ?? '',
        dbExistingEmail:   '',
      };
    }
  }

  // 완전 미매칭
  return {
    ...base,
    transformedName:   candidates[0]?.name ?? row.hospitalName,
    transformType:     'original',
    transformPriority: 1,
    status:            'unmatched',
    matchedFields:     '-',
    nameMatchType:     'none',
    nameScore:         '0.000',
    dbHospitalId:      '',
    dbHospitalName:    '',
    dbDoctorName:      '',
    dbPhone:           '',
    dbAddress:         '',
    dbExistingEmail:   '',
  };
}

// ─── Excel 출력 ────────────────────────────────────────
function writeResultExcel(results: ResultRow[], outputDir: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outPath   = path.join(outputDir, `name-disambig-result-${timestamp}.xlsx`);

  const headers = [
    '행번호', '병원명(엑셀)', '원장명', '이메일', '세금계산서이메일',
    '전화번호', '주소',
    '기존상태', '변환된이름', '변환타입', '변환우선순위',
    '매칭상태', '매칭항목', '이름매칭방식', '이름유사도',
    'DB병원ID', 'DB병원명', 'DB원장명', 'DB전화번호', 'DB주소', 'DB기존이메일',
  ];

  const toRow = (r: ResultRow) => [
    r.rowIndex,
    r.hospitalName,
    r.directorName,
    r.directorEmail,
    r.taxEmail,
    r.phone,
    r.address,
    r.originalStatus,
    r.transformedName,
    r.transformType,
    r.transformPriority,
    r.status === 'matched' ? '✅ 매칭' : r.status === 'ambiguous' ? '⚠️ 모호' : '❌ 미매칭',
    r.matchedFields,
    r.nameMatchType,
    r.nameScore,
    r.dbHospitalId,
    r.dbHospitalName,
    r.dbDoctorName,
    r.dbPhone,
    r.dbAddress,
    r.dbExistingEmail,
  ];

  const colWidths = [
    { wch: 6 }, { wch: 28 }, { wch: 10 }, { wch: 28 }, { wch: 28 },
    { wch: 14 }, { wch: 36 },
    { wch: 10 }, { wch: 28 }, { wch: 22 }, { wch: 8 },
    { wch: 10 }, { wch: 20 }, { wch: 10 }, { wch: 8 },
    { wch: 36 }, { wch: 24 }, { wch: 10 }, { wch: 14 }, { wch: 36 }, { wch: 28 },
  ];

  const wb = XLSX.utils.book_new();

  // 전체
  const wsAll = XLSX.utils.aoa_to_sheet([headers, ...results.map(toRow)]);
  wsAll['!cols'] = colWidths;
  XLSX.utils.book_append_sheet(wb, wsAll, '전체결과');

  // 매칭 성공
  const matched = results.filter(r => r.status === 'matched');
  if (matched.length > 0) {
    const ws = XLSX.utils.aoa_to_sheet([headers, ...matched.map(toRow)]);
    ws['!cols'] = colWidths;
    XLSX.utils.book_append_sheet(wb, ws, `✅ 신규매칭(${matched.length})`);
  }

  // 모호
  const ambiguous = results.filter(r => r.status === 'ambiguous');
  if (ambiguous.length > 0) {
    const ws = XLSX.utils.aoa_to_sheet([headers, ...ambiguous.map(toRow)]);
    ws['!cols'] = colWidths;
    XLSX.utils.book_append_sheet(wb, ws, `⚠️ 모호(${ambiguous.length})`);
  }

  // 여전히 미매칭
  const unmatched = results.filter(r => r.status === 'unmatched');
  if (unmatched.length > 0) {
    const ws = XLSX.utils.aoa_to_sheet([headers, ...unmatched.map(toRow)]);
    ws['!cols'] = colWidths;
    XLSX.utils.book_append_sheet(wb, ws, `❌ 미매칭(${unmatched.length})`);
  }

  // 변환타입별 통계
  const byType: Record<string, number> = {};
  for (const r of matched) {
    byType[r.transformType] = (byType[r.transformType] ?? 0) + 1;
  }
  const statRows = Object.entries(byType)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => [type, count]);
  const wsStat = XLSX.utils.aoa_to_sheet([
    ['변환타입', '매칭건수'],
    ...statRows,
    ['합계', matched.length],
  ]);
  wsStat['!cols'] = [{ wch: 26 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, wsStat, '변환타입통계');

  XLSX.writeFile(wb, outPath);
  return outPath;
}

// ─── 콘솔 요약 ─────────────────────────────────────────
function printSummary(results: ResultRow[], inputCount: number): void {
  const matched   = results.filter(r => r.status === 'matched');
  const ambiguous = results.filter(r => r.status === 'ambiguous');
  const unmatched = results.filter(r => r.status === 'unmatched');
  const pct = (n: number) => `${((n / inputCount) * 100).toFixed(1)}%`;

  // 변환타입별 매칭 집계
  const byType: Record<string, number> = {};
  for (const r of matched) {
    byType[r.transformType] = (byType[r.transformType] ?? 0) + 1;
  }

  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║     병원명 불일치 해소 결과 (v2)              ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║  재매칭 시도:          ${String(inputCount).padStart(4)}건                ║`);
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║  ✅ 신규 매칭 성공:    ${String(matched.length).padStart(4)}건  (${pct(matched.length).padStart(5)})    ║`);
  console.log(`║  ⚠️  여전히 모호:      ${String(ambiguous.length).padStart(4)}건  (${pct(ambiguous.length).padStart(5)})    ║`);
  console.log(`║  ❌ 여전히 미매칭:     ${String(unmatched.length).padStart(4)}건  (${pct(unmatched.length).padStart(5)})    ║`);
  console.log('╠══════════════════════════════════════════════╣');
  console.log('║  📋 변환 방법별 성공 건수                      ║');
  for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    const label = type.padEnd(22);
    console.log(`║    ${label}: ${String(count).padStart(4)}건               ║`);
  }
  console.log('╠══════════════════════════════════════════════╣');
  const hasEmail = matched.filter(r => r.dbExistingEmail).length;
  const noEmail  = matched.filter(r => !r.dbExistingEmail).length;
  console.log(`║  DB 이미 이메일 있음:  ${String(hasEmail).padStart(4)}건               ║`);
  console.log(`║  DB 이메일 없음(신규): ${String(noEmail).padStart(4)}건               ║`);
  console.log('╚══════════════════════════════════════════════╝');
}

// ─── 메인 ──────────────────────────────────────────────
async function main(): Promise<void> {
  const args   = process.argv.slice(2);
  const getArg = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };

  const outputDir  = getArg('--output') ?? path.resolve(__dirname, '../../output');
  const resultFile = getArg('--result') ?? findLatestResultFile(outputDir);

  log.info(`Result file: ${resultFile}`);

  // 1. 기존 결과 파싱 (미매칭/모호만)
  const rows = parseResultExcel(resultFile);
  if (rows.length === 0) {
    console.log('재매칭 대상 없음 (미매칭/모호 행이 없습니다)');
    return;
  }

  // 2. DB 로드
  const hospitals = await loadHospitals();

  // 3. 이름 인덱스 구성
  const nameIndex = new Map<string, DbHospital[]>();
  for (const h of hospitals) {
    if (!nameIndex.has(h.normalizedName)) nameIndex.set(h.normalizedName, []);
    nameIndex.get(h.normalizedName)!.push(h);
  }

  // 4. 변환 파이프라인으로 재매칭
  log.info(`Matching ${rows.length} rows with transformation pipeline...`);
  const results = rows.map(row => matchWithTransform(row, hospitals, nameIndex));

  // 5. 요약 출력
  printSummary(results, rows.length);

  // 6. Excel 출력
  const outPath = writeResultExcel(results, outputDir);
  console.log(`\n📁 결과 파일: ${outPath}`);
}

main().catch(err => {
  console.error('오류:', err.message);
  process.exit(1);
});
