/**
 * 타임아웃 8개 병원 전체 데이터 추출 + 보고서 생성
 * Firecrawl (도쿄) 5개 + Playwright fallback 3개
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import FirecrawlApp from '@mendable/firecrawl-js';
import { captureScreenshots, closeBrowser, type ScreenshotResult } from './v5/screenshot-capture.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

const firecrawlApiKey = process.env.FIRECRAWL_API_KEY || 'fc-test';
const firecrawlApiUrl = process.env.FIRECRAWL_API_URL || undefined;
const firecrawl = new FirecrawlApp({ apiKey: firecrawlApiKey, apiUrl: firecrawlApiUrl });

interface HospitalTarget {
  name: string;
  url: string;
  method: 'firecrawl' | 'playwright';
}

const TARGETS: HospitalTarget[] = [
  // Firecrawl 성공 5개
  { name: '리노보의원(부산)', url: 'http://www.renovo.co.kr/', method: 'firecrawl' },
  { name: '벨버티의원(광주)', url: 'http://velvety.co.kr/', method: 'firecrawl' },
  { name: '천안이젠의원', url: 'http://www.ezenskin.co.kr/', method: 'firecrawl' },
  { name: '포에버의원(신사)', url: 'https://gn.4-ever.co.kr', method: 'firecrawl' },
  { name: '부평포에버의원', url: 'https://www.4-ever.co.kr/', method: 'firecrawl' },
  // Playwright fallback 3개
  { name: '다인피부과', url: 'http://www.dainskin.co.kr/', method: 'playwright' },
  { name: '비에비스나무병원', url: 'https://www.vievisnamuh.com', method: 'playwright' },
  { name: '빈센트의원', url: 'http://vincent.kr/', method: 'playwright' },
];

interface CrawlReport {
  name: string;
  url: string;
  method: string;
  elapsedMs: number;
  success: boolean;
  error?: string;
  title?: string;
  markdown: string;
  markdownLength: number;
  links: Array<{ text: string; href: string }>;
  snsLinks: Array<{ text: string; href: string }>;
  screenshots: number;
  screenshotTotalKB: number;
}

async function crawlWithFirecrawl(t: HospitalTarget): Promise<CrawlReport> {
  const start = Date.now();
  const report: CrawlReport = {
    name: t.name, url: t.url, method: 'firecrawl',
    elapsedMs: 0, success: false, markdown: '', markdownLength: 0,
    links: [], snsLinks: [], screenshots: 0, screenshotTotalKB: 0,
  };

  try {
    // Map API로 서브페이지 URL 수집
    let urls: string[] = [t.url];
    try {
      const mapResult = await (firecrawl as any).v1.mapUrl(t.url, { limit: 50 });
      if (mapResult?.links?.length > 0) {
        urls = mapResult.links.slice(0, 30);
        if (!urls.includes(t.url)) urls.unshift(t.url);
      }
    } catch {
      // map 실패 시 메인 URL만
    }
    console.log(`   📍 URL ${urls.length}개 발견`);

    // 각 URL scrape
    const allMarkdowns: string[] = [];
    let crawled = 0;
    let failed = 0;

    for (const url of urls) {
      try {
        const result = await (firecrawl as any).v1.scrapeUrl(url, {
          formats: ['markdown'],
          waitFor: 5000,
          timeout: 30000,
        });
        if (result?.markdown) {
          allMarkdowns.push(`\n\n--- PAGE: ${url} ---\n\n${result.markdown}`);
          crawled++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }

    console.log(`   📄 크롤링: ${crawled}/${urls.length} 성공 (${failed} 실패)`);

    report.markdown = allMarkdowns.join('\n');
    report.markdownLength = report.markdown.length;
    report.success = crawled > 0;

    // 링크 추출 (마크다운에서)
    const linkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
    let match: RegExpExecArray | null;
    while ((match = linkRegex.exec(report.markdown)) !== null) {
      report.links.push({ text: match[1], href: match[2] });
    }

    // SNS 필터
    const snsPattern = /kakao|naver|instagram|facebook|youtube|blog|tel:|mailto:/i;
    report.snsLinks = report.links.filter(l => snsPattern.test(l.href));

    // Playwright 스크린샷도 추가 (메인 페이지만)
    try {
      const ssResult = await captureScreenshots(t.url, {
        maxScreenshots: 10, timeout: 20000, waitAfterScroll: 400,
      });
      report.screenshots = ssResult.screenshots.length;
      report.screenshotTotalKB = ssResult.screenshots.reduce((s, b) => s + b.length, 0) / 1024;
      report.title = ssResult.pageTitle || undefined;

      // 스크린샷 저장
      const outDir = path.resolve(__dirname, '..', 'output', 'reports-8', sanitize(t.name));
      fs.mkdirSync(outDir, { recursive: true });
      for (let i = 0; i < ssResult.screenshots.length; i++) {
        fs.writeFileSync(path.resolve(outDir, `screenshot_${i + 1}.png`), ssResult.screenshots[i]);
      }
    } catch {
      // 스크린샷 실패 무시
    }

  } catch (err) {
    report.error = err instanceof Error ? err.message : String(err);
  }

  report.elapsedMs = Date.now() - start;
  return report;
}

async function crawlWithPlaywright(t: HospitalTarget): Promise<CrawlReport> {
  const start = Date.now();
  const report: CrawlReport = {
    name: t.name, url: t.url, method: 'playwright',
    elapsedMs: 0, success: false, markdown: '', markdownLength: 0,
    links: [], snsLinks: [], screenshots: 0, screenshotTotalKB: 0,
  };

  try {
    const result = await captureScreenshots(t.url, {
      maxScreenshots: 15, timeout: 30000, waitAfterScroll: 500,
    });

    report.title = result.pageTitle;
    report.markdown = result.pageText;
    report.markdownLength = result.pageText.length;
    report.links = result.links;
    report.screenshots = result.screenshots.length;
    report.screenshotTotalKB = result.screenshots.reduce((s, b) => s + b.length, 0) / 1024;
    report.success = result.pageText.length > 50;

    // SNS 필터
    const snsPattern = /kakao|naver|instagram|facebook|youtube|blog|tel:|mailto:/i;
    report.snsLinks = report.links.filter(l => snsPattern.test(l.href));

    // 스크린샷 저장
    const outDir = path.resolve(__dirname, '..', 'output', 'reports-8', sanitize(t.name));
    fs.mkdirSync(outDir, { recursive: true });
    for (let i = 0; i < result.screenshots.length; i++) {
      fs.writeFileSync(path.resolve(outDir, `screenshot_${i + 1}.png`), result.screenshots[i]);
    }

    if (result.errors.length > 0) {
      report.error = result.errors.join('; ');
    }

    // 서브페이지 링크 수집 후 추가 크롤링
    const sameOriginLinks = result.links
      .map(l => l.href)
      .filter(href => {
        try {
          const u = new URL(href, t.url);
          const base = new URL(t.url);
          return u.hostname === base.hostname && u.pathname !== '/' && !u.pathname.endsWith('.jpg') && !u.pathname.endsWith('.png');
        } catch { return false; }
      })
      .map(href => new URL(href, t.url).href)
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .slice(0, 15);

    if (sameOriginLinks.length > 0) {
      console.log(`   📍 서브페이지 ${sameOriginLinks.length}개 추가 크롤링...`);
      let subCount = 0;
      for (const subUrl of sameOriginLinks) {
        try {
          const subResult = await captureScreenshots(subUrl, {
            maxScreenshots: 5, timeout: 15000, waitAfterScroll: 300,
          });
          if (subResult.pageText.length > 50) {
            report.markdown += `\n\n--- PAGE: ${subUrl} ---\n\n${subResult.pageText}`;
            report.links.push(...subResult.links);
            subCount++;

            // 서브페이지 스크린샷 저장
            for (let i = 0; i < subResult.screenshots.length; i++) {
              const ssDir = path.resolve(__dirname, '..', 'output', 'reports-8', sanitize(t.name));
              fs.writeFileSync(path.resolve(ssDir, `sub_${subCount}_ss_${i + 1}.png`), subResult.screenshots[i]);
            }
            report.screenshots += subResult.screenshots.length;
            report.screenshotTotalKB += subResult.screenshots.reduce((s, b) => s + b.length, 0) / 1024;
          }
        } catch {
          // 서브페이지 실패 무시
        }
      }
      console.log(`   📄 서브페이지 ${subCount}개 텍스트 추출 성공`);
      report.markdownLength = report.markdown.length;
      // SNS 재필터
      const snsPattern2 = /kakao|naver|instagram|facebook|youtube|blog|tel:|mailto:/i;
      report.snsLinks = report.links.filter(l => snsPattern2.test(l.href));
    }

  } catch (err) {
    report.error = err instanceof Error ? err.message : String(err);
  }

  report.elapsedMs = Date.now() - start;
  return report;
}

function sanitize(name: string): string {
  return name.replace(/[<>:"/\\|?*()]/g, '_');
}

function generateReportMarkdown(r: CrawlReport): string {
  const lines: string[] = [];
  lines.push(`# ${r.name} 크롤링 보고서`);
  lines.push('');
  lines.push(`| 항목 | 값 |`);
  lines.push(`|------|-----|`);
  lines.push(`| URL | ${r.url} |`);
  lines.push(`| 수집 방법 | ${r.method} |`);
  lines.push(`| 페이지 제목 | ${r.title || '(미추출)'} |`);
  lines.push(`| 소요 시간 | ${(r.elapsedMs / 1000).toFixed(1)}초 |`);
  lines.push(`| 성공 여부 | ${r.success ? 'O' : 'X'} |`);
  lines.push(`| 텍스트 길이 | ${r.markdownLength.toLocaleString()}자 |`);
  lines.push(`| 링크 수 | ${r.links.length}개 |`);
  lines.push(`| SNS/연락처 링크 | ${r.snsLinks.length}개 |`);
  lines.push(`| 스크린샷 | ${r.screenshots}장 (${r.screenshotTotalKB.toFixed(0)}KB) |`);
  if (r.error) {
    lines.push(`| 에러 | ${r.error} |`);
  }
  lines.push('');

  if (r.snsLinks.length > 0) {
    lines.push('## SNS / 연락처 링크');
    lines.push('');
    for (const l of r.snsLinks) {
      lines.push(`- [${l.text || '(없음)'}](${l.href})`);
    }
    lines.push('');
  }

  lines.push('## 전체 추출 텍스트');
  lines.push('');
  lines.push('```');
  lines.push(r.markdown);
  lines.push('```');
  lines.push('');

  return lines.join('\n');
}

async function main(): Promise<void> {
  console.log('=== 8개 병원 전체 데이터 추출 + 보고서 생성 ===\n');

  const outBase = path.resolve(__dirname, '..', 'output', 'reports-8');
  fs.mkdirSync(outBase, { recursive: true });

  const reports: CrawlReport[] = [];

  for (const t of TARGETS) {
    console.log(`\n📋 ${t.name} (${t.method})`);
    console.log(`   URL: ${t.url}`);

    let report: CrawlReport;
    if (t.method === 'firecrawl') {
      report = await crawlWithFirecrawl(t);
    } else {
      report = await crawlWithPlaywright(t);
    }

    reports.push(report);

    console.log(`   ${report.success ? '✅' : '❌'} ${(report.elapsedMs / 1000).toFixed(1)}초 | ${report.markdownLength.toLocaleString()}자 | 📸${report.screenshots}장 | 🔗${report.snsLinks.length}개 SNS`);

    // 개별 보고서 저장
    const reportDir = path.resolve(outBase, sanitize(t.name));
    fs.mkdirSync(reportDir, { recursive: true });
    const md = generateReportMarkdown(report);
    fs.writeFileSync(path.resolve(reportDir, 'report.md'), md, 'utf-8');
    // 원본 텍스트도 별도 저장
    fs.writeFileSync(path.resolve(reportDir, 'raw-text.txt'), report.markdown, 'utf-8');
  }

  await closeBrowser();

  // 전체 요약 보고서
  console.log('\n\n========================================');
  console.log('          전체 요약');
  console.log('========================================\n');

  const summaryLines: string[] = [];
  summaryLines.push('# 8개 병원 크롤링 전체 요약 보고서');
  summaryLines.push('');
  summaryLines.push(`생성일: ${new Date().toISOString().slice(0, 19)}`);
  summaryLines.push('');
  summaryLines.push('| # | 병원명 | 방법 | 시간 | 텍스트 | 스크린샷 | SNS | 결과 |');
  summaryLines.push('|---|--------|------|------|--------|---------|-----|------|');

  for (let i = 0; i < reports.length; i++) {
    const r = reports[i];
    const line = `| ${i + 1} | ${r.name} | ${r.method} | ${(r.elapsedMs / 1000).toFixed(1)}s | ${r.markdownLength.toLocaleString()}자 | ${r.screenshots}장 | ${r.snsLinks.length}개 | ${r.success ? '✅' : '❌'} |`;
    summaryLines.push(line);
    console.log(`${r.success ? '✅' : '❌'} ${r.name.padEnd(16)} | ${r.method.padEnd(10)} | ${(r.elapsedMs / 1000).toFixed(1).padStart(5)}s | ${String(r.markdownLength).padStart(6)}자 | 📸${String(r.screenshots).padStart(2)}장 | 🔗${r.snsLinks.length}개`);
  }

  const totalText = reports.reduce((s, r) => s + r.markdownLength, 0);
  const totalSS = reports.reduce((s, r) => s + r.screenshots, 0);
  const totalTime = reports.reduce((s, r) => s + r.elapsedMs, 0);
  const successCount = reports.filter(r => r.success).length;

  console.log(`\n합계: ${successCount}/8 성공 | ${totalText.toLocaleString()}자 | 📸${totalSS}장 | ⏱️${(totalTime / 1000).toFixed(0)}초`);

  summaryLines.push('');
  summaryLines.push(`**합계:** ${successCount}/8 성공, ${totalText.toLocaleString()}자 텍스트, ${totalSS}장 스크린샷, ${(totalTime / 1000).toFixed(0)}초 소요`);

  fs.writeFileSync(path.resolve(outBase, 'SUMMARY.md'), summaryLines.join('\n'), 'utf-8');
  console.log(`\n📁 보고서 저장: output/reports-8/`);
}

main().catch(console.error);
