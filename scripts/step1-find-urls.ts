/**
 * step1-find-urls.ts
 *
 * TORR RF 납품처 URL 수집 (Step 1/3)
 * - FIND_URL (42개) + FIND_URL_THEN_CRAWL (6개) = 48개 대상
 * - No.37, No.55 (㈜메이코리아) 스킵 (유통사)
 * - 네이버 지역 검색 API 사용
 * - 결과를 JSON 파일 + Supabase crm_hospitals.website 업데이트
 *
 * 실행: npx tsx scripts/step1-find-urls.ts
 * DB 업데이트 포함: npx tsx scripts/step1-find-urls.ts --update-db
 */

import { supabase } from './utils/supabase.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

// ============================================================
// 마스터 데이터 로드
// ============================================================
interface MasterHospital {
  no: number;
  name: string;
  doctor: string;
  region: string;
  address: string;
  status: string;
  website: string | null;
  phase: string;
  in_db: boolean;
  eq_count: number;
  tr_count: number;
  search_query: string;
  url_status: string;
}

// crm-find-urls.ts에서 가져온 보정된 주소 (네이버 검색 매칭용)
const CORRECTED_ADDRESSES: Record<number, string> = {
  8: "경기도 화성시 동탄순환대로20길 55(영천동) 4층",
  9: "서울특별시 강남구 압구정로 326 PLIT빌딩 5, 6층",
  10: "대전광역시 서구 도안동로 137 제이빌딩 5층",
  11: "경기도 성남시 분당구 정자일로 166 A동 7층",
  12: "서울특별시 강남구 논현로 738 비에비스나무병원",
  13: "서울특별시 강남구 학동로 305 성원빌딩 2층",
  14: "서울특별시 강남구 선릉로 821 더프라임빌딩 4~6층",
  15: "서울특별시 강남구 도산대로 107 1-5층(신사동)",
  16: "서울특별시 강남구 강남대로 600 한유빌딩 5층",
  17: "충청남도 천안시 서북구 불당25로 176 (불당동) 에코시티 A동 3층 301호",
  18: "경기도 오산시 세마역로 28 하이플러스",
  19: "강원특별자치도 강릉시 하슬라로 43 3, 4층",
  20: "서울특별시 강남구 도산대로 440 네이처포엠 2층",
  21: "서울특별시 강남구 도산대로 521 라비에벨클래스 빌딩 6층",
  22: "울산광역시 남구 삼산로 289 스타빌딩 5층",
  23: "서울특별시 강남구 논현로 837, 4층 바롬의원(신사동)",
  24: "서울특별시 강남구 압구정로2길 46 코너하우스 6~8층",
  25: "서울특별시 강남구 삼성로 212 정석빌딩 4층",
  26: "서울특별시 강남구 강남대로 390 미진프라자 15층(역삼동)",
  27: "서울특별시 강남구 강남대로 362 폰즈타워 6층",
  28: "서울특별시 서초구 잠원로 39 1층",
  29: "경기도 의정부시 신촌로 21 2층",
  30: "서울특별시 영등포구 국제금융로 36 여의도파이낸스타워 지하 1층",
  31: "경기도 용인시 기흥구 신갈로 22 (구갈동) 동원빌딩 4층",
  32: "강원특별자치도 강릉시 월드컵로 62(교동) 3층",
  33: "서울특별시 강남구 압구정로 50길 21 8층",
  34: "부산광역시 해운대구 해운대로 768-10 협성빌딩 7층",
  35: "서울특별시 강남구 도산대로 139 뉴논현빌딩 6층",
  36: "서울특별시 송파구 올림픽로 269 1012호",
  37: "부산광역시 수영구 광남로 114, 302호(남천동)",
  38: "부산광역시 부산진구 서전로10번길 29 (부전동) 2층",
  39: "부산광역시 연제구 중앙대로 1153 (연산동) 3층",
  40: "서울특별시 강남구 강남대로 416 창림빌딩 7층",
  41: "서울특별시 강남구 도산대로 456 정인빌딩 3층",
  43: "경기도 고양시 일산동구 중앙로 1261 프라자동 5층",
  44: "부산광역시 해운대구 해운대로 808-18 마린타워 7층",
  45: "경기도 성남시 분당구 황새울로360번길 2 4층 401호",
  46: "경기도 성남시 분당구 야탑동 352-7, 4층",
  47: "광주광역시 서구 상무대로 780 8층(치평동)",
  48: "광주광역시 서구 상무대로 770 6층(치평동)",
  49: "서울특별시 마포구 신촌로 136 네오빌딩 6층",
  50: "서울특별시 강남구 도산대로 426, 4층",
  51: "부산광역시 부산진구 서전로 10번길 63 3층",
  52: "울산광역시 중구 성남3길 13(성남동)",
  53: "서울특별시 강남구 도산대로 502 7층",
  54: "대구광역시 수성구 달구벌대로 2528 메디스퀘어 4층",
  55: "부산광역시 수영구 광남로 114, 302호(남천동)",
  56: "서울특별시 강남구 도산대로 223 (신사동) 3층",
  57: "서울특별시 강서구 공항대로 200, 2층 201호(내발산동)",
  58: "대전광역시 유성구 계룡로 92 2층",
  59: "경기도 평택시 비전5로 1 뉴골든프라자 301호",
  61: "대구광역시 수성구 달구벌대로 2516 2층",
  63: "서울특별시 강남구 도산대로 452 빌딩2층",
  64: "경기도 안산시 단원구 중앙대로 833 3층",
  65: "서울특별시 마포구 양화로 186 LC타워 12층",
  66: "서울특별시 성동구 독서당로 261 1층",
  69: "울산광역시 남구 삼산로 266, 7층",
  70: "서울특별시 강남구 압구정로 50길 8 원풍빌딩 3층",
  71: "서울 용산구 서빙고로 17 해링턴스퀘어 E몰 2층 8호",
};

