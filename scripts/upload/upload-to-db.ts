/**
 * DB Upload Pipeline
 * Reads collected data and uploads to Supabase:
 * - HIRA data -> hospitals
 * - Naver data -> hospital_treatments
 * - Web analysis data -> hospital_equipments + hospital_treatments
 * - Data quality score calculation
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase } from '../utils/supabase.js';
import { createLogger } from '../utils/logger.js';
import { updateDataQualityScores } from './quality-score.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const log = createLogger('upload');

const HIRA_DIR = path.resolve(__dirname, '../data/hira-raw');
const NAVER_DIR = path.resolve(__dirname, '../data/naver-raw');
const WEB_DIR = path.resolve(__dirname, '../data/web-raw');
const ERRORS_PATH = path.resolve(__dirname, '../data/errors.json');

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
  estbDd: string;
  drTotCnt: number;
  XPos?: string;
  YPos?: string;
}

function parseEstbDate(estbDd: string): string | null {
  if (!estbDd || estbDd.length < 8) return null;
  return `${estbDd.slice(0, 4)}-${estbDd.slice(4, 6)}-${estbDd.slice(6, 8)}`;
}

function extractPart(addr: string, index: number): string {
  return addr.split(' ')[index] ?? '';
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

    for (const item of items) {
      const { error } = await supabase.from('hospitals').upsert({
        business_number: item.ykiho,
        name: item.yadmNm,
        address: item.addr,
        sido: item.sidoCdNm ?? extractPart(item.addr, 0),
        sigungu: item.sgguCdNm ?? extractPart(item.addr, 1),
        dong: item.emdongNm ?? extractPart(item.addr, 2),
        phone: item.telno || null,
        department: item.dgsbjtCdNm,
        hospital_type: item.clCdNm,
        opened_at: parseEstbDate(item.estbDd),
        source: 'hira',
        crawled_at: new Date().toISOString(),
        status: 'active',
        is_target: true,
        data_quality_score: 0,
        latitude: item.YPos ? parseFloat(item.YPos) : null,
        longitude: item.XPos ? parseFloat(item.XPos) : null,
      }, { onConflict: 'business_number' });

      if (error) recordError('hira', item.ykiho, error.message);
      else total++;
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

  let total = 0;
  for (const file of files.filter((f) => f.endsWith('.json'))) {
    const data: NaverData = JSON.parse(await fs.readFile(path.join(NAVER_DIR, file), 'utf-8'));
    if (!data.found || !data.treatments?.length) continue;

    for (const t of data.treatments) {
      const { error } = await supabase.from('hospital_treatments').insert({
        hospital_id: data.hospitalId,
        treatment_name: t.name,
        treatment_category: t.category,
        price_min: t.priceMin,
        price_max: t.priceMax,
        is_promoted: false,
        source: 'naver',
      });
      if (error) recordError('naver', data.hospitalId, error.message);
      else total++;
    }
  }

  log.info(`Naver upload complete: ${total} treatments`);
  return total;
}

// --- Web Analysis Upload ---

interface WebData {
  hospitalId: string;
  success: boolean;
  email?: string | null;
  analysis?: {
    equipments: { equipment_name: string; equipment_brand: string | null; equipment_category: string; equipment_model: string | null; estimated_year: number | null }[];
    treatments: { treatment_name: string; treatment_category: string; price_min: number | null; price_max: number | null; is_promoted: boolean }[];
  };
}

async function uploadWebData(): Promise<{ equipments: number; treatments: number }> {
  log.info('Uploading web analysis data...');

  let files: string[];
  try { files = await fs.readdir(WEB_DIR); } catch { return { equipments: 0, treatments: 0 }; }

  let eqTotal = 0;
  let trTotal = 0;

  for (const file of files.filter((f) => f.endsWith('.json'))) {
    const data: WebData = JSON.parse(await fs.readFile(path.join(WEB_DIR, file), 'utf-8'));
    if (!data.success || !data.analysis) continue;

    if (data.email) {
      const { error } = await supabase.from('hospitals').update({ email: data.email }).eq('id', data.hospitalId);
      if (error) recordError('web-email', data.hospitalId, error.message);
    }

    for (const eq of data.analysis.equipments) {
      const { error } = await supabase.from('hospital_equipments').insert({
        hospital_id: data.hospitalId, equipment_name: eq.equipment_name, equipment_brand: eq.equipment_brand,
        equipment_category: eq.equipment_category, equipment_model: eq.equipment_model, estimated_year: eq.estimated_year,
        is_confirmed: false, source: 'web_analysis',
      });
      if (error) recordError('web-equipment', data.hospitalId, error.message);
      else eqTotal++;
    }

    for (const t of data.analysis.treatments) {
      const { error } = await supabase.from('hospital_treatments').insert({
        hospital_id: data.hospitalId, treatment_name: t.treatment_name, treatment_category: t.treatment_category,
        price_min: t.price_min, price_max: t.price_max, is_promoted: t.is_promoted, source: 'web_analysis',
      });
      if (error) recordError('web-treatment', data.hospitalId, error.message);
      else trTotal++;
    }
  }

  log.info(`Web upload complete: ${eqTotal} equipments, ${trTotal} treatments`);
  return { equipments: eqTotal, treatments: trTotal };
}

// --- Main ---

async function main(): Promise<void> {
  log.info('Starting upload pipeline');

  const hiraCount = await uploadHiraData();
  const naverCount = await uploadNaverData();
  const webCounts = await uploadWebData();
  await updateDataQualityScores(supabase, errors);

  if (errors.length > 0) {
    await fs.writeFile(ERRORS_PATH, JSON.stringify(errors, null, 2), 'utf-8');
    log.warn(`${errors.length} errors recorded to data/errors.json`);
  }

  log.info('Upload pipeline complete');
  log.info(`Summary: ${hiraCount} hospitals, ${naverCount} naver treatments, ${webCounts.equipments} equipments, ${webCounts.treatments} web treatments`);
}

main().catch((err) => {
  log.error('Fatal error', err);
  process.exit(1);
});
