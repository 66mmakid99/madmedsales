/**
 * crm-find-urls.ts
 * 
 * 역할: 50개 병원의 공식 웹사이트 URL을 네이버 검색으로 자동 수집
 * 실행: npx tsx scripts/crm-find-urls.ts
 * 
 * 전략:
 * 1. 네이버 검색 API (Client ID/Secret 필요) 또는
 * 2. Google Custom Search API 또는  
 * 3. SerpAPI 사용
 * 
 * 필요 env:
 *   NAVER_CLIENT_ID, NAVER_CLIENT_SECRET  (네이버 검색 API)
 *   또는 SERPAPI_KEY (SerpAPI - 무료 100회/월)
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

// ============================================================
// 71개 전체 납품처 마스터 데이터 (엑셀에서 추출)
// ============================================================
const MASTER_HOSPITALS = [
  { no: 1, name: "안산엔비의원", doctor: "기문상", region: "안산", address: "경기도 안산시 단원구 고잔로 76 (고잔동) 영풍프라자 211~214호" },
  { no: 2, name: "러블리피부과의원", doctor: "김진아", region: "대전", address: "대전광역시 서구 둔산남로 107 명문빌딩 201호" },
  { no: 3, name: "라마르프리미어의원", doctor: "황제완", region: "대구", address: "대구광역시 중구 달구벌대로 2077 현대백화점 6층" },
  { no: 4, name: "부산CF강남의원", doctor: "이병학", region: "부산", address: "부산광역시 해운대구 해운대로 794 엘리움 5층" },
  { no: 5, name: "미라벨의원", doctor: "이상수", region: "약수", address: "서울특별시 중구 동호로 163(신당동) 3층 301호(신동호빌딩)" },
  { no: 6, name: "연세팜스의원", doctor: "윤정현", region: "은평", address: "서울특별시 은평구 불광로17 (대조동) 대흥빌딩 6층" },
  { no: 7, name: "부평포에버의원", doctor: "장효승", region: "부평", address: "인천광역시 부평구 부평대로 16(부평동) 4층" },
  { no: 8, name: "엔의원", doctor: "김범석", region: "동탄", address: "경기도 화성시 동탄순환대로20길 55(영천동) 4층" },
  { no: 9, name: "메이린 압구정", doctor: "박현준", region: "압구정", address: "서울특별시 강남구 압구정로 326 PLIT빌딩 5, 6층" },
  { no: 10, name: "더웰피부과", doctor: "김형주", region: "대전", address: "대전광역시 서구 도안동로 137 제이빌딩 5층" },
  { no: 11, name: "분당오라클피부과", doctor: "김성권", region: "성남", address: "경기도 성남시 분당구 정자일로 166 A동 7층" },
  { no: 12, name: "비에비스나무병원", doctor: "주현정", region: "논현", address: "서울특별시 강남구 논현로 738 비에비스나무병원" },
  { no: 13, name: "셀린피부과의원", doctor: "김영훈", region: "학동", address: "서울특별시 강남구 학동로 305 성원빌딩 2층" },
  { no: 14, name: "탐클리닉", doctor: "권혜석", region: "압구정", address: "서울특별시 강남구 선릉로 821 더프라임빌딩 4~6층" },
  { no: 15, name: "에어리어88성형외과", doctor: "서의석", region: "신사", address: "서울특별시 강남구 도산대로 107 1-5층(신사동)" },
  { no: 16, name: "동안중심의원", doctor: "조창환", region: "신사", address: "서울특별시 강남구 강남대로 600 한유빌딩 5층" },
  { no: 17, name: "천안이젠의원", doctor: "이란", region: "천안", address: "충청남도 천안시 서북구 불당25로 176 (불당동) 에코시티 A동 3층 301호" },
  { no: 18, name: "세마그린요양병원", doctor: "박종우", region: "오산", address: "경기도 오산시 세마역로 28 하이플러스" },
  { no: 19, name: "아가파퍼즐닥터의원", doctor: "임재규", region: "강릉", address: "강원특별자치도 강릉시 하슬라로 43 3, 4층" },
  { no: 20, name: "MH의원", doctor: "김지선", region: "청담", address: "서울특별시 강남구 도산대로 440 네이처포엠 2층" },
  { no: 21, name: "서희원클리닉", doctor: "서희원", region: "청담", address: "서울특별시 강남구 도산대로 521 라비에벨클래스 빌딩 6층" },
  { no: 22, name: "울산메이린의원", doctor: "김정근", region: "울산", address: "울산광역시 남구 삼산로 289 스타빌딩 5층" },
  { no: 23, name: "강남바롬의원", doctor: "고강영", region: "강남", address: "서울특별시 강남구 논현로 837, 4층 바롬의원(신사동)" },
  { no: 24, name: "포에버의원(신사)", doctor: "정혜진", region: "신사", address: "서울특별시 강남구 압구정로2길 46 코너하우스 6~8층" },
  { no: 25, name: "닥터로빈의원", doctor: "나공찬", region: "대치", address: "서울특별시 강남구 삼성로 212 정석빌딩 4층" },
  { no: 26, name: "바로코의원", doctor: "김 준", region: "강남", address: "서울특별시 강남구 강남대로 390 미진프라자 15층(역삼동)" },
  { no: 27, name: "미라인피부과의원", doctor: "방장석", region: "역삼", address: "서울특별시 강남구 강남대로 362 폰즈타워 6층" },
  { no: 28, name: "웰스킨의원", doctor: "황용호", region: "반포", address: "서울특별시 서초구 잠원로 39 1층" },
  { no: 29, name: "세인트의원", doctor: "김성수", region: "의정부", address: "경기도 의정부시 신촌로 21 2층" },
  { no: 30, name: "나의미래피부과의원", doctor: "노효진", region: "여의도", address: "서울특별시 영등포구 국제금융로 36 여의도파이낸스타워 지하 1층" },
  { no: 31, name: "선이고운여성의원", doctor: "김주한", region: "용인", address: "경기도 용인시 기흥구 신갈로 22 (구갈동) 동원빌딩 4층" },
  { no: 32, name: "힐링수의원(강릉)", doctor: "이상돈", region: "강릉", address: "강원특별자치도 강릉시 월드컵로 62(교동) 3층" },
  { no: 33, name: "청담아티젠의원", doctor: "윤승환", region: "청담", address: "서울특별시 강남구 압구정로 50길 21 8층" },
  { no: 34, name: "뷰티온메디", doctor: "유준현", region: "부산", address: "부산광역시 해운대구 해운대로 768-10 협성빌딩 7층" },
  { no: 35, name: "프레쉬성형외과", doctor: "이재일", region: "신사", address: "서울특별시 강남구 도산대로 139 뉴논현빌딩 6층" },
  { no: 36, name: "클럽미즈라미체의원", doctor: "주종호", region: "잠실", address: "서울특별시 송파구 올림픽로 269 1012호" },
  { no: 37, name: "㈜메이코리아", doctor: "권종성", region: "부산", address: "부산광역시 수영구 광남로 114, 302호(남천동)" },
  { no: 38, name: "파라다이스의원(부산)", doctor: "신부선", region: "부산", address: "부산광역시 부산진구 서전로10번길 29 (부전동) 2층" },
  { no: 39, name: "동백제니스(부산)", doctor: "원종인", region: "부산", address: "부산광역시 연제구 중앙대로 1153 (연산동) 3층" },
  { no: 40, name: "강남타임의원", doctor: "백나영", region: "강남", address: "서울특별시 강남구 강남대로 416 창림빌딩 7층" },
  { no: 41, name: "글래시피부과의원", doctor: "주홍진", region: "청담", address: "서울특별시 강남구 도산대로 456 정인빌딩 3층" },
  { no: 42, name: "디에이성형외과의원", doctor: "이상우", region: "강남", address: "서울특별시 강남구 테헤란로 125 동찬빌딩" },
  { no: 43, name: "메이린일산", doctor: "김형문", region: "일산", address: "경기도 고양시 일산동구 중앙로 1261 프라자동 5층" },
  { no: 44, name: "인앤아웃의원(부산)", doctor: "김태훈", region: "부산", address: "부산광역시 해운대구 해운대로 808-18 마린타워 7층" },
  { no: 45, name: "라뷰티의원", doctor: "유운영", region: "성남", address: "경기도 성남시 분당구 황새울로360번길 2 4층 401호" },
  { no: 46, name: "아가파의원", doctor: "유병준", region: "성남", address: "경기도 성남시 분당구 야탑동 352-7, 4층" },
  { no: 47, name: "벨버티의원(광주)", doctor: "강인웅", region: "광주", address: "광주광역시 서구 상무대로 780 8층(치평동)" },
  { no: 48, name: "청담리브의원(광주)", doctor: "박세령", region: "광주", address: "광주광역시 서구 상무대로 770 6층(치평동)" },
  { no: 49, name: "노벨의원(신촌)", doctor: "반정현", region: "마포", address: "서울특별시 마포구 신촌로 136 네오빌딩 6층" },
  { no: 50, name: "이에스청담의원(청담)", doctor: "임태길", region: "청담", address: "서울특별시 강남구 도산대로 426, 4층" },
  { no: 51, name: "디데이의원(부산)", doctor: "박인규", region: "부산", address: "부산광역시 부산진구 서전로 10번길 63 3층" },
  { no: 52, name: "울산제일병원", doctor: "이성흔", region: "울산", address: "울산광역시 중구 성남3길 13(성남동)" },
  { no: 53, name: "엠레드의원", doctor: "최두영", region: "청담", address: "서울특별시 강남구 도산대로 502 7층" },
  { no: 54, name: "강남수의원(대구)", doctor: "최용원", region: "대구", address: "대구광역시 수성구 달구벌대로 2528 메디스퀘어 4층" },
  { no: 55, name: "(주)메이코리아", doctor: "권종성", region: "부산", address: "부산광역시 수영구 광남로 114, 302호(남천동)" },
  { no: 56, name: "피어나의원", doctor: "최호성", region: "논현", address: "서울특별시 강남구 도산대로 223 (신사동) 3층" },
  { no: 57, name: "빈센트의원", doctor: "이화준", region: "강서", address: "서울특별시 강서구 공항대로 200, 2층 201호(내발산동)" },
  { no: 58, name: "크리미의원(유성)", doctor: "정호영", region: "유성", address: "대전광역시 유성구 계룡로 92 2층" },
  { no: 59, name: "휴먼피부과(평택)", doctor: "계지원", region: "평택", address: "경기도 평택시 비전5로 1 뉴골든프라자 301호" },
  { no: 60, name: "봉선화의원(청주)", doctor: "봉선욱", region: "청주", address: "(검색 미확인)" },
  { no: 61, name: "청담에프앤비의원(대구)", doctor: "손무현", region: "대구", address: "대구광역시 수성구 달구벌대로 2516 2층" },
  { no: 62, name: "리노보의원(부산)", doctor: "-", region: "부산", address: "부산 부산진구 서면로 25, 삼한골든뷰 6층" },
  { no: 63, name: "르벨의원", doctor: "황원욱", region: "청담", address: "서울특별시 강남구 도산대로 452 빌딩2층" },
  { no: 64, name: "뮤즈의원 안산", doctor: "김재민", region: "안산", address: "경기도 안산시 단원구 중앙대로 833 3층" },
  { no: 65, name: "샤인빔의원 홍대", doctor: "김동원", region: "홍대", address: "서울특별시 마포구 양화로 186 LC타워 12층" },
  { no: 66, name: "삼성웰내과의원", doctor: "정대준", region: "옥수", address: "서울특별시 성동구 독서당로 261 1층" },
  { no: 67, name: "나드라의원", doctor: "-", region: "미확인", address: "(검색 미확인)" },
  { no: 68, name: "리셋의원", doctor: "봉아라", region: "분당", address: "경기 성남시 분당구 황새울로342번길 21, 대정빌딩 5층" },
  { no: 69, name: "울산베러미의원", doctor: "이인홍", region: "울산", address: "울산광역시 남구 삼산로 266, 7층" },
  { no: 70, name: "다인피부과", doctor: "신항계", region: "신사", address: "서울특별시 강남구 압구정로 50길 8 원풍빌딩 3층" },
  { no: 71, name: "휴먼피부과(용산)", doctor: "변상영", region: "용산", address: "서울 용산구 서빙고로 17 해링턴스퀘어 E몰 2층 8호" },
];

// 이미 URL이 확보된 병원 (기존 크롤링 데이터에서)
const KNOWN_URLS: Record<string, string> = {
  "라마르프리미어의원": "http://www.pclamar.co.kr/new/",
  "연세팜스의원": "http://yonseifams.co.kr/",
  "엔의원": "http://www.nskin.kr",
  "비에비스나무병원": "https://www.vievisnamuh.com",
  "셀린피부과의원": "https://blog.naver.com/cellinskin", // 블로그 → 공식 URL 필요
  "동안중심의원": "http://www.dongancenter.com/",
  "포에버의원(신사)": "https://as.4-ever.co.kr",
  "웰스킨의원": "http://www.wellskinclinic.net/",
  "세인트의원": "https://blog.naver.com/dngmlgp32358", // 블로그 → 공식 URL 필요
  "나의미래피부과의원": "http://mymirae.co.kr/",
  "청담아티젠의원": "http://www.artisanclinic.co.kr",
  "클럽미즈라미체의원": "http://www.lamiche.co.kr/index.php",
  "강남타임의원": "http://www.gangnamtime.com",
  "글래시피부과의원": "https://booking.naver.com/booking/13/bizes/695390",
  "디에이성형외과의원": "https://daprs.com/", // 찾음
  "리노보의원(부산)": "http://www.renovo.co.kr/",
  "뮤즈의원 안산": "http://ansan.museclinic.co.kr/",
  "엠레드의원": "https://amredclinic.com/ko",
  "노벨의원(신촌)": "http://novelclinic1.com/",
  "피어나의원": "https://blog.naver.com/femaleuro", // 블로그 → 공식 URL 필요
  "빈센트의원": "http://vincent.kr/",
  "크리미의원(유성)": "http://cafe.naver.com/apinkatudia", // 카페 → 공식 URL 필요
  "휴먼피부과(평택)": "http://pastelskin.com/",
  "르벨의원": "https://www.instagram.com/dr.hwang_wonuk_lebelleclinic", // 인스타 → 공식 URL 필요
  "아가파의원": "http://www.agafarclinic.com/",
  "라뷰티의원": "", // 없음
  "나드라의원": "", // 없음
  "리셋의원": "http://pf.kakao.com/_xbsWQj", // 카카오 → 공식 URL 필요
  "다인피부과": "http://www.dainskin.co.kr/",
  "휴먼피부과(용산)": "http://pastelskin.com/",
  "삼성웰내과의원": "", // 없음
  "미라벨의원": "", // 없음
};

// 블로그/SNS URL인지 판별
function isBlogOrSns(url: string): boolean {
  if (!url) return false;
  return /blog\.naver|cafe\.naver|instagram\.com|pf\.kakao|youtube\.com|booking\.naver/.test(url);
}

// ============================================================
// 네이버 검색 API로 URL 찾기
// ============================================================
async function searchNaverLocal(query: string): Promise<string | null> {
  // 방법 1: 네이버 지역 검색 API
  // https://developers.naver.com/docs/serviceapi/search/local/local.md
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  
  if (!clientId || !clientSecret) {
    console.log('⚠️ NAVER_CLIENT_ID/SECRET 없음 → Google 검색 시도');
    return null;
  }

  try {
    const url = `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(query)}&display=1`;
    const res = await fetch(url, {
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
      }
    });
    const data = await res.json();
    
    if (data.items && data.items.length > 0) {
      const item = data.items[0];
      // 네이버 지역검색은 link 필드에 홈페이지 URL이 있음
      if (item.link && !isBlogOrSns(item.link)) {
        return item.link;
      }
    }
  } catch (err) {
    console.error(`  네이버 검색 실패: ${err}`);
  }
  return null;
}

// 방법 2: Google Custom Search (대안)
async function searchGoogle(query: string): Promise<string | null> {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const cx = process.env.GOOGLE_SEARCH_CX;
  
  if (!apiKey || !cx) return null;

  try {
    const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(query)}&num=5`;
    const res = await fetch(url);
    const data = await res.json();
    
    if (data.items) {
      for (const item of data.items) {
        const link = item.link;
        if (link && !isBlogOrSns(link) && (link.includes('.co.kr') || link.includes('.com') || link.includes('.kr'))) {
          return link;
        }
      }
    }
  } catch (err) {
    console.error(`  Google 검색 실패: ${err}`);
  }
  return null;
}

// 방법 3: SerpAPI (무료 100회/월)
async function searchSerpApi(query: string): Promise<string | null> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) return null;

  try {
    const url = `https://serpapi.com/search.json?engine=naver&query=${encodeURIComponent(query)}&api_key=${apiKey}`;
    const res = await fetch(url);
    const data = await res.json();
    
    // 네이버 플레이스 결과에서 홈페이지 추출
    if (data.places_results) {
      for (const place of data.places_results) {
        if (place.website && !isBlogOrSns(place.website)) {
          return place.website;
        }
      }
    }
    
    // 일반 검색 결과에서 추출
    if (data.organic_results) {
      for (const result of data.organic_results) {
        const link = result.link;
        if (link && !isBlogOrSns(link) && (link.includes('.co.kr') || link.includes('.com') || link.includes('.kr'))) {
          return link;
        }
      }
    }
  } catch (err) {
    console.error(`  SerpAPI 실패: ${err}`);
  }
  return null;
}

// 병원 URL 검색
async function findHospitalUrl(hospital: typeof MASTER_HOSPITALS[0]): Promise<string | null> {
  const queries = [
    `${hospital.name} ${hospital.region} 피부과`,
    `${hospital.name} ${hospital.region}`,
    `${hospital.name} ${hospital.doctor} 원장`,
  ];

  for (const query of queries) {
    // 순서대로 시도
    let url = await searchNaverLocal(query);
    if (url) return url;
    
    url = await searchSerpApi(query);
    if (url) return url;
    
    url = await searchGoogle(query);
    if (url) return url;
  }

  return null;
}

// ============================================================
// 메인 실행
// ============================================================
async function main() {
  console.log('🔍 TORR RF 납품처 URL 수집 시작\n');
  
  const results: Array<{
    no: number;
    name: string;
    region: string;
    website: string;
    source: string;
    phase: string;
  }> = [];

  for (const h of MASTER_HOSPITALS) {
    const known = KNOWN_URLS[h.name];
    
    // 이미 유효한 URL이 있는 경우
    if (known && !isBlogOrSns(known) && known !== '') {
      results.push({ no: h.no, name: h.name, region: h.region, website: known, source: 'existing', phase: 'CRAWL' });
      console.log(`✅ ${h.no}. ${h.name}: ${known} (기존)`);
      continue;
    }

    // 검색 필요
    console.log(`🔍 ${h.no}. ${h.name} (${h.region}) 검색 중...`);
    const foundUrl = await findHospitalUrl(h);
    
    if (foundUrl) {
      results.push({ no: h.no, name: h.name, region: h.region, website: foundUrl, source: 'search', phase: 'CRAWL' });
      console.log(`  ✅ 발견: ${foundUrl}`);
    } else {
      // 블로그/SNS URL이라도 있으면 저장
      const fallback = known || '';
      results.push({ no: h.no, name: h.name, region: h.region, website: fallback, source: 'not_found', phase: 'MANUAL' });
      console.log(`  ❌ 미발견 (폴백: ${fallback || '없음'})`);
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 500));
  }

  // 결과 저장
  const fs = await import('fs');
  fs.writeFileSync('scripts/data/url-search-results.json', JSON.stringify(results, null, 2));

  // Supabase 업데이트 (선택)
  console.log('\n📊 결과 요약:');
  const found = results.filter(r => r.phase === 'CRAWL').length;
  const notFound = results.filter(r => r.phase === 'MANUAL').length;
  console.log(`  URL 확보: ${found}개`);
  console.log(`  수동 확인 필요: ${notFound}개`);
  
  // Supabase에 업데이트할지 확인
  if (process.argv.includes('--update-db')) {
    console.log('\n💾 Supabase 업데이트 중...');
    for (const r of results) {
      if (r.website && r.phase === 'CRAWL') {
        // crm_hospitals 테이블에 website 업데이트
        // 먼저 name으로 찾아서 업데이트
        const { error } = await supabase
          .from('crm_hospitals')
          .update({ website: r.website })
          .eq('name', r.name)
          .eq('tenant_id', TENANT_ID);
          
        if (error) {
          console.log(`  ❌ ${r.name}: ${error.message}`);
        } else {
          console.log(`  ✅ ${r.name}: DB 업데이트`);
        }
      }
    }
  }

  console.log('\n✅ 완료! 결과: scripts/data/url-search-results.json');
}

main().catch(console.error);
