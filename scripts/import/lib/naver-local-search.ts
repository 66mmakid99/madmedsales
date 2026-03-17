/**
 * Naver 지역 검색 API 래퍼
 * API: https://openapi.naver.com/v1/search/local.json
 */
import https from 'https';

export interface NaverPlace {
  title: string;        // HTML 태그 포함 가능
  address: string;      // 지번주소
  roadAddress: string;  // 도로명주소
  telephone: string;    // 전화번호
  category: string;
}

interface NaverResponse {
  items: NaverPlace[];
  total: number;
}

const NAVER_ID     = process.env.NAVER_CLIENT_ID ?? '';
const NAVER_SECRET = process.env.NAVER_CLIENT_SECRET ?? '';

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '').trim();
}

export async function searchNaverLocal(
  query: string,
  display = 5
): Promise<NaverPlace[]> {
  const params = new URLSearchParams({ query, display: String(display) });

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'openapi.naver.com',
        path: `/v1/search/local.json?${params}`,
        headers: {
          'X-Naver-Client-Id':     NAVER_ID,
          'X-Naver-Client-Secret': NAVER_SECRET,
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        res.on('end', () => {
          try {
            const json = JSON.parse(body) as NaverResponse;
            resolve(
              (json.items ?? []).map(item => ({
                ...item,
                title: stripHtml(item.title),
              }))
            );
          } catch {
            resolve([]);
          }
        });
      }
    );
    req.on('error', () => resolve([]));
    req.end();
  });
}