// 스킵할 번호 (유통사)
const SKIP_NOS = [37, 55];

// 블로그/SNS URL 판별
function isBlogOrSns(url: string): boolean {
  if (!url) return false;
  return /blog\.naver|cafe\.naver|instagram\.com|pf\.kakao|youtube\.com|booking\.naver/.test(url);
}

// ============================================================
// 네이버 검색 API
// ============================================================
interface NaverLocalItem {
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

interface NaverLocalResponse {
  lastBuildDate: string;
  total: number;
  start: number;
  display: number;
  items: NaverLocalItem[];
}

async function searchNaverLocal(query: string, display: number = 5): Promise<NaverLocalItem[]> {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('NAVER_CLIENT_ID/SECRET 미설정');
  }

  const url = `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(query)}&display=${display}`;
  const res = await fetch(url, {
    headers: {
      'X-Naver-Client-Id': clientId,
      'X-Naver-Client-Secret': clientSecret,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Naver API ${res.status}: ${text}`);
  }

  const data: NaverLocalResponse = await res.json();
  return data.items || [];
}

// 주소 유사도 검사 (간단 버전 - 핵심 키워드 매칭)
function addressMatch(apiAddress: string, refAddress: string): boolean {
  if (!apiAddress || !refAddress || refAddress === '(검색 미확인)') return false;

  // 핵심 도로명/지번 번호만 추출하여 비교
  const extractNumbers = (addr: string): string[] => {
    const nums = addr.match(/\d+(-\d+)?/g) || [];
    return nums.slice(0, 3); // 앞쪽 숫자 3개만
  };

  const extractKeywords = (addr: string): string[] => {
    // 구/동/로 이름 추출
    const keywords: string[] = [];
    const gu = addr.match(/([가-힣]+구)/g);
    if (gu) keywords.push(...gu);
    const dong = addr.match(/([가-힣]+동)/g);
    if (dong) keywords.push(...dong);
    const ro = addr.match(/([가-힣]+로)/g);
    if (ro) keywords.push(...ro);
    return keywords;
  };

  const apiNums = extractNumbers(apiAddress);
  const refNums = extractNumbers(refAddress);
  const apiKeywords = extractKeywords(apiAddress);
  const refKeywords = extractKeywords(refAddress);

  // 구 이름이 일치하면 높은 점수
  const guMatch = apiKeywords.some(k => k.endsWith('구') && refKeywords.includes(k));
  // 동 이름이 일치
  const dongMatch = apiKeywords.some(k => k.endsWith('동') && refKeywords.includes(k));
  // 도로명 일치
  const roMatch = apiKeywords.some(k => k.endsWith('로') && refKeywords.includes(k));
  // 번호 일치 (첫 번째 숫자)
  const numMatch = apiNums.length > 0 && refNums.length > 0 && apiNums[0] === refNums[0];

  // 구 + (동 or 로) 매칭이면 OK
  if (guMatch && (dongMatch || roMatch)) return true;
  // 도로명 + 번호 매칭이면 OK
  if (roMatch && numMatch) return true;
  // 시/군 + 동 매칭
  if (dongMatch && numMatch) return true;

  return false;
}

// 병원명 유사도 (HTML 태그 제거 후)
function nameMatch(apiTitle: string, hospitalName: string): boolean {
  const clean = apiTitle.replace(/<[^>]+>/g, '').trim();
  const name = hospitalName.replace(/\([^)]+\)/g, '').trim(); // 괄호 안 내용 제거

  // 완전 일치 또는 포함
  if (clean === name || clean.includes(name) || name.includes(clean)) return true;

  // 핵심 단어 비교 (2글자 이상 한글 단어)
  const cleanWords = clean.match(/[가-힣]{2,}/g) || [];
  const nameWords = name.match(/[가-힣]{2,}/g) || [];
  const overlap = cleanWords.filter(w => nameWords.some(nw => nw.includes(w) || w.includes(nw)));

  return overlap.length >= 1 && overlap.length >= nameWords.length * 0.5;
}

// ============================================================
// 병원 URL 검색 로직
// ============================================================
interface SearchResult {
  no: number;
  name: string;
  region: string;
  doctor: string;
  address: string;
  foundUrl: string;
  source: 'naver_local' | 'naver_web' | 'not_found' | 'blog_fallback';
  confidence: 'high' | 'medium' | 'low';
  apiTitle?: string;
  apiAddress?: string;
}

async function findUrl(hospital: MasterHospital): Promise<SearchResult> {
  const correctedAddr = CORRECTED_ADDRESSES[hospital.no] || hospital.address;
  const baseResult: SearchResult = {
    no: hospital.no,
    name: hospital.name,
    region: hospital.region,
    doctor: hospital.doctor,
    address: correctedAddr,
    foundUrl: '',
    source: 'not_found',
    confidence: 'low',
  };

  // 쿼리 순서: 병원명+지역, 병원명만
  const queries = [
    `${hospital.name} ${hospital.region}`,
    hospital.name,
  ];

  // 원장명이 있으면 세 번째 쿼리
  if (hospital.doctor && hospital.doctor !== '-') {
    queries.push(`${hospital.name} ${hospital.doctor} 원장`);
  }

  for (const query of queries) {
    try {
      const items = await searchNaverLocal(query, 5);

      for (const item of items) {
        const titleClean = item.title.replace(/<[^>]+>/g, '');
        const isNameOk = nameMatch(item.title, hospital.name);
        const isAddrOk = addressMatch(item.roadAddress || item.address, correctedAddr);

        // link가 있고, 블로그/SNS가 아닌 경우
        if (item.link && !isBlogOrSns(item.link) && isNameOk) {
          baseResult.foundUrl = item.link;
          baseResult.source = 'naver_local';
          baseResult.confidence = isAddrOk ? 'high' : 'medium';
          baseResult.apiTitle = titleClean;
          baseResult.apiAddress = item.roadAddress || item.address;
          return baseResult;
        }

        // link는 블로그인데 이름+주소 매칭인 경우 (블로그 폴백)
        if (item.link && isBlogOrSns(item.link) && isNameOk && isAddrOk) {
          // 이미 더 좋은 결과가 없을 때만
          if (!baseResult.foundUrl) {
            baseResult.foundUrl = item.link;
            baseResult.source = 'blog_fallback';
            baseResult.confidence = 'low';
            baseResult.apiTitle = titleClean;
            baseResult.apiAddress = item.roadAddress || item.address;
          }
        }

        // link 없지만 이름+주소 매칭 → 웹사이트 없는 병원으로 판정
        if (!item.link && isNameOk && isAddrOk) {
          baseResult.apiTitle = titleClean;
          baseResult.apiAddress = item.roadAddress || item.address;
        }
      }
    } catch (err) {
      console.error(`  ⚠️ 검색 에러 (${query}): ${err}`);
    }

    // rate limit
    await new Promise(r => setTimeout(r, 200));
  }

  return baseResult;
}

// ============================================================
// 네이버 웹 검색 (보조 - 지역검색에서 못 찾으면)
// ============================================================
async function searchNaverWeb(query: string): Promise<string | null> {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const url = `https://openapi.naver.com/v1/search/webkr.json?query=${encodeURIComponent(query)}&display=10`;
    const res = await fetch(url, {
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
      },
    });

    if (!res.ok) return null;
    const data = await res.json();

    if (data.items) {
      for (const item of data.items as Array<{ link: string; title: string }>) {
        const link = item.link;
        if (link && !isBlogOrSns(link) &&
            (link.includes('.co.kr') || link.includes('.com') || link.includes('.kr')) &&
            !link.includes('naver.com') && !link.includes('google.com') &&
            !link.includes('daum.net') && !link.includes('kakao.com') &&
            !link.includes('modoo.at') && !link.includes('tistory.com')) {
          return link;
        }
      }
    }
  } catch {
    // 무시
  }
  return null;
}

// ============================================================
// 메인
// ============================================================
async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════');
  console.log('  Step 1: TORR RF 납품처 URL 수집');
  console.log('═══════════════════════════════════════════════════\n');

