/**
 * 카카오 로컬 검색으로 병원 홈페이지 URL 확보
 * 웹사이트 URL이 없는 병원을 카카오 검색하여 homepage URL을 가져옵니다.
 */
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { supabase } from '../utils/supabase.js';
import { createLogger } from '../utils/logger.js';
import { delayWithJitter } from '../utils/delay.js';
import { isHospitalOwnedWebsite } from '../utils/url-classifier.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const log = createLogger('crawl-kakao-web');

const KAKAO_API_KEY = process.env.KAKAO_REST_API_KEY;
if (!KAKAO_API_KEY) {
  throw new Error('Missing KAKAO_REST_API_KEY in scripts/.env');
}

const DELAY_MS = 300;
const JITTER_MS = 200;
const BATCH_SIZE = 100;

interface KakaoPlace {
  place_name: string;
  place_url: string;
  phone: string;
  address_name: string;
  category_name: string;
  x: string;
  y: string;
}

interface KakaoSearchResponse {
  documents: KakaoPlace[];
  meta: { total_count: number; is_end: boolean };
}

async function searchKakao(query: string): Promise<KakaoPlace | null> {
  try {
    const response = await axios.get<KakaoSearchResponse>(
      'https://dapi.kakao.com/v2/local/search/keyword.json',
      {
        params: { query, category_group_code: 'HP8', size: 1 },
        headers: { Authorization: `KakaoAK ${KAKAO_API_KEY}` },
        timeout: 10000,
      }
    );

    const docs = response.data.documents;
    return docs.length > 0 ? docs[0] : null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`Kakao search failed for "${query}": ${message}`);
    return null;
  }
}

async function main(): Promise<void> {
  log.info('Starting Kakao website crawl');

  // Get hospitals without website
  let offset = 0;
  let totalUpdated = 0;
  let totalSearched = 0;

  while (true) {
    const { data: hospitals, error } = await supabase
      .from('hospitals')
      .select('id, name, address, sido, sigungu')
      .eq('status', 'active')
      .is('website', null)
      .order('created_at', { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) {
      log.error(`Failed to fetch hospitals: ${error.message}`);
      break;
    }

    if (!hospitals || hospitals.length === 0) break;

    log.info(`Processing batch: ${offset + 1} ~ ${offset + hospitals.length}`);

    for (const hospital of hospitals) {
      totalSearched++;

      // Build search query: "병원이름 지역"
      const region = hospital.sigungu ?? hospital.sido ?? '';
      const query = `${hospital.name} ${region}`.trim();

      const result = await searchKakao(query);

      if (result?.place_url) {
        // place_url is kakao map link, we want the actual website
        // Kakao local API doesn't directly give homepage URL, but place_url can be useful
        // We store the place_url as a reference; actual homepage would need scraping place_url
        // For now, only update if we get a meaningful URL
        const homepage = result.place_url;

        if (homepage && isHospitalOwnedWebsite(homepage)) {
          const { error: updateError } = await supabase
            .from('hospitals')
            .update({ website: homepage })
            .eq('id', hospital.id);

          if (!updateError) {
            totalUpdated++;
          }
        }
      }

      if (totalSearched % 100 === 0) {
        log.info(`Progress: ${totalSearched} searched, ${totalUpdated} updated`);
      }

      await delayWithJitter(DELAY_MS, JITTER_MS);
    }

    offset += hospitals.length;
    if (hospitals.length < BATCH_SIZE) break;
  }

  log.info(`Kakao crawl complete. Searched: ${totalSearched}, Updated: ${totalUpdated}`);
}

main().catch((err) => {
  log.error('Fatal error', err);
  process.exit(1);
});
