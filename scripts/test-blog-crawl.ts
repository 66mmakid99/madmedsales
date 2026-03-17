/**
 * test-blog-crawl.ts — Firecrawl 네이버 블로그 크롤링 테스트
 *
 * 테스트 대상: blog.naver.com/365daerimos (365대림정형외과)
 *
 * Usage: npx tsx scripts/test-blog-crawl.ts
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import FirecrawlApp from '@mendable/firecrawl-js';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
const FIRECRAWL_API_URL = process.env.FIRECRAWL_API_URL || undefined;

if (!FIRECRAWL_API_KEY) {
  console.error('❌ FIRECRAWL_API_KEY 미설정');
  process.exit(1);
}

const app = new FirecrawlApp({ apiKey: FIRECRAWL_API_KEY, apiUrl: FIRECRAWL_API_URL });
const firecrawl = app as unknown as {
  v1: {
    scrapeUrl: (url: string, opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
    mapUrl: (url: string, opts: Record<string, unknown>) => Promise<{ success: boolean; links?: string[] }>;
    crawlUrl: (url: string, opts: Record<string, unknown>, pollInterval?: number) => Promise<Record<string, unknown>>;
  };
};

const BLOG_URL = 'https://blog.naver.com/365daerimos';
const BLOG_MOBILE_PREFIX = 'https://m.blog.naver.com/365daerimos';

interface TestResult {
  testName: string;
  url: string;
  success: boolean;
  elapsed: number;
  textPreview: string | null;
  pageCount: number | null;
  urlCount: number | null;
  error: string | null;
  raw: unknown;
}

function preview(text: string | null | undefined, maxLen = 500): string | null {
  if (!text) return null;
  return text.slice(0, maxLen).replace(/\n{3,}/g, '\n\n');
}

/** Promise에 timeout을 걸어주는 헬퍼 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`TIMEOUT (${ms / 1000}초) — ${label}`)), ms);
    promise.then(v => { clearTimeout(timer); resolve(v); }).catch(e => { clearTimeout(timer); reject(e); });
  });
}

// ── Test 1: crawlUrl 블로그 메인 ──
async function testCrawlUrl(): Promise<TestResult> {
  const testName = '1. crawlUrl (블로그 메인, limit:10)';
  console.log(`\n🧪 ${testName}`);
  console.log(`   URL: ${BLOG_URL}`);

  const start = Date.now();
  try {
    const result = await withTimeout(
      firecrawl.v1.crawlUrl(BLOG_URL, {
        limit: 10,
        scrapeOptions: { formats: ['markdown'], waitFor: 5000 },
      }, 3000),
      60000, 'crawlUrl'
    );

    const elapsed = Date.now() - start;
    const data = (result as Record<string, unknown>).data as Array<Record<string, unknown>> | undefined;
    const pageCount = data?.length ?? 0;
    const firstMarkdown = data?.[0]?.markdown as string | undefined;

    console.log(`   ✅ ${pageCount}페이지 크롤링됨 (${(elapsed / 1000).toFixed(1)}초)`);
    if (firstMarkdown) console.log(`   📄 첫 페이지 텍스트(200자): ${preview(firstMarkdown, 200)}`);

    return {
      testName, url: BLOG_URL, success: pageCount > 0, elapsed,
      textPreview: preview(firstMarkdown), pageCount, urlCount: null,
      error: null, raw: { status: (result as Record<string, unknown>).status, pageCount },
    };
  } catch (err) {
    const elapsed = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`   ❌ 실패 (${(elapsed / 1000).toFixed(1)}초): ${msg}`);
    return {
      testName, url: BLOG_URL, success: false, elapsed,
      textPreview: null, pageCount: null, urlCount: null,
      error: msg, raw: null,
    };
  }
}

// ── Test 2: scrapeUrl 블로그 개별 포스트 ──
async function testScrapePost(postUrl: string): Promise<TestResult> {
  const testName = '2. scrapeUrl (개별 포스트)';
  console.log(`\n🧪 ${testName}`);
  console.log(`   URL: ${postUrl}`);

  const start = Date.now();
  try {
    const result = await withTimeout(
      firecrawl.v1.scrapeUrl(postUrl, {
        formats: ['markdown'],
        waitFor: 5000,
      }),
      30000, 'scrapeUrl post'
    );

    const elapsed = Date.now() - start;
    const markdown = result.markdown as string | undefined;
    const textLen = markdown?.length ?? 0;
    const success = textLen > 100;

    console.log(`   ${success ? '✅' : '⚠️'} 텍스트 ${textLen}자 추출 (${(elapsed / 1000).toFixed(1)}초)`);
    if (markdown) console.log(`   📄 텍스트(200자): ${preview(markdown, 200)}`);

    return {
      testName, url: postUrl, success, elapsed,
      textPreview: preview(markdown), pageCount: null, urlCount: null,
      error: success ? null : `텍스트 ${textLen}자 (100자 미만)`,
      raw: { textLen, statusCode: result.metadata },
    };
  } catch (err) {
    const elapsed = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`   ❌ 실패 (${(elapsed / 1000).toFixed(1)}초): ${msg}`);
    return {
      testName, url: postUrl, success: false, elapsed,
      textPreview: null, pageCount: null, urlCount: null,
      error: msg, raw: null,
    };
  }
}

// ── Test 3: scrapeUrl 모바일 URL ──
async function testScrapeMobile(postUrl: string): Promise<TestResult> {
  // 이미 m.blog.naver.com인 경우 중복 치환 방지
  const mobileUrl = postUrl.includes('m.blog.naver.com')
    ? postUrl
    : postUrl.replace('blog.naver.com', 'm.blog.naver.com');
  const testName = '3. scrapeUrl (모바일 URL)';
  console.log(`\n🧪 ${testName}`);
  console.log(`   URL: ${mobileUrl}`);

  const start = Date.now();
  try {
    const result = await withTimeout(
      firecrawl.v1.scrapeUrl(mobileUrl, {
        formats: ['markdown'],
        waitFor: 5000,
      }),
      30000, 'scrapeUrl mobile'
    );

    const elapsed = Date.now() - start;
    const markdown = result.markdown as string | undefined;
    const textLen = markdown?.length ?? 0;
    const success = textLen > 100;

    console.log(`   ${success ? '✅' : '⚠️'} 텍스트 ${textLen}자 추출 (${(elapsed / 1000).toFixed(1)}초)`);
    if (markdown) console.log(`   📄 텍스트(200자): ${preview(markdown, 200)}`);

    return {
      testName, url: mobileUrl, success, elapsed,
      textPreview: preview(markdown), pageCount: null, urlCount: null,
      error: success ? null : `텍스트 ${textLen}자 (100자 미만)`,
      raw: { textLen },
    };
  } catch (err) {
    const elapsed = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`   ❌ 실패 (${(elapsed / 1000).toFixed(1)}초): ${msg}`);
    return {
      testName, url: mobileUrl, success: false, elapsed,
      textPreview: null, pageCount: null, urlCount: null,
      error: msg, raw: null,
    };
  }
}

// ── Test 4: mapUrl 블로그 URL 목록 ──
async function testMapUrl(): Promise<TestResult> {
  const testName = '4. mapUrl (블로그 URL 목록)';
  console.log(`\n🧪 ${testName}`);
  console.log(`   URL: ${BLOG_URL}`);

  const start = Date.now();
  try {
    const result = await withTimeout(
      firecrawl.v1.mapUrl(BLOG_URL, { limit: 100 }),
      30000, 'mapUrl'
    );

    const elapsed = Date.now() - start;
    const links = result.links ?? [];
    const postLinks = links.filter((l: string) => /\/\d{9,}$/.test(l) || l.includes('logNo='));
    const success = links.length > 0;

    console.log(`   ${success ? '✅' : '⚠️'} 전체 ${links.length}개 URL (포스트: ${postLinks.length}개) (${(elapsed / 1000).toFixed(1)}초)`);
    if (links.length > 0) {
      console.log(`   📄 샘플 URL:`);
      for (const l of links.slice(0, 5)) console.log(`      ${l}`);
      if (links.length > 5) console.log(`      ... 외 ${links.length - 5}개`);
    }

    return {
      testName, url: BLOG_URL, success, elapsed,
      textPreview: null, pageCount: null, urlCount: links.length,
      error: success ? null : 'URL 0개',
      raw: { totalLinks: links.length, postLinks: postLinks.length, sampleLinks: links.slice(0, 10) },
    };
  } catch (err) {
    const elapsed = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`   ❌ 실패 (${(elapsed / 1000).toFixed(1)}초): ${msg}`);
    return {
      testName, url: BLOG_URL, success: false, elapsed,
      textPreview: null, pageCount: null, urlCount: null,
      error: msg, raw: null,
    };
  }
}

// ── 포스트 URL 찾기 ──
async function findPostUrl(): Promise<string> {
  // mapUrl로 먼저 시도
  try {
    const result = await withTimeout(firecrawl.v1.mapUrl(BLOG_URL, { limit: 50 }), 20000, 'findPost mapUrl');
    const links = result.links ?? [];
    const post = links.find((l: string) => /\/\d{9,}$/.test(l) || l.includes('logNo='));
    if (post) return post;
  } catch { /* ignore */ }

  // Fallback: 직접 scrape해서 링크 추출
  try {
    const result = await withTimeout(firecrawl.v1.scrapeUrl(BLOG_URL, { formats: ['markdown', 'links'] }), 20000, 'findPost scrape');
    const links = result.links as string[] | undefined;
    const post = links?.find((l: string) => /\/\d{9,}$/.test(l) || l.includes('logNo='));
    if (post) return post;
  } catch { /* ignore */ }

  // 최종 fallback: 하드코딩된 최근 포스트
  return `${BLOG_URL}/223797660123`;
}