  // 환경 확인
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error('❌ NAVER_CLIENT_ID / NAVER_CLIENT_SECRET가 scripts/.env에 없습니다.');
    process.exit(1);
  }
  console.log('✅ 네이버 검색 API 키 확인됨\n');

  // 네이버 API 테스트
  try {
    const testItems = await searchNaverLocal('강남피부과', 1);
    console.log(`✅ 네이버 API 연결 확인 (테스트 결과: ${testItems.length}건)\n`);
  } catch (err) {
    console.error(`❌ 네이버 API 연결 실패: ${err}`);
    process.exit(1);
  }

  // 마스터 데이터 로드
  const masterPath = path.resolve(__dirname, '..', 'torr-rf-master-71-v2.json');
  const masterData: MasterHospital[] = JSON.parse(fs.readFileSync(masterPath, 'utf-8'));

  // 대상 필터: FIND_URL + FIND_URL_THEN_CRAWL, 스킵 제외
  const targets = masterData.filter(h =>
    (h.phase === 'FIND_URL' || h.phase === 'FIND_URL_THEN_CRAWL') &&
    !SKIP_NOS.includes(h.no)
  );

  console.log(`📋 검색 대상: ${targets.length}개 병원`);
  console.log(`   FIND_URL: ${targets.filter(t => t.phase === 'FIND_URL').length}개`);
  console.log(`   FIND_URL_THEN_CRAWL: ${targets.filter(t => t.phase === 'FIND_URL_THEN_CRAWL').length}개`);
  console.log(`   스킵: No.37, No.55 (㈜메이코리아 유통사)\n`);
  console.log('───────────────────────────────────────────────────');

  const results: SearchResult[] = [];
  let foundCount = 0;
  let blogCount = 0;
  let notFoundCount = 0;

  for (let i = 0; i < targets.length; i++) {
    const h = targets[i];
    console.log(`\n[${i + 1}/${targets.length}] No.${h.no} ${h.name} (${h.region})`);

    const result = await findUrl(h);

    // 지역검색에서 공식 URL 못 찾았으면 웹 검색도 시도
    if (result.source === 'not_found' || result.source === 'blog_fallback') {
      const webQuery = `${h.name} ${h.region} 공식 홈페이지`;
      const webUrl = await searchNaverWeb(webQuery);
      if (webUrl) {
        result.foundUrl = webUrl;
        result.source = 'naver_web' as SearchResult['source'];
        result.confidence = 'medium';
        console.log(`  🔍 웹 검색으로 발견: ${webUrl}`);
      }
    }

    results.push(result);

    if (result.source === 'naver_local' || result.source === 'naver_web') {
      foundCount++;
      const icon = result.confidence === 'high' ? '✅' : '🟡';
      console.log(`  ${icon} ${result.foundUrl} [${result.confidence}] (${result.apiTitle || ''})`);
    } else if (result.source === 'blog_fallback') {
      blogCount++;
      console.log(`  📝 블로그/SNS만: ${result.foundUrl}`);
    } else {
      notFoundCount++;
      console.log(`  ❌ 미발견`);
    }

    // rate limit: 500ms
    await new Promise(r => setTimeout(r, 300));
  }

  // ============================================================
  // 결과 저장
  // ============================================================
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  결과 요약');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  ✅ 공식 URL 발견: ${foundCount}개`);
  console.log(`  📝 블로그/SNS만: ${blogCount}개`);
  console.log(`  ❌ 미발견: ${notFoundCount}개`);
  console.log(`  ─────────────────────`);
  console.log(`  전체: ${targets.length}개\n`);

  // JSON 저장
  const dataDir = path.resolve(__dirname, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const outputPath = path.resolve(dataDir, 'step1-url-results.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`💾 결과 저장: ${outputPath}`);

  // 미발견 목록
  const notFoundList = results.filter(r => r.source === 'not_found');
  if (notFoundList.length > 0) {
    console.log(`\n⚠️ 미발견 병원 (${notFoundList.length}개):`);
    for (const r of notFoundList) {
      console.log(`   No.${r.no} ${r.name} (${r.region})`);
    }
  }

  // Supabase 업데이트
  if (process.argv.includes('--update-db')) {
    console.log('\n💾 Supabase crm_hospitals.website 업데이트 중...');
    const urlsToUpdate = results.filter(r =>
      r.foundUrl && (r.source === 'naver_local' || r.source === 'naver_web')
    );

    let updated = 0;
    let errors = 0;

    for (const r of urlsToUpdate) {
      const { error } = await supabase
        .from('crm_hospitals')
        .update({ website: r.foundUrl })
        .eq('name', r.name)
        .eq('tenant_id', TENANT_ID);

      if (error) {
        console.log(`   ❌ ${r.name}: ${error.message}`);
        errors++;
      } else {
        console.log(`   ✅ ${r.name}: ${r.foundUrl}`);
        updated++;
      }
    }

    console.log(`\n   DB 업데이트: ${updated}건 성공, ${errors}건 실패`);
  } else {
    console.log('\n💡 DB 업데이트를 하려면: npx tsx scripts/step1-find-urls.ts --update-db');
  }

  // 다음 단계 안내
  const totalCrawlable = foundCount + masterData.filter(h => h.phase === 'CRAWL').length;
  console.log(`\n📊 다음 단계 (Step 2) 크롤링 대상: ~${totalCrawlable}개 병원`);
}

main().catch(console.error);
