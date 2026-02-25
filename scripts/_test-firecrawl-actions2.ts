/**
 * Firecrawl actions 상세 검증
 * - screenshots 배열 길이 (4장 나오는지)
 * - 각 스크린샷 다운로드 가능 여부
 * - 크레딧 소모량
 */
import FirecrawlApp from '@mendable/firecrawl-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

const firecrawlApp = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY! });
const firecrawl = firecrawlApp as unknown as {
  v1: { scrapeUrl: (url: string, opts: Record<string, unknown>) => Promise<Record<string, unknown>> }
};

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════');
  console.log('  Firecrawl Actions 상세 검증');
  console.log('═══════════════════════════════════════\n');

  const testUrl = 'http://www.dongancenter.com/';

  const result = await firecrawl.v1.scrapeUrl(testUrl, {
    formats: ['markdown', 'screenshot'],
    waitFor: 3000,
    actions: [
      { type: 'screenshot' },
      { type: 'click', selector: '[class*="close"], [class*="닫기"], .popup-close, .btn-close, .close-btn, a[href="javascript:;"]' },
      { type: 'wait', milliseconds: 500 },
      { type: 'screenshot' },
      { type: 'scroll', direction: 'down', amount: 3 },
      { type: 'wait', milliseconds: 500 },
      { type: 'screenshot' },
      { type: 'scroll', direction: 'down', amount: 3 },
      { type: 'wait', milliseconds: 500 },
      { type: 'screenshot' },
    ]
  });

  // 메타데이터
  const meta = result.metadata as Record<string, unknown>;
  console.log('[메타데이터]');
  console.log(`  creditsUsed: ${meta.creditsUsed}`);
  console.log(`  statusCode: ${meta.statusCode}`);
  console.log(`  proxyUsed: ${meta.proxyUsed}`);
  console.log(`  scrapeId: ${meta.scrapeId}`);

  // 기본 screenshot
  console.log(`\n[기본 screenshot]`);
  console.log(`  타입: ${typeof result.screenshot}`);
  if (typeof result.screenshot === 'string') {
    console.log(`  URL: ${(result.screenshot as string).substring(0, 80)}...`);
  }

  // actions screenshots
  const actions = result.actions as { screenshots: string[]; scrapes: unknown[]; javascriptReturns: unknown[]; pdfs: unknown[] };
  console.log(`\n[actions.screenshots]`);
  console.log(`  배열 길이: ${actions.screenshots.length}`);

  for (let i = 0; i < actions.screenshots.length; i++) {
    const url = actions.screenshots[i];
    console.log(`\n  [${i}] URL: ${url.substring(0, 80)}...`);

    // 다운로드 테스트
    try {
      const resp = await fetch(url);
      const buf = Buffer.from(await resp.arrayBuffer());
      console.log(`  [${i}] 다운로드: ✅ ${(buf.length / 1024).toFixed(1)}KB, Content-Type: ${resp.headers.get('content-type')}`);
    } catch (err) {
      console.log(`  [${i}] 다운로드: ❌ ${(err as Error).message}`);
    }
  }

  // 다른 actions 필드
  console.log(`\n[기타 actions 필드]`);
  console.log(`  scrapes: ${Array.isArray(actions.scrapes) ? actions.scrapes.length : 'N/A'}`);
  console.log(`  javascriptReturns: ${Array.isArray(actions.javascriptReturns) ? actions.javascriptReturns.length : 'N/A'}`);
  console.log(`  pdfs: ${Array.isArray(actions.pdfs) ? actions.pdfs.length : 'N/A'}`);

  // markdown 길이
  console.log(`\n[마크다운]`);
  console.log(`  길이: ${(result.markdown as string).length}자`);

  console.log('\n═══════════════════════════════════════');
  console.log('  검증 완료');
  console.log('═══════════════════════════════════════');
}

main().catch(console.error);
