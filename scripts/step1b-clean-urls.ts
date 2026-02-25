/**
 * step1b-clean-urls.ts
 *
 * Step 1 결과 정제: 병원 정보 사이트, 뉴스, 관련 없는 URL 제거
 * 공식 홈페이지 URL만 남기고, 나머지는 not_found로 변경
 *
 * 실행: npx tsx scripts/step1b-clean-urls.ts
 * DB 업데이트: npx tsx scripts/step1b-clean-urls.ts --update-db
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase } from './utils/supabase.js';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

// 병원 정보 포털/관련 없는 도메인 필터
const INVALID_DOMAINS = [
  'hidoc.co.kr',
  'modoodoc.com',
  'goodoc.co.kr',
  'ddocdoc.com',
  'medinavi.co.kr',
  'mt.co.kr',         // 뉴스
  'newsrep.co.kr',    // 뉴스
  'mediup.co.kr',     // 의료 커뮤니티
  'facebook.com',     // SNS
  'shinewoman.co.kr', // 다른 병원
  '100원커피이벤트',   // 카페
  'litt.ly',          // 링크 서비스
];

// URL 특정 경로가 문제인 것들
const INVALID_URL_PATTERNS = [
  /ezenskin\.co\.kr\/skinCare/, // 하위 페이지 (루트가 맞음)
];

// 수동 보정: 자동 검색으로 잘못 나온 것들 수정
const MANUAL_OVERRIDES: Record<number, { url: string; note: string } | null> = {
  4: null,  // 부산CF강남의원 - hidoc → 공식 사이트 없음
  5: null,  // 미라벨의원 - facebook → 공식 사이트 없음
  7: { url: 'https://www.4-ever.co.kr/', note: '포에버 체인 공식 (부평 지점 페이지 있을 수 있음)' },
  13: null, // 셀린피부과의원 - hidoc → 블로그만 있음
  17: { url: 'http://www.ezenskin.co.kr/', note: '하위 페이지 → 루트로 보정' },
  19: null, // 아가파퍼즐닥터의원 - medinavi → 공식 사이트 없음
  20: null, // MH의원 - 셀앤의원 (다른 병원!) → 제거
  21: null, // 서희원클리닉 - 뉴스 기사 → 없음
  27: null, // 미라인피부과의원 - modoodoc → 없음
  31: null, // 선이고운여성의원 - ddocdoc → 없음
  32: null, // 힐링수의원(강릉) - modoodoc → 없음
  34: null, // 뷰티온메디 - 뉴스 기사 → 없음
  35: null, // 프레쉬성형외과 - hidoc (프레쉬 홍닥터의원 = 다른 병원!)
  39: null, // 동백제니스(부산) - 카페 → 없음 (피부과가 아닌 카페로 검색됨)
  54: null, // 강남수의원(대구) - hidoc → 없음
  56: null, // 피어나의원 - hidoc → 블로그만 있음
  58: null, // 크리미의원(유성) - mediup 커뮤니티 → 없음
  60: null, // 봉선화의원(청주) - modoodoc → 없음
  61: null, // 청담에프앤비의원(대구) - goodoc → 없음
  63: null, // 르벨의원 - hidoc → 없음
  67: null, // 나드라의원 - 다른 병원 사이트 → 없음
  68: null, // 리셋의원 - litt.ly 링크 (365리셋의원 = 수원, 다른 지점)
};

interface SearchResult {
  no: number;
  name: string;
  region: string;
  doctor: string;
  address: string;
  foundUrl: string;
  source: string;
  confidence: string;
  apiTitle?: string;
  apiAddress?: string;
}

interface CleanResult {
  no: number;
  name: string;
  region: string;
  url: string;
  status: 'valid' | 'invalid' | 'no_website';
  note: string;
}

function isInvalidUrl(url: string): boolean {
  if (!url) return true;
  for (const domain of INVALID_DOMAINS) {
    if (url.includes(domain)) return true;
  }
  for (const pattern of INVALID_URL_PATTERNS) {
    if (pattern.test(url)) return true;
  }
  return false;
}

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════');
  console.log('  Step 1b: URL 결과 정제');
  console.log('═══════════════════════════════════════════════════\n');

  const inputPath = path.resolve(__dirname, 'data', 'step1-url-results.json');
  const rawResults: SearchResult[] = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));

  const cleanResults: CleanResult[] = [];
  let validCount = 0;
  let invalidCount = 0;
  let noWebsiteCount = 0;

  for (const r of rawResults) {
    // 수동 보정 체크
    if (r.no in MANUAL_OVERRIDES) {
      const override = MANUAL_OVERRIDES[r.no];
      if (override) {
        cleanResults.push({
          no: r.no, name: r.name, region: r.region,
          url: override.url,
          status: 'valid',
          note: `수동 보정: ${override.note}`,
        });
        validCount++;
        console.log(`✅ No.${r.no} ${r.name}: ${override.url} (수동 보정)`);
      } else {
        cleanResults.push({
          no: r.no, name: r.name, region: r.region,
          url: '',
          status: 'no_website',
          note: '공식 웹사이트 미확인 (자동 검색 결과 무효)',
        });
        noWebsiteCount++;
        console.log(`❌ No.${r.no} ${r.name}: 공식 사이트 없음 (${r.foundUrl} 제거)`);
      }
      continue;
    }

    // 자동 필터
    if (isInvalidUrl(r.foundUrl)) {
      cleanResults.push({
        no: r.no, name: r.name, region: r.region,
        url: '',
        status: 'invalid',
        note: `무효 URL 제거: ${r.foundUrl}`,
      });
      invalidCount++;
      console.log(`🗑️ No.${r.no} ${r.name}: ${r.foundUrl} (무효)`);
      continue;
    }

    // 유효한 URL
    cleanResults.push({
      no: r.no, name: r.name, region: r.region,
      url: r.foundUrl,
      status: 'valid',
      note: `${r.source} [${r.confidence}]`,
    });
    validCount++;
    console.log(`✅ No.${r.no} ${r.name}: ${r.foundUrl}`);
  }

  // 마스터 데이터의 CRAWL phase 병원도 포함 (이미 URL 있는 것)
  const masterPath = path.resolve(__dirname, '..', 'torr-rf-master-71-v2.json');
  interface MasterEntry {
    no: number;
    name: string;
    region: string;
    website: string | null;
    phase: string;
  }
  const masterData: MasterEntry[] = JSON.parse(fs.readFileSync(masterPath, 'utf-8'));
  const crawlPhase = masterData.filter(h => h.phase === 'CRAWL');

  console.log('\n───────────────────────────────────────────────────');
  console.log('  기존 CRAWL phase 병원 (URL 확인됨):');
  console.log('───────────────────────────────────────────────────');
  for (const h of crawlPhase) {
    console.log(`  🔄 No.${h.no} ${h.name}: ${h.website}`);
  }

  // ============================================================
  // 최종 크롤링 대상 목록 생성
  // ============================================================
  const crawlTargets: Array<{ no: number; name: string; region: string; url: string; source: string }> = [];

  // CRAWL phase (기존 URL)
  for (const h of crawlPhase) {
    if (h.website) {
      crawlTargets.push({ no: h.no, name: h.name, region: h.region, url: h.website, source: 'existing_crawl' });
    }
  }

  // Step 1 검색 결과 중 유효한 것
  for (const r of cleanResults) {
    if (r.status === 'valid' && r.url) {
      crawlTargets.push({ no: r.no, name: r.name, region: r.region, url: r.url, source: 'step1_search' });
    }
  }

  // 결과 요약
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  정제 결과 요약');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  ✅ 유효 공식 URL: ${validCount}개`);
  console.log(`  🗑️ 무효 URL 제거: ${invalidCount}개`);
  console.log(`  ❌ 공식 사이트 없음: ${noWebsiteCount}개`);
  console.log(`  ─────────────────────`);
  console.log(`  전체: ${rawResults.length}개\n`);
  console.log(`  📋 Step 2 크롤링 대상: ${crawlTargets.length}개`);
  console.log(`    - 기존 CRAWL: ${crawlPhase.length}개`);
  console.log(`    - Step 1 검색: ${validCount}개`);

  // 저장
  const dataDir = path.resolve(__dirname, 'data');
  fs.writeFileSync(
    path.resolve(dataDir, 'step1-clean-results.json'),
    JSON.stringify(cleanResults, null, 2)
  );
  fs.writeFileSync(
    path.resolve(dataDir, 'step2-crawl-targets.json'),
    JSON.stringify(crawlTargets, null, 2)
  );

  console.log(`\n💾 정제 결과: scripts/data/step1-clean-results.json`);
  console.log(`💾 크롤링 대상: scripts/data/step2-crawl-targets.json`);

  // 공식 사이트 없는 병원 목록
  const noSiteList = cleanResults.filter(r => r.status === 'no_website' || r.status === 'invalid');
  if (noSiteList.length > 0) {
    console.log(`\n⚠️ 공식 사이트 미확보 (${noSiteList.length}개):`);
    for (const r of noSiteList) {
      console.log(`   No.${r.no} ${r.name} (${r.region})`);
    }
  }

  // DB 업데이트
  if (process.argv.includes('--update-db')) {
    console.log('\n💾 Supabase crm_hospitals.website 업데이트 중...');
    let updated = 0;
    let errors = 0;

    for (const r of cleanResults) {
      if (r.status === 'valid' && r.url) {
        const { error } = await supabase
          .from('crm_hospitals')
          .update({ website: r.url })
          .eq('name', r.name)
          .eq('tenant_id', TENANT_ID);

        if (error) {
          console.log(`   ❌ ${r.name}: ${error.message}`);
          errors++;
        } else {
          console.log(`   ✅ ${r.name}: ${r.url}`);
          updated++;
        }
      }
    }

    console.log(`\n   DB 업데이트: ${updated}건 성공, ${errors}건 실패`);
  } else {
    console.log('\n💡 DB 업데이트: npx tsx scripts/step1b-clean-urls.ts --update-db');
  }
}

main().catch(console.error);
