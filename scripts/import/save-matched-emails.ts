/**
 * 매칭 이메일 Supabase 저장 + 미매칭 Excel 출력
 *
 * v1/v2/v3 결과 Excel에서:
 *   - 매칭 행 → hospital_emails 테이블 저장 + hospitals.email 업데이트
 *   - 미매칭/모호 행 + 이메일 없는 매칭 행 → Excel 파일 출력
 *
 * 실행:
 *   # 미리보기 (dry-run, 기본)
 *   npx tsx scripts/import/save-matched-emails.ts
 *
 *   # 실제 저장
 *   npx tsx scripts/import/save-matched-emails.ts --execute
 *
 *   # 파일 직접 지정
 *   npx tsx scripts/import/save-matched-emails.ts --v1 <path> --v2 <path> --v3 <path>
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const log = createLogger('save-matched-emails');

// ─── 타입 ──────────────────────────────────────────────
interface MatchedRow {
  // 원본 Excel 필드
  rowIndex: number;
  hospitalName: string;
  directorName: string;
  directorEmail: string;
  taxEmail: string;
  phone: string;
  address: string;
  // 매칭 정보
  status: 'matched' | 'ambiguous' | 'unmatched';
  matchedFields: string;
  nameMatchType: string;   // exact / fuzzy / none
  nameScore: string;
  transformedName: string;
  transformType: string;
  // DB 병원 정보
  dbHospitalId: string;
  dbHospitalName: string;
  dbExistingEmail: string;
  // 소스 파일명
  sourceFile: string;
}

interface EmailRecord {
  hospital_id: string;
  email: string;
  email_type: 'director' | 'tax_invoice';
  source_file: string;
  original_hospital_name: string;
  transformed_name: string;
  transform_type: string;
  matched_fields: string;
  confidence: 'HIGH' | 'MEDIUM';
  director_name: string;
  is_primary: boolean;
}

interface UnmatchedExcelRow {
  rowIndex: number;
  hospitalName: string;
  directorName: string;
  directorEmail: string;
  taxEmail: string;
  phone: string;
  address: string;
  reason: string;
}

// ─── 이메일 검증 ───────────────────────────────────────
function isValidEmail(email: string): boolean {
  if (!email || email.length < 5) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

// ─── 신뢰도 판정 ───────────────────────────────────────
function getConfidence(row: MatchedRow): 'HIGH' | 'MEDIUM' {
  if (row.nameMatchType === 'exact' || row.nameScore === '1.000') return 'HIGH';
  return 'MEDIUM';
}

// ─── 결과 파일 자동 탐지 ──────────────────────────────
function findLatestFile(outputDir: string, prefix: string): string | null {
  try {
    const files = readdirSync(outputDir)
      .filter(f => f.startsWith(prefix) && f.endsWith('.xlsx') && !f.startsWith('~$'))
      .sort().reverse();
    return files.length > 0 ? path.join(outputDir, files[0]) : null;
  } catch {
    return null;
  }
}

// ─── Excel 파싱 (v1/v2/v3 공통) ───────────────────────
function parseResultExcel(filePath: string, sourceFile: string): MatchedRow[] {
  log.info(`Parsing: ${path.basename(filePath)}`);
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]]; // 전체 결과 시트
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet);

  const result: MatchedRow[] = [];
  for (const r of rows) {
    const status = r['매칭상태'] ?? '';
    const matchStatus: 'matched' | 'ambiguous' | 'unmatched' =
      status.includes('매칭') && !status.includes('미매칭') ? 'matched'
      : status.includes('모호') ? 'ambiguous'
      : 'unmatched';

    const hospitalName = (r['병원명(엑셀)'] ?? '').toString().trim();
    if (!hospitalName) continue;

    result.push({
      rowIndex:        Number(r['행번호']) || 0,
      hospitalName,
      directorName:    (r['원장명'] ?? r['원장명(엑셀)'] ?? '').toString().trim(),
      directorEmail:   (r['이메일'] ?? r['이메일(엑셀)'] ?? '').toString().trim(),
      taxEmail:        (r['세금계산서이메일'] ?? '').toString().trim(),
      phone:           (r['전화번호'] ?? r['전화번호(엑셀)'] ?? '').toString().trim(),
      address:         (r['주소'] ?? r['주소(엑셀)'] ?? '').toString().trim(),
      status:          matchStatus,
      matchedFields:   (r['매칭항목'] ?? r['매칭된항목'] ?? '').toString().trim(),
      nameMatchType:   (r['이름매칭방식'] ?? '').toString().trim(),
      nameScore:       (r['이름유사도'] ?? '0').toString().trim(),
      transformedName: (r['변환이름'] ?? r['변환된이름'] ?? hospitalName).toString().trim(),
      transformType:   (r['변환타입'] ?? 'original').toString().trim(),
      dbHospitalId:    (r['DB병원ID'] ?? '').toString().trim(),
      dbHospitalName:  (r['DB병원명'] ?? '').toString().trim(),
      dbExistingEmail: (r['DB기존이메일'] ?? '').toString().trim(),
      sourceFile,
    });
  }

  const matched = result.filter(r => r.status === 'matched');
  const ambiguous = result.filter(r => r.status === 'ambiguous');
  const unmatched = result.filter(r => r.status === 'unmatched');
  log.info(`  → 매칭 ${matched.length}건 / 모호 ${ambiguous.length}건 / 미매칭 ${unmatched.length}건`);
  return result;
}

// ─── 저장용 레코드 생성 ────────────────────────────────
function buildEmailRecords(rows: MatchedRow[]): {
  toSave: EmailRecord[];
  toExcel: UnmatchedExcelRow[];
} {
  const toSave: EmailRecord[] = [];
  const toExcel: UnmatchedExcelRow[] = [];
  const seen = new Set<string>(); // hospital_id::email 중복 방지

  for (const row of rows) {
    // 미매칭/모호 → Excel
    if (row.status !== 'matched') {
      toExcel.push({
        rowIndex:     row.rowIndex,
        hospitalName: row.hospitalName,
        directorName: row.directorName,
        directorEmail: row.directorEmail,
        taxEmail:     row.taxEmail,
        phone:        row.phone,
        address:      row.address,
        reason:       row.status === 'ambiguous'
          ? `⚠️ 모호 (변환: ${row.transformedName})`
          : `❌ 미매칭`,
      });
      continue;
    }

    if (!row.dbHospitalId) {
      toExcel.push({
        rowIndex: row.rowIndex, hospitalName: row.hospitalName,
        directorName: row.directorName, directorEmail: row.directorEmail,
        taxEmail: row.taxEmail, phone: row.phone, address: row.address,
        reason: '✅ 매칭됐으나 DB ID 없음',
      });
      continue;
    }

    const confidence = getConfidence(row);
    const base: Omit<EmailRecord, 'email' | 'email_type' | 'is_primary'> = {
      hospital_id:            row.dbHospitalId,
      source_file:            row.sourceFile,
      original_hospital_name: row.hospitalName,
      transformed_name:       row.transformedName,
      transform_type:         row.transformType,
      matched_fields:         row.matchedFields,
      confidence,
      director_name:          row.directorName,
    };

    let hasEmail = false;

    // director_email 처리
    if (isValidEmail(row.directorEmail)) {
      const key = `${row.dbHospitalId}::${row.directorEmail.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        // PRIMARY 여부: 기존 DB 이메일 없고 HIGH confidence
        const isPrimary = !row.dbExistingEmail && confidence === 'HIGH';
        toSave.push({ ...base, email: row.directorEmail.toLowerCase(), email_type: 'director', is_primary: isPrimary });
        hasEmail = true;
      }
    }

    // tax_invoice_email 처리 (director_email과 다른 경우만)
    if (isValidEmail(row.taxEmail) && row.taxEmail.toLowerCase() !== row.directorEmail.toLowerCase()) {
      const key = `${row.dbHospitalId}::${row.taxEmail.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        toSave.push({ ...base, email: row.taxEmail.toLowerCase(), email_type: 'tax_invoice', is_primary: false });
        hasEmail = true;
      }
    }

    // 매칭됐지만 이메일 없는 경우
    if (!hasEmail) {
      toExcel.push({
        rowIndex: row.rowIndex, hospitalName: row.hospitalName,
        directorName: row.directorName, directorEmail: row.directorEmail,
        taxEmail: row.taxEmail, phone: row.phone, address: row.address,
        reason: `✅ 매칭됨 (${row.dbHospitalName}) 그러나 유효 이메일 없음`,
      });
    }
  }

  return { toSave, toExcel };
}

// ─── Supabase 저장 ─────────────────────────────────────
async function saveToSupabase(records: EmailRecord[], dryRun: boolean): Promise<{
  inserted: number;
  skipped: number;
  hospitalsUpdated: number;
}> {
  if (dryRun) {
    const primary = records.filter(r => r.is_primary);
    log.info(`[DRY-RUN] hospital_emails 저장 예정: ${records.length}건`);
    log.info(`[DRY-RUN] hospitals.email 업데이트 예정: ${primary.length}건`);
    return { inserted: 0, skipped: 0, hospitalsUpdated: 0 };
  }

  let inserted = 0;
  let skipped = 0;

  // upsert (중복 시 skip — ON CONFLICT DO NOTHING과 동일)
  const BATCH = 50;
  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH);
    const { data, error } = await supabase
      .from('hospital_emails')
      .upsert(batch, { onConflict: 'hospital_id,email', ignoreDuplicates: true })
      .select('id');

    if (error) {
      log.info(`배치 오류 (${i}~${i + BATCH}): ${error.message}`);
      skipped += batch.length;
    } else {
      inserted += data?.length ?? 0;
      skipped += batch.length - (data?.length ?? 0);
    }
  }

  // hospitals.email 업데이트 (is_primary=true 인 것만)
  const primaries = records.filter(r => r.is_primary);
  let hospitalsUpdated = 0;

  for (const p of primaries) {
    // 현재 hospitals.email 재확인 (저장 직전 체크)
    const { data: hosp } = await supabase
      .from('hospitals')
      .select('email')
      .eq('id', p.hospital_id)
      .single();

    if (hosp?.email) {
      // 이미 이메일 있음 → 건너뜀 (기존 데이터 보호)
      continue;
    }

    const { error } = await supabase
      .from('hospitals')
      .update({ email: p.email, updated_at: new Date().toISOString() })
      .eq('id', p.hospital_id);

    if (!error) hospitalsUpdated++;
  }

  log.info(`저장 완료: ${inserted}건 신규 / ${skipped}건 중복 스킵 / hospitals ${hospitalsUpdated}건 업데이트`);
  return { inserted, skipped, hospitalsUpdated };
}

// ─── 미매칭 Excel 출력 ─────────────────────────────────
function writeUnmatchedExcel(rows: UnmatchedExcelRow[], outputDir: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outPath   = path.join(outputDir, `unmatched-emails-${timestamp}.xlsx`);

  const headers = ['행번호', '병원명(엑셀)', '원장명', '이메일(원장)', '이메일(세금계산서)', '전화번호', '주소', '미매칭사유'];
  const data = rows.map(r => [
    r.rowIndex, r.hospitalName, r.directorName,
    r.directorEmail, r.taxEmail, r.phone, r.address, r.reason,
  ]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
  ws['!cols'] = [
    { wch: 6 }, { wch: 28 }, { wch: 10 }, { wch: 30 }, { wch: 30 },
    { wch: 14 }, { wch: 36 }, { wch: 36 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `미매칭(${rows.length})`);

  // 사유별 분류
  const ambiguous  = rows.filter(r => r.reason.includes('모호'));
  const unmatched  = rows.filter(r => r.reason.includes('미매칭'));
  const noEmail    = rows.filter(r => r.reason.includes('이메일 없음'));

  if (ambiguous.length > 0) {
    const ws2 = XLSX.utils.aoa_to_sheet([headers, ...ambiguous.map(r => [
      r.rowIndex, r.hospitalName, r.directorName, r.directorEmail, r.taxEmail, r.phone, r.address, r.reason,
    ])]);
    ws2['!cols'] = ws['!cols'];
    XLSX.utils.book_append_sheet(wb, ws2, `⚠️모호(${ambiguous.length})`);
  }
  if (unmatched.length > 0) {
    const ws3 = XLSX.utils.aoa_to_sheet([headers, ...unmatched.map(r => [
      r.rowIndex, r.hospitalName, r.directorName, r.directorEmail, r.taxEmail, r.phone, r.address, r.reason,
    ])]);
    ws3['!cols'] = ws['!cols'];
    XLSX.utils.book_append_sheet(wb, ws3, `❌미매칭(${unmatched.length})`);
  }
  if (noEmail.length > 0) {
    const ws4 = XLSX.utils.aoa_to_sheet([headers, ...noEmail.map(r => [
      r.rowIndex, r.hospitalName, r.directorName, r.directorEmail, r.taxEmail, r.phone, r.address, r.reason,
    ])]);
    ws4['!cols'] = ws['!cols'];
    XLSX.utils.book_append_sheet(wb, ws4, `이메일없음(${noEmail.length})`);
  }

  XLSX.writeFile(wb, outPath);
  return outPath;
}

// ─── 콘솔 요약 ─────────────────────────────────────────
function printSummary(
  allRows: MatchedRow[],
  toSave: EmailRecord[],
  toExcel: UnmatchedExcelRow[],
  saved: { inserted: number; skipped: number; hospitalsUpdated: number },
  dryRun: boolean,
): void {
  const matched = allRows.filter(r => r.status === 'matched').length;
  const tag = dryRun ? '[DRY-RUN]' : '[SAVED]';

  const high = toSave.filter(r => r.confidence === 'HIGH').length;
  const medium = toSave.filter(r => r.confidence === 'MEDIUM').length;
  const primary = toSave.filter(r => r.is_primary).length;
  const director = toSave.filter(r => r.email_type === 'director').length;
  const taxInv = toSave.filter(r => r.email_type === 'tax_invoice').length;

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║          이메일 저장 결과 요약                    ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  전체 처리 행수:        ${String(allRows.length).padStart(4)}건                  ║`);
  console.log(`║  매칭 성공:             ${String(matched).padStart(4)}건                  ║`);
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  ${tag} hospital_emails 저장:               ║`);
  console.log(`║    총 유효 이메일:      ${String(toSave.length).padStart(4)}건                  ║`);
  console.log(`║    └ 원장이메일:        ${String(director).padStart(4)}건                  ║`);
  console.log(`║    └ 세금계산서이메일:  ${String(taxInv).padStart(4)}건                  ║`);
  console.log(`║    └ HIGH 신뢰도:       ${String(high).padStart(4)}건                  ║`);
  console.log(`║    └ MEDIUM 신뢰도:     ${String(medium).padStart(4)}건                  ║`);
  if (!dryRun) {
    console.log(`║    신규 저장:           ${String(saved.inserted).padStart(4)}건                  ║`);
    console.log(`║    중복 스킵:           ${String(saved.skipped).padStart(4)}건                  ║`);
  }
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  ${tag} hospitals.email 업데이트:             ║`);
  console.log(`║    대상 (기존 NULL + HIGH):${String(primary).padStart(4)}건                  ║`);
  if (!dryRun) {
    console.log(`║    실제 업데이트:       ${String(saved.hospitalsUpdated).padStart(4)}건                  ║`);
  }
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  미매칭 Excel 출력:     ${String(toExcel.length).padStart(4)}건                  ║`);
  console.log('╚══════════════════════════════════════════════════╝');
}

// ─── 메인 ──────────────────────────────────────────────
async function main(): Promise<void> {
  const args    = process.argv.slice(2);
  const getArg  = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
  const hasFlag = (f: string) => args.includes(f);

  const dryRun    = !hasFlag('--execute');
  const outputDir = getArg('--output') ?? path.resolve(__dirname, '../../output');

  if (dryRun) {
    console.log('\n⚠️  DRY-RUN 모드 (실제 저장 안 함). 저장하려면 --execute 플래그 추가.');
  }

  // 결과 파일 탐지 (지정 or 자동)
  const v1File = getArg('--v1') ?? findLatestFile(outputDir, 'email-match-result-');
  const v2File = getArg('--v2') ?? findLatestFile(outputDir, 'name-disambig-result-');
  const v3File = getArg('--v3') ?? findLatestFile(outputDir, 'disambig-v3-result-');

  if (!v1File && !v2File && !v3File) {
    throw new Error('결과 파일을 찾을 수 없습니다. --v1/--v2/--v3 옵션으로 직접 지정하세요.');
  }

  // 파싱
  const allRows: MatchedRow[] = [];
  if (v1File) allRows.push(...parseResultExcel(v1File, path.basename(v1File)));
  if (v2File) allRows.push(...parseResultExcel(v2File, path.basename(v2File)));
  if (v3File) allRows.push(...parseResultExcel(v3File, path.basename(v3File)));

  log.info(`전체 처리 행수: ${allRows.length}건 (v1+v2+v3 합산)`);

  // 저장 레코드 생성
  const { toSave, toExcel } = buildEmailRecords(allRows);

  // 저장 미리보기
  log.info(`저장 대상 이메일: ${toSave.length}건`);
  log.info(`미매칭 Excel 출력: ${toExcel.length}건`);

  if (dryRun) {
    // 샘플 출력
    console.log('\n=== 저장 예정 샘플 (상위 10) ===');
    toSave.slice(0, 10).forEach(r =>
      console.log(`  [${r.confidence}] [${r.email_type}] ${r.email} → ${r.hospital_id.slice(0, 8)}... (${r.original_hospital_name})`)
    );
    console.log('\n=== 미매칭 Excel 예정 샘플 (상위 10) ===');
    toExcel.slice(0, 10).forEach(r =>
      console.log(`  ${r.hospitalName} | ${r.directorEmail} | ${r.reason}`)
    );
  }

  // Supabase 저장
  const saved = await saveToSupabase(toSave, dryRun);

  // 미매칭 Excel 출력 (항상)
  const excelPath = writeUnmatchedExcel(toExcel, outputDir);
  console.log(`\n📁 미매칭 Excel: ${excelPath}`);

  // 요약
  printSummary(allRows, toSave, toExcel, saved, dryRun);

  if (dryRun) {
    console.log('\n💡 실제 저장: npx tsx scripts/import/save-matched-emails.ts --execute');
  }
}

main().catch(err => {
  console.error('오류:', err.message);
  process.exit(1);
});
