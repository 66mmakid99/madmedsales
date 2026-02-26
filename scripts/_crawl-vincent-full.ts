/**
 * 빈센트의원 전체 데이터 추출
 * iframe + javascript:GoSubMenu() 네비게이션 사이트 대응
 */
import { chromium, type Browser, type Page, type Frame } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '..', 'output', 'reports-8', '빈센트의원');

interface SubMenuInfo {
  type: string;
  category: string;
  item: string;
}

interface PageContent {
  category: string;
  item: string;
  text: string;
  screenshotBuf: Buffer | null;
}

async function getContentFrame(page: Page): Promise<Frame | null> {
  const frames = page.frames();
  for (const frame of frames) {
    try {
      const hasGoSubMenu = await frame.evaluate(() =>
        typeof (window as any).GoSubMenu === 'function',
      );
      if (hasGoSubMenu) return frame;
    } catch {
      // skip
    }
  }
  return null;
}

async function extractSubMenuList(frame: Frame): Promise<SubMenuInfo[]> {
  const raw = await frame.evaluate(() => {
    const results: Array<{ type: string; category: string; item: string }> = [];
    const anchors = document.querySelectorAll('a[href^="javascript:GoSubMenu"]');
    for (const a of anchors) {
      const href = a.getAttribute('href') || '';
      const match = href.match(/GoSubMenu\(['"]([^'"]*)['"]\s*,\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]*)['"]\)/);
      if (match) {
        results.push({ type: match[1], category: match[2], item: match[3] });
      }
    }
    return results;
  });

  // deduplicate by category+item
  const seen = new Set<string>();
  return raw.filter(r => {
    const key = `${r.category}|${r.item}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function navigateAndExtract(
  page: Page,
  frame: Frame,
  menu: SubMenuInfo,
): Promise<PageContent> {
  const result: PageContent = {
    category: menu.category,
    item: menu.item,
    text: '',
    screenshotBuf: null,
  };

  try {
    // GoSubMenu 호출
    await frame.evaluate(
      ({ type, category, item }: { type: string; category: string; item: string }) => {
        (window as any).GoSubMenu(type, category, item);
      },
      { type: menu.type, category: menu.category, item: menu.item },
    );

    // 페이지 전환 대기
    await page.waitForTimeout(1500);

    // 콘텐츠 영역 텍스트 추출 (모든 프레임에서)
    const frames = page.frames();
    const texts: string[] = [];
    for (const f of frames) {
      try {
        const t = await f.evaluate(() => {
          // 콘텐츠 영역만 추출 시도
          const content = document.querySelector('.sub_content, .content_wrap, #content, .board_wrap, main');
          if (content) return (content as HTMLElement).innerText || '';
          return document.body?.innerText || '';
        });
        if (t.length > 30) texts.push(t);
      } catch {
        // skip
      }
    }

    result.text = texts.join('\n');

    // 스크린샷
    result.screenshotBuf = await page.screenshot({ type: 'png' });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.text = `[에러: ${msg}]`;
  }

  return result;
}

async function main(): Promise<void> {
  console.log('=== 빈센트의원 전체 데이터 추출 (iframe + JS 네비게이션) ===\n');

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    locale: 'ko-KR',
  });

  const page = await context.newPage();
  await page.route('**/*.{mp4,webm,ogg,mp3,wav}', route => route.abort());

  console.log('📌 메인 페이지 로딩...');
  await page.goto('http://vincent.kr/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  // 팝업 닫기
  const frames = page.frames();
  for (const frame of frames) {
    try {
      await frame.evaluate(() => {
        const closeBtn = document.querySelector('a[href*="closeWin"], [onclick*="close"]');
        if (closeBtn) (closeBtn as HTMLElement).click();
      });
    } catch {}
  }
  await page.waitForTimeout(500);

  // 콘텐츠 프레임 찾기
  const contentFrame = await getContentFrame(page);
  if (!contentFrame) {
    console.error('❌ GoSubMenu가 있는 프레임을 찾을 수 없습니다.');
    await browser.close();
    return;
  }

  console.log('✅ 콘텐츠 프레임 발견\n');

  // 서브메뉴 목록 추출
  const menus = await extractSubMenuList(contentFrame);
  console.log(`📍 서브메뉴 ${menus.length}개 발견\n`);

  // 카테고리별 그룹핑
  const categories = new Map<string, SubMenuInfo[]>();
  for (const m of menus) {
    if (!categories.has(m.category)) categories.set(m.category, []);
    categories.get(m.category)!.push(m);
  }

  // 전체 텍스트 수집
  const allContents: PageContent[] = [];
  let ssCount = 0;

  for (const [category, items] of categories) {
    console.log(`📂 ${category} (${items.length}개)`);

    for (const menu of items) {
      const label = menu.item || '(메인)';
      const content = await navigateAndExtract(page, contentFrame, menu);
      allContents.push(content);

      const textLen = content.text.length;
      const hasText = textLen > 50;
      process.stdout.write(`   ${hasText ? '✅' : '⚠️'} ${label.padEnd(25)} ${String(textLen).padStart(5)}자`);

      // 스크린샷 저장
      if (content.screenshotBuf) {
        ssCount++;
        const fname = `${category}_${label}`.replace(/[<>:"/\\|?*]/g, '_').slice(0, 60);
        fs.writeFileSync(path.resolve(OUT_DIR, `${fname}.png`), content.screenshotBuf);
        process.stdout.write(` 📸`);
      }
      process.stdout.write('\n');
    }
    console.log('');
  }

  await browser.close();

  // 보고서 생성
  const allText = allContents
    .filter(c => c.text.length > 30)
    .map(c => `\n--- ${c.category} > ${c.item || '(메인)'} ---\n\n${c.text}`)
    .join('\n');

  const totalChars = allText.length;
  const successPages = allContents.filter(c => c.text.length > 50).length;

  // 파일 저장
  fs.writeFileSync(path.resolve(OUT_DIR, 'raw-text.txt'), allText, 'utf-8');

  // 보고서 마크다운
  const report = `# 빈센트의원 크롤링 보고서

| 항목 | 값 |
|------|-----|
| URL | http://vincent.kr/ |
| 수집 방법 | playwright (iframe + JS 네비게이션 순회) |
| 페이지 제목 | 눈,코 전문 성형외과 빈센트의원 |
| 서브메뉴 | ${menus.length}개 |
| 성공 페이지 | ${successPages}/${menus.length} |
| 텍스트 길이 | ${totalChars.toLocaleString()}자 |
| 스크린샷 | ${ssCount}장 |
| 카테고리 | ${Array.from(categories.keys()).join(', ')} |

## 카테고리별 데이터

${Array.from(categories.entries()).map(([cat, items]) => {
  const catContents = allContents.filter(c => c.category === cat);
  const catChars = catContents.reduce((s, c) => s + c.text.length, 0);
  return `### ${cat} (${items.length}개, ${catChars.toLocaleString()}자)
${items.map(item => {
  const c = allContents.find(ac => ac.category === item.category && ac.item === item.item);
  return `- ${item.item || '(메인)'}: ${c ? c.text.length.toLocaleString() + '자' : '실패'}`;
}).join('\n')}`;
}).join('\n\n')}

## 전체 추출 텍스트

\`\`\`
${allText}
\`\`\`
`;

  fs.writeFileSync(path.resolve(OUT_DIR, 'report.md'), report, 'utf-8');

  console.log('========================================');
  console.log('          빈센트의원 결과 요약');
  console.log('========================================');
  console.log(`서브메뉴: ${menus.length}개`);
  console.log(`성공: ${successPages}/${menus.length}`);
  console.log(`텍스트: ${totalChars.toLocaleString()}자`);
  console.log(`스크린샷: ${ssCount}장`);
  console.log(`저장: ${OUT_DIR}`);
}

main().catch(console.error);
