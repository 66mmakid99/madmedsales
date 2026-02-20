/**
 * 네이버 플레이스 크롤러
 * 네이버 검색 API로 병원을 찾고, 플레이스 페이지에서
 * 시술 메뉴, 리뷰 수 등을 수집합니다.
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
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
  throw new Error(
    'Missing NAVER_CLIENT_ID or NAVER_CLIENT_SECRET in scripts/.env'
  );
}

const DATA_DIR = path.resolve(__dirname, '../data/naver-raw');
const DELAY_MS = 2000;
const JITTER_MS = 1000;

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
  lastBuildDate: string;
  total: number;
  start: number;
  display: number;
  items: NaverSearchItem[];
}

interface NaverPlaceData {
  placeId: string | null;
  naverUrl: string | null;
  reviewCount: number | null;
  treatments: {
    name: string;
    category: string;
    priceMin: number | null;
    priceMax: number | null;
  }[];
}

async function searchNaverLocal(
  query: string
): Promise<NaverSearchItem | null> {
  try {
    const response = await axios.get<NaverSearchResponse>(
      'https://openapi.naver.com/v1/search/local.json',
      {
        params: { query, display: 1 },
        headers: {
          'X-Naver-Client-Id': NAVER_CLIENT_ID,
          'X-Naver-Client-Secret': NAVER_CLIENT_SECRET,
        },
      }
    );

    if (response.data.items.length === 0) {
      return null;
    }
    return response.data.items[0];
  } catch (err) {
    log.error(`Naver search failed for "${query}"`, err);
    return null;
  }
}

function extractPlaceId(link: string): string | null {
  // Naver place links contain the place ID
  const match = link.match(/place\/(\d+)/);
  return match ? match[1] : null;
}

async function scrapeNaverPlace(
  placeId: string
): Promise<Partial<NaverPlaceData>> {
  const result: Partial<NaverPlaceData> = {
    placeId,
    naverUrl: `https://m.place.naver.com/hospital/${placeId}/home`,
    treatments: [],
  };

  try {
    // Fetch home page for review count
    const homeRes = await axios.get(
      `https://m.place.naver.com/hospital/${placeId}/home`,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
        },
        timeout: 10000,
      }
    );

    const $home = cheerio.load(homeRes.data);

    // Try to extract review count from page
    const reviewText = $home('[class*="review"]').first().text();
    const reviewMatch = reviewText.match(/(\d[\d,]*)/);
    if (reviewMatch) {
      result.reviewCount = parseInt(reviewMatch[1].replace(/,/g, ''), 10);
    }
  } catch (err) {
    log.warn(`Failed to scrape place home for ${placeId}`, err);
  }

  try {
    // Fetch treatments/price page
    await delayWithJitter(1000, 500);

    const priceRes = await axios.get(
      `https://m.place.naver.com/hospital/${placeId}/price`,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
        },
        timeout: 10000,
      }
    );

    const $price = cheerio.load(priceRes.data);

    // Extract treatment items from the price page
    $price('[class*="price_item"], [class*="menu_item"]').each((_, el) => {
      const name = $price(el).find('[class*="name"]').text().trim();
      const priceText = $price(el).find('[class*="price"]').text().trim();

      if (name) {
        const priceNumbers = priceText.match(/(\d[\d,]+)/g);
        const prices = priceNumbers
          ? priceNumbers.map((p) => parseInt(p.replace(/,/g, ''), 10))
          : [];

        result.treatments?.push({
          name,
          category: categorizeTreatment(name),
          priceMin: prices.length > 0 ? Math.min(...prices) : null,
          priceMax: prices.length > 1 ? Math.max(...prices) : null,
        });
      }
    });
  } catch (err) {
    log.warn(`Failed to scrape price page for ${placeId}`, err);
  }

  return result;
}

function categorizeTreatment(name: string): string {
  const lower = name.toLowerCase();
  if (/리프팅|울쎄라|슈링크|써마지|하이푸/.test(lower)) return 'lifting';
  if (/타이트닝|탄력/.test(lower)) return 'tightening';
  if (/토닝|레이저토닝|피코토닝/.test(lower)) return 'toning';
  if (/필러/.test(lower)) return 'filler';
  if (/보톡스|보툴리눔/.test(lower)) return 'botox';
  if (/레이저/.test(lower)) return 'laser_toning';
  if (/흉터|스카/.test(lower)) return 'scar';
  if (/여드름|아크네/.test(lower)) return 'acne';
  if (/미백|화이트닝|기미/.test(lower)) return 'whitening';
  return 'other';
}

async function main(): Promise<void> {
  log.info('Starting Naver Place crawl');

  await fs.mkdir(DATA_DIR, { recursive: true });

  // Fetch hospitals from Supabase that haven't been crawled via Naver yet
  const { data: hospitals, error } = await supabase
    .from('hospitals')
    .select('id, name, sido, sigungu, address')
    .eq('status', 'active')
    .order('created_at', { ascending: true });

  if (error) {
    log.error('Failed to fetch hospitals from Supabase', error);
    process.exit(1);
  }

  if (!hospitals || hospitals.length === 0) {
    log.warn('No hospitals found in DB');
    return;
  }

  log.info(`Found ${hospitals.length} hospitals to process`);

  let processed = 0;
  let found = 0;

  for (const hospital of hospitals) {
    processed++;

    // Skip if already crawled
    const filePath = path.join(DATA_DIR, `${hospital.id}.json`);
    try {
      await fs.access(filePath);
      log.debug(`Already crawled: ${hospital.name} (${hospital.id})`);
      continue;
    } catch {
      // File doesn't exist, proceed
    }

    const query = `${hospital.name} ${hospital.sigungu || hospital.sido || ''}`.trim();
    log.info(
      `[${processed}/${hospitals.length}] Searching: ${query}`
    );

    const searchResult = await searchNaverLocal(query);

    if (!searchResult) {
      log.warn(`No Naver result for: ${hospital.name}`);
      // Save empty result to avoid re-processing
      await fs.writeFile(
        filePath,
        JSON.stringify({ hospitalId: hospital.id, found: false }, null, 2),
        'utf-8'
      );
      await delayWithJitter(DELAY_MS, JITTER_MS);
      continue;
    }

    const placeId = extractPlaceId(searchResult.link);

    if (!placeId) {
      log.warn(`Could not extract placeId for: ${hospital.name}`);
      await fs.writeFile(
        filePath,
        JSON.stringify(
          { hospitalId: hospital.id, found: false, link: searchResult.link },
          null,
          2
        ),
        'utf-8'
      );
      await delayWithJitter(DELAY_MS, JITTER_MS);
      continue;
    }

    await delayWithJitter(DELAY_MS, JITTER_MS);

    const placeData = await scrapeNaverPlace(placeId);

    const result = {
      hospitalId: hospital.id,
      found: true,
      ...placeData,
    };

    await fs.writeFile(filePath, JSON.stringify(result, null, 2), 'utf-8');
    found++;

    log.info(
      `Saved Naver data for ${hospital.name}: ${placeData.treatments?.length ?? 0} treatments`
    );

    await delayWithJitter(DELAY_MS, JITTER_MS);
  }

  log.info(`Crawl complete. Processed: ${processed}, Found: ${found}`);
}

main().catch((err) => {
  log.error('Fatal error', err);
  process.exit(1);
});
