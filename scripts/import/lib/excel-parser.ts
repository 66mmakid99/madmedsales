import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx') as typeof import('xlsx');
import { ExcelRow } from './types.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('excel-parser');

const COLUMN_ALIASES = {
  hospitalName: ['병원명', '병원 이름', '기관명', '의원명', 'hospital', 'hospital_name', 'clinic'],
  doctorName:   ['이름', '원장명', '담당자', '의사명', '대표자', 'name', 'doctor'],
  email:        ['이메일', '메일', 'email', 'e-mail', 'Email'],
  address:      ['주소', '병원주소', 'address'],
} as const;

function detectColumn(headers: string[], aliases: readonly string[]): number {
  for (const alias of aliases) {
    const idx = headers.findIndex(h =>
      h?.toString().trim().toLowerCase() === alias.toLowerCase()
    );
    if (idx >= 0) return idx;
  }
  return -1;
}

export function parseExcel(filePath: string): ExcelRow[] {
  log.info(`Reading Excel: ${filePath}`);

  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });

  if (rows.length < 2) {
    throw new Error('Excel 파일이 비어있거나 헤더만 있습니다.');
  }

  const headers = rows[0].map(h => h?.toString().trim() ?? '');
  log.info(`Headers detected: ${headers.join(', ')}`);

  const colIdx = {
    hospitalName: detectColumn(headers, COLUMN_ALIASES.hospitalName),
    doctorName:   detectColumn(headers, COLUMN_ALIASES.doctorName),
    email:        detectColumn(headers, COLUMN_ALIASES.email),
    address:      detectColumn(headers, COLUMN_ALIASES.address),
  };

  if (colIdx.hospitalName < 0) {
    throw new Error(
      `병원명 컬럼을 찾을 수 없습니다.\n감지된 헤더: [${headers.join(', ')}]\n지원 컬럼명: ${COLUMN_ALIASES.hospitalName.join(', ')}`
    );
  }
  if (colIdx.email < 0) {
    throw new Error(
      `이메일 컬럼을 찾을 수 없습니다.\n감지된 헤더: [${headers.join(', ')}]\n지원 컬럼명: ${COLUMN_ALIASES.email.join(', ')}`
    );
  }

  log.info(
    `Column mapping — hospitalName[${colIdx.hospitalName}] doctorName[${colIdx.doctorName}] email[${colIdx.email}] address[${colIdx.address}]`
  );

  const result: ExcelRow[] = [];
  let skipped = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) { skipped++; continue; }

    const email = row[colIdx.email]?.toString().trim() ?? '';
    const hospitalName = row[colIdx.hospitalName]?.toString().trim() ?? '';

    if (!email || !hospitalName) { skipped++; continue; }

    result.push({
      rawHospitalName: hospitalName,
      rawDoctorName:   colIdx.doctorName >= 0 ? (row[colIdx.doctorName]?.toString().trim() ?? '') : '',
      email,
      rawAddress:      colIdx.address >= 0    ? (row[colIdx.address]?.toString().trim() ?? '')    : '',
      rowIndex:        i + 1,
    });
  }

  log.info(`Parsed ${result.length} rows (skipped ${skipped} empty)`);
  return result;
}