// ── Main ──
async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════');
  console.log('  Firecrawl 네이버 블로그 크롤링 테스트');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  대상: ${BLOG_URL}`);
  console.log(`  Firecrawl: ${FIRECRAWL_API_URL ?? 'cloud (default)'}\n`);

  const results: TestResult[] = [];

  // Test 1: crawlUrl
  results.push(await testCrawlUrl());

  // 포스트 URL 찾기
  console.log('\n🔍 개별 포스트 URL 탐색...');
  const postUrl = await findPostUrl();
  console.log(`   → ${postUrl}`);

  // Test 2: scrapeUrl 개별 포스트
  results.push(await testScrapePost(postUrl));

  // Test 3: 모바일 URL
  results.push(await testScrapeMobile(postUrl));

  // Test 4: mapUrl
  results.push(await testMapUrl());

  // 결과 저장
  const outputDir = path.resolve(__dirname, '..', 'output', 'logs');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, 'blog-crawl-test.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    target: BLOG_URL,
    firecrawlUrl: FIRECRAWL_API_URL ?? 'cloud',
    results,
  }, null, 2));
  console.log(`\n📄 저장: ${outputPath}`);

  // 최종 결론
  const scrapeOk = results[1]?.success || results[2]?.success;
  const mapOk = results[3]?.success;

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  최종 결론');
  console.log('═══════════════════════════════════════════════════\n');

  for (const r of results) {
    console.log(`  ${r.success ? '✅' : '❌'} ${r.testName} — ${r.success ? '성공' : '실패'}${r.error ? ` (${r.error})` : ''} [${(r.elapsed / 1000).toFixed(1)}초]`);
  }

  console.log('');
  if (scrapeOk) {
    console.log('  🟢 방법 A 가능: Firecrawl로 블로그 개별 포스트 크롤 가능');
    if (mapOk) {
      console.log('  🟢 mapUrl로 포스트 URL 목록 수집도 가능');
    } else {
      console.log('  🟡 mapUrl은 안 되지만, 블로그 메인에서 포스트 링크 추출 후 개별 scrape 가능');
    }
  } else {
    console.log('  🔴 방법 B 필요: Firecrawl로 안 되므로 네이버 검색 API 등 대안 필요');
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
