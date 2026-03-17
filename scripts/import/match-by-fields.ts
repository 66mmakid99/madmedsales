/**
 * 병원 이메일 매칭 스크립트 v2 — 다중 필드 매칭
 *
 * Excel의 hospital_name을 기준으로 DB 매칭 후,
 * address / director_name / director_contact(전화) 중 하나라도 추가 매칭되면 확정
 *
 * 실행:
 *   npx tsx scripts/import/match-by-fields.ts [--file <path>] [--output <dir>]
 *
 * 결과: DB 저장 없음. Excel 파일로 출력.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx') as typeof import('xlsx');

import { supabase } from '../utils/supabase.js';
import { createLogger } from '../utils/logger.js';
import { normalizeHospitalName, normalizeDoctorName } from './lib/normalizer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const log = createLogger('match-by-fields');

// ─── 타입 ──────────────────────────────────────────────
interface ExcelRow {
  rowIndex: number;
  directorName: string;    // director_name
  directorEmail: string;   // director_email
  hospitalName: string;    // hospital_name
  taxEmail: string;        // tax_invoice_email
  phone: string;           // director_contact
  address: string;         // hospital_address
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

interface MatchedField {
  nameMatch: boolean;
  addressMatch: boolean;
  doctorMatch: boolean;
  phoneMatch: boolean;
}

interface ResultRow {
  rowIndex: number;
  // Excel 원본
  directorName: string;
  directorEmail: string;
  hospitalName: string;
  taxEmail: string;
  phone: string;
  address: string;
  // 매칭 결과
  status: MatchStatus;
  matchedFields: string;      // e.g. "이름, 주소" or "전화번호"
  nameMatchType: string;      // exact / fuzzy / none
  nameScore: string;
  // 매칭된 DB 병원 정보
  dbHospitalId: string;
  dbHospitalName: string;
  dbDoctorName: string;
  dbPhone: string;
  dbAddress: string;
  dbExistingEmail: string;
}

// ─── 전화번호 정규화 ────────────────────────────────────
function normalizePhone(phone: string): string {
  if (!phone) return '';
  return phone.replace(/[^0-9]/g, ''); // 숫자만
}

// ─── 주소 유사도 (시도+구군+도로명 부분 매칭) ───────────
function addressSimilarity(excelAddr: string, dbAddr: string): boolean {
  if (!excelAddr || !dbAddr) return false;
  const a = excelAddr.replace(/\s+/g, '').toLowerCase();
  const b = dbAddr.replace(/\s+/g, '').toLowerCase();
  // 한쪽이 다른 쪽을 포함하거나, 공통 15자 이상 substring 존재
  if (a.includes(b.slice(0, 12)) || b.includes(a.slice(0, 12))) return true;
  // 도로명 추출 비교
  const roadA = extractRoad(excelAddr);
  const roadB = extractRoad(dbAddr);
  return !!roadA && !!roadB && roadA === roadB;
}

function extractRoad(addr: string): string {
  const m = addr.match(/([가-힣0-9]+로|[가-힣0-9]+길)\s*\d+/);
  return m ? m[0].replace(/\s/g, '') : '';
}

// ─── Levenshtein 유사도 ─────────────────────────────────
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

// ─── Excel 파싱 ────────────────────────────────────────
function parseExcel(filePath: string): ExcelRow[] {
  log.info(`Reading: ${filePath}`);
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });

  const headers = rows[0].map(h => h?.toString().trim().toLowerCase() ?? '');
  log.info(`Headers: ${headers.join(', ')}`);

  const idx = {
    directorName:  headers.indexOf('director_name'),
    directorEmail: headers.indexOf('director_email'),
    hospitalName:  headers.indexOf('hospital_name'),
    taxEmail:      headers.indexOf('tax_invoice_email'),
    phone:         headers.indexOf('director_contact'),
    address:       headers.indexOf('hospital_address'),
  };

  const result: ExcelRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!Array.isArray(r)) continue;
    const hospitalName = r[idx.hospitalName]?.toString().trim() ?? '';
    if (!hospitalName) continue;
    result.push({
      rowIndex:      i + 1,
      directorName:  r[idx.directorName]?.toString().trim() ?? '',
      directorEmail: r[idx.directorEmail]?.toString().trim() ?? '',
      hospitalName,
      taxEmail:      r[idx.taxEmail]?.toString().trim() ?? '',
      phone:         r[idx.phone]?.toString().trim() ?? '',
      address:       r[idx.address]?.toString().trim() ?? '',
    });
  }
  log.info(`Parsed ${result.length} valid rows`);
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
    log.info(`  page ${page + 1}: ${all.length} loaded`);
  }

  log.info(`Total hospitals: ${all.length}`);
  return all;
}

// ─── 핵심 매칭 로직 ────────────────────────────────────
function matchRow(row: ExcelRow, hospitals: DbHospital[], nameIndex: Map<string, DbHospital[]>): ResultRow {
  const normName    = normalizeHospitalName(row.hospitalName);
  const normDoctor  = normalizeDoctorName(row.directorName);
  const normPhone   = normalizePhone(row.phone);

  const base: Omit<ResultRow, 'status' | 'matchedFields' | 'nameMatchType' | 'nameScore' | 'dbHospitalId' | 'dbHospitalName' | 'dbDoctorName' | 'dbPhone' | 'dbAddress' | 'dbExistingEmail'> = {
    rowIndex: row.rowIndex,
    directorName: row.directorName,
    directorEmail: row.directorEmail,
    hospitalName: row.hospitalName,
    taxEmail: row.taxEmail,
    phone: row.phone,
    address: row.address,
  };

  const makeResult = (
    status: MatchStatus,
    nameMatchType: string,
    nameScore: number,
    matched: DbHospital | null,
    fields: MatchedField,
  ): ResultRow => {
    const fieldLabels: string[] = [];
    if (fields.nameMatch) fieldLabels.push('병원명');
    if (fields.doctorMatch) fieldLabels.push('의사명');
    if (fields.phoneMatch) fieldLabels.push('전화번호');
    if (fields.addressMatch) fieldLabels.push('주소');

    return {
      ...base,
      status,
      matchedFields:    fieldLabels.join(', ') || '-',
      nameMatchType,
      nameScore:        nameScore.toFixed(3),
      dbHospitalId:     matched?.id ?? '',
      dbHospitalName:   matched?.name ?? '',
      dbDoctorName:     matched?.doctorName ?? '',
      dbPhone:          matched?.phone ?? '',
      dbAddress:        matched?.address ?? '',
      dbExistingEmail:  matched?.email ?? '',
    };
  };

  // ─ 1단계: 이름 exact ─
  const exactCandidates = nameIndex.get(normName) ?? [];

  let nameCandidates: Array<{ h: DbHospital; nameScore: number }> = [];

  if (exactCandidates.length > 0) {
    nameCandidates = exactCandidates.map(h => ({ h, nameScore: 1.0 }));
  } else {
    // ─ 2단계: fuzzy ─
    for (const h of hospitals) {
      const s = similarity(normName, h.normalizedName);
      if (s >= 0.85) nameCandidates.push({ h, nameScore: s });
    }
    nameCandidates.sort((a, b) => b.nameScore - a.nameScore);
    nameCandidates = nameCandidates.slice(0, 10); // 상위 10개만
  }

  if (nameCandidates.length === 0) {
    // 이름 매칭 실패 → 전화번호로 단독 검색
    if (normPhone.length >= 9) {
      const byPhone = hospitals.find(h => h.normalizedPhone === normPhone);
      if (byPhone) {
        return makeResult('matched', 'none', 0, byPhone, {
          nameMatch: false, doctorMatch: false, phoneMatch: true, addressMatch: false,
        });
      }
    }
    return makeResult('unmatched', 'none', 0, null, {
      nameMatch: false, doctorMatch: false, phoneMatch: false, addressMatch: false,
    });
  }

  // ─ 3단계: 추가 필드로 tiebreak/확정 ─
  interface Scored { h: DbHospital; nameScore: number; bonus: number; fields: MatchedField; }
  const scored: Scored[] = [];

  for (const { h, nameScore } of nameCandidates) {
    const doctorMatch  = !!(normDoctor && h.normalizedDoctorName &&
                           similarity(normDoctor, h.normalizedDoctorName) >= 0.85);
    const phoneMatch   = !!(normPhone.length >= 9 && h.normalizedPhone === normPhone);
    const addressMatch = addressSimilarity(row.address, h.address ?? '');

    const bonus = (doctorMatch ? 3 : 0) + (phoneMatch ? 3 : 0) + (addressMatch ? 2 : 0);

    scored.push({
      h,
      nameScore,
      bonus,
      fields: { nameMatch: nameScore >= 0.85, doctorMatch, phoneMatch, addressMatch },
    });
  }

  scored.sort((a, b) => (b.nameScore + b.bonus * 0.1) - (a.nameScore + a.bonus * 0.1));

  const top    = scored[0];
  const second = scored[1];

  const nameMatchType = top.nameScore === 1.0 ? 'exact' : 'fuzzy';

  // 단일 후보 OR 추가 필드로 명확히 구분되면 matched
  if (scored.length === 1) {
    return makeResult('matched', nameMatchType, top.nameScore, top.h, top.fields);
  }

  // 추가 필드 보너스로 1등이 2등보다 확실히 앞서면 matched
  const topTotal    = top.nameScore    + top.bonus    * 0.1;
  const secondTotal = second.nameScore + second.bonus * 0.1;

  if (top.bonus > 0 && topTotal - secondTotal >= 0.05) {
    return makeResult('matched', nameMatchType, top.nameScore, top.h, top.fields);
  }

  // 아직도 동점 → ambiguous
  return makeResult('ambiguous', nameMatchType, top.nameScore, null, {
    nameMatch: true, doctorMatch: false, phoneMatch: false, addressMatch: false,
  });
}

// ─── Excel 출력 ────────────────────────────────────────
function writeResultExcel(results: ResultRow[], outputDir: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outPath   = path.join(outputDir, `email-match-result-${timestamp}.xlsx`);

  const headers = [
    '행번호', '병원명(엑셀)', '원장명(엑셀)', '이메일(엑셀)', '세금계산서이메일',
    '전화번호(엑셀)', '주소(엑셀)',
    '매칭상태', '매칭된항목', '이름매칭방식', '이름유사도',
    'DB병원ID', 'DB병원명', 'DB원장명', 'DB전화번호', 'DB주소', 'DB기존이메일',
  ];

  const data = results.map(r => [
    r.rowIndex,
    r.hospitalName,
    r.directorName,
    r.directorEmail,
    r.taxEmail,
    r.phone,
    r.address,
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
  ]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);

  // 컬럼 너비
  ws['!cols'] = [
    { wch: 6 }, { wch: 24 }, { wch: 10 }, { wch: 28 }, { wch: 28 },
    { wch: 14 }, { wch: 36 },
    { wch: 10 }, { wch: 18 }, { wch: 10 }, { wch: 8 },
    { wch: 36 }, { wch: 24 }, { wch: 10 }, { wch: 14 }, { wch: 36 }, { wch: 28 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '매칭결과');

  // 매칭 상태별 시트
  const matched   = results.filter(r => r.status === 'matched');
  const ambiguous = results.filter(r => r.status === 'ambiguous');
  const unmatched = results.filter(r => r.status === 'unmatched');

  if (matched.length > 0) {
    const ws2 = XLSX.utils.aoa_to_sheet([headers, ...matched.map(r => [
      r.rowIndex, r.hospitalName, r.directorName, r.directorEmail, r.taxEmail,
      r.phone, r.address, '✅ 매칭', r.matchedFields, r.nameMatchType, r.nameScore,
      r.dbHospitalId, r.dbHospitalName, r.dbDoctorName, r.dbPhone, r.dbAddress, r.dbExistingEmail,
    ])]);
    ws2['!cols'] = ws['!cols'];
    XLSX.utils.book_append_sheet(wb, ws2, `✅ 매칭(${matched.length})`);
  }

  if (ambiguous.length > 0) {
    const ws3 = XLSX.utils.aoa_to_sheet([headers, ...ambiguous.map(r => [
      r.rowIndex, r.hospitalName, r.directorName, r.directorEmail, r.taxEmail,
      r.phone, r.address, '⚠️ 모호', r.matchedFields, r.nameMatchType, r.nameScore,
      r.dbHospitalId, r.dbHospitalName, r.dbDoctorName, r.dbPhone, r.dbAddress, r.dbExistingEmail,
    ])]);
    ws3['!cols'] = ws['!cols'];
    XLSX.utils.book_append_sheet(wb, ws3, `⚠️ 모호(${ambiguous.length})`);
  }

  if (unmatched.length > 0) {
    const ws4 = XLSX.utils.aoa_to_sheet([headers, ...unmatched.map(r => [
      r.rowIndex, r.hospitalName, r.directorName, r.directorEmail, r.taxEmail,
      r.phone, r.address, '❌ 미매칭', '-', '-', '-', '', '', '', '', '', '',
    ])]);
    ws4['!cols'] = ws['!cols'];
    XLSX.utils.book_append_sheet(wb, ws4, `❌ 미매칭(${unmatched.length})`);
  }

  XLSX.writeFile(wb, outPath);
  return outPath;
}

// ─── 콘솔 요약 출력 ────────────────────────────────────
function printSummary(results: ResultRow[]): void {
  const total     = results.length;
  const matched   = results.filter(r => r.status === 'matched');
  const ambiguous = results.filter(r => r.status === 'ambiguous');
  const unmatched = results.filter(r => r.status === 'unmatched');
  const pct = (n: number) => `${((n / total) * 100).toFixed(1)}%`;

  // 매칭 항목별 집계
  const byField = {
    '병원명만':      matched.filter(r => r.matchedFields === '병원명').length,
    '병원명+의사명': matched.filter(r => r.matchedFields.includes('병원명') && r.matchedFields.includes('의사명')).length,
    '병원명+전화':   matched.filter(r => r.matchedFields.includes('병원명') && r.matchedFields.includes('전화번호')).length,
    '병원명+주소':   matched.filter(r => r.matchedFields.includes('병원명') && r.matchedFields.includes('주소')).length,
    '전화번호만':    matched.filter(r => r.matchedFields === '전화번호').length,
    '복합매칭':      matched.filter(r => {
      const f = r.matchedFields;
      return f.includes('의사명') && f.includes('전화번호');
    }).length,
  };

  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║        병원 이메일 매칭 결과 요약           ║');
  console.log('╠════════════════════════════════════════════╣');
  console.log(`║  Excel 총 유효 행수:   ${String(total).padStart(4)}건              ║`);
  console.log('╠════════════════════════════════════════════╣');
  console.log(`║  ✅ 매칭 성공:         ${String(matched.length).padStart(4)}건  (${pct(matched.length).padStart(5)})    ║`);
  console.log(`║  ⚠️  모호 (수동검토):  ${String(ambiguous.length).padStart(4)}건  (${pct(ambiguous.length).padStart(5)})    ║`);
  console.log(`║  ❌ 미매칭:            ${String(unmatched.length).padStart(4)}건  (${pct(unmatched.length).padStart(5)})    ║`);
  console.log('╠════════════════════════════════════════════╣');
  console.log('║  📋 매칭 근거 분류                          ║');
  for (const [label, count] of Object.entries(byField)) {
    if (count > 0) {
      console.log(`║    ${label.padEnd(14)}: ${String(count).padStart(4)}건               ║`);
    }
  }
  console.log('╠════════════════════════════════════════════╣');

  // 이미 이메일 있는 경우
  const hasEmail = matched.filter(r => r.dbExistingEmail).length;
  const noEmail  = matched.filter(r => !r.dbExistingEmail).length;
  console.log(`║  DB 이미 이메일 있음:  ${String(hasEmail).padStart(4)}건               ║`);
  console.log(`║  DB 이메일 없음(신규): ${String(noEmail).padStart(4)}건               ║`);
  console.log('╚════════════════════════════════════════════╝');
}

// ─── 메인 ──────────────────────────────────────────────
async function main(): Promise<void> {
  const args   = process.argv.slice(2);
  const getArg = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };

  const filePath  = getArg('--file') ?? path.resolve(__dirname, '../../madmedsales_병원-이메일-이름-주소aasdsf.xlsx');
  const outputDir = getArg('--output') ?? path.resolve(__dirname, '../../output');

  // 1. Excel 파싱
  const rows = parseExcel(filePath);
  if (rows.length === 0) throw new Error('유효한 데이터 없음');

  // 2. DB 로드
  const hospitals = await loadHospitals();

  // 3. 이름 인덱스 구성
  const nameIndex = new Map<string, DbHospital[]>();
  for (const h of hospitals) {
    if (!nameIndex.has(h.normalizedName)) nameIndex.set(h.normalizedName, []);
    nameIndex.get(h.normalizedName)!.push(h);
  }

  // 4. 매칭
  log.info(`Matching ${rows.length} rows against ${hospitals.length} hospitals...`);
  const results = rows.map(row => matchRow(row, hospitals, nameIndex));

  // 5. 콘솔 요약
  printSummary(results);

  // 6. Excel 출력
  const outPath = writeResultExcel(results, outputDir);
  console.log(`\n📁 결과 파일: ${outPath}`);
}

main().catch(err => {
  console.error('오류:', err.message);
  process.exit(1);
});
