/**
 * 주소 기반 매칭 결과 → Supabase 저장
 *
 * match-by-address-*.xlsx의 '매칭' 시트를 읽어:
 *   - 이메일 있는 행 → hospital_emails 테이블 upsert (confidence='MEDIUM')
 *   - 주소점수 1.0 + 이름유사도 0.80 이상 → 'HIGH'
 *
 * 실행:
 *   npx tsx scripts/import/save-address-matched.ts          # dry-run
 *   npx tsx scripts/import/save-address-matched.ts --execute # 실제 저장
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
const log = createLogger('save-address-matched');

const EXECUTE = process.argv.includes('--execute');
const BATCH_SIZE = 50;

// ─── 타입 ─────────────────────────────────────────────
interface InputRow {
  rowIndex: number;
  hospitalName: string;
  directorName: string;
  directorEmail: string;
  taxEmail: string;
  addrScore: number;
  nameSim: number;
  dbHospitalId: string;
  dbHospitalName: string;
  dbExistingEmail: string;
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

// ─── 유틸 ─────────────────────────────────────────────
function isValidEmail(email: string): boolean {
  if (!email || email.length < 5) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function getConfidence(addrScore: number, nameSim: number): 'HIGH' | 'MEDIUM' {
  // 주소 완전 일치(1.0) + 이름 유사도 0.80 이상 → HIGH
  // 나머지 → MEDIUM
  if (addrScore >= 0.80 && nameSim >= 0.80) return 'HIGH';
  return 'MEDIUM';
}

function findLatestFile(dir: string, prefix: string): string | null {
  try {
    const files = readdirSync(dir)
      .filter(f => f.startsWith(prefix) && f.endsWith('.xlsx') && !f.startsWith('~$'))
      .sort().reverse();
    return files.length > 0 ? path.join(dir, files[0]) : null;
  } catch {
    return null;
  }
}

// ─── Excel 파싱 ────────────────────────────────────────
function parseAddressResultExcel(filePath: string): InputRow[] {
  log.info(`Reading: ${path.basename(filePath)}`);
  const wb = XLSX.readFile(filePath);

  // '매칭' 시트만 처리
  const sheetName = '매칭';
  if (!wb.SheetNames.includes(sheetName)) {
    log.warn(`'${sheetName}' 시트 없음`);
    return [];
  }
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet);

  const result: InputRow[] = [];
  for (const r of rows) {
    const hospitalName = r['병원명(엑셀)']?.toString().trim() ?? '';
    const dbHospitalId = r['DB병원ID']?.toString().trim() ?? '';
    if (!hospitalName || !dbHospitalId) continue;

    result.push({
      rowIndex:        Number(r['rowIndex']) || 0,
      hospitalName,
      directorName:    r['원장명']?.toString().trim() ?? '',
      directorEmail:   r['이메일']?.toString().trim() ?? '',
      taxEmail:        r['세금계산서이메일']?.toString().trim() ?? '',
      addrScore:       parseFloat(r['주소점수'] ?? '0') || 0,
      nameSim:         parseFloat(r['이름유사도'] ?? '0') || 0,
      dbHospitalId,
      dbHospitalName:  r['DB병원명']?.toString().trim() ?? '',
      dbExistingEmail: r['DB이메일']?.toString().trim() ?? '',
      sourceFile:      path.basename(filePath),
    });
  }

  log.info(`매칭 행: ${result.length}건`);
  return result;
}

// ─── 이메일 레코드 빌드 ────────────────────────────────
function buildEmailRecords(rows: InputRow[]): EmailRecord[] {
  const records: EmailRecord[] = [];

  for (const row of rows) {
    const confidence = getConfidence(row.addrScore, row.nameSim);
    const base = {
      hospital_id:            row.dbHospitalId,
      source_file:            row.sourceFile,
      original_hospital_name: row.hospitalName,
      transformed_name:       row.hospitalName,
      transform_type:         'address_match',
      matched_fields:         `주소(${row.addrScore.toFixed(2)})+이름유사도(${row.nameSim.toFixed(2)})`,
      confidence,
      director_name:          row.directorName,
      is_primary:             false,
    };

    if (isValidEmail(row.directorEmail)) {
      const isPrimary = !row.dbExistingEmail && confidence === 'HIGH';
      records.push({
        ...base,
        email:       row.directorEmail.trim(),
        email_type:  'director',
        is_primary:  isPrimary,
      });
    }

    if (isValidEmail(row.taxEmail) && row.taxEmail !== row.directorEmail) {
      records.push({
        ...base,
        email:       row.taxEmail.trim(),
        email_type:  'tax_invoice',
        is_primary:  false,
      });
    }
  }

  return records;
}

// ─── 배치 upsert ──────────────────────────────────────
async function upsertBatch(records: EmailRecord[]): Promise<number> {
  // 배치 내 (hospital_id, email) 중복 제거 — 먼저 나온 레코드 우선
  const seen = new Set<string>();
  const deduped = records.filter(r => {
    const key = `${r.hospital_id}:${r.email}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const { error } = await supabase
    .from('hospital_emails')
    .upsert(deduped, { onConflict: 'hospital_id,email' });

  if (error) {
    log.error(`upsert 오류: ${error.message}`);
    return 0;
  }
  return deduped.length;
}

// ─── hospitals.email 업데이트 ─────────────────────────
async function updateHospitalEmails(records: EmailRecord[]): Promise<number> {
  const primaryRecords = records.filter(r => r.is_primary && r.email_type === 'director');
  let updated = 0;

  for (const rec of primaryRecords) {
    const { error } = await supabase
      .from('hospitals')
      .update({ email: rec.email })
      .eq('id', rec.hospital_id)
      .is('email', null); // NULL인 경우만 업데이트

    if (!error) updated++;
  }

  return updated;
}

// ─── 메인 ─────────────────────────────────────────────
async function main(): Promise<void> {
  const outputDir = path.resolve(__dirname, '../../output');

  // --input 또는 최신 파일
  const args = process.argv.slice(2);
  const inputIdx = args.indexOf('--input');
  const inputFile = inputIdx >= 0
    ? args[inputIdx + 1]
    : findLatestFile(outputDir, 'match-by-address-');

  if (!inputFile) {
    log.error('입력 파일 없음. match-by-address-*.xlsx를 output/에 넣어주세요.');
    process.exit(1);
  }

  log.info(`[${EXECUTE ? '실제 저장' : 'DRY-RUN'}] 입력: ${path.basename(inputFile)}`);

  const rows = parseAddressResultExcel(inputFile);
  if (rows.length === 0) {
    log.warn('처리할 행 없음.');
    return;
  }

  const records = buildEmailRecords(rows);
  const highConf = records.filter(r => r.confidence === 'HIGH').length;
  const medConf  = records.filter(r => r.confidence === 'MEDIUM').length;
  const primary  = records.filter(r => r.is_primary).length;

  log.info(`이메일 레코드: ${records.length}건 (HIGH=${highConf}, MEDIUM=${medConf})`);
  log.info(`hospitals.email 업데이트 예정: ${primary}건`);

  if (!EXECUTE) {
    log.info('DRY-RUN 완료. 실제 저장하려면 --execute 플래그를 추가하세요.');
    log.info('샘플:');
    records.slice(0, 5).forEach(r =>
      log.info(`  [${r.confidence}] ${r.original_hospital_name} → ${r.email} (${r.email_type})`)
    );
    return;
  }

  // 실제 저장
  let totalSaved = 0;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const saved = await upsertBatch(batch);
    totalSaved += saved;
    log.info(`  upsert ${i + batch.length}/${records.length}건`);
  }

  const updatedHospitals = await updateHospitalEmails(records);

  log.info('─'.repeat(50));
  log.info(`hospital_emails 저장: ${totalSaved}건`);
  log.info(`hospitals.email 업데이트: ${updatedHospitals}건`);
  log.info('완료.');
}

main().catch(err => {
  log.error(err);
  process.exit(1);
});
