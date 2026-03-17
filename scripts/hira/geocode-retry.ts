/**
 * Geocoding 실패건 재시도
 * 1차: 주소에서 층수/호수/상세 제거 → 도로명+건물번호만
 * 2차: 지번주소로 폴백
 * 최종 실패건 리스트 출력
 *
 * 실행: npx tsx scripts/hira/geocode-retry.ts
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

const log = createLogger('geocode-retry');

const KAKAO_API_KEY = process.env.KAKAO_REST_API_KEY;
if (!KAKAO_API_KEY) {
  throw new Error('Missing KAKAO_REST_API_KEY in scripts/.env');
}

const KAKAO_ADDRESS_URL = 'https://dapi.kakao.com/v2/local/search/address.json';
const KAKAO_KEYWORD_URL = 'https://dapi.kakao.com/v2/local/search/keyword.json';
const DELAY_MS = 200;

interface KakaoAddressDoc {
  address_name: string;
  road_address: { address_name: string } | null;
  x: string;
  y: string;
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
    return docs?.length ? docs[0] : null;
  } catch {
    return null;
  }
}

async function searchByKeyword(query: string): Promise<KakaoKeywordDoc | null> {
  try {
    const { data } = await axios.get(KAKAO_KEYWORD_URL, {
      headers: { Authorization: `KakaoAK ${KAKAO_API_KEY}` },
      params: { query, page: 1, size: 1 },
    });
    const docs = data?.documents as KakaoKeywordDoc[];
    return docs?.length ? docs[0] : null;
  } catch {
    return null;
  }
}

/**
 * 주소에서 상세정보(층수, 호수, 쉼표 이후) 제거
 * "서울특별시 강남구 압구정로80길 33, 2,4층 (청담동)" → "서울특별시 강남구 압구정로80길 33"
 */
function simplifyAddress(addr: string): string {
  // 쉼표 이전까지만 추출
  let simplified = addr.split(',')[0].trim();

  // 괄호 안 동 정보 제거
  simplified = simplified.replace(/\s*\(.*?\)\s*/g, '').trim();

  // 끝에 붙은 층/호 제거 (예: "3층", "201호")
  simplified = simplified.replace(/\s+\d+[-~\d]*층?\s*$/g, '').trim();

  return simplified;
}

/**
 * 주소에서 지번 부분 추출 시도
 * 괄호 안의 동 이름 + 시/구 정보 조합
 */
function extractJibunHint(addr: string): string | null {
  // 괄호 안 동 이름 추출
  const dongMatch = addr.match(/\(([^,)]+)/);
  if (!dongMatch) return null;
  const dong = dongMatch[1].trim();

  // 시/구 추출
  const parts = addr.split(/\s+/);
  if (parts.length < 3) return null;

  // "서울특별시 강남구 동이름" 형태로 조합
  return `${parts[0]} ${parts[1]} ${dong}`;
}

async function main(): Promise<void> {
  // geocoded_at이 있지만 address_normalized가 null인 병원 = 실패건
  const { data: failedHospitals, error } = await supabase
    .from('hospitals')
    .select('id, name, address, latitude, longitude')
    .eq('status', 'active')
    .not('geocoded_at', 'is', null)
    .is('address_normalized', null);

  if (error) throw new Error(`Query failed: ${error.message}`);
  if (!failedHospitals || failedHospitals.length === 0) {
    log.info('No failed hospitals to retry');
    return;
  }

  log.info(`=== Retrying ${failedHospitals.length} failed hospitals ===`);

  let success = 0;
  let coordUpdated = 0;
  const finalFails: Array<{ name: string; address: string }> = [];

  for (const h of failedHospitals) {
    const addr = h.address as string;
    if (!addr) {
      finalFails.push({ name: h.name, address: '(주소 없음)' });
      continue;
    }

    let normalized: string | null = null;
    let lat: number | null = null;
    let lng: number | null = null;

    // 1차: 주소 단순화 후 재검색
    const simplified = simplifyAddress(addr);
    if (simplified !== addr) {
      const result = await searchByAddress(simplified);
      await delay(DELAY_MS);

      if (result) {
        normalized = result.road_address?.address_name ?? result.address_name;
        lat = parseFloat(result.y);
        lng = parseFloat(result.x);
      }
    }

    // 2차: 지번 힌트로 검색
    if (!normalized) {
      const jibunHint = extractJibunHint(addr);
      if (jibunHint) {
        const result = await searchByAddress(jibunHint);
        await delay(DELAY_MS);

        if (result) {
          normalized = result.road_address?.address_name ?? result.address_name;
          lat = parseFloat(result.y);
          lng = parseFloat(result.x);
        }
      }
    }

    // 3차: 병원명으로 키워드 검색
    if (!normalized) {
      const kwResult = await searchByKeyword(h.name);
      await delay(DELAY_MS);

      if (kwResult) {
        normalized = kwResult.road_address_name || kwResult.address_name;
        lat = parseFloat(kwResult.y);
        lng = parseFloat(kwResult.x);
      }
    }

    if (!normalized) {
      finalFails.push({ name: h.name, address: addr });
      continue;
    }

    const updateData: Record<string, unknown> = {
      address_normalized: normalized,
      geocoded_at: new Date().toISOString(),
    };

    if (lat && lng && (!h.latitude || !h.longitude)) {
      updateData.latitude = lat;
      updateData.longitude = lng;
      coordUpdated++;
    }

    const { error: updateErr } = await supabase
      .from('hospitals')
      .update(updateData)
      .eq('id', h.id);

    if (updateErr) {
      log.error(`Update failed: ${h.name} — ${updateErr.message}`);
      finalFails.push({ name: h.name, address: addr });
    } else {
      success++;
      log.info(`✓ ${h.name} → ${normalized}`);
    }
  }

  log.info('');
  log.info('=== Retry complete ===');
  log.info(`Success: ${success}/${failedHospitals.length}`);
  log.info(`Coords updated: ${coordUpdated}`);
  log.info(`Final fails: ${finalFails.length}`);

  if (finalFails.length > 0) {
    log.info('');
    log.info('=== Final failed list ===');
    for (const f of finalFails) {
      log.info(`  ✗ ${f.name} | ${f.address}`);
    }
  }
}

main().catch((err) => {
  log.error('Fatal error', err);
  process.exit(1);
});
