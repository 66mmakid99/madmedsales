/**
 * DB Upload Pipeline
 * Reads collected data and uploads to Supabase:
 * - HIRA data -> hospitals (batch upsert)
 * - Naver data -> hospital_treatments
 * - Web analysis data -> hospital_doctors + hospital_equipments + hospital_treatments
 * - Data quality score calculation
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase } from '../utils/supabase.js';
import { createLogger } from '../utils/logger.js';
import { updateDataQualityScores } from './quality-score.js';
import { uploadWebData } from './upload-web.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const log = createLogger('upload');

const HIRA_DIR = path.resolve(__dirname, '../data/hira-raw');
const NAVER_DIR = path.resolve(__dirname, '../data/naver-raw');
const ERRORS_PATH = path.resolve(__dirname, '../data/errors.json');

const BATCH_SIZE = 500;

interface UploadError {
  source: string;
  hospitalId: string;
  error: string;
  timestamp: string;
}

const errors: UploadError[] = [];

function recordError(source: string, hospitalId: string, error: string): void {
  errors.push({ source, hospitalId, error, timestamp: new Date().toISOString() });
}

// --- HIRA Upload ---

interface HiraItem {
  ykiho: string;
  yadmNm: string;
  clCdNm: string;
  dgsbjtCdNm: string;
  sidoCdNm?: string;
  sgguCdNm?: string;
  emdongNm?: string;
  addr: string;
  telno: string;
  estbDd: string | number;
  drTotCnt: number;
  XPos?: string | number;
  YPos?: string | number;
}

function parseEstbDate(estbDd: string | number | null | undefined): string | null {
  if (!estbDd) return null;
  const s = String(estbDd);
  if (s.length < 8) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function extractPart(addr: string, index: number): string {
  return addr.split(' ')[index] ?? '';
}

const DEPT_CODE_MAP: Record<string, string> = {
  '14': '피부과',
  '09': '성형외과',
};

function deptFromFileName(fileName: string): string | null {
  const match = fileName.match(/_(\d+)\.json$/);
  return match ? DEPT_CODE_MAP[match[1]] ?? null : null;
}

function toHospitalRow(item: HiraItem, department: string | null) {
  return {
    business_number: String(item.ykiho),
    name: item.yadmNm,
    address: item.addr,
    sido: item.sidoCdNm ?? extractPart(item.addr, 0),
    sigungu: item.sgguCdNm ?? extractPart(item.addr, 1),
    dong: item.emdongNm ?? extractPart(item.addr, 2),
    phone: item.telno || null,
    department,
    hospital_type: item.clCdNm,
    opened_at: parseEstbDate(item.estbDd),
    source: 'hira',
    crawled_at: new Date().toISOString(),
    status: 'active',
    is_target: true,
    data_quality_score: 0,
    latitude: item.YPos ? parseFloat(String(item.YPos)) : null,
    longitude: item.XPos ? parseFloat(String(item.XPos)) : null,
  };
}

async function uploadHiraData(): Promise<number> {
  log.info('Uploading HIRA data...');

  let files: string[];
  try { files = await fs.readdir(HIRA_DIR); } catch { return 0; }

  const jsonFiles = files.filter((f) => f.endsWith('.json'));
  let total = 0;

  for (const file of jsonFiles) {
    const raw = await fs.readFile(path.join(HIRA_DIR, file), 'utf-8');
    const items: HiraItem[] = JSON.parse(raw);

    if (items.length === 0) continue;

    const dept = deptFromFileName(file);
    log.info(`Processing ${file}: ${items.length} records (dept: ${dept})`);

    const rows = items.map((item) => toHospitalRow(item, dept));

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const { error, count } = await supabase
        .from('hospitals')
        .upsert(batch, { onConflict: 'business_number', count: 'exact' });

      if (error) {
        log.error(`Batch error in ${file} (offset ${i}): ${error.message}`);
        recordError('hira', `batch-${file}-${i}`, error.message);
      } else {
        total += count ?? batch.length;
      }

      log.info(`  ${file}: ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length} uploaded`);
    }
  }

  log.info(`HIRA upload complete: ${total} hospitals`);
  return total;
}

// --- Naver Upload ---

interface NaverData {
  hospitalId: string;
  found: boolean;
  treatments?: { name: string; category: string; priceMin: number | null; priceMax: number | null }[];
}

async function uploadNaverData(): Promise<number> {
  log.info('Uploading Naver data...');

  let files: string[];
  try { files = await fs.readdir(NAVER_DIR); } catch { return 0; }

  const jsonFiles = files.filter((f) => f.endsWith('.json'));
  if (jsonFiles.length === 0) {
    log.info('No Naver data files found');
    return 0;
  }

  const allRows: Record<string, unknown>[] = [];

  for (const file of jsonFiles) {
    const data: NaverData = JSON.parse(await fs.readFile(path.join(NAVER_DIR, file), 'utf-8'));
    if (!data.found || !data.treatments?.length) continue;

    for (const t of data.treatments) {
      allRows.push({
        hospital_id: data.hospitalId,
        treatment_name: t.name,
        treatment_category: t.category,
        price_min: t.priceMin,
        price_max: t.priceMax,
        is_promoted: false,
        source: 'naver',
      });
    }
  }

  let total = 0;
  for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
    const batch = allRows.slice(i, i + BATCH_SIZE);
    const { error, count } = await supabase
      .from('hospital_treatments')
      .insert(batch, { count: 'exact' });

    if (error) {
      log.error(`Naver batch error (offset ${i}): ${error.message}`);
      recordError('naver', `batch-${i}`, error.message);
    } else {
      total += count ?? batch.length;
    }
  }

  log.info(`Naver upload complete: ${total} treatments`);
  return total;
}

// --- Main ---

async function main(): Promise<void> {
  log.info('Starting upload pipeline');

  const hiraCount = await uploadHiraData();
  const naverCount = await uploadNaverData();
  const webCounts = await uploadWebData(supabase, errors);
  await updateDataQualityScores(supabase, errors);

  if (errors.length > 0) {
    await fs.writeFile(ERRORS_PATH, JSON.stringify(errors, null, 2), 'utf-8');
    log.warn(`${errors.length} errors recorded to data/errors.json`);
  }

  log.info('Upload pipeline complete');
  log.info(`Summary: ${hiraCount} hospitals, ${naverCount} naver treatments, ${webCounts.doctors} doctors, ${webCounts.equipments} equipments, ${webCounts.treatments} web treatments, ${webCounts.emails} emails, ${webCounts.phones} phones`);
}

main().catch((err) => {
  log.error('Fatal error', err);
  process.exit(1);
});
