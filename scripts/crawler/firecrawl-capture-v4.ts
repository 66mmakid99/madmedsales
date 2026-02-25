/**
 * Firecrawl 4차 E2E: Phase 1 캡처
 * 3차 대비 변경사항:
 *   - crawl limit: 20 → 50
 *   - 닥터스피부과: branch URL → 메인 도메인 (doctors365.co.kr)
 *   - 제로피부과: 모바일 URL + User-Agent 변경
 *
 * 실행: npx tsx scripts/crawler/firecrawl-capture-v4.ts
 * 단일: npx tsx scripts/crawler/firecrawl-capture-v4.ts --index 4
 */
import FirecrawlApp from '@mendable/firecrawl-js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
const CRAWL_LIMIT = 50; // 3차: 20 → 4차: 50

const TEST_HOSPITALS = [
  { index: 1, name: '815의원', url: 'https://www.815clinic.co.kr/' },
  { index: 2, name: '리멤버피부과', url: 'https://rememberno1.com/' },
  { index: 3, name: '고운세상피부과명동', url: 'http://www.gowoonss.com/bbs/content.php?co_id=myungdong' },
  // 4차 변경: 메인 도메인으로 재시도
  { index: 4, name: '닥터스피부과신사', url: 'https://www.doctors365.co.kr/' },
  { index: 5, name: '한미인의원', url: 'https://hanmiin.kr/' },
  // 4차 변경: 모바일 URL로 재시도
  { index: 6, name: '제로피부과', url: 'https://m.zerodermaclinic.com/' },
  { index: 7, name: '톡스앤필강서', url: 'https://www.toxnfill32.com/' },
  { index: 8, name: '이지함피부과망우', url: 'http://mw.ljh.co.kr/' },
  { index: 9, name: '바노바기피부과', url: 'https://www.skinbanobagi.com/web' },
  { index: 10, name: '신사루비의원', url: 'https://www.rubyclinic-sinsa.com/' },
];

interface CaptureResult {
  name: string;
  index: number;
  success: boolean;
  pages: number;
  urlsFound: number;
  relevantUrls: number;
  totalMarkdownLength: number;
  screenshotCount: number;
  elapsed: number;
  error?: string;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function captureHospital(
  app: FirecrawlApp,
  hospital: { index: number; name: string; url: string }
): Promise<CaptureResult> {
  const startTime = Date.now();
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`=== [${hospital.index}] ${hospital.name} 캡처 시작 (4차) ===`);
  console.log(`URL: ${hospital.url}`);
  console.log(`${'═'.repeat(60)}`);

