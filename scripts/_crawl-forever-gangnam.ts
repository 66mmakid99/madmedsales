/**
 * 포에버의원(강남) 전체 크롤링 — Firecrawl crawlUrl API 사용
 * mapUrl+scrapeUrl 대신 crawlUrl로 서브페이지 자동 탐색
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import FirecrawlApp from '@mendable/firecrawl-js';
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, AlignmentType, BorderStyle, ShadingType, PageBreak,
  Header, Footer, PageNumber,
} from 'docx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

const apiKey = process.env.FIRECRAWL_API_KEY || 'fc-test';
const apiUrl = process.env.FIRECRAWL_API_URL || undefined;
const firecrawl = new FirecrawlApp({ apiKey, apiUrl });

const TARGET_URL = 'https://gn.4-ever.co.kr';
const TARGET_NAME = '포에버의원(강남)';
const OUT_DIR = path.resolve(__dirname, '..', 'output', 'reports-8', '포에버의원_신사_');

// ── 색상 ──
const C = {
  primary: '1B4F72', secondary: '2E86C1', accent: 'E74C3C',
  headerBg: '1B4F72', headerText: 'FFFFFF', altRow: 'EBF5FB',
  dark: '2C3E50', sep: 'D5D8DC', sns: '27AE60',
};

const thinBorder = {
  top: { style: BorderStyle.SINGLE, size: 1, color: C.sep },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: C.sep },
  left: { style: BorderStyle.SINGLE, size: 1, color: C.sep },
  right: { style: BorderStyle.SINGLE, size: 1, color: C.sep },
};

function hCell(text: string, w?: number): TableCell {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text, bold: true, color: C.headerText, size: 20, font: 'Malgun Gothic' })],
      alignment: AlignmentType.CENTER, spacing: { before: 60, after: 60 },
    })],
    shading: { type: ShadingType.CLEAR, fill: C.headerBg },
    borders: thinBorder,
    ...(w ? { width: { size: w, type: WidthType.PERCENTAGE } } : {}),
  });
}

function dCell(text: string, opts?: { bold?: boolean; color?: string; w?: number; bg?: string; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; sz?: number }): TableCell {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text, bold: opts?.bold, color: opts?.color || C.dark, size: opts?.sz || 19, font: 'Malgun Gothic' })],
      alignment: opts?.align || AlignmentType.LEFT, spacing: { before: 40, after: 40 }, indent: { left: 80 },
    })],
    borders: thinBorder,
    ...(opts?.w ? { width: { size: opts.w, type: WidthType.PERCENTAGE } } : {}),
    ...(opts?.bg ? { shading: { type: ShadingType.CLEAR, fill: opts.bg } } : {}),
  });
}

function kvRow(k: string, v: string, alt: boolean): TableRow {
  return new TableRow({ children: [
    dCell(k, { bold: true, w: 28, bg: alt ? C.altRow : undefined }),
    dCell(v, { w: 72, bg: alt ? C.altRow : undefined }),
  ]});
}

function sectionTitle(text: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({ text: '■ ', color: C.accent, size: 24, font: 'Malgun Gothic', bold: true }),
      new TextRun({ text, color: C.primary, size: 24, font: 'Malgun Gothic', bold: true }),
    ],
    spacing: { before: 400, after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: C.secondary } },
  });
}

// ── 시술/장비 키워드 추출 ──
function extractKeywords(text: string): string[] {
  const KW = [
    '써마지', 'Thermage', '울쎄라', 'Ulthera', '인모드', 'InMode',
    '슈링크', '리프팅', '보톡스', '필러', '레이저', 'HIFU', '하이푸',
    '스킨부스터', '쥬베룩', '리쥬란', '엑소좀', '피코', 'IPL', 'RF',
    '엘라비에', '덴서티', '버츄', '코어스컬프', '더블로', '리니어펌',
    '지방흡입', '눈성형', '코성형', '안면거상', '제모', '여드름',
    '탄력', '주름', '색소', '홍조', '모공', '흉터', '기미',
    'TORR', '체외충격파', 'PRP', 'PDRN', '삭센다', '윤곽주사',
    '울쎄라피', '프라임', '볼뉴머', '프로파일로', '쁘띠성형',
    '실리프팅', '올리지오', '포텐자', '시크릿', '스컬프트라',
  ];
  const found = new Set<string>();
  const lower = text.toLowerCase();
  for (const kw of KW) {
    if (lower.includes(kw.toLowerCase())) found.add(kw);
  }
  return Array.from(found);
}

// ── 장비 목록 추출 (상세) ──
function extractEquipment(text: string): string[] {
  const equip = new Set<string>();
  const patterns = [
    /(?:울쎄라|울쎄라피\s*프라임|Ulthera(?:py)?(?:\s*Prime)?)/gi,
    /(?:인모드|InMode)(?:\s*(?:FX|Lift|Mini))?/gi,
    /(?:써마지|Thermage)(?:\s*(?:FLX|CPT))?/gi,
    /(?:슈링크|Shurink)(?:\s*(?:유니버스|Universe))?/gi,
    /(?:더블로|Doublo)(?:\s*(?:골드|Gold))?/gi,
    /(?:리프테라|Liftera)/gi,
    /(?:올리지오|Oligio)/gi,
    /(?:포텐자|Potenza)/gi,
    /(?:시크릿|Secret)(?:\s*RF)?/gi,
    /(?:피코슈어|PicoSure)/gi,
    /(?:피코웨이|PicoWay)/gi,
    /(?:젠틀맥스|GentleMax)/gi,
    /(?:클라리티|Clarity)/gi,
    /(?:엑셀V|Excel\s*V)/gi,
    /(?:볼뉴머|Volnewmer)/gi,
    /(?:텐써마|Tensthera)/gi,
    /TORR\s*RF/gi,
    /(?:코어스컬프|CoolSculpting)/gi,
  ];
  for (const p of patterns) {
    const matches = text.match(p);
    if (matches) {
      for (const m of matches) equip.add(m.trim());
    }
  }
  return Array.from(equip);
}

// ── 시술 목록 추출 ──
function extractTreatments(text: string): string[] {
  const treats = new Set<string>();
  const lines = text.split('\n');
  const treatKw = /보톡스|필러|리프팅|스킨부스터|쥬베룩|리쥬란|엑소좀|지방흡입|윤곽주사|실리프팅|물광|수액|비타민|레이저토닝|IPL|제모|여드름|기미|색소|모공|흉터|탈모|탄력|주름|리프팅|바디|슬림|셀룰라이트/i;
  for (const line of lines) {
    const t = line.trim();
    if (t.length > 3 && t.length < 40 && treatKw.test(t)) {
      treats.add(t);
    }
  }
  return Array.from(treats).slice(0, 60);
}

// ── 가격 정보 추출 ──
function extractPrices(text: string): Array<{ item: string; price: string }> {
  const prices: Array<{ item: string; price: string }> = [];
  const priceRegex = /(.{2,30}?)\s*[:\-–—]\s*(\d{1,3}(?:,\d{3})*)\s*원/g;
  let m: RegExpExecArray | null;
  while ((m = priceRegex.exec(text)) !== null) {
    prices.push({ item: m[1].trim(), price: m[2] + '원' });
  }
  // 만원 패턴
  const manwonRegex = /(.{2,30}?)\s*[:\-–—]\s*(\d{1,4})\s*만\s*원/g;
  while ((m = manwonRegex.exec(text)) !== null) {
    prices.push({ item: m[1].trim(), price: m[2] + '만원' });
  }
  return prices.filter((v, i, arr) => arr.findIndex(a => a.item === v.item) === i).slice(0, 30);
}

async function main(): Promise<void> {
  console.log(`=== ${TARGET_NAME} 전체 크롤링 (crawlUrl API) ===\n`);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // ── Step 1: crawlUrl로 전체 사이트 크롤링 ──
  console.log('📡 Firecrawl crawlUrl 시작...');
  const start = Date.now();

  let crawlResult: any;
  try {
    crawlResult = await (firecrawl as any).v1.crawlUrl(TARGET_URL, {
      limit: 50,
      scrapeOptions: {
        formats: ['markdown'],
        waitFor: 5000,
      },
    }, 2000); // pollInterval 2초
  } catch (err) {
    console.error('❌ crawlUrl 실패:', err instanceof Error ? err.message : err);
    // Fallback: asyncCrawlUrl + checkCrawlStatus
    console.log('\n🔄 asyncCrawlUrl + polling 방식으로 재시도...');
    const asyncResult = await (firecrawl as any).v1.asyncCrawlUrl(TARGET_URL, {
      limit: 50,
      scrapeOptions: {
        formats: ['markdown'],
        waitFor: 5000,
      },
    });

    if (!asyncResult?.success) {
      console.error('❌ asyncCrawlUrl도 실패:', asyncResult);
      return;
    }

    const jobId = asyncResult.id;
    console.log(`   Job ID: ${jobId}`);

    // Poll until done
    let status = 'scraping';
    let pollCount = 0;
    while (status === 'scraping' && pollCount < 60) {
      await new Promise(r => setTimeout(r, 3000));
      pollCount++;
      const check = await (firecrawl as any).v1.checkCrawlStatus(jobId, true);
      status = check?.status || 'unknown';
      const total = check?.data?.length || 0;
      process.stdout.write(`\r   Polling [${pollCount}] status=${status} pages=${total}  `);
      if (status === 'completed') {
        crawlResult = check;
        break;
      }
    }
    console.log('');
  }

  const elapsed = Date.now() - start;
  console.log(`⏱️  ${(elapsed / 1000).toFixed(1)}초 소요\n`);

  if (!crawlResult?.data || !Array.isArray(crawlResult.data)) {
    // Try accessing differently
    if (crawlResult?.success && crawlResult?.data) {
      console.log('crawlResult structure:', Object.keys(crawlResult));
    } else {
      console.error('❌ 크롤링 결과 없음');
      console.log('Raw result:', JSON.stringify(crawlResult)?.slice(0, 500));
      return;
    }
  }

  const pages = Array.isArray(crawlResult.data) ? crawlResult.data : [crawlResult.data];
  console.log(`📄 총 ${pages.length}개 페이지 크롤링 완료\n`);

  // ── Step 2: 페이지별 데이터 정리 ──
  interface PageData {
    url: string;
    title: string;
    markdown: string;
    charCount: number;
  }

  const pageDataList: PageData[] = [];
  const allMarkdowns: string[] = [];

  for (let i = 0; i < pages.length; i++) {
    const pg = pages[i];
    const md = pg.markdown || pg.content || '';
    const url = pg.metadata?.sourceURL || pg.metadata?.url || pg.url || `page_${i + 1}`;
    const title = pg.metadata?.title || '';

    pageDataList.push({ url, title, markdown: md, charCount: md.length });
    allMarkdowns.push(`\n\n--- PAGE: ${url} ---\n\n${md}`);

    const status = md.length > 100 ? '✅' : (md.length > 0 ? '⚠️' : '❌');
    console.log(`${status} [${String(i + 1).padStart(2)}] ${url.slice(0, 60).padEnd(60)} ${String(md.length).padStart(6)}자  ${title.slice(0, 30)}`);
  }

  const fullText = allMarkdowns.join('\n');
  const totalChars = fullText.length;

  // ── Step 3: 데이터 분석 ──
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('          데이터 분석');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const keywords = extractKeywords(fullText);
  const equipment = extractEquipment(fullText);
  const treatments = extractTreatments(fullText);
  const prices = extractPrices(fullText);

  // SNS 링크
  const snsPattern = /(?:https?:\/\/)?(?:pf\.kakao|blog\.naver|www\.youtube|www\.instagram|m\.post\.naver|open\.kakao)[^\s)"\]]+/gi;
  const snsLinks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = snsPattern.exec(fullText)) !== null) {
    if (!snsLinks.includes(m[0])) snsLinks.push(m[0]);
  }
  // tel
  const telPattern = /(?:tel:)?(?:1\d{3}|0\d{1,2})-?\d{3,4}-?\d{4}/g;
  while ((m = telPattern.exec(fullText)) !== null) {
    if (!snsLinks.includes(m[0])) snsLinks.push(m[0]);
  }

  console.log(`📊 총 페이지: ${pages.length}개`);
  console.log(`📝 총 텍스트: ${totalChars.toLocaleString()}자`);
  console.log(`🔧 장비: ${equipment.length}개 → ${equipment.join(', ') || '(없음)'}`);
  console.log(`💉 시술 키워드: ${keywords.length}개 → ${keywords.join(', ') || '(없음)'}`);
  console.log(`📋 시술 목록: ${treatments.length}개`);
  if (treatments.length > 0) {
    for (const t of treatments.slice(0, 20)) console.log(`   - ${t}`);
    if (treatments.length > 20) console.log(`   ... +${treatments.length - 20}개`);
  }
  console.log(`💰 가격 정보: ${prices.length}개`);
  for (const p of prices.slice(0, 10)) console.log(`   - ${p.item}: ${p.price}`);
  console.log(`🔗 SNS/연락처: ${snsLinks.length}개`);
  for (const l of snsLinks.slice(0, 10)) console.log(`   - ${l}`);

  // ── Step 4: 파일 저장 ──
  fs.writeFileSync(path.resolve(OUT_DIR, 'raw-text.txt'), fullText, 'utf-8');
  fs.writeFileSync(path.resolve(OUT_DIR, 'crawl-result.json'), JSON.stringify({
    name: TARGET_NAME,
    url: TARGET_URL,
    crawledAt: new Date().toISOString(),
    totalPages: pages.length,
    totalChars,
    equipment,
    keywords,
    treatmentCount: treatments.length,
    priceCount: prices.length,
    snsLinks,
    pages: pageDataList.map(p => ({ url: p.url, title: p.title, charCount: p.charCount })),
  }, null, 2), 'utf-8');

  // ── Step 5: DOCX 보고서 ──
  console.log('\n📄 DOCX 보고서 생성 중...');

  const docSections: any[] = [];

  // 표지
  docSections.push(
    new Paragraph({ spacing: { before: 2000 } }),
    new Paragraph({ children: [new TextRun({ text: 'MADMEDSALES', color: C.secondary, size: 28, font: 'Malgun Gothic' })], alignment: AlignmentType.CENTER }),
    new Paragraph({ spacing: { before: 200 } }),
    new Paragraph({ children: [new TextRun({ text: TARGET_NAME, color: C.primary, size: 52, font: 'Malgun Gothic', bold: true })], alignment: AlignmentType.CENTER }),
    new Paragraph({ children: [new TextRun({ text: '크롤링 데이터 보고서', color: C.dark, size: 28, font: 'Malgun Gothic' })], alignment: AlignmentType.CENTER, spacing: { before: 200 } }),
    new Paragraph({ spacing: { before: 400 } }),
    new Paragraph({ children: [new TextRun({ text: `${new Date().toISOString().slice(0, 10)} | Firecrawl crawlUrl API | ${pages.length}페이지`, color: '888888', size: 20, font: 'Malgun Gothic' })], alignment: AlignmentType.CENTER }),
    new Paragraph({ children: [new PageBreak()] }),
  );

  // 기본 정보
  docSections.push(sectionTitle('기본 정보'));
  docSections.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
    kvRow('병원명', TARGET_NAME, false),
    kvRow('웹사이트', TARGET_URL, true),
    kvRow('수집 방법', 'Firecrawl crawlUrl (서브페이지 자동 탐색)', false),
    kvRow('크롤링 소요', `${(elapsed / 1000).toFixed(1)}초`, true),
    kvRow('총 페이지', `${pages.length}개`, false),
    kvRow('총 텍스트', `${totalChars.toLocaleString()}자`, true),
    kvRow('장비', equipment.join(', ') || '(미감지)', false),
    kvRow('시술 키워드', keywords.join(', ') || '(미감지)', true),
    kvRow('가격 정보', `${prices.length}건`, false),
    kvRow('SNS/연락처', `${snsLinks.length}개`, true),
  ]}));

  // 장비 테이블
  if (equipment.length > 0) {
    docSections.push(new Paragraph({ spacing: { before: 200 } }));
    docSections.push(sectionTitle('감지된 장비'));
    const eqRows = [new TableRow({ children: [hCell('#', 10), hCell('장비명', 90)] })];
    equipment.forEach((eq, i) => {
      eqRows.push(new TableRow({ children: [
        dCell(String(i + 1), { w: 10, bg: i % 2 ? C.altRow : undefined, align: AlignmentType.CENTER }),
        dCell(eq, { w: 90, bg: i % 2 ? C.altRow : undefined, bold: true }),
      ]}));
    });
    docSections.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: eqRows }));
  }

  // 시술 목록 테이블
  if (treatments.length > 0) {
    docSections.push(new Paragraph({ spacing: { before: 200 } }));
    docSections.push(sectionTitle('시술 목록'));
    const tRows = [new TableRow({ children: [hCell('#', 8), hCell('시술명', 46), hCell('#', 8), hCell('시술명', 38)] })];
    const half = Math.ceil(treatments.length / 2);
    for (let i = 0; i < half; i++) {
      const bg = i % 2 ? C.altRow : undefined;
      tRows.push(new TableRow({ children: [
        dCell(String(i + 1), { w: 8, bg, align: AlignmentType.CENTER }),
        dCell(treatments[i] || '', { w: 46, bg }),
        dCell(i + half < treatments.length ? String(i + half + 1) : '', { w: 8, bg, align: AlignmentType.CENTER }),
        dCell(treatments[i + half] || '', { w: 38, bg }),
      ]}));
    }
    docSections.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: tRows }));
  }

  // 가격 정보
  if (prices.length > 0) {
    docSections.push(new Paragraph({ spacing: { before: 200 } }));
    docSections.push(sectionTitle('가격 정보'));
    const pRows = [new TableRow({ children: [hCell('#', 8), hCell('시술/상품', 60), hCell('가격', 32)] })];
    prices.forEach((p, i) => {
      const bg = i % 2 ? C.altRow : undefined;
      pRows.push(new TableRow({ children: [
        dCell(String(i + 1), { w: 8, bg, align: AlignmentType.CENTER }),
        dCell(p.item, { w: 60, bg }),
        dCell(p.price, { w: 32, bg, bold: true, color: C.accent }),
      ]}));
    });
    docSections.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: pRows }));
  }

  // SNS 링크
  if (snsLinks.length > 0) {
    docSections.push(new Paragraph({ spacing: { before: 200 } }));
    docSections.push(sectionTitle('SNS / 연락처'));
    const sRows = [new TableRow({ children: [hCell('#', 8), hCell('구분', 20), hCell('링크', 72)] })];
    snsLinks.forEach((link, i) => {
      let label = '기타';
      if (link.includes('kakao')) label = '카카오톡';
      else if (link.includes('blog.naver')) label = '블로그';
      else if (link.includes('youtube')) label = '유튜브';
      else if (link.includes('instagram')) label = '인스타';
      else if (/^\d|-/.test(link)) label = '전화';
      const bg = i % 2 ? C.altRow : undefined;
      sRows.push(new TableRow({ children: [
        dCell(String(i + 1), { w: 8, bg, align: AlignmentType.CENTER }),
        dCell(label, { w: 20, bg, bold: true, color: C.sns }),
        dCell(link, { w: 72, bg, sz: 17 }),
      ]}));
    });
    docSections.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: sRows }));
  }

  // 페이지 목록
  docSections.push(new Paragraph({ children: [new PageBreak()] }));
  docSections.push(sectionTitle('크롤링된 페이지 목록'));
  const pgRows = [new TableRow({ children: [hCell('#', 6), hCell('URL', 54), hCell('제목', 24), hCell('텍스트', 16)] })];
  pageDataList.forEach((pg, i) => {
    const bg = i % 2 ? C.altRow : undefined;
    pgRows.push(new TableRow({ children: [
      dCell(String(i + 1), { w: 6, bg, align: AlignmentType.CENTER }),
      dCell(pg.url.replace(TARGET_URL, ''), { w: 54, bg, sz: 16 }),
      dCell(pg.title.slice(0, 25), { w: 24, bg, sz: 16 }),
      dCell(`${pg.charCount.toLocaleString()}자`, { w: 16, bg, align: AlignmentType.RIGHT }),
    ]}));
  });
  docSections.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: pgRows }));

  // 페이지별 전체 텍스트
  docSections.push(new Paragraph({ children: [new PageBreak()] }));
  docSections.push(sectionTitle('페이지별 전체 텍스트'));

  for (let i = 0; i < pageDataList.length; i++) {
    const pg = pageDataList[i];
    docSections.push(new Paragraph({
      children: [
        new TextRun({ text: `${i + 1}. `, color: C.accent, size: 22, font: 'Malgun Gothic', bold: true }),
        new TextRun({ text: pg.url.replace(TARGET_URL, '') || '/', color: C.primary, size: 22, font: 'Malgun Gothic', bold: true }),
        new TextRun({ text: `  (${pg.charCount.toLocaleString()}자)`, color: '999999', size: 17, font: 'Malgun Gothic' }),
      ],
      spacing: { before: 300, after: 120 },
      border: { bottom: { style: BorderStyle.DOTTED, size: 1, color: C.sep } },
    }));

    const lines = pg.markdown.replace(/!\[[^\]]*\]\([^)]+\)/g, '').replace(/\[([^\]]*)\]\([^)]+\)/g, '$1')
      .split('\n').map(l => l.trim()).filter(l => l.length > 0);

    for (const line of lines.slice(0, 150)) {
      docSections.push(new Paragraph({
        children: [new TextRun({ text: line, color: C.dark, size: 18, font: 'Malgun Gothic' })],
        spacing: { before: 20, after: 20 }, indent: { left: 200 },
      }));
    }
    if (lines.length > 150) {
      docSections.push(new Paragraph({
        children: [new TextRun({ text: `... ${lines.length - 150}줄 생략`, color: '999999', size: 17, font: 'Malgun Gothic', italics: true })],
        indent: { left: 200 },
      }));
    }
  }

  const doc = new Document({
    sections: [{
      properties: { page: { margin: { top: 1200, bottom: 1000, left: 1200, right: 1200 } } },
      headers: { default: new Header({ children: [new Paragraph({
        children: [new TextRun({ text: `${TARGET_NAME} — 크롤링 데이터 보고서`, color: '999999', size: 16, font: 'Malgun Gothic' })],
        alignment: AlignmentType.RIGHT,
      })]})},
      footers: { default: new Footer({ children: [new Paragraph({
        children: [
          new TextRun({ text: 'MADMEDSALES · ', color: C.secondary, size: 16, font: 'Malgun Gothic' }),
          new TextRun({ children: [PageNumber.CURRENT], color: '999999', size: 16 }),
          new TextRun({ text: ' / ', color: '999999', size: 16 }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], color: '999999', size: 16 }),
        ],
        alignment: AlignmentType.CENTER,
      })]})},
      children: docSections,
    }],
  });

  const buf = await Packer.toBuffer(doc);
  const docxPath = path.resolve(OUT_DIR, '포에버의원_강남_보고서.docx');
  fs.writeFileSync(docxPath, buf);
  console.log(`\n✅ DOCX 저장: ${docxPath} (${(buf.length / 1024).toFixed(0)}KB)`);

  // 최종 요약
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('          최종 결과');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ 총 페이지: ${pages.length}개`);
  console.log(`✅ 총 텍스트: ${totalChars.toLocaleString()}자`);
  console.log(`✅ 장비: ${equipment.length}개 (${equipment.join(', ')})`);
  console.log(`✅ 시술: ${treatments.length}개`);
  console.log(`✅ 가격: ${prices.length}건`);
  console.log(`✅ SNS: ${snsLinks.length}개`);
}

main().catch(console.error);
