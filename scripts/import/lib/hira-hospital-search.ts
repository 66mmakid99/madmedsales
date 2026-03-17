/**
 * 건강보험심사평가원(HIRA) 요양기관 정보 API 래퍼
 * API: https://apis.data.go.kr/B551182/hospInfoService1/getHospBasisList
 */
import https from 'https';

export interface HiraHospital {
  yadmNm: string;   // 요양기관명
  addr: string;     // 주소
  telno: string;    // 전화번호
  XPos: string;     // 경도
  YPos: string;     // 위도
  ykiho: string;    // 요양기관기호
  clCd: string;     // 종별코드 (21=의원, 11=상급종합 등)
}

interface HiraResponse {
  response: {
    body: {
      items: { item: HiraHospital | HiraHospital[] } | '';
      totalCount: number;
    };
  };
}

const DATA_GO_KEY = process.env.DATA_GO_KR_API_KEY ?? '';

export async function searchHiraHospitals(params: {
  name: string;
  sido?: string;
  sigungu?: string;
  numOfRows?: number;
}): Promise<HiraHospital[]> {
  const query = new URLSearchParams({
    serviceKey: DATA_GO_KEY,
    yadmNm:     params.name,
    numOfRows:  String(params.numOfRows ?? 10),
    pageNo:     '1',
    _type:      'json',
  });

  // 시도코드 매핑 (심평원 코드)
  const SIDO_CODE: Record<string, string> = {
    '서울': '110000', '경기': '410000', '인천': '280000',
    '부산': '260000', '대구': '270000', '광주': '290000',
    '대전': '300000', '울산': '310000', '세종': '360000',
  };
  if (params.sido && SIDO_CODE[params.sido]) {
    query.set('sidoCd', SIDO_CODE[params.sido]);
  }

  return new Promise((resolve, reject) => {
    const url = `https://apis.data.go.kr/B551182/hospInfoService1/getHospBasisList?${query}`;
    https.get(url, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      res.on('end', () => {
        try {
          const json = JSON.parse(body) as HiraResponse;
          const items = json.response?.body?.items;
          if (!items || items === '') return resolve([]);
          const raw = items.item;
          if (!raw) return resolve([]);
          resolve(Array.isArray(raw) ? raw : [raw]);
        } catch {
          resolve([]); // API 오류 시 빈 배열
        }
      });
    }).on('error', () => resolve([]));
  });
}
