/**
 * v5.5 Playwright 스크린샷 캡처 모듈
 * Firecrawl 셀프호스팅에서 스크린샷 미지원 → Playwright 직접 호출로 대체
 *
 * 방식: viewport 단위로 스크롤하면서 분할 촬영 (v5.4 동일)
 */

import { chromium, type Browser, type Page } from 'playwright';

export interface PageLink {
  text: string;
  href: string;
}

export interface ScreenshotResult {
  url: string;
  screenshots: Buffer[];
  totalHeight: number;
  viewportCount: number;
  errors: string[];
  // v5.5 텍스트 추출 (Firecrawl fallback용)
  pageText: string;        // document.body.innerText
  pageTitle: string;       // document.title
  links: PageLink[];       // 페이지 내 모든 링크
}

export interface CaptureOptions {
  viewportWidth?: number;   // 기본값 1280
  viewportHeight?: number;  // 기본값 1080
  waitAfterScroll?: number; // 스크롤 후 대기 ms, 기본값 500
  maxScreenshots?: number;  // 최대 촬영 수, 기본값 50
  timeout?: number;         // 페이지 로딩 타임아웃, 기본값 30000
  closePopups?: boolean;    // 팝업 닫기 시도, 기본값 true
}

const DEFAULT_OPTIONS: Required<CaptureOptions> = {
  viewportWidth: 1280,
  viewportHeight: 1080,
  waitAfterScroll: 500,
  maxScreenshots: 50,
  timeout: 30000,
  closePopups: true,
};

// 한국 병원 사이트에서 흔한 팝업 닫기 셀렉터
const POPUP_CLOSE_SELECTORS = [
  '.popup-close', '.pop-close', '.close-btn', '.btn-close',
  '[class*="popup"] [class*="close"]',
  '[class*="pop"] [class*="close"]',
  '[id*="popup"] [class*="close"]',
  'a[href*="popup_close"]',
  'img[src*="close"]',
  'button[onclick*="close"]',
  '.layer-close', '.modal-close',
  '[class*="layer"] [class*="close"]',
];

let _browser: Browser | null = null;
let _cleanupRegistered = false;

function registerProcessCleanup(): void {
  if (_cleanupRegistered) return;
  _cleanupRegistered = true;

  const cleanup = (): void => {
    if (_browser) {
      try { (_browser as any).process?.()?.kill('SIGKILL'); } catch {}
      _browser = null;
    }
  };

  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });
  // 주의: uncaughtException에서 process.exit()하면 메인 배치도 죽음
  // 브라우저 정리만 하고, exit 판단은 메인 프로세스 핸들러에 위임
  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception, closing browser:', err.message);
    cleanup();
    // process.exit(1) 제거 — 메인 프로세스 핸들러가 판단
  });
}

async function getBrowser(): Promise<Browser> {
  if (!_browser || !_browser.isConnected()) {
    _browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-web-security',
        '--max_old_space_size=256',
        '--disable-background-timer-throttling',
      ],
    });
    registerProcessCleanup();
  }
  return _browser;
}

/** 브라우저 종료 (파이프라인 마지막에 호출) */
export async function closeBrowser(): Promise<void> {
  if (_browser) {
    await _browser.close().catch(() => {});
    _browser = null;
  }
}

/** 팝업/모달 닫기 시도 */
async function tryClosePopups(page: Page): Promise<number> {
  let closed = 0;
  for (const selector of POPUP_CLOSE_SELECTORS) {
    try {
      const elements = await page.$$(selector);
      for (const el of elements) {
        const visible = await el.isVisible().catch(() => false);
        if (visible) {
          await el.click({ timeout: 1000 }).catch(() => {});
          closed++;
        }
      }
    } catch {
      // 무시
    }
  }

  // "오늘 하루 안보기" 체크박스 + 닫기
  try {
    const todayLabels = await page.$$('text=/오늘.*안.*보/i');
    for (const label of todayLabels) {
      await label.click({ timeout: 500 }).catch(() => {});
      closed++;
    }
  } catch {
    // 무시
  }

  return closed;
}

/**
 * URL의 스크린샷을 viewport 단위로 분할 촬영
 */
