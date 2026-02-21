/**
 * Web analysis data upload.
 * Uploads doctors, equipments, treatments, and contact info
 * extracted from hospital website analysis.
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = createLogger('upload-web');
const WEB_DIR = path.resolve(__dirname, '../data/web-raw');
const BATCH_SIZE = 500;

interface UploadError {
  source: string;
  hospitalId: string;
  error: string;
  timestamp: string;
}

interface WebDoctor {
  name: string;
  title: string | null;
  specialty: string | null;
  career: string[];
}

interface WebData {
  hospitalId: string;
  success: boolean;
  email?: string | null;
  emails?: string[];
  phones?: string[];
  contactUrl?: string | null;
  analysis?: {
    doctors?: WebDoctor[];
    equipments: {
      equipment_name: string;
      equipment_brand: string | null;
      equipment_category: string;
      equipment_model: string | null;
      estimated_year: number | null;
      manufacturer?: string | null;
    }[];
    treatments: {
      treatment_name: string;
      treatment_category: string;
      price_min: number | null;
      price_max: number | null;
      price?: number | null;
      price_event?: number | null;
      original_name?: string | null;
      is_promoted: boolean;
    }[];
    contact_info?: { emails: string[]; phones: string[]; contact_page_url: string | null };
  };
}

export interface WebUploadResult {
  equipments: number;
  treatments: number;
  doctors: number;
  emails: number;
  phones: number;
}

function pickBestContactEmail(emails: string[]): string | null {
  if (emails.length === 0) return null;
  const contactPrefixes = emails.find(
    (e) => /^(info|contact|admin|help|cs|counsel|consulting|consult)@/i.test(e)
  );
  if (contactPrefixes) return contactPrefixes;
  const nonGeneric = emails.filter(
    (e) => !/@(gmail|naver|daum|hanmail|kakao|yahoo|hotmail|outlook)\./i.test(e)
  );
  if (nonGeneric.length > 0) return nonGeneric[0];
  return emails[0];
}

export async function uploadWebData(
  supabase: SupabaseClient,
  errors: UploadError[]
): Promise<WebUploadResult> {
  log.info('Uploading web analysis data...');

  function recordError(source: string, hospitalId: string, error: string): void {
    errors.push({ source, hospitalId, error, timestamp: new Date().toISOString() });
  }

  let files: string[];
  try { files = await fs.readdir(WEB_DIR); } catch { return { equipments: 0, treatments: 0, doctors: 0, emails: 0, phones: 0 }; }

  const jsonFiles = files.filter((f) => f.endsWith('.json'));
  if (jsonFiles.length === 0) {
    log.info('No web analysis data files found');
    return { equipments: 0, treatments: 0, doctors: 0, emails: 0, phones: 0 };
  }

  const eqRows: Record<string, unknown>[] = [];
  const trRows: Record<string, unknown>[] = [];
  const drRows: Record<string, unknown>[] = [];
  const contactUpdates: { id: string; email: string | null; phone: string | null }[] = [];

  for (const file of jsonFiles) {
    const data: WebData = JSON.parse(await fs.readFile(path.join(WEB_DIR, file), 'utf-8'));
    if (!data.success) continue;

    const regexEmail = data.email ?? null;
    const geminiEmails = data.analysis?.contact_info?.emails ?? [];
    const regexPhones = data.phones ?? [];
    const geminiPhones = data.analysis?.contact_info?.phones ?? [];

    const allEmails = [...new Set([...geminiEmails, ...(data.emails ?? []), ...(regexEmail ? [regexEmail] : [])])];
    const bestEmail = pickBestContactEmail(allEmails);
    const allPhones = [...new Set([...geminiPhones, ...regexPhones])];
    const bestPhone = allPhones[0] ?? null;

    if (bestEmail || bestPhone) {
      contactUpdates.push({ id: data.hospitalId, email: bestEmail, phone: bestPhone });
    }

    if (!data.analysis) continue;

    for (const dr of data.analysis.doctors ?? []) {
      if (!dr.name) continue;
      drRows.push({
        hospital_id: data.hospitalId, name: dr.name, title: dr.title ?? null,
        specialty: dr.specialty ?? null, career: dr.career ?? [], education: [],
        source: 'web_analysis',
      });
    }

    for (const eq of data.analysis.equipments) {
      eqRows.push({
        hospital_id: data.hospitalId, equipment_name: eq.equipment_name,
        equipment_brand: eq.equipment_brand, equipment_category: eq.equipment_category,
        equipment_model: eq.equipment_model, estimated_year: eq.estimated_year,
        manufacturer: eq.manufacturer ?? null, is_confirmed: false, source: 'web_analysis',
      });
    }

    for (const t of data.analysis.treatments) {
      trRows.push({
        hospital_id: data.hospitalId, treatment_name: t.treatment_name,
        treatment_category: t.treatment_category, price_min: t.price_min,
        price_max: t.price_max, price: t.price ?? null, price_event: t.price_event ?? null,
        original_treatment_name: t.original_name ?? null,
        is_promoted: t.is_promoted, source: 'web_analysis',
      });
    }
  }

  // Contact updates
  let emailCount = 0;
  let phoneCount = 0;
  const invalidEmailDomains = /@(example\.com|test\.com|localhost|sentry\.io)/i;
  for (const u of contactUpdates) {
    const updates: Record<string, string> = {};
    if (u.email && !invalidEmailDomains.test(u.email)) updates.email = u.email;
    if (u.phone) updates.phone = u.phone;
    if (Object.keys(updates).length === 0) continue;

    const { error } = await supabase.from('hospitals').update(updates).eq('id', u.id);
    if (error) recordError('web-contact', u.id, error.message);
    else {
      if (u.email) emailCount++;
      if (u.phone) phoneCount++;
    }
  }
  log.info(`Contact updates: ${emailCount} emails, ${phoneCount} phones`);

  // Batch insert doctors
  let drTotal = 0;
  for (let i = 0; i < drRows.length; i += BATCH_SIZE) {
    const batch = drRows.slice(i, i + BATCH_SIZE);
    const { error, count } = await supabase.from('hospital_doctors').insert(batch, { count: 'exact' });
    if (error) recordError('web-doctor', `batch-${i}`, error.message);
    else drTotal += count ?? batch.length;
  }

  // Batch insert equipments
  let eqTotal = 0;
  for (let i = 0; i < eqRows.length; i += BATCH_SIZE) {
    const batch = eqRows.slice(i, i + BATCH_SIZE);
    const { error, count } = await supabase.from('hospital_equipments').insert(batch, { count: 'exact' });
    if (error) recordError('web-equipment', `batch-${i}`, error.message);
    else eqTotal += count ?? batch.length;
  }

  // Batch insert treatments
  let trTotal = 0;
  for (let i = 0; i < trRows.length; i += BATCH_SIZE) {
    const batch = trRows.slice(i, i + BATCH_SIZE);
    const { error, count } = await supabase.from('hospital_treatments').insert(batch, { count: 'exact' });
    if (error) recordError('web-treatment', `batch-${i}`, error.message);
    else trTotal += count ?? batch.length;
  }

  log.info(`Web upload: ${drTotal} doctors, ${eqTotal} equipments, ${trTotal} treatments, ${emailCount} emails, ${phoneCount} phones`);
  return { equipments: eqTotal, treatments: trTotal, doctors: drTotal, emails: emailCount, phones: phoneCount };
}
