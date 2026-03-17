/**
 * 병원 이메일 매칭 스크립트
 *
 * Excel 파일의 병원 이메일을 DB hospitals 테이블과 매칭하여 업데이트
 *
 * 실행:
 *   npx tsx scripts/import/match-hospital-emails.ts            ← dry-run (기본)
 *   npx tsx scripts/import/match-hospital-emails.ts --execute  ← 실제 업데이트
 *   npx tsx scripts/import/match-hospital-emails.ts --execute --overwrite  ← 기존 덮어쓰기
 *
 * 옵션:
 *   --execute          실제 DB 업데이트 (없으면 dry-run)
 *   --overwrite        기존 이메일 덮어쓰기
 *   --threshold 0.85   fuzzy 임계값 (기본 0.85)
 *   --sido 서울         특정 시도만 처리
 *   --dept 피부과       특정 진료과목만 대상 (기본: 피부과)
 *   --all-dept         진료과목 필터 없이 전체 병원 대상
 *   --file <path>      Excel 파일 경로
 *   --output <dir>     CSV 출력 디렉토리 (기본: output/)
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { supabase } from '../utils/supabase.js';
import { createLogger } from '../utils/logger.js';
import { parseExcel } from './lib/excel-parser.js';
import { normalizeHospitalName, normalizeDoctorName } from './lib/normalizer.js';
import { MatchingEngine } from './lib/matcher.js';
import { decideAction, batchUpdate, type UpdateRecord } from './lib/updater.js';
import { buildReportRows, writeCsv, printSummary } from './lib/reporter.js';
import type { HospitalRecord, MatchOptions } from './lib/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const log = createLogger('main');

function parseArgs(): MatchOptions & { filePath: string; outputDir: string } {
  const args = process.argv.slice(2);
  const get  = (flag: string) => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : undefined;
  };

  return {
    dryRun:         !args.includes('--execute'),
    overwrite:      args.includes('--overwrite'),
    fuzzyThreshold: parseFloat(get('--threshold') ?? '0.85'),
    sido:           get('--sido') ?? null,
    // 피부과+성형외과 모두 포함 (기본값). --dept 피부과 로 좁히기 가능
    dept:           get('--dept') ?? null,
    batchSize:      50,
    filePath: get('--file') ?? path.resolve(
      __dirname,
      '../../../docs/madmedsales_병원-이메일-이름-주소.xlsx'
    ),
    outputDir: get('--output') ?? path.resolve(__dirname, '../../output'),
  };
}

async function loadHospitals(dept: string | null): Promise<HospitalRecord[]> {
  log.info(`Loading hospitals from DB${dept ? ` (department=${dept})` : ' (전체)'}...`);

  // Supabase 기본 limit(1000) 우회: 페이지네이션으로 전체 로드
  const PAGE_SIZE = 1000;
  let allData: typeof data = [];
  let page = 0;

  while (true) {
    let query = supabase
      .from('hospitals')
      .select('id, name, email, doctor_name, address, sido, sigungu')
      .eq('status', 'active');

    // dept 지정 시 해당 과목만, 미지정 시 피부과+성형외과 (시술병원 전체)
    if (dept) {
      query = query.eq('department', dept);
    } else {
      query = query.in('department', ['피부과', '성형외과']);
    }

    const { data, error } = await query
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (error) throw new Error(`Failed to load hospitals (page ${page}): ${error.message}`);
    if (!data || data.length === 0) break;

    allData = allData ? [...allData, ...data] : data;
    if (data.length < PAGE_SIZE) break;
    page++;
    log.info(`  Loaded page ${page}: ${allData.length} hospitals so far...`);
  }

  const data = allData;
  if (!data || data.length === 0) throw new Error('No active hospitals found in DB');

  const records: HospitalRecord[] = data.map((h: {
    id: string;
    name: string;
    email: string | null;
    doctor_name: string | null;
    address: string | null;
    sido: string | null;
    sigungu: string | null;
  }) => ({
    id:                   h.id,
    name:                 h.name,
    normalizedName:       normalizeHospitalName(h.name),
    email:                h.email,
    doctorName:           h.doctor_name,
    normalizedDoctorName: h.doctor_name ? normalizeDoctorName(h.doctor_name) : null,
    address:              h.address,
    sido:                 h.sido,
    sigungu:              h.sigungu,
  }));

  log.info(`Loaded ${records.length} active hospitals`);
  return records;
}

async function main(): Promise<void> {
  const options = parseArgs();

  console.log('\n=== Options ===');
  console.log(`  dry-run:   ${options.dryRun}`);
  console.log(`  overwrite: ${options.overwrite}`);
  console.log(`  threshold: ${options.fuzzyThreshold}`);
  console.log(`  sido:      ${options.sido ?? '(전체)'}`);
  console.log(`  dept:      ${(options as any).dept ?? '(전체)'}`);
  console.log(`  file:      ${options.filePath}`);

  // 1. Excel 파싱
  const excelRows = parseExcel(options.filePath);
  if (excelRows.length === 0) throw new Error('Excel에서 처리할 행이 없습니다.');

  // 2. DB 로드 (피부과 필터)
  const hospitals = await loadHospitals((options as any).dept ?? null);

  // 3. 매칭 엔진
  log.info('Building match index...');
  const engine = new MatchingEngine(hospitals);

  // 4. 매칭 실행
  log.info(`Matching ${excelRows.length} rows...`);
  const results = excelRows.map(row => engine.match(row, options));

  // 5. 업데이트 레코드 구성
  const updateRecords: UpdateRecord[] = [];
  for (const result of results) {
    if (decideAction(result, options) === 'updated' && result.matched) {
      updateRecords.push({
        hospitalId:    result.matched.id,
        email:         result.excelRow.email.trim(),
        previousEmail: result.matched.email ?? '',
      });
    }
  }

  // 6. DB 업데이트
  if (updateRecords.length > 0) {
    const { success, failed } = await batchUpdate(supabase, updateRecords, options);
    log.info(`Update result: success=${success} failed=${failed}`);
  } else {
    log.info('No records to update');
  }

  // 7. 리포트 생성
  const reportRows = buildReportRows(results, options);
  const reportPath = await writeCsv(reportRows, options.outputDir);

  // 8. 콘솔 요약
  printSummary(reportRows, options.dryRun);
  console.log(`\nReport: ${reportPath}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
