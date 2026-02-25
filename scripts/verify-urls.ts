/**
 * [v5.5 결함 7] DB URL 전수 점검 스크립트
 *
 * CRM 병원 목록에서 웹사이트가 있는 병원을 대상으로:
 * 1. 메인 페이지 1페이지만 간이 크롤링 (Firecrawl scrapeUrl)
 * 2. 크롤링된 병원명/주소 추출 (정규식 기반, Gemini 없음)
 * 3. DB 등록 병원명/위치와 비교
 * 4. 불일치 목록 JSON 출력
 *
 * 실행: npx tsx scripts/verify-urls.ts
 * 옵션: --dry-run (크롤링 없이 DB 목록만 출력)
 */

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import FirecrawlApp from '@mendable/firecrawl-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env'), override: true });

// ============================================================
// 환경변수
// ============================================================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
const FIRECRAWL_API_URL = process.env.FIRECRAWL_API_URL || undefined;
const TENANT_ID = '00000000-0000-0000-0000-000000000001';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 미설정');
  process.exit(1);
}
if (!FIRECRAWL_API_KEY) {
  console.error('FIRECRAWL_API_KEY 미설정');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const firecrawlApp = new FirecrawlApp({ apiKey: FIRECRAWL_API_KEY, apiUrl: FIRECRAWL_API_URL });
const firecrawl = firecrawlApp as unknown as {
  v1: {
    scrapeUrl: (url: string, opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };
};

// ============================================================
// 시도 축약 매핑
// ============================================================
const SIDO_SHORT: Record<string, string> = {
  '서울특별시': '서울', '서울시': '서울', '부산광역시': '부산', '대구광역시': '대구',
  '인천광역시': '인천', '광주광역시': '광주', '대전광역시': '대전', '울산광역시': '울산',
  '세종특별자치시': '세종', '경기도': '경기', '강원특별자치도': '강원', '강원도': '강원',
  '충청북도': '충북', '충청남도': '충남', '전라북도': '전북', '전북특별자치도': '전북',
  '전라남도': '전남', '경상북도': '경북', '경상남도': '경남', '제주특별자치도': '제주',
};

// ============================================================
// 결과 타입
// ============================================================
interface VerifyResult {
  crmId: string;
  dbName: string;
  dbRegion: string | null;
  website: string;
  crawledTitle: string | null;
  crawledAddress: string | null;
  crawledRegion: string | null;
  nameMatch: boolean;
  regionMatch: boolean;
  franchise: { domain: string; branch: string } | null;
  status: 'ok' | 'name_mismatch' | 'region_mismatch' | 'both_mismatch' | 'crawl_failed' | 'no_data';
  note: string;
}

// ============================================================
// 병원명 추출 (마크다운에서 <title> 또는 첫 heading)
// ============================================================
function extractHospitalName(markdown: string): string | null {
  // 마크다운에서 # heading 패턴
  const h1 = markdown.match(/^#\s+(.+)/m);
  if (h1) return h1[1].trim();

  // 또는 title 형태
  const title = markdown.match(/title[:\s]*["']?([^"'\n]+)/i);
  if (title) return title[1].trim();

  // 첫 줄에서 병원명 후보 (XX의원, XX병원, XX클리닉, XX피부과 등)
  const lines = markdown.split('\n').slice(0, 30);
  for (const line of lines) {
    const m = line.match(/([가-힣A-Za-z\s]{2,30}(?:의원|병원|클리닉|피부과|성형외과|센터))/);
    if (m) return m[1].trim();
  }
  return null;
}

// ============================================================
// 주소 추출 (마크다운에서 정규식)
// ============================================================
function extractAddress(markdown: string): string | null {
  // "서울특별시 강남구 ..." 또는 "경기도 안산시 ..." 패턴
  const patterns = [
    /(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충[청남북]|전[라남북]|경[상남북]|제주)[^\n,]{5,60}[동읍면리로길번지호층]\d*/,
    /(?:서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|경기도|강원[도특별자치도]*|충청[남북]도|전[라북]*[도특별자치도]*|경상[남북]도|제주특별자치도)\s+\S+[시군구]\s+[^\n,]{3,40}/,
  ];
  for (const p of patterns) {
    const m = markdown.match(p);
    if (m) return m[0].trim();
  }
  return null;
}

// ============================================================
// 주소에서 시군구 추출 → 위치명
// ============================================================
function addressToRegion(address: string): string | null {
  // "경기도 안산시 단원구 ..." → "안산"
  const words = address.split(/\s+/);
  for (const w of words) {
    if (/[시군]$/.test(w) && !Object.keys(SIDO_SHORT).some(s => w.includes(s.replace(/[도시]$/, '')))) {
      return w.replace(/[시군]$/, '').trim();
    }
    // 구 단위 (서울 등 광역시)
    if (/구$/.test(w) && words[0] && Object.values(SIDO_SHORT).includes(words[0].replace(/[특별광역시도자치]*$/, '').trim())) {
      return w.replace(/구$/, '').trim();
    }
  }
  // sido 레벨 fallback
  for (const [full, short] of Object.entries(SIDO_SHORT)) {
    if (address.startsWith(full) || address.startsWith(short)) return short;
  }
  return null;
}

// ============================================================
// 프랜차이즈 감지
// ============================================================
function detectFranchise(url: string): { domain: string; branch: string } | null {
  try {
    const hostname = new URL(url).hostname;
    const parts = hostname.split('.');
    if (parts.length >= 3 && parts[0].length <= 4 && /^[a-z]{2,4}$/.test(parts[0])) {
      return { domain: parts.slice(1).join('.'), branch: parts[0] };
    }
  } catch { /* ignore */ }
  return null;
}

// ============================================================
// 병원명 비교 (유연)
// ============================================================
function namesMatch(dbName: string, crawledName: string | null): boolean {
  if (!crawledName) return false;
  const a = dbName.replace(/\([^)]*\)/g, '').replace(/\s+/g, '').trim();
  const b = crawledName.replace(/\([^)]*\)/g, '').replace(/\s+/g, '').trim();
  return a === b || b.includes(a) || a.includes(b);
}

// ============================================================
// 위치명 비교 (유연)
// ============================================================
function regionsMatch(dbRegion: string | null, crawledRegion: string | null): boolean {
  if (!dbRegion || !crawledRegion) return true; // 비교 불가 → 일단 OK
  const a = dbRegion.replace(/[시구군도]$/, '').trim();
  const b = crawledRegion.replace(/[시구군도]$/, '').trim();
  return a === b || b.includes(a) || a.includes(b);
}

// ============================================================
// 메인 실행
// ============================================================
async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const limitArg = process.argv.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : undefined;

  console.log('═══════════════════════════════════════════════════');
  console.log('  [v5.5] DB URL 전수 점검');
  console.log('═══════════════════════════════════════════════════\n');

  // 1. CRM 병원 목록 조회
  const { data: hospitals, error } = await supabase
    .from('crm_hospitals')
    .select('id, name, website, region, district')
    .eq('tenant_id', TENANT_ID)
    .not('website', 'is', null)
    .order('name');

  if (error || !hospitals) {
    console.error('CRM 병원 조회 실패:', error?.message);
    process.exit(1);
  }

  const withUrl = hospitals.filter(h => h.website && h.website.trim() !== '');
  console.log(`📋 CRM 병원: ${hospitals.length}개 (URL 보유: ${withUrl.length}개)\n`);

  if (dryRun) {
    console.log('[DRY RUN] 크롤링 없이 목록만 출력\n');
    for (const h of withUrl) {
      const franchise = detectFranchise(h.website);
      console.log(`  ${h.name} | ${h.region || '-'} | ${h.website}${franchise ? ` [프랜차이즈: ${franchise.domain}/${franchise.branch}]` : ''}`);
    }
    console.log(`\n총 ${withUrl.length}개`);
    return;
  }

  // 2. 간이 크롤링 + 비교
  const targets = limit ? withUrl.slice(0, limit) : withUrl;
  const results: VerifyResult[] = [];
  let okCount = 0;
  let mismatchCount = 0;
  let failCount = 0;

  for (let i = 0; i < targets.length; i++) {
    const h = targets[i];
    const idx = `[${i + 1}/${targets.length}]`;
    process.stdout.write(`${idx} ${h.name} (${h.website})... `);

    const franchise = detectFranchise(h.website);
    const result: VerifyResult = {
      crmId: h.id,
      dbName: h.name,
      dbRegion: h.region,
      website: h.website,
      crawledTitle: null,
      crawledAddress: null,
      crawledRegion: null,
      nameMatch: false,
      regionMatch: false,
      franchise,
      status: 'crawl_failed',
      note: '',
    };

    try {
      const scrapeResult = await firecrawl.v1.scrapeUrl(h.website, {
        formats: ['markdown'],
        waitFor: 5000,
      });
      const md = (scrapeResult.markdown as string) || '';

      if (md.length < 100) {
        result.status = 'no_data';
        result.note = `마크다운 ${md.length}자 — 콘텐츠 부족`;
        console.log('⚠️ 콘텐츠 부족');
      } else {
        result.crawledTitle = extractHospitalName(md);
        result.crawledAddress = extractAddress(md);
        result.crawledRegion = result.crawledAddress ? addressToRegion(result.crawledAddress) : null;

        result.nameMatch = namesMatch(h.name, result.crawledTitle);
        result.regionMatch = regionsMatch(h.region, result.crawledRegion);

        if (result.nameMatch && result.regionMatch) {
          result.status = 'ok';
          okCount++;
          console.log('✅ OK');
        } else if (!result.nameMatch && !result.regionMatch) {
          result.status = 'both_mismatch';
          result.note = `이름: "${result.crawledTitle}", 위치: "${result.crawledRegion}"`;
          mismatchCount++;
          console.log(`🚨 이름+위치 불일치 → "${result.crawledTitle}" / ${result.crawledRegion}`);
        } else if (!result.nameMatch) {
          result.status = 'name_mismatch';
          result.note = `DB="${h.name}" ≠ 크롤링="${result.crawledTitle}"`;
          mismatchCount++;
          console.log(`⚠️ 이름 불일치 → "${result.crawledTitle}"`);
        } else {
          result.status = 'region_mismatch';
          result.note = `DB="${h.region}" ≠ 크롤링="${result.crawledRegion}" (${result.crawledAddress})`;
          mismatchCount++;
          console.log(`⚠️ 위치 불일치 → "${result.crawledRegion}"`);
        }
      }
    } catch (err) {
      result.status = 'crawl_failed';
      result.note = `${err}`;
      failCount++;
      console.log(`❌ 크롤링 실패`);
    }

    results.push(result);

    // Rate limit: 2초 간격
    if (i < targets.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  // 3. 결과 출력
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  전수 점검 결과');
  console.log('═══════════════════════════════════════════════════\n');

  console.log(`✅ 정상: ${okCount}개`);
  console.log(`⚠️ 불일치: ${mismatchCount}개`);
  console.log(`❌ 크롤링 실패: ${failCount}개`);
  console.log(`⚪ 콘텐츠 부족: ${results.filter(r => r.status === 'no_data').length}개`);

  // 불일치 상세 출력
  const mismatches = results.filter(r => ['name_mismatch', 'region_mismatch', 'both_mismatch'].includes(r.status));
  if (mismatches.length > 0) {
    console.log('\n--- 불일치 상세 ---\n');
    for (const m of mismatches) {
      console.log(`  [${m.status}] ${m.dbName}`);
      console.log(`    DB: 이름="${m.dbName}", 위치="${m.dbRegion}", URL=${m.website}`);
      console.log(`    크롤링: 이름="${m.crawledTitle}", 위치="${m.crawledRegion}", 주소="${m.crawledAddress}"`);
      if (m.franchise) console.log(`    프랜차이즈: ${m.franchise.domain} [${m.franchise.branch}점]`);
      console.log('');
    }
  }

  // 프랜차이즈 병원 목록
  const franchises = results.filter(r => r.franchise);
  if (franchises.length > 0) {
    console.log('--- 프랜차이즈 병원 ---\n');
    const byDomain = new Map<string, VerifyResult[]>();
    for (const f of franchises) {
      const key = f.franchise!.domain;
      if (!byDomain.has(key)) byDomain.set(key, []);
      byDomain.get(key)!.push(f);
    }
    for (const [domain, items] of byDomain) {
      console.log(`  ${domain} (${items.length}개 지점)`);
      for (const item of items) {
        console.log(`    - ${item.dbName} [${item.franchise!.branch}점] ${item.status === 'ok' ? '✅' : '⚠️ ' + item.note}`);
      }
    }
    console.log('');
  }

  // 4. 결과 JSON 저장
  const outputPath = path.resolve(__dirname, 'data', 'verify-urls-result.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`📁 결과 저장: ${outputPath}`);

  // 5. 액션 필요 항목 요약
  const actionNeeded = results.filter(r => r.status !== 'ok');
  if (actionNeeded.length > 0) {
    console.log(`\n🔧 조치 필요: ${actionNeeded.length}개`);
    console.log('   → verify-urls-result.json 확인 후 DB 수동 수정');
  } else {
    console.log('\n✅ 전체 URL 정상 — Phase 2 진행 가능');
  }
}

main().catch(console.error);
