/**
 * 카카오 지도 API 지오코딩
 * 병원 주소를 위도/경도 좌표로 변환하여 DB에 업데이트합니다.
 */
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { supabase } from '../utils/supabase.js';
import { delay } from '../utils/delay.js';
import { createLogger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const log = createLogger('geocode');

const KAKAO_REST_API_KEY = process.env.KAKAO_REST_API_KEY;
if (!KAKAO_REST_API_KEY) {
  throw new Error('Missing KAKAO_REST_API_KEY in scripts/.env');
}

const DELAY_MS = 100;
const BATCH_SIZE = 50;

interface KakaoGeoResponse {
  documents: {
    address_name: string;
    x: string; // longitude
    y: string; // latitude
  }[];
  meta: { total_count: number };
}

async function geocodeAddress(
  address: string
): Promise<{ latitude: number; longitude: number } | null> {
  try {
    const response = await axios.get<KakaoGeoResponse>(
      'https://dapi.kakao.com/v2/local/search/address.json',
      {
        params: { query: address },
        headers: {
          Authorization: `KakaoAK ${KAKAO_REST_API_KEY}`,
        },
        timeout: 5000,
      }
    );

    const docs = response.data.documents;
    if (docs.length === 0) return null;

    return {
      latitude: parseFloat(docs[0].y),
      longitude: parseFloat(docs[0].x),
    };
  } catch (err) {
    log.warn(`Geocoding failed for "${address}"`, err);
    return null;
  }
}

async function main(): Promise<void> {
  log.info('Starting geocoding');

  // Fetch hospitals without coordinates
  const { data: hospitals, error } = await supabase
    .from('hospitals')
    .select('id, name, address')
    .is('latitude', null)
    .not('address', 'is', null)
    .eq('status', 'active')
    .order('created_at', { ascending: true });

  if (error) {
    log.error('Failed to fetch hospitals', error);
    process.exit(1);
  }

  if (!hospitals || hospitals.length === 0) {
    log.info('No hospitals need geocoding');
    return;
  }

  log.info(`Found ${hospitals.length} hospitals to geocode`);

  let processed = 0;
  let success = 0;

  for (const hospital of hospitals) {
    processed++;

    if (!hospital.address) continue;

    const coords = await geocodeAddress(hospital.address);

    if (coords) {
      const { error: updateError } = await supabase
        .from('hospitals')
        .update({
          latitude: coords.latitude,
          longitude: coords.longitude,
        })
        .eq('id', hospital.id);

      if (updateError) {
        log.error(`Failed to update ${hospital.name}`, updateError);
      } else {
        success++;
        if (processed % BATCH_SIZE === 0) {
          log.info(
            `Progress: ${processed}/${hospitals.length} (${success} geocoded)`
          );
        }
      }
    } else {
      log.warn(`No coordinates for ${hospital.name}: ${hospital.address}`);
    }

    await delay(DELAY_MS);
  }

  log.info(
    `Geocoding complete. Processed: ${processed}, Success: ${success}`
  );
}

main().catch((err) => {
  log.error('Fatal error', err);
  process.exit(1);
});
