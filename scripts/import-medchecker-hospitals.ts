/**
 * Import hospitals from MEDCHECKER (ad-medchecker) hospital JSON.
 * Reads the 403-hospital dataset and upserts into MADMEDSALES.
 *
 * Only imports:
 * - Hospitals with homepageUrl (we need a website to crawl)
 * - isSkinRelated: true
 * - Not matching EXCLUDE_KEYWORDS
 *
 * Usage: npx tsx scripts/import-medchecker-hospitals.ts [--dry-run]
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase } from './utils/supabase.js';
import { createLogger } from './utils/logger.js';
import { isExcludedHospital, isTargetDepartment } from './utils/hospital-filter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = createLogger('import-medchecker');

// MEDCHECKER project is at ~/ad-medchecker (not under Projects/)
const MEDCHECKER_PATH = path.resolve(
  process.env.USERPROFILE ?? process.env.HOME ?? '',
  'ad-medchecker/medchecker/backend/data/hospitals/hospitals.json'
);

const DRY_RUN = process.argv.includes('--dry-run');

interface MedcheckerHospital {
  id: string;
  name: string;
  address: string;
  oldAddress?: string;
  telephone: string;
  category: string;
  naverLink: string;
  homepageUrl: string | null;
  mapx: string;
  mapy: string;
  region: string;
  searchKeyword: string;
  isSkinRelated: boolean;
}

function extractDepartment(category: string): string | null {
  if (category.includes('피부과')) return '피부과';
  if (category.includes('성형외과')) return '성형외과';
  return null;
}

function extractRegionParts(address: string): { sido: string; sigungu: string } {
  const parts = address.split(' ');
  return {
    sido: parts[0] ?? '',
    sigungu: parts[1] ?? '',
  };
}

async function main(): Promise<void> {
  log.info('=== MEDCHECKER Hospital Import ===');
  if (DRY_RUN) log.info('(DRY RUN — no DB changes)');

  // Read MEDCHECKER data
  const raw = await fs.readFile(MEDCHECKER_PATH, 'utf-8');
  const parsed = JSON.parse(raw) as { hospitals: MedcheckerHospital[] };
  log.info(`Read ${parsed.hospitals.length} hospitals from MEDCHECKER`);

  // Filter
  const candidates = parsed.hospitals.filter((h) => {
    if (!h.isSkinRelated) return false;
    if (!h.homepageUrl) return false;
    if (isExcludedHospital(h.name)) return false;
    const dept = extractDepartment(h.category);
    if (!isTargetDepartment(dept, h.category)) return false;
    return true;
  });

  log.info(`Filtered to ${candidates.length} valid candidates (have website + target dept)`);

  // Check which already exist in DB (by name + address match)
  const { data: existing } = await supabase
    .from('hospitals')
    .select('name, website')
    .not('website', 'is', null);

  const existingNames = new Set((existing ?? []).map((h) => h.name));
  const existingWebsites = new Set(
    (existing ?? []).map((h) => (h.website as string).replace(/\/+$/, '').toLowerCase())
  );

  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (const h of candidates) {
    // Skip if already exists by name or website
    const normalizedUrl = h.homepageUrl!.replace(/\/+$/, '').toLowerCase();
    if (existingNames.has(h.name) || existingWebsites.has(normalizedUrl)) {
      skipped++;
      continue;
    }

    const dept = extractDepartment(h.category);
    const { sido, sigungu } = extractRegionParts(h.address);

    const row = {
      name: h.name,
      department: dept,
      address: h.address,
      phone: h.telephone || null,
      website: h.homepageUrl,
      sido,
      sigungu,
      status: 'active',
      is_target: true,
      data_quality_score: 30, // basic info only, needs crawling
    };

    if (DRY_RUN) {
      if (imported < 5) log.info(`  [DRY] Would import: ${h.name} (${dept}) — ${h.homepageUrl}`);
      imported++;
      continue;
    }

    const { error } = await supabase.from('hospitals').insert(row);
    if (error) {
      if (error.code === '23505') {
        skipped++; // duplicate
      } else {
        log.warn(`Insert error for ${h.name}: ${error.message}`);
        errors++;
      }
    } else {
      imported++;
    }
  }

  log.info('\n=== Result ===');
  log.info(`Imported:  ${imported}`);
  log.info(`Skipped:   ${skipped} (already exist)`);
  log.info(`Errors:    ${errors}`);
  log.info(`Total DB:  ${(existing?.length ?? 0) + imported} (estimated)`);
}

main().catch((err) => {
  log.error('Fatal error', err);
  process.exit(1);
});