export async function captureScreenshots(
  url: string,
  options?: CaptureOptions,
): Promise<ScreenshotResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const result: ScreenshotResult = {
    url,
    screenshots: [],
    totalHeight: 0,
    viewportCount: 0,
    errors: [],
    pageText: '',
    pageTitle: '',
    links: [],
  };

  let page: Page | null = null;
  let context: Awaited<ReturnType<Browser['newContext']>> | null = null;

  try {
    const browser = await getBrowser();
    context = await browser.newContext({
      viewport: { width: opts.viewportWidth, height: opts.viewportHeight },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      locale: 'ko-KR',
    });
    page = await context.newPage();

    // 불필요한 리소스 차단 (속도 개선)
    await page.route('**/*.{mp4,webm,ogg,mp3,wav}', route => route.abort());

    // 페이지 로딩
    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: opts.timeout,
    });

    // 팝업 닫기
    if (opts.closePopups) {
      await page.waitForTimeout(1000); // 팝업 렌더링 대기
      const closedCount = await tryClosePopups(page);
      if (closedCount > 0) {
        await page.waitForTimeout(500);
      }
    }

    // 전체 페이지 높이 측정
    result.totalHeight = await page.evaluate(() => {
      return Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight,
      );
    });

    // viewport 단위로 스크롤하면서 스크린샷 촬영
    let scrollY = 0;
    let count = 0;

    while (scrollY < result.totalHeight && count < opts.maxScreenshots) {
      // 현재 위치로 스크롤
      await page.evaluate((y: number) => window.scrollTo(0, y), scrollY);
      await page.waitForTimeout(opts.waitAfterScroll);

      // 스크린샷 촬영
      const buf = await page.screenshot({ type: 'png' });
      result.screenshots.push(buf);
      count++;

      // 다음 위치로 이동
      scrollY += opts.viewportHeight;

      // 동적 로딩으로 페이지가 늘어났을 수 있으므로 높이 재측정
      if (count % 5 === 0) {
        const newHeight = await page.evaluate(() =>
          Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
        );
        if (newHeight > result.totalHeight) {
          result.totalHeight = newHeight;
        }
      }
    }

    result.viewportCount = count;

    // ── 텍스트 + 링크 추출 (Firecrawl fallback용) ──
    try {
      // 맨 위로 스크롤 (전체 DOM 접근)
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(300);

      result.pageTitle = await page.title();
      result.pageText = await page.evaluate(() => document.body.innerText || '');

      // 모든 링크 추출
      result.links = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a[href]')).map(a => ({
          text: (a.textContent || '').trim().slice(0, 100),
          href: a.getAttribute('href') || '',
        }));
      });

      // iframe 프레임 텍스트 추출 (vincent.kr 같은 iframe 기반 사이트 대응)
      if (result.pageText.length < 100) {
        const frames = page.frames();
        const frameTexts: string[] = [];
        const frameLinks: PageLink[] = [];
        for (const frame of frames) {
          if (frame === page.mainFrame()) continue;
          try {
            const ft = await frame.evaluate(() => document.body?.innerText || '');
            if (ft.length > 20) frameTexts.push(ft);
            const fl = await frame.evaluate(() =>
              Array.from(document.querySelectorAll('a[href]')).map(a => ({
                text: (a.textContent || '').trim().slice(0, 100),
                href: a.getAttribute('href') || '',
              })),
            );
            frameLinks.push(...fl);
          } catch {
            // cross-origin 프레임 등 접근 불가 — 무시
          }
        }
        if (frameTexts.length > 0) {
          result.pageText = frameTexts.join('\n\n');
          result.links.push(...frameLinks);
        }
      }

      // SNS/연락처 링크를 텍스트 끝에 추가 (contact-extractor가 URL 패턴을 찾을 수 있도록)
      const snsPatterns = /kakao|naver|instagram|facebook|youtube|blog\.naver|pf\.kakao|channel\.io|line\.me/i;
      const snsLinks = result.links.filter(l => snsPatterns.test(l.href));
      if (snsLinks.length > 0) {
        const linkSection = snsLinks.map(l => `[${l.text || 'link'}](${l.href})`).join('\n');
        result.pageText += '\n\n--- 링크 목록 ---\n' + linkSection;
      }
    } catch (textErr) {
      const msg = textErr instanceof Error ? textErr.message : String(textErr);
      result.errors.push(`텍스트 추출 실패: ${msg}`);
    }

    await context.close();

  } catch (err) {
    if (context) await context.close().catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(msg);
  }

  return result;
}

/**
 * 여러 URL을 순차적으로 스크린샷 촬영
 */
export async function captureMultiplePages(
  urls: string[],
  options?: CaptureOptions,
): Promise<ScreenshotResult[]> {
  const results: ScreenshotResult[] = [];

  for (const url of urls) {
    const result = await captureScreenshots(url, options);
    results.push(result);
  }

  return results;
}

// ── CLI 단독 실행 ──
if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}` ||
    process.argv[1]?.endsWith('screenshot-capture.ts')) {
  const testUrl = process.argv[2] || 'https://example.com';
  console.log(`📸 Playwright 스크린샷 테스트: ${testUrl}`);
  console.log(`   viewport: ${DEFAULT_OPTIONS.viewportWidth}x${DEFAULT_OPTIONS.viewportHeight}`);

  captureScreenshots(testUrl).then(async (result) => {
    console.log(`\n📊 결과:`);
    console.log(`   URL: ${result.url}`);
    console.log(`   페이지 높이: ${result.totalHeight}px`);
    console.log(`   스크린샷: ${result.viewportCount}장`);
    console.log(`   총 크기: ${(result.screenshots.reduce((s, b) => s + b.length, 0) / 1024).toFixed(0)}KB`);
    console.log(`   페이지 제목: ${result.pageTitle}`);
    console.log(`   텍스트 길이: ${result.pageText.length}자`);
    console.log(`   링크 수: ${result.links.length}개`);
    const snsLinks = result.links.filter(l => /kakao|naver|instagram|facebook|youtube|blog/i.test(l.href));
    if (snsLinks.length > 0) {
      console.log(`   SNS 링크:`);
      for (const l of snsLinks) {
        console.log(`     - [${l.text || '(없음)'}] ${l.href}`);
      }
    }
    if (result.errors.length > 0) {
      console.log(`   에러: ${result.errors.join(', ')}`);
    }

    // 파일 저장 (테스트용)
    const fs = await import('fs');
    const path = await import('path');
    const outDir = path.resolve(import.meta.dirname || '.', '..', '..', 'output', 'screenshots');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    for (let i = 0; i < result.screenshots.length; i++) {
      const fname = path.resolve(outDir, `test_${i + 1}.png`);
      fs.writeFileSync(fname, result.screenshots[i]);
    }
    console.log(`   저장: ${outDir}/test_*.png (${result.screenshots.length}장)`);

    await closeBrowser();
  }).catch(async (err) => {
    console.error('❌ 실패:', err);
    await closeBrowser();
    process.exit(1);
  });
}
