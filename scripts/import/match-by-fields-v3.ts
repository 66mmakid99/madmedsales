/**
 * 병원 매칭 v3 — 모호건 지역 tiebreak + 쉼표 구분자
 *
 * v2 결과 Excel의 미매칭/모호 행에 대해:
 *   1. 원본명에서 지역(sido/sigungu) hint 추출
 *   2. 변환 후보로 매칭 시도 (쉼표 구분자 포함)
 *   3. 모호 후보를 지역 tiebreak로 확정
 *
 * 실행:
 *   npx tsx scripts/import/match-by-fields-v3.ts [--result <xlsx>] [--output <dir>]
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
import { extractLocation, sidoMatches, sigunguMatches } from './lib/location-extractor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const log = createLogger('match-by-fields-v3');

// ─── 타입 ──────────────────────────────────────────────
interface InputRow {
  rowIndex: number;
  hospitalName: string;
  directorName: string;
  directorEmail: string;
  taxEmail: string;
  phone: string;
  address: string;
  originalStatus: string;
  prevTransformType: string;
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
  hospitalName: string;
  directorName: string;
  directorEmail: string;
  taxEmail: string;
  phone: string;
  address: string;
  originalStatus: string;
  // 새 변환 정보
  transformedName: string;
  transformType: string;
  locationHint: string;
  // 매칭 결과
  status: MatchStatus;
  matchedFields: string;
  nameMatchType: string;
  nameScore: string;
  tiebreakedByLocation: boolean;
  // DB 정보
  dbHospitalId: string;
  dbHospitalName: string;
  dbDoctorName: string;
  dbPhone: string;
  dbAddress: string;
  dbSido: string;
  dbSigungu: string;
  dbExistingEmail: string;
}

// ─── 유틸 ─────────────────────────────────────────────
function normalizePhone(p: string): string {
  return p ? p.replace(/[^0-9]/g, '') : '';
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
  const ra = extractRoad(a), rb = extractRoad(b);
  return !!ra && !!rb && ra === rb;
}

// ─── DB 로드 ───────────────────────────────────────────
async function loadHospitals(): Promise<DbHospital[]> {
  log.info('Loading hospitals...');
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
        id: h.id, name: h.name,
        normalizedName: normalizeHospitalName(h.name),
        email: h.email,
        doctorName: h.doctor_name,
        normalizedDoctorName: h.doctor_name ? normalizeDoctorName(h.doctor_name) : null,
        phone: h.phone,
        normalizedPhone: h.phone ? normalizePhone(h.phone) : null,
        address: h.address,
        sido: h.sido, sigungu: h.sigungu,
      });
    }

    if (data.length < PAGE_SIZE) break;
    page++;
    if (page % 5 === 0) log.info(`  page ${page}: ${all.length} loaded`);
  }

  log.info(`Total hospitals: ${all.length}`);
  return all;
}

// ─── 입력 파싱 ─────────────────────────────────────────
function findLatestFile(outputDir: string, prefix: string): string {
  const files = readdirSync(outputDir)
    .filter(f => f.startsWith(prefix) && f.endsWith('.xlsx'))
    .sort().reverse();
  if (files.length === 0) throw new Error(`파일 없음 (${prefix}*)`);
  return path.join(outputDir, files[0]);
}

function parseInputExcel(filePath: string): InputRow[] {
  log.info(`Reading: ${filePath}`);
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet);

  const result: InputRow[] = [];
  for (const r of rows) {
    const status = r['매칭상태'] ?? '';
    if (!status.includes('미매칭') && !status.includes('모호')) continue;
    const hospitalName = r['병원명(엑셀)']?.toString().trim() ?? '';
    if (!hospitalName) continue;

    result.push({
      rowIndex:         Number(r['행번호']) || 0,
      hospitalName,
      directorName:     r['원장명']?.toString().trim() ?? r['원장명(엑셀)']?.toString().trim() ?? '',
      directorEmail:    r['이메일']?.toString().trim() ?? r['이메일(엑셀)']?.toString().trim() ?? '',
      taxEmail:         r['세금계산서이메일']?.toString().trim() ?? '',
      phone:            r['전화번호']?.toString().trim() ?? r['전화번호(엑셀)']?.toString().trim() ?? '',
      address:          r['주소']?.toString().trim() ?? r['주소(엑셀)']?.toString().trim() ?? '',
      originalStatus:   status,
      prevTransformType: r['변환타입']?.toString().trim() ?? '',
    });
  }

  log.info(`재처리 대상: ${result.length}건`);
  return result;
}

// ─── 핵심 매칭 (지역 tiebreak 포함) ──────────────────
interface CandidateScored {
  h: DbHospital;
  nameScore: number;
  bonus: number;
  fields: string[];
}

function scoreCandidate(
  h: DbHospital,
  nameScore: number,
  row: InputRow,
): CandidateScored {
  const normDoctor = normalizeDoctorName(row.directorName);
  const normPhone  = normalizePhone(row.phone);

  const doctorMatch  = !!(normDoctor && h.normalizedDoctorName &&
                         similarity(normDoctor, h.normalizedDoctorName) >= 0.85);
  const phoneMatch   = !!(normPhone.length >= 9 && h.normalizedPhone === normPhone);
  const addressMatch = addressSimilarity(row.address, h.address ?? '');

  const fields: string[] = ['병원명'];
  if (doctorMatch) fields.push('의사명');
  if (phoneMatch) fields.push('전화번호');
  if (addressMatch) fields.push('주소');

  const bonus = (doctorMatch ? 3 : 0) + (phoneMatch ? 3 : 0) + (addressMatch ? 2 : 0);
  return { h, nameScore, bonus, fields };
}

function matchWithLocation(
  row: InputRow,
  hospitals: DbHospital[],
  nameIndex: Map<string, DbHospital[]>,
): ResultRow {
  const candidates = generateCandidates(row.hospitalName);
  const locationHint = extractLocation(row.hospitalName);
  const hintStr = locationHint.sido
    ? `${locationHint.sido}${locationHint.sigungu ? ' ' + locationHint.sigungu : ''}`
    : locationHint.sigungu ?? '';

  const base = {
    rowIndex: row.rowIndex,
    hospitalName: row.hospitalName,
    directorName: row.directorName,
    directorEmail: row.directorEmail,
    taxEmail: row.taxEmail,
    phone: row.phone,
    address: row.address,
    originalStatus: row.originalStatus,
    locationHint: hintStr,
  };

  const makeResult = (
    status: MatchStatus,
    cand: { name: string; transformType: string },
    scored: CandidateScored | null,
    tiebreakedByLocation: boolean,
  ): ResultRow => ({
    ...base,
    transformedName:      cand.name,
    transformType:        cand.transformType,
    status,
    matchedFields:        scored?.fields.join(', ') ?? '-',
    nameMatchType:        scored ? (scored.nameScore === 1.0 ? 'exact' : 'fuzzy') : 'none',
    nameScore:            scored?.nameScore.toFixed(3) ?? '0.000',
    tiebreakedByLocation,
    dbHospitalId:         scored?.h.id ?? '',
    dbHospitalName:       scored?.h.name ?? '',
    dbDoctorName:         scored?.h.doctorName ?? '',
    dbPhone:              scored?.h.phone ?? '',
    dbAddress:            scored?.h.address ?? '',
    dbSido:               scored?.h.sido ?? '',
    dbSigungu:            scored?.h.sigungu ?? '',
    dbExistingEmail:      scored?.h.email ?? '',
  });

  for (const cand of candidates) {
    const normName = normalizeHospitalName(cand.name);

    // 이름 후보 수집
    let nameCandidates: Array<{ h: DbHospital; nameScore: number }> = [];
    const exact = nameIndex.get(normName) ?? [];
    if (exact.length > 0) {
      nameCandidates = exact.map(h => ({ h, nameScore: 1.0 }));
    } else {
      for (const h of hospitals) {
        const s = similarity(normName, h.normalizedName);
        if (s >= 0.85) nameCandidates.push({ h, nameScore: s });
      }
      nameCandidates.sort((a, b) => b.nameScore - a.nameScore);
      nameCandidates = nameCandidates.slice(0, 10);
    }

    if (nameCandidates.length === 0) continue;

    // 전체 스코어링
    const scored: CandidateScored[] = nameCandidates.map(({ h, nameScore }) =>
      scoreCandidate(h, nameScore, row)
    );
    scored.sort((a, b) => (b.nameScore + b.bonus * 0.1) - (a.nameScore + a.bonus * 0.1));

    const top = scored[0];
    const nameMatchType = top.nameScore === 1.0 ? 'exact' : 'fuzzy';

    // 단일 후보
    if (scored.length === 1) {
      return makeResult('matched', cand, top, false);
    }

    // 추가 필드로 tiebreak
    const topTotal    = top.nameScore + top.bonus * 0.1;
    const second      = scored[1];
    const secondTotal = second.nameScore + second.bonus * 0.1;

    if (top.bonus > 0 && topTotal - secondTotal >= 0.05) {
      return makeResult('matched', cand, top, false);
    }

    // ─── 지역 tiebreak ────────────────────────────────
    if (locationHint.sido || locationHint.sigungu) {
      let regionFiltered = scored.filter(s => {
        const sidoOk  = !locationHint.sido    || sidoMatches(s.h.sido, locationHint.sido);
        const sigunguOk = !locationHint.sigungu || sigunguMatches(s.h.sigungu, locationHint.sigungu);
        return locationHint.sido && locationHint.sigungu
          ? sidoOk && sigunguOk
          : sidoOk || sigunguOk;
      });

      if (regionFiltered.length === 0 && locationHint.sigungu) {
        // sigungu만으로 재시도
        regionFiltered = scored.filter(s => sigunguMatches(s.h.sigungu, locationHint.sigungu!));
      }

      if (regionFiltered.length === 1) {
        return makeResult('matched', cand, regionFiltered[0], true);
      }
      if (regionFiltered.length > 1) {
        // 지역 필터 후에도 복수이면 필드 보너스 1위
        const topRegion = regionFiltered.sort(
          (a, b) => (b.nameScore + b.bonus * 0.1) - (a.nameScore + a.bonus * 0.1)
        )[0];
        if (topRegion.bonus > 0) {
          return makeResult('matched', cand, topRegion, true);
        }
        // 지역 필터 후 ambiguous
        return makeResult('ambiguous', cand, topRegion, true);
      }
    }

    // 지역 힌트 없거나 필터 실패 → ambiguous 기록하고 다음 후보 시도
  }

  // 모든 후보 실패 → 전화번호 단독 (마지막 수단)
  const normPhone = normalizePhone(row.phone);
  if (normPhone.length >= 9) {
    const byPhone = hospitals.find(h => h.normalizedPhone === normPhone);
    if (byPhone) {
      const s = scoreCandidate(byPhone, 0, row);
      s.fields = ['전화번호'];
      return makeResult('matched', { name: row.hospitalName, transformType: 'original' }, s, false);
    }
  }

  // 여전히 ambiguous가 있었으면 ambiguous 반환
  for (const cand of candidates) {
    const normName = normalizeHospitalName(cand.name);
    const nameCandidates: Array<{ h: DbHospital; nameScore: number }> = [];
    const exact = nameIndex.get(normName) ?? [];
    if (exact.length > 0) {
      nameCandidates.push(...exact.map(h => ({ h, nameScore: 1.0 })));
    } else {
      for (const h of hospitals) {
        const s = similarity(normName, h.normalizedName);
        if (s >= 0.85) nameCandidates.push({ h, nameScore: s });
      }
    }
    if (nameCandidates.length > 1) {
      const top = nameCandidates.sort((a, b) => b.nameScore - a.nameScore)[0];
      const s = scoreCandidate(top.h, top.nameScore, row);
      return makeResult('ambiguous', cand, s, false);
    }
  }

  return makeResult('unmatched', { name: row.hospitalName, transformType: 'original' }, null, false);
}

// ─── Excel 출력 ────────────────────────────────────────
function writeResultExcel(results: ResultRow[], outputDir: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outPath   = path.join(outputDir, `disambig-v3-result-${timestamp}.xlsx`);

  const headers = [
    '행번호', '병원명(엑셀)', '원장명', '이메일', '세금계산서이메일',
    '전화번호', '주소', '기존상태',
    '변환이름', '변환타입', '지역힌트', '지역tiebreak여부',
    '매칭상태', '매칭항목', '이름매칭방식', '이름유사도',
    'DB병원ID', 'DB병원명', 'DB원장명', 'DB전화번호', 'DB주소', 'DB시도', 'DB시군구', 'DB기존이메일',
  ];

  const toRow = (r: ResultRow) => [
    r.rowIndex, r.hospitalName, r.directorName, r.directorEmail, r.taxEmail,
    r.phone, r.address, r.originalStatus,
    r.transformedName, r.transformType, r.locationHint, r.tiebreakedByLocation ? 'Y' : '',
    r.status === 'matched' ? '✅ 매칭' : r.status === 'ambiguous' ? '⚠️ 모호' : '❌ 미매칭',
    r.matchedFields, r.nameMatchType, r.nameScore,
    r.dbHospitalId, r.dbHospitalName, r.dbDoctorName, r.dbPhone, r.dbAddress,
    r.dbSido, r.dbSigungu, r.dbExistingEmail,
  ];

  const colWidths = [
    { wch: 6 }, { wch: 30 }, { wch: 10 }, { wch: 28 }, { wch: 28 },
    { wch: 14 }, { wch: 36 }, { wch: 10 },
    { wch: 28 }, { wch: 22 }, { wch: 14 }, { wch: 10 },
    { wch: 10 }, { wch: 20 }, { wch: 10 }, { wch: 8 },
    { wch: 36 }, { wch: 24 }, { wch: 10 }, { wch: 14 }, { wch: 36 }, { wch: 10 }, { wch: 14 }, { wch: 28 },
  ];

  const wb = XLSX.utils.book_new();

  const wsAll = XLSX.utils.aoa_to_sheet([headers, ...results.map(toRow)]);
  wsAll['!cols'] = colWidths;
  XLSX.utils.book_append_sheet(wb, wsAll, '전체결과');

  const matched = results.filter(r => r.status === 'matched');
  if (matched.length > 0) {
    const ws = XLSX.utils.aoa_to_sheet([headers, ...matched.map(toRow)]);
    ws['!cols'] = colWidths;
    XLSX.utils.book_append_sheet(wb, ws, `✅ 신규매칭(${matched.length})`);
  }

  const tiebreakedByLoc = matched.filter(r => r.tiebreakedByLocation);
  if (tiebreakedByLoc.length > 0) {
    const ws = XLSX.utils.aoa_to_sheet([headers, ...tiebreakedByLoc.map(toRow)]);
    ws['!cols'] = colWidths;
    XLSX.utils.book_append_sheet(wb, ws, `📍 지역tiebreak(${tiebreakedByLoc.length})`);
  }

  const ambiguous = results.filter(r => r.status === 'ambiguous');
  if (ambiguous.length > 0) {
    const ws = XLSX.utils.aoa_to_sheet([headers, ...ambiguous.map(toRow)]);
    ws['!cols'] = colWidths;
    XLSX.utils.book_append_sheet(wb, ws, `⚠️ 모호(${ambiguous.length})`);
  }

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
  const wsStat = XLSX.utils.aoa_to_sheet([
    ['변환타입', '매칭건수'],
    ...Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([t, c]) => [t, c]),
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
  const byLoc     = matched.filter(r => r.tiebreakedByLocation);
  const pct = (n: number) => `${((n / inputCount) * 100).toFixed(1)}%`;

  const byType: Record<string, number> = {};
  for (const r of matched) byType[r.transformType] = (byType[r.transformType] ?? 0) + 1;

  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║     병원 매칭 v3 결과 (지역 tiebreak)        ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║  재매칭 시도:          ${String(inputCount).padStart(4)}건                ║`);
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║  ✅ 신규 매칭 성공:    ${String(matched.length).padStart(4)}건  (${pct(matched.length).padStart(5)})    ║`);
  console.log(`║    └ 지역 tiebreak:   ${String(byLoc.length).padStart(4)}건               ║`);
  console.log(`║  ⚠️  여전히 모호:      ${String(ambiguous.length).padStart(4)}건  (${pct(ambiguous.length).padStart(5)})    ║`);
  console.log(`║  ❌ 여전히 미매칭:     ${String(unmatched.length).padStart(4)}건  (${pct(unmatched.length).padStart(5)})    ║`);
  console.log('╠══════════════════════════════════════════════╣');
  console.log('║  📋 변환 방법별 성공                          ║');
  for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`║    ${type.padEnd(22)}: ${String(count).padStart(4)}건               ║`);
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
  // v2 결과 파일 우선, 없으면 v1 결과
  const resultFile = getArg('--result') ?? (() => {
    try { return findLatestFile(outputDir, 'name-disambig-result-'); }
    catch { return findLatestFile(outputDir, 'email-match-result-'); }
  })();

  log.info(`Input: ${resultFile}`);

  const rows = parseInputExcel(resultFile);
  if (rows.length === 0) {
    console.log('재처리 대상 없음');
    return;
  }

  const hospitals = await loadHospitals();
  const nameIndex = new Map<string, DbHospital[]>();
  for (const h of hospitals) {
    if (!nameIndex.has(h.normalizedName)) nameIndex.set(h.normalizedName, []);
    nameIndex.get(h.normalizedName)!.push(h);
  }

  log.info(`Matching ${rows.length} rows (with location tiebreak)...`);
  const results = rows.map(row => matchWithLocation(row, hospitals, nameIndex));

  printSummary(results, rows.length);

  const outPath = writeResultExcel(results, outputDir);
  console.log(`\n📁 결과 파일: ${outPath}`);
}

main().catch(err => {
  console.error('오류:', err.message);
  process.exit(1);
});
