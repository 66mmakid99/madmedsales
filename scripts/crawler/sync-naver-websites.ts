/**
 * 네이버 URL 동기화
 * naver-raw 데이터에서 웹사이트 URL을 추출하여
 * hospitals.website 필드를 업데이트합니다.
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase } from '../utils/supabase.js';
import { createLogger } from '../utils/logger.js';
import { isHospitalOwnedWebsite } from '../utils/url-classifier.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = createLogger('sync-naver-web');
const NAVER_DIR = path.resolve(__dirname, '../data/naver-raw');

interface NaverRawData {
  hospitalId: string;
  found: boolean;
  website?: string | null;
  homepage?: string | null;
  url?: string | null;
}

async function main(): Promise<void> {
  log.info('Starting Naver website URL sync');

  let files: string[];
  try {
    files = await fs.readdir(NAVER_DIR);
  } catch {
    log.error('No naver-raw directory found');
    return;
  }

  const jsonFiles = files.filter((f) => f.endsWith('.json'));
  log.info(`Found ${jsonFiles.length} naver-raw files`);

  let updated = 0;
  let skipped = 0;
  let filtered = 0;

  for (const file of jsonFiles) {
    const raw = await fs.readFile(path.join(NAVER_DIR, file), 'utf-8');
    const data: NaverRawData = JSON.parse(raw);

    if (!data.found) continue;

    const websiteUrl = data.website ?? data.homepage ?? data.url ?? null;
    if (!websiteUrl) {
      skipped++;
      continue;
    }

    if (!isHospitalOwnedWebsite(websiteUrl)) {
      filtered++;
      continue;
    }

    // Only update hospitals that don't have a website yet
    const { data: existing } = await supabase
      .from('hospitals')
      .select('website')
      .eq('id', data.hospitalId)
      .single();

    if (existing?.website) {
      skipped++;
      continue;
    }

    const { error } = await supabase
      .from('hospitals')
      .update({ website: websiteUrl })
      .eq('id', data.hospitalId);

    if (error) {
      log.warn(`Failed to update ${data.hospitalId}: ${error.message}`);
    } else {
      updated++;
    }
  }

  log.info(`Sync complete. Updated: ${updated}, Skipped: ${skipped}, Filtered (non-hospital): ${filtered}`);
}

main().catch((err) => {
  log.error('Fatal error', err);
  process.exit(1);
});
