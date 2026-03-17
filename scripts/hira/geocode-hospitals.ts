/**
 * Step 1-C: 주소 정규화 + 좌표 변환 (Kakao REST API)
 *
 * Kakao 주소 검색 API로 hospitals 테이블의 주소를 정규화하고 위도/경도를 업데이트.
 * geocoded_at이 null인 병원만 대상.
 *
 * 실행: npx tsx scripts/hira/geocode-hospitals.ts
 * 옵션: --limit 100 (처리할 최대 건수, 기본 전체)
 *       --force (이미 geocoded된 건도 재처리)
 */
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { supabase } from '../utils/supabase.js';
import { createLogger } from '../utils/logger.js';
import { delay } from '../utils/delay.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const log = createLogger('geocode');

const KAKAO_API_KEY = process.env.KAKAO_REST_API_KEY;
if (!KAKAO_API_KEY) {
  throw new Error('Missing KAKAO_REST_API_KEY in scripts/.env');
}

const KAKAO_ADDRESS_URL = 'https://dapi.kakao.com/v2/local/search/address.json';
const KAKAO_KEYWORD_URL = 'https://dapi.kakao.com/v2/local/search/keyword.json';
const DELAY_MS = 200; // Kakao API: 초당 10건 제한

interface KakaoAddressDoc {
  address_name: string;
  road_address: {
    address_name: string;
    zone_no: string;
  } | null;
  x: string; // longitude
  y: string; // latitude
}

interface KakaoKeywordDoc {
  place_name: string;
  address_name: string;
  road_address_name: string;
  x: string;
  y: string;
}

async function searchByAddress(query: string): Promise<KakaoAddressDoc | null> {
  try {
    const { data } = await axios.get(KAKAO_ADDRESS_URL, {
      headers: { Authorization: `KakaoAK ${KAKAO_API_KEY}` },
      params: { query, analyze_type: 'similar', page: 1, size: 1 },
    });

    const docs = data?.documents as KakaoAddressDoc[];
    if (!docs || docs.length === 0) return null;
    return docs[0];
  } catch (err) {
    log.error(`Kakao address search failed: ${query}`, err);
    return null;
  }
}

async function searchByKeyword(
  name: string,
  address: string,
): Promise<KakaoKeywordDoc | null> {
  try {
    const { data } = await axios.get(KAKAO_KEYWORD_URL, {
      headers: { Authorization: `KakaoAK ${KAKAO_API_KEY}` },
      params: { query: `${name} ${address}`, page: 1, size: 1 },
    });

    const docs = data?.documents as KakaoKeywordDoc[];
    if (!docs || docs.length === 0) return null;
    return docs[0];
  } catch (err) {
    log.error(`Kakao keyword search failed: ${name}`, err);
    return null;
  }
}

async function loadTargetHospitals(
  limit: number,
  force: boolean,
): Promise<
  Array<{
    id: string;
    name: string;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
  }>
> {
  let query = supabase
    .from('hospitals')
    .select('id, name, address, latitude, longitude')
    .eq('status', 'active')
    .not('address', 'is', null);

  if (!force) {
    query = query.is('geocoded_at', null);
  }

  if (limit > 0) {
    query = query.limit(limit);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to load hospitals: ${error.message}`);
  return data ?? [];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 0;
  const force = args.includes('--force');

  log.info(
    `=== Starting geocoding via Kakao API (limit=${limit || 'all'}, force=${force}) ===`,
  );

  const hospitals = await loadTargetHospitals(limit, force);
  log.info(`Found ${hospitals.length} hospitals to geocode`);

  let success = 0;
  let coordUpdated = 0;
  let noResult = 0;
  let errors = 0;

  for (let i = 0; i < hospitals.length; i++) {
    const h = hospitals[i];
    const address = h.address;

    if (!address) {
      noResult++;
      continue;
    }

    // 1차: 주소 검색
    let normalized: string | null = null;
    let lat: number | null = null;
    let lng: number | null = null;

    const addrResult = await searchByAddress(address);
    await delay(DELAY_MS);

    if (addrResult) {
      normalized =
        addrResult.road_address?.address_name ?? addrResult.address_name;
      lat = parseFloat(addrResult.y);
      lng = parseFloat(addrResult.x);
    } else {
      // 2차: 병원명 + 주소 키워드 검색
      const kwResult = await searchByKeyword(h.name, address);
      await delay(DELAY_MS);

      if (kwResult) {
        normalized = kwResult.road_address_name || kwResult.address_name;
        lat = parseFloat(kwResult.y);
        lng = parseFloat(kwResult.x);
      }
    }

    if (!normalized && !lat) {
      noResult++;
      log.warn(`No result for: ${h.name} (${address})`);

      await supabase
        .from('hospitals')
        .update({ geocoded_at: new Date().toISOString() })
        .eq('id', h.id);

      continue;
    }

    const updateData: Record<string, unknown> = {
      geocoded_at: new Date().toISOString(),
    };

    if (normalized) {
      updateData.address_normalized = normalized;
    }

    // 기존 좌표가 없거나 0인 경우에만 좌표 업데이트
    if (lat && lng && (!h.latitude || !h.longitude)) {
      updateData.latitude = lat;
      updateData.longitude = lng;
      coordUpdated++;
    }

    const { error } = await supabase
      .from('hospitals')
      .update(updateData)
      .eq('id', h.id);

    if (error) {
      errors++;
      log.error(`Update failed for ${h.name}: ${error.message}`);
    } else {
      success++;
    }

    if ((i + 1) % 100 === 0) {
      log.info(
        `Progress: ${i + 1}/${hospitals.length} (success=${success}, coords=${coordUpdated}, noResult=${noResult})`,
      );
    }
  }

  log.info('=== Geocoding complete ===');
  log.info(`Success: ${success}`);
  log.info(`Coords updated: ${coordUpdated}`);
  log.info(`No result: ${noResult}`);
  log.info(`Errors: ${errors}`);
}

main().catch((err) => {
  log.error('Fatal error', err);
  process.exit(1);
});
