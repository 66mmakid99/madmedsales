/**
 * Kakao 장소 검색 API 래퍼
 * category_group_code=HP8 (병원) 전용
 */
import https from 'https';

export interface KakaoPlace {
  id: string;
  place_name: string;
  address_name: string;
  road_address_name: string;
  phone: string;
  x: string; // longitude
  y: string; // latitude
  category_group_code: string;
}

interface KakaoResponse {
  documents: KakaoPlace[];
  meta: { total_count: number };
}

const KAKAO_API_KEY = process.env.KAKAO_REST_API_KEY ?? '';

export async function searchKakaoPlaces(
  query: string,
  options: { size?: number } = {}
): Promise<KakaoPlace[]> {
  const params = new URLSearchParams({
    query,
    category_group_code: 'HP8',
    size: String(options.size ?? 5),
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'dapi.kakao.com',
        path: `/v2/local/search/keyword.json?${params}`,
        headers: { Authorization: `KakaoAK ${KAKAO_API_KEY}` },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        res.on('end', () => {
          try {
            const json = JSON.parse(body) as KakaoResponse;
            resolve(json.documents ?? []);
          } catch (e) {
            reject(new Error(`Kakao JSON parse error: ${body.slice(0, 100)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}