  try {
    // 1. Map: 사이트 URL 구조 파악
    console.log('[1/3] 사이트 맵 수집 중...');
    const mapResult = await app.map(hospital.url, { limit: 200 });
    const allUrls: string[] = (mapResult?.links ?? []).map((l: { url: string }) => l.url);
    console.log(`발견된 URL: ${allUrls.length}개`);

    // 관련 URL 필터링
    const relevantPatterns = [
      /시술|treatment|service|진료|클리닉|clinic/i,
      /장비|equipment|device|기기/i,
      /이벤트|event|프로모션|promotion|할인/i,
      /의료진|doctor|staff|원장/i,
      /소개|about|info/i,
      /가격|price|비용|cost/i,
    ];
    const relevantUrls = allUrls.filter((url) =>
      relevantPatterns.some((p) => p.test(url))
    );
    console.log(`관련 URL (필터링): ${relevantUrls.length}개`);

    // URL 출력 (상위 30개)
    console.log('\n--- 발견된 URL (상위 30) ---');
    allUrls.slice(0, 30).forEach((url, i) => console.log(`  ${i + 1}. ${url}`));
    if (allUrls.length > 30) console.log(`  ... 외 ${allUrls.length - 30}개`);
    console.log('--- 필터링된 URL ---');
    relevantUrls.forEach((url, i) => console.log(`  ★ ${i + 1}. ${url}`));

    // 2. Crawl: 사이트 크롤링 (limit 50)
    console.log(`\n[2/3] 사이트 크롤링 중... (limit=${CRAWL_LIMIT})`);
    const crawlResult = await app.crawl(hospital.url, {
      limit: CRAWL_LIMIT,
      scrapeOptions: {
        formats: ['markdown', 'html', 'screenshot', 'links'],
        onlyMainContent: true,
      },
      timeout: 180000, // 3분 (페이지 수 증가에 따라)
    });

    const pages = crawlResult?.data ?? [];
    console.log(`크롤링 완료: ${pages.length}페이지`);

    // 3. 로컬 저장
    console.log('\n[3/3] 로컬 저장 중...');
    const today = new Date().toISOString().split('T')[0];
    const saveDir = path.resolve(
      __dirname,
      '../../snapshots',
      `${today}-v4`,
      hospital.name.replace(/\s/g, '_')
    );
    await fs.mkdir(saveDir, { recursive: true });
    await fs.mkdir(path.join(saveDir, 'screenshots'), { recursive: true });

    // 메타 정보 저장
    const meta = {
      hospital_name: hospital.name,
      url: hospital.url,
      test_round: 'v4',
      crawl_limit: CRAWL_LIMIT,
      captured_at: new Date().toISOString(),
      total_urls_found: allUrls.length,
      relevant_urls: relevantUrls.length,
      pages_crawled: pages.length,
      all_urls: allUrls,
      relevant_urls_list: relevantUrls,
    };
    await fs.writeFile(path.join(saveDir, 'meta.json'), JSON.stringify(meta, null, 2));

    let totalMarkdownLength = 0;
    let screenshotCount = 0;

    // 각 페이지 저장
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i] as Record<string, unknown>;
      const pageDir = path.join(saveDir, `page-${String(i).padStart(3, '0')}`);
      await fs.mkdir(pageDir, { recursive: true });

      const pageMeta = (page.metadata as object) ?? {};
      await fs.writeFile(path.join(pageDir, 'metadata.json'), JSON.stringify(pageMeta, null, 2));

      const markdown = (page.markdown ?? '') as string;
      if (markdown) {
        await fs.writeFile(path.join(pageDir, 'content.md'), markdown);
        totalMarkdownLength += markdown.length;
      }

      const html = (page.html ?? '') as string;
      if (html) {
        await fs.writeFile(path.join(pageDir, 'content.html'), html);
      }

