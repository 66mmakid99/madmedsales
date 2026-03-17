import { createWriteStream } from 'fs';
import path from 'path';
import { MatchResult, ReportRow, UpdateAction, MatchOptions } from './types.js';
import { createLogger } from '../../utils/logger.js';
import { decideAction } from './updater.js';

const log = createLogger('reporter');

export function buildReportRows(results: MatchResult[], options: MatchOptions): ReportRow[] {
  return results.map(result => {
    const action  = decideAction(result, options);
    const matched = result.matched;
    return {
      rowIndex:            result.excelRow.rowIndex,
      excelHospitalName:   result.excelRow.rawHospitalName,
      excelDoctorName:     result.excelRow.rawDoctorName,
      excelEmail:          result.excelRow.email,
      excelAddress:        result.excelRow.rawAddress,
      matchType:           result.matchType,
      matchScore:          Math.round(result.score * 1000) / 1000,
      matchedHospitalId:   matched?.id ?? '',
      matchedHospitalName: matched?.name ?? '',
      matchedDoctorName:   matched?.doctorName ?? '',
      action,
      previousEmail:       matched?.email ?? '',
      candidateCount:      result.candidates.length,
    };
  });
}

export async function writeCsv(rows: ReportRow[], outputDir: string): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filePath  = path.join(outputDir, `email-matching-result-${timestamp}.csv`);

  const headers = [
    'row', 'excel_hospital_name', 'excel_doctor_name', 'excel_email',
    'excel_address', 'match_type', 'match_score',
    'matched_hospital_id', 'matched_hospital_name', 'matched_doctor_name',
    'action', 'previous_email', 'candidate_count',
  ];

  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;

  const stream = createWriteStream(filePath, { encoding: 'utf8' });
  stream.write('\uFEFF'); // BOM (Excel UTF-8)
  stream.write(headers.join(',') + '\n');

  for (const row of rows) {
    stream.write([
      row.rowIndex,
      esc(row.excelHospitalName),
      esc(row.excelDoctorName),
      esc(row.excelEmail),
      esc(row.excelAddress),
      row.matchType,
      row.matchScore,
      row.matchedHospitalId,
      esc(row.matchedHospitalName),
      esc(row.matchedDoctorName),
      row.action,
      esc(row.previousEmail),
      row.candidateCount,
    ].join(',') + '\n');
  }

  await new Promise<void>((resolve, reject) => {
    stream.end(err => (err ? reject(err) : resolve()));
  });

  log.info(`Report written: ${filePath}`);
  return filePath;
}

export function printSummary(rows: ReportRow[], dryRun: boolean): void {
  const total = rows.length;
  const pct   = (n: number) => total > 0 ? `${((n / total) * 100).toFixed(1)}%` : '0%';

  const byType: Record<string, number> = {
    exact:     rows.filter(r => r.matchType === 'exact').length,
    fuzzy:     rows.filter(r => r.matchType === 'fuzzy').length,
    ambiguous: rows.filter(r => r.matchType === 'ambiguous').length,
    unmatched: rows.filter(r => r.matchType === 'unmatched').length,
  };
  const byAction: Record<UpdateAction, number> = {
    updated:               rows.filter(r => r.action === 'updated').length,
    skipped_existing:      rows.filter(r => r.action === 'skipped_existing').length,
    skipped_invalid_email: rows.filter(r => r.action === 'skipped_invalid_email').length,
    no_match:              rows.filter(r => r.action === 'no_match').length,
  };

  console.log('\n=== Email Matching Results ===');
  if (dryRun) console.log('[DRY-RUN MODE — DB 업데이트 없음]');
  console.log(`Total Excel rows:    ${total}`);
  console.log(`Exact match:         ${byType.exact} (${pct(byType.exact)})`);
  console.log(`Fuzzy match:         ${byType.fuzzy} (${pct(byType.fuzzy)})`);
  console.log(`Ambiguous:           ${byType.ambiguous} (${pct(byType.ambiguous)})`);
  console.log(`Unmatched:           ${byType.unmatched} (${pct(byType.unmatched)})`);
  console.log('');
  console.log(`Updated:             ${byAction.updated}`);
  console.log(`Skipped (existing):  ${byAction.skipped_existing}`);
  console.log(`Invalid email:       ${byAction.skipped_invalid_email}`);
  console.log(`No match:            ${byAction.no_match}`);
}
