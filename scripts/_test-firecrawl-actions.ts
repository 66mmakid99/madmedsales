/**
 * Firecrawl actions 기능 테스트
 * v5 핵심: 팝업 2회 캡처 + 스크롤 다중 캡처가 가능한지 검증
 */
import FirecrawlApp from '@mendable/firecrawl-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

const firecrawlApp = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY! });
const firecrawl = firecrawlApp as unknown as { v1: { scrapeUrl: (url: string, opts: Record<string, unknown>) => Promise<Record<string, unknown>> } };

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════');
  console.log('  Firecrawl Actions 기능 테스트');
  console.log('═══════════════════════════════════════\n');

  const testUrl = 'http://www.dongancenter.com/';

  // -------------------------------------------------------
  // 테스트 1: actions + screenshot 동작 확인
  // -------------------------------------------------------
  console.log('[테스트 1] actions + 다중 screenshot 테스트');
  console.log(`  대상: ${testUrl}\n`);

  try {
    const result = await firecrawl.v1.scrapeUrl(testUrl, {
      formats: ['markdown', 'screenshot'],
      waitFor: 3000,
      actions: [
        // 1: 팝업 포함 상태 캡처
        { type: 'screenshot' as const },
        // 팝업 닫기 시도
        { type: 'click' as const, selector: '[class*="close"], [class*="닫기"], .popup-close, .btn-close' },
        { type: 'wait' as const, milliseconds: 500 },
        // 2: 팝업 닫은 후 상단
        { type: 'screenshot' as const },
        // 3: 중간 스크롤
        { type: 'scroll' as const, direction: 'down' as const, amount: 3 },
        { type: 'wait' as const, milliseconds: 500 },
        { type: 'screenshot' as const },
        // 4: 하단 스크롤
        { type: 'scroll' as const, direction: 'down' as const, amount: 3 },
        { type: 'wait' as const, milliseconds: 500 },
        { type: 'screenshot' as const },
      ]
    });

    console.log('  ✅ actions 호출 성공!\n');

    // 반환 구조 분석
    console.log('[반환 구조 분석]');
    console.log(`  result.markdown: ${result.markdown ? `${result.markdown.length}자` : 'null'}`);
    console.log(`  result.screenshot: ${result.screenshot ? `타입=${typeof result.screenshot}, 길이=${typeof result.screenshot === 'string' ? result.screenshot.length : 'N/A'}` : 'null/undefined'}`);

    // actions 결과 확인
    const anyResult = result as Record<string, unknown>;
    console.log(`  result.actions: ${anyResult.actions ? JSON.stringify(anyResult.actions).substring(0, 200) : 'null/undefined'}`);

    // 스크린샷 관련 필드 전부 탐색
    console.log('\n[result 최상위 키]');
    for (const key of Object.keys(anyResult)) {
      const val = anyResult[key];
      const preview = typeof val === 'string'
        ? `string(${val.length})${val.startsWith('http') ? ` → ${val.substring(0, 80)}` : ''}${val.startsWith('data:') ? ' → base64' : ''}`
        : typeof val === 'object' && val !== null
          ? `${Array.isArray(val) ? `array(${(val as unknown[]).length})` : `object(${Object.keys(val as Record<string, unknown>).join(',')})`}`
          : String(val);
      console.log(`  ${key}: ${preview}`);
    }

    // screenshot 필드가 배열인지 확인
    if (result.screenshot) {
      if (typeof result.screenshot === 'string') {
        const isUrl = result.screenshot.startsWith('http');
        const isBase64 = result.screenshot.startsWith('data:');
        console.log(`\n[screenshot 형식]`);
        console.log(`  단일 값 (string)`);
        console.log(`  URL: ${isUrl} ${isUrl ? result.screenshot.substring(0, 100) : ''}`);
        console.log(`  Base64: ${isBase64}`);
      }
    }

    // actions 결과에서 스크린샷 배열 찾기
    if (anyResult.actions && typeof anyResult.actions === 'object') {
      const actionsData = anyResult.actions as Record<string, unknown>;
      console.log('\n[actions 결과 상세]');
      console.log(JSON.stringify(actionsData, null, 2).substring(0, 1000));

      // screenshots 배열 탐색
      if (Array.isArray(actionsData)) {
        console.log(`\n  actions 배열 길이: ${actionsData.length}`);
        for (let i = 0; i < actionsData.length; i++) {
          const item = actionsData[i] as Record<string, unknown>;
          console.log(`  [${i}] 타입: ${item.type}, 키: ${Object.keys(item).join(',')}`);
          if (item.screenshot || item.url || item.data) {
            const val = (item.screenshot || item.url || item.data) as string;
            console.log(`      값: ${typeof val === 'string' ? val.substring(0, 80) : typeof val}`);
          }
        }
      }
    }

    // screenshots (복수형) 필드 확인
    if (anyResult.screenshots) {
      console.log('\n[screenshots 필드 발견!]');
      if (Array.isArray(anyResult.screenshots)) {
        console.log(`  배열 길이: ${(anyResult.screenshots as unknown[]).length}`);
        for (let i = 0; i < (anyResult.screenshots as unknown[]).length; i++) {
          const s = (anyResult.screenshots as string[])[i];
          console.log(`  [${i}]: ${typeof s === 'string' ? s.substring(0, 80) : typeof s}`);
        }
      }
    }

  } catch (err: unknown) {
    const error = err as Error & { statusCode?: number; response?: { data?: unknown } };
    console.log('  ❌ actions 호출 실패!');
    console.log(`  에러: ${error.message}`);
    if (error.statusCode) console.log(`  상태코드: ${error.statusCode}`);
    if (error.response?.data) console.log(`  응답: ${JSON.stringify(error.response.data).substring(0, 300)}`);

    // -------------------------------------------------------
    // 대안 테스트: fullPageScreenshot 옵션
    // -------------------------------------------------------
    console.log('\n[대안 테스트] actions 없이 기본 screenshot만');
    try {
      const fallback = await firecrawl.v1.scrapeUrl(testUrl, {
        formats: ['markdown', 'screenshot'],
        waitFor: 3000,
      });
      console.log(`  screenshot: ${fallback.screenshot ? `존재 (${typeof fallback.screenshot})` : 'null'}`);
      if (fallback.screenshot && typeof fallback.screenshot === 'string') {
        console.log(`  형식: ${fallback.screenshot.startsWith('http') ? 'URL' : fallback.screenshot.startsWith('data:') ? 'base64' : 'unknown'}`);
        if (fallback.screenshot.startsWith('http')) {
          console.log(`  URL: ${fallback.screenshot.substring(0, 120)}`);
        }
      }
    } catch (fbErr: unknown) {
      console.log(`  대안도 실패: ${(fbErr as Error).message}`);
    }
  }

  console.log('\n═══════════════════════════════════════');
  console.log('  테스트 완료');
  console.log('═══════════════════════════════════════');
}

main().catch(console.error);