      const screenshot = (page.screenshot ?? '') as string;
      if (screenshot) {
        const screenshotPath = path.join(saveDir, 'screenshots', `page-${String(i).padStart(3, '0')}.png`);
        try {
          if (screenshot.startsWith('http')) {
            const response = await fetch(screenshot);
            const buffer = Buffer.from(await response.arrayBuffer());
            await fs.writeFile(screenshotPath, buffer);
          } else {
            const buffer = Buffer.from(screenshot, 'base64');
            await fs.writeFile(screenshotPath, buffer);
          }
          screenshotCount++;
        } catch (err) {
          console.log(`    스크린샷 저장 실패: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      const links = page.links as unknown[] | undefined;
      if (links) {
        await fs.writeFile(path.join(pageDir, 'links.json'), JSON.stringify(links, null, 2));
      }

      const pm = pageMeta as Record<string, unknown>;
      const url = (pm.sourceURL ?? pm.url ?? '(unknown)') as string;
      console.log(`  page-${i}: ${url}`);
      console.log(`    markdown: ${markdown.length}자, screenshot: ${screenshot ? '✅' : '❌'}, links: ${Array.isArray(links) ? links.length : 0}개`);
    }

    const elapsed = (Date.now() - startTime) / 1000;
    console.log(`\n✅ ${hospital.name} 완료 (${elapsed.toFixed(1)}초, ${pages.length}페이지, md=${totalMarkdownLength.toLocaleString()}자)`);
    console.log(`저장 위치: ${saveDir}`);

    return {
      name: hospital.name,
      index: hospital.index,
      success: true,
      pages: pages.length,
      urlsFound: allUrls.length,
      relevantUrls: relevantUrls.length,
      totalMarkdownLength,
      screenshotCount,
      elapsed,
    };
  } catch (err) {
    const elapsed = (Date.now() - startTime) / 1000;
    console.error(`❌ ${hospital.name} 실패: ${err instanceof Error ? err.message : String(err)}`);
    return {
      name: hospital.name,
      index: hospital.index,
      success: false,
      pages: 0,
      urlsFound: 0,
      relevantUrls: 0,
      totalMarkdownLength: 0,
      screenshotCount: 0,
      elapsed,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main(): Promise<void> {
  if (!FIRECRAWL_API_KEY) {
    console.error('FIRECRAWL_API_KEY 환경변수가 설정되지 않았습니다.');
    process.exit(1);
  }

  const app = new FirecrawlApp({ apiKey: FIRECRAWL_API_KEY });

  // 단일 병원 실행 지원
  const indexArgIdx = process.argv.indexOf('--index');
  const singleIndex = indexArgIdx !== -1 && process.argv[indexArgIdx + 1]
    ? parseInt(process.argv[indexArgIdx + 1])
    : null;

  const targets = singleIndex
    ? TEST_HOSPITALS.filter((h) => h.index === singleIndex)
    : TEST_HOSPITALS;

  console.log('═'.repeat(60));
  console.log('Firecrawl 4차 E2E: Phase 1 캡처');
  console.log(`변경: crawl limit=${CRAWL_LIMIT}, 닥터스=메인도메인, 제로=모바일URL`);
  console.log(`테스트 대상: ${targets.length}개 병원`);
  console.log(`예상 크레딧: ~${targets.length * (CRAWL_LIMIT * 1.5 + 1)}크레딧`);
  console.log('═'.repeat(60));

  const results: CaptureResult[] = [];

  for (const hospital of targets) {
    const result = await captureHospital(app, hospital);
    results.push(result);

    if (hospital !== targets[targets.length - 1]) {
      console.log('\n--- 15초 대기 ---\n');
      await delay(15000);
    }
  }

  // 종합 보고
  console.log(`\n${'═'.repeat(60)}`);
  console.log('=== 4차 Phase 1 캡처 종합 결과 ===');
  console.log('═'.repeat(60));

  for (const r of results) {
    if (r.success) {
      console.log(
        `✅ [${r.index}] ${r.name}: ${r.pages}페이지, ${r.urlsFound} URL, md=${r.totalMarkdownLength.toLocaleString()}자, screenshots=${r.screenshotCount} (${r.elapsed.toFixed(1)}초)`
      );
    } else {
      console.log(`❌ [${r.index}] ${r.name}: ${r.error}`);
    }
  }

  const successCount = results.filter((r) => r.success).length;
  const totalPages = results.reduce((s, r) => s + r.pages, 0);
  const totalMd = results.reduce((s, r) => s + r.totalMarkdownLength, 0);
  console.log(`\n성공: ${successCount}/${results.length}`);
  console.log(`총 페이지: ${totalPages}`);
  console.log(`총 markdown: ${totalMd.toLocaleString()}자`);
  console.log(`예상 크레딧 사용: ~${totalPages + results.length}크레딧`);

  // 결과 JSON 저장
  const today = new Date().toISOString().split('T')[0];
  const summaryPath = path.resolve(__dirname, '../../snapshots', `${today}-v4`, 'capture-summary.json');
  await fs.writeFile(summaryPath, JSON.stringify({ results, totals: { successCount, totalPages, totalMd } }, null, 2));

  console.log(`\n결과 저장: ${summaryPath}`);
  console.log(`다음 단계: npx tsx scripts/crawler/firecrawl-analyze-v4.ts`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
