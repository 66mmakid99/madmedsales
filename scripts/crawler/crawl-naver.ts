/**
 * 네이버 검색 크롤러
 * 네이버 검색 API(local)로 병원 정보를 보강합니다.
 * - 카테고리 확인 (실제 피부과/성형외과인지)
 * - 웹사이트 URL 수집
 * - 도로명주소 보강
 */
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { supabase } from '../utils/supabase.js';
import { delayWithJitter } from '../utils/delay.js';
import { createLogger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const log = createLogger('crawl-naver');

const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;

if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
  throw new Error('Missing NAVER_CLIENT_ID or NAVER_CLIENT_SECRET in scripts/.env');
}

const DATA_DIR = path.resolve(__dirname, '../data/naver-raw');
const DELAY_MS = 300;
const JITTER_MS = 200;
const PAGE_SIZE = 1000;

interface NaverSearchItem {
  title: string;
  link: string;
  category: string;
  description: string;
  telephone: string;
  address: string;
  roadAddress: string;
  mapx: string;
  mapy: string;
}

interface NaverSearchResponse {
  total: number;
  start: number;
  display: number;
  items: NaverSearchItem[];
}

function stripHtml(str: string): string {
  return str.replace(/<[^>]*>/g, '').trim();
}

async function searchNaverLocal(query: string): Promise<NaverSearchItem | null> {
  try {
    const response = await axios.get<NaverSearchResponse>(
      'https://openapi.naver.com/v1/search/local.json',
      {
        params: { query, display: 1 },
        headers: {
          'X-Naver-Client-Id': NAVER_CLIENT_ID!,
          'X-Naver-Client-Secret': NAVER_CLIENT_SECRET!,
        },
        timeout: 5000,
      }
    );

    if (response.data.items.length === 0) return null;
    return response.data.items[0];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`Naver search failed for "${query}": ${msg}`);
    return null;
  }
}

function isRelevantCategory(category: string): boolean {
  return /피부과|성형외과|피부|성형|의원|클리닉/.test(category);
}

async function fetchHospitalsBatch(offset: number): Promise<{ id: string; name: string; sido: string | null; sigungu: string | null; department: string | null; website: string | null }[]> {
  const { data, error } = await supabase
    .from('hospitals')
    .select('id, name, sido, sigungu, department, website')
    .eq('status', 'active')
    .in('department', ['피부과', '성형외과'])
    .order('created_at', { ascending: true })
    .range(offset, offset + PAGE_SIZE - 1);

  if (error) {
    log.error(`Failed to fetch hospitals at offset ${offset}`, error);
    return [];
  }
  return data ?? [];
}

async function main(): Promise<void> {
  log.info('Starting Naver search crawl');

  await fs.mkdir(DATA_DIR, { recursive: true });

  // Fetch all hospitals in batches
  let offset = 0;
  let allHospitals: { id: string; name: string; sido: string | null; sigungu: string | null; department: string | null; website: string | null }[] = [];

  while (true) {
    const batch = await fetchHospitalsBatch(offset);
    if (batch.length === 0) break;
    allHospitals.push(...batch);
    log.info(`Fetched hospitals: ${allHospitals.length} (offset ${offset})`);
    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  log.info(`Total hospitals to process: ${allHospitals.length}`);

  let processed = 0;
  let found = 0;
  let skipped = 0;

  for (const hospital of allHospitals) {
    processed++;

    // Skip if already crawled
    const filePath = path.join(DATA_DIR, `${hospital.id}.json`);
    try {
      await fs.access(filePath);
      skipped++;
      continue;
    } catch {
      // File doesn't exist, proceed
    }

    const query = `${hospital.name} ${hospital.sigungu || hospital.sido || ''}`.trim();

    if (processed % 100 === 0 || processed <= 5) {
      log.info(`[${processed}/${allHospitals.length}] Searching: ${query}`);
    }

    const searchResult = await searchNaverLocal(query);

    if (!searchResult) {
      await fs.writeFile(
        filePath,
        JSON.stringify({ hospitalId: hospital.id, found: false }, null, 2),
        'utf-8'
      );
      await delayWithJitter(DELAY_MS, JITTER_MS);
      continue;
    }

    const cleanTitle = stripHtml(searchResult.title);
    const relevant = isRelevantCategory(searchResult.category);

    const result = {
      hospitalId: hospital.id,
      found: true,
      naverTitle: cleanTitle,
      category: searchResult.category,
      isRelevantCategory: relevant,
      website: searchResult.link || null,
      telephone: searchResult.telephone || null,
      roadAddress: searchResult.roadAddress || null,
      description: stripHtml(searchResult.description),
      mapx: searchResult.mapx,
      mapy: searchResult.mapy,
    };

    await fs.writeFile(filePath, JSON.stringify(result, null, 2), 'utf-8');
    found++;

    // Update hospital website if missing
    if (searchResult.link && !hospital.website) {
      await supabase
        .from('hospitals')
        .update({ website: searchResult.link })
        .eq('id', hospital.id);
    }

    await delayWithJitter(DELAY_MS, JITTER_MS);
  }

  log.info(`Crawl complete. Processed: ${processed}, Found: ${found}, Skipped (cached): ${skipped}`);
}

main().catch((err) => {
  log.error('Fatal error', err);
  process.exit(1);
});
