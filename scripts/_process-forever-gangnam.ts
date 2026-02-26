/**
 * 포에버의원(강남) crawlUrl 결과 처리 + DOCX 보고서 생성
 * 이미 다운로드된 crawl-result.json을 읽어서 분석 + DOCX 생성
 */
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, AlignmentType, BorderStyle, ShadingType, PageBreak,
  Header, Footer, PageNumber,
} from 'docx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TARGET_URL = 'https://gn.4-ever.co.kr';
const TARGET_NAME = '포에버의원(강남)';
const DATA_DIR = path.resolve(__dirname, '..', 'output', 'reports-8', 'forever-gangnam');
const OUT_DIR = path.resolve(__dirname, '..', 'output', 'reports-8', 'forever-gangnam');

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
      new TextRun({ text: '\u25A0 ', color: C.accent, size: 24, font: 'Malgun Gothic', bold: true }),
      new TextRun({ text, color: C.primary, size: 24, font: 'Malgun Gothic', bold: true }),
    ],
    spacing: { before: 400, after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: C.secondary } },
  });
}

// ── 키워드/장비/시술/가격 추출 ──
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
    '온다', '구리', '가슴성형', '지방이식',
  ];
  const found = new Set<string>();
  const lower = text.toLowerCase();
  for (const kw of KW) {
    if (lower.includes(kw.toLowerCase())) found.add(kw);
  }
  return Array.from(found);
}

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
    /(?:온다|ONDA)/gi,
    /(?:구리|Gouri)/gi,
    /(?:스컬프트라|Sculptra)/gi,
    /(?:쁘띠셀|PetitCell)/gi,
  ];
  for (const p of patterns) {
    const matches = text.match(p);
    if (matches) {
      for (const m of matches) equip.add(m.trim());
    }
  }
  // 정규화: 동일 장비 통합
  const normalized = new Map<string, string>();
  for (const e of equip) {
    const key = e.toLowerCase().replace(/\s+/g, '');
    if (!normalized.has(key)) normalized.set(key, e);
  }
  return Array.from(normalized.values());
}

function extractTreatments(text: string): string[] {
  const treats = new Set<string>();
  const lines = text.split('\n');
  const treatKw = /보톡스|필러|리프팅|스킨부스터|쥬베룩|리쥬란|엑소좀|지방흡입|윤곽주사|실리프팅|물광|수액|비타민|레이저토닝|IPL|제모|여드름|기미|색소|모공|흉터|탈모|탄력|주름|바디|슬림|셀룰라이트|쁘띠|눈매|코성형|가슴|이마|지방이식|안면거상|구리|스컬프트라|온다|울쎄라|인모드|슈링크|써마지|올리지오|포텐자/i;
  for (const line of lines) {
    const t = line.trim().replace(/^[#*\-\d.]+\s*/, '');
    if (t.length > 3 && t.length < 50 && treatKw.test(t)) {
      treats.add(t);
    }
  }
  return Array.from(treats).slice(0, 80);
}

function extractPrices(text: string): Array<{ item: string; price: string }> {
  const prices: Array<{ item: string; price: string }> = [];
  const priceRegex = /(.{2,30}?)\s*[:\-–—]\s*(\d{1,3}(?:,\d{3})*)\s*원/g;
  let m: RegExpExecArray | null;
  while ((m = priceRegex.exec(text)) !== null) {
    prices.push({ item: m[1].trim(), price: m[2] + '원' });
  }
  const manwonRegex = /(.{2,30}?)\s*[:\-–—]\s*(\d{1,4})\s*만\s*원/g;
  while ((m = manwonRegex.exec(text)) !== null) {
    prices.push({ item: m[1].trim(), price: m[2] + '만원' });
  }
  return prices.filter((v, i, arr) => arr.findIndex(a => a.item === v.item) === i).slice(0, 40);
}

function extractSnsLinks(text: string): Array<{ type: string; link: string }> {
  const results: Array<{ type: string; link: string }> = [];
  const seen = new Set<string>();

  const patterns: Array<{ type: string; regex: RegExp }> = [
    { type: '카카오톡', regex: /(?:https?:\/\/)?(?:pf\.kakao\.com|open\.kakao\.com)[^\s)"\]<]*/gi },
    { type: '블로그', regex: /(?:https?:\/\/)?(?:blog\.naver\.com|m\.blog\.naver\.com)[^\s)"\]<]*/gi },
    { type: '유튜브', regex: /(?:https?:\/\/)?(?:www\.youtube\.com|youtube\.com|youtu\.be)[^\s)"\]<]*/gi },
    { type: '인스타', regex: /(?:https?:\/\/)?(?:www\.instagram\.com|instagram\.com)[^\s)"\]<]*/gi },
    { type: '네이버포스트', regex: /(?:https?:\/\/)?m\.post\.naver\.com[^\s)"\]<]*/gi },
  ];
  for (const { type, regex } of patterns) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const link = match[0];
      if (!seen.has(link)) { seen.add(link); results.push({ type, link }); }
    }
  }
  // 전화번호
  const telRegex = /(?:tel:)?(\d{2,4}-?\d{3,4}-?\d{4})/g;
  let match: RegExpExecArray | null;
  while ((match = telRegex.exec(text)) !== null) {
    const link = match[1];
    if (!seen.has(link) && /^[01]/.test(link)) { seen.add(link); results.push({ type: '전화', link }); }
  }
  return results;
}

// ── 페이지 카테고리 분류 ──
function categorize(url: string): string {
  if (url.includes('/lifting/')) return '리프팅';
  if (url.includes('/skin/')) return '피부';
  if (url.includes('/plastic/plastic_eye')) return '눈성형';
  if (url.includes('/plastic/plastic_nose')) return '코성형';
  if (url.includes('/plastic/plastic_face')) return '안면성형';
  if (url.includes('/plastic/plastic_breast')) return '가슴성형';
  if (url.includes('/petit/')) return '쁘띠성형';
  if (url.includes('/community/event')) return '이벤트';
  if (url.includes('/landing/')) return '랜딩/이벤트';
  if (url.includes('/model')) return '모델';
  if (url.includes('/member/')) return '회원';
  if (url === TARGET_URL || url === TARGET_URL + '/') return '메인';
  return '기타';
}

async function main(): Promise<void> {
  console.log(`=== ${TARGET_NAME} crawlUrl 결과 처리 + DOCX 보고서 ===\n`);

  // ── Load crawl result ──
  const resultPath = path.resolve(DATA_DIR, 'crawl-result.json');
  if (!fs.existsSync(resultPath)) {
    console.error(`결과 파일 없음: ${resultPath}`);
    return;
  }

  const rawData = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
  const pages = rawData.data;
  console.log(`총 ${pages.length}개 페이지 로드\n`);

  // ── 페이지 데이터 정리 ──
  interface PageData {
    url: string;
    title: string;
    markdown: string;
    charCount: number;
    category: string;
  }

  const pageDataList: PageData[] = [];
  const allMarkdowns: string[] = [];

  for (let i = 0; i < pages.length; i++) {
    const pg = pages[i];
    const md = pg.markdown || '';
    const url = pg.metadata?.sourceURL || pg.metadata?.url || `page_${i + 1}`;
    const title = pg.metadata?.title || '';
    const category = categorize(url);

    pageDataList.push({ url, title, markdown: md, charCount: md.length, category });
    allMarkdowns.push(md);

    const status = md.length > 100 ? '\u2705' : (md.length > 0 ? '\u26A0\uFE0F' : '\u274C');
    console.log(`${status} [${String(i + 1).padStart(2)}] ${category.padEnd(8)} ${url.replace(TARGET_URL, '').slice(0, 55).padEnd(57)} ${String(md.length).padStart(6)}\uC790`);
  }

  const fullText = allMarkdowns.join('\n\n');
  const totalChars = fullText.length;

  // ── 데이터 분석 ──
  console.log('\n' + '='.repeat(50));
  console.log('            데이터 분석');
  console.log('='.repeat(50) + '\n');

  const keywords = extractKeywords(fullText);
  const equipment = extractEquipment(fullText);
  const treatments = extractTreatments(fullText);
  const prices = extractPrices(fullText);
  const snsLinks = extractSnsLinks(fullText);

  // 카테고리별 통계
  const catStats = new Map<string, { count: number; chars: number }>();
  for (const pg of pageDataList) {
    const stat = catStats.get(pg.category) || { count: 0, chars: 0 };
    stat.count++;
    stat.chars += pg.charCount;
    catStats.set(pg.category, stat);
  }

  console.log(`총 페이지: ${pages.length}개`);
  console.log(`총 텍스트: ${totalChars.toLocaleString()}\uC790`);
  console.log(`\n카테고리별:`);
  for (const [cat, stat] of catStats) {
    console.log(`  ${cat.padEnd(10)} ${String(stat.count).padStart(3)}페이지  ${stat.chars.toLocaleString().padStart(8)}\uC790`);
  }
  console.log(`\n장비: ${equipment.length}개 -> ${equipment.join(', ') || '(없음)'}`);
  console.log(`시술 키워드: ${keywords.length}개 -> ${keywords.join(', ')}`);
  console.log(`시술 목록: ${treatments.length}개`);
  if (treatments.length > 0) {
    for (const t of treatments.slice(0, 25)) console.log(`   - ${t}`);
    if (treatments.length > 25) console.log(`   ... +${treatments.length - 25}개`);
  }
  console.log(`가격 정보: ${prices.length}개`);
  for (const p of prices.slice(0, 10)) console.log(`   - ${p.item}: ${p.price}`);
  console.log(`SNS/연락처: ${snsLinks.length}개`);
  for (const l of snsLinks.slice(0, 10)) console.log(`   - [${l.type}] ${l.link}`);

  // ── raw-text 저장 ──
  const rawTextPath = path.resolve(OUT_DIR, 'raw-text.txt');
  const rawTextContent = pageDataList
    .map((pg, i) => `\n${'='.repeat(60)}\nPAGE ${i + 1}: ${pg.url}\nCategory: ${pg.category}\nTitle: ${pg.title}\n${'='.repeat(60)}\n\n${pg.markdown}`)
    .join('\n\n');
  fs.writeFileSync(rawTextPath, rawTextContent, 'utf-8');
  console.log(`\nraw-text.txt 저장 (${(rawTextContent.length / 1024).toFixed(0)}KB)`);

  // ── report.md 저장 ──
  const reportMd = `# ${TARGET_NAME} 크롤링 보고서 (crawlUrl)

| 항목 | 값 |
|------|-----|
| URL | ${TARGET_URL} |
| 수집 방법 | Firecrawl crawlUrl (서브페이지 자동 탐색) |
| 총 페이지 | ${pages.length}개 |
| 총 텍스트 | ${totalChars.toLocaleString()}\uC790 |
| 장비 | ${equipment.join(', ') || '(미감지)'} |
| 시술 키워드 | ${keywords.length}개 |
| 시술 목록 | ${treatments.length}개 |
| 가격 정보 | ${prices.length}건 |
| SNS/연락처 | ${snsLinks.length}개 |

## 카테고리별 통계

| 카테고리 | 페이지 수 | 텍스트 |
|---------|----------|--------|
${Array.from(catStats.entries()).map(([cat, s]) => `| ${cat} | ${s.count}개 | ${s.chars.toLocaleString()}\uC790 |`).join('\n')}

## 감지된 장비
${equipment.map((e, i) => `${i + 1}. ${e}`).join('\n') || '(없음)'}

## 시술 목록
${treatments.map((t, i) => `${i + 1}. ${t}`).join('\n') || '(없음)'}

## 가격 정보
${prices.map(p => `- ${p.item}: ${p.price}`).join('\n') || '(없음)'}

## SNS/연락처
${snsLinks.map(l => `- [${l.type}] ${l.link}`).join('\n') || '(없음)'}
`;
  fs.writeFileSync(path.resolve(OUT_DIR, 'report.md'), reportMd, 'utf-8');

  // ── DOCX 보고서 ──
  console.log('\nDOCX 보고서 생성 중...');

  const docChildren: any[] = [];

  // 표지
  docChildren.push(
    new Paragraph({ spacing: { before: 2000 } }),
    new Paragraph({ children: [new TextRun({ text: 'MADMEDSALES', color: C.secondary, size: 28, font: 'Malgun Gothic' })], alignment: AlignmentType.CENTER }),
    new Paragraph({ spacing: { before: 200 } }),
    new Paragraph({ children: [new TextRun({ text: TARGET_NAME, color: C.primary, size: 52, font: 'Malgun Gothic', bold: true })], alignment: AlignmentType.CENTER }),
    new Paragraph({ children: [new TextRun({ text: '\uD06C\uB864\uB9C1 \uB370\uC774\uD130 \uBCF4\uACE0\uC11C', color: C.dark, size: 28, font: 'Malgun Gothic' })], alignment: AlignmentType.CENTER, spacing: { before: 200 } }),
    new Paragraph({ spacing: { before: 400 } }),
    new Paragraph({ children: [new TextRun({ text: `${new Date().toISOString().slice(0, 10)} | Firecrawl crawlUrl API | ${pages.length}\uD398\uC774\uC9C0 | ${totalChars.toLocaleString()}\uC790`, color: '888888', size: 20, font: 'Malgun Gothic' })], alignment: AlignmentType.CENTER }),
    new Paragraph({ children: [new PageBreak()] }),
  );

  // 기본 정보
  docChildren.push(sectionTitle('\uAE30\uBCF8 \uC815\uBCF4'));
  docChildren.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
    kvRow('\uBCD1\uC6D0\uBA85', TARGET_NAME, false),
    kvRow('\uC6F9\uC0AC\uC774\uD2B8', TARGET_URL, true),
    kvRow('\uC218\uC9D1 \uBC29\uBC95', 'Firecrawl crawlUrl (\uC11C\uBE0C\uD398\uC774\uC9C0 \uC790\uB3D9 \uD0D0\uC0C9)', false),
    kvRow('\uCD1D \uD398\uC774\uC9C0', `${pages.length}\uAC1C`, true),
    kvRow('\uCD1D \uD14D\uC2A4\uD2B8', `${totalChars.toLocaleString()}\uC790`, false),
    kvRow('\uC7A5\uBE44', equipment.join(', ') || '(\uBBF8\uAC10\uC9C0)', true),
    kvRow('\uC2DC\uC220 \uD0A4\uC6CC\uB4DC', `${keywords.length}\uAC1C`, false),
    kvRow('\uAC00\uACA9 \uC815\uBCF4', `${prices.length}\uAC74`, true),
    kvRow('SNS/\uC5F0\uB77D\uCC98', `${snsLinks.length}\uAC1C`, false),
  ]}));

  // 카테고리별 통계
  docChildren.push(new Paragraph({ spacing: { before: 200 } }));
  docChildren.push(sectionTitle('\uCE74\uD14C\uACE0\uB9AC\uBCC4 \uD1B5\uACC4'));
  const catRows = [new TableRow({ children: [hCell('\uCE74\uD14C\uACE0\uB9AC', 30), hCell('\uD398\uC774\uC9C0 \uC218', 20), hCell('\uD14D\uC2A4\uD2B8', 25), hCell('\uBE44\uC728', 25)] })];
  let rowIdx = 0;
  for (const [cat, stat] of catStats) {
    const pct = ((stat.chars / totalChars) * 100).toFixed(1);
    catRows.push(new TableRow({ children: [
      dCell(cat, { w: 30, bold: true, bg: rowIdx % 2 ? C.altRow : undefined }),
      dCell(`${stat.count}\uAC1C`, { w: 20, align: AlignmentType.CENTER, bg: rowIdx % 2 ? C.altRow : undefined }),
      dCell(`${stat.chars.toLocaleString()}\uC790`, { w: 25, align: AlignmentType.RIGHT, bg: rowIdx % 2 ? C.altRow : undefined }),
      dCell(`${pct}%`, { w: 25, align: AlignmentType.CENTER, bg: rowIdx % 2 ? C.altRow : undefined }),
    ]}));
    rowIdx++;
  }
  docChildren.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: catRows }));

  // 장비 테이블
  if (equipment.length > 0) {
    docChildren.push(new Paragraph({ spacing: { before: 200 } }));
    docChildren.push(sectionTitle('\uAC10\uC9C0\uB41C \uC7A5\uBE44'));
    const eqRows = [new TableRow({ children: [hCell('#', 10), hCell('\uC7A5\uBE44\uBA85', 90)] })];
    equipment.forEach((eq, i) => {
      eqRows.push(new TableRow({ children: [
        dCell(String(i + 1), { w: 10, bg: i % 2 ? C.altRow : undefined, align: AlignmentType.CENTER }),
        dCell(eq, { w: 90, bg: i % 2 ? C.altRow : undefined, bold: true }),
      ]}));
    });
    docChildren.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: eqRows }));
  }

  // 시술 키워드 테이블
  if (keywords.length > 0) {
    docChildren.push(new Paragraph({ spacing: { before: 200 } }));
    docChildren.push(sectionTitle('\uC2DC\uC220 \uD0A4\uC6CC\uB4DC'));
    const kwRows = [new TableRow({ children: [hCell('#', 8), hCell('\uD0A4\uC6CC\uB4DC', 42), hCell('#', 8), hCell('\uD0A4\uC6CC\uB4DC', 42)] })];
    const kwHalf = Math.ceil(keywords.length / 2);
    for (let i = 0; i < kwHalf; i++) {
      const bg = i % 2 ? C.altRow : undefined;
      kwRows.push(new TableRow({ children: [
        dCell(String(i + 1), { w: 8, bg, align: AlignmentType.CENTER }),
        dCell(keywords[i], { w: 42, bg, bold: true }),
        dCell(i + kwHalf < keywords.length ? String(i + kwHalf + 1) : '', { w: 8, bg, align: AlignmentType.CENTER }),
        dCell(keywords[i + kwHalf] || '', { w: 42, bg, bold: true }),
      ]}));
    }
    docChildren.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: kwRows }));
  }

  // 시술 목록 테이블
  if (treatments.length > 0) {
    docChildren.push(new Paragraph({ spacing: { before: 200 } }));
    docChildren.push(sectionTitle(`\uC2DC\uC220 \uBAA9\uB85D (${treatments.length}\uAC1C)`));
    const tRows = [new TableRow({ children: [hCell('#', 8), hCell('\uC2DC\uC220\uBA85', 42), hCell('#', 8), hCell('\uC2DC\uC220\uBA85', 42)] })];
    const half = Math.ceil(treatments.length / 2);
    for (let i = 0; i < half; i++) {
      const bg = i % 2 ? C.altRow : undefined;
      tRows.push(new TableRow({ children: [
        dCell(String(i + 1), { w: 8, bg, align: AlignmentType.CENTER }),
        dCell(treatments[i] || '', { w: 42, bg }),
        dCell(i + half < treatments.length ? String(i + half + 1) : '', { w: 8, bg, align: AlignmentType.CENTER }),
        dCell(treatments[i + half] || '', { w: 42, bg }),
      ]}));
    }
    docChildren.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: tRows }));
  }

  // 가격 정보
  if (prices.length > 0) {
    docChildren.push(new Paragraph({ spacing: { before: 200 } }));
    docChildren.push(sectionTitle(`\uAC00\uACA9 \uC815\uBCF4 (${prices.length}\uAC74)`));
    const pRows = [new TableRow({ children: [hCell('#', 8), hCell('\uC2DC\uC220/\uC0C1\uD488', 60), hCell('\uAC00\uACA9', 32)] })];
    prices.forEach((p, i) => {
      const bg = i % 2 ? C.altRow : undefined;
      pRows.push(new TableRow({ children: [
        dCell(String(i + 1), { w: 8, bg, align: AlignmentType.CENTER }),
        dCell(p.item, { w: 60, bg }),
        dCell(p.price, { w: 32, bg, bold: true, color: C.accent }),
      ]}));
    });
    docChildren.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: pRows }));
  }

  // SNS 링크
  if (snsLinks.length > 0) {
    docChildren.push(new Paragraph({ spacing: { before: 200 } }));
    docChildren.push(sectionTitle('SNS / \uC5F0\uB77D\uCC98'));
    const sRows = [new TableRow({ children: [hCell('#', 8), hCell('\uAD6C\uBD84', 18), hCell('\uB9C1\uD06C', 74)] })];
    snsLinks.forEach((l, i) => {
      const bg = i % 2 ? C.altRow : undefined;
      sRows.push(new TableRow({ children: [
        dCell(String(i + 1), { w: 8, bg, align: AlignmentType.CENTER }),
        dCell(l.type, { w: 18, bg, bold: true, color: C.sns }),
        dCell(l.link, { w: 74, bg, sz: 17 }),
      ]}));
    });
    docChildren.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: sRows }));
  }

  // 페이지 목록
  docChildren.push(new Paragraph({ children: [new PageBreak()] }));
  docChildren.push(sectionTitle(`\uD06C\uB864\uB9C1\uB41C \uD398\uC774\uC9C0 \uBAA9\uB85D (${pages.length}\uAC1C)`));
  const pgRows = [new TableRow({ children: [hCell('#', 5), hCell('\uCE74\uD14C\uACE0\uB9AC', 12), hCell('URL', 53), hCell('\uD14D\uC2A4\uD2B8', 14), hCell('\uC81C\uBAA9', 16)] })];
  pageDataList.forEach((pg, i) => {
    const bg = i % 2 ? C.altRow : undefined;
    pgRows.push(new TableRow({ children: [
      dCell(String(i + 1), { w: 5, bg, align: AlignmentType.CENTER }),
      dCell(pg.category, { w: 12, bg, bold: true }),
      dCell(pg.url.replace(TARGET_URL, '').slice(0, 55), { w: 53, bg, sz: 16 }),
      dCell(`${pg.charCount.toLocaleString()}\uC790`, { w: 14, bg, align: AlignmentType.RIGHT }),
      dCell((pg.title || '').slice(0, 15), { w: 16, bg, sz: 16 }),
    ]}));
  });
  docChildren.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: pgRows }));

  // 페이지별 전체 텍스트 (요약)
  docChildren.push(new Paragraph({ children: [new PageBreak()] }));
  docChildren.push(sectionTitle('\uD398\uC774\uC9C0\uBCC4 \uCD94\uCD9C \uD14D\uC2A4\uD2B8'));

  for (let i = 0; i < pageDataList.length; i++) {
    const pg = pageDataList[i];
    if (pg.charCount < 50) continue; // 빈 페이지 스킵

    docChildren.push(new Paragraph({
      children: [
        new TextRun({ text: `${i + 1}. `, color: C.accent, size: 22, font: 'Malgun Gothic', bold: true }),
        new TextRun({ text: `[${pg.category}] ${pg.url.replace(TARGET_URL, '') || '/'}`, color: C.primary, size: 22, font: 'Malgun Gothic', bold: true }),
        new TextRun({ text: `  (${pg.charCount.toLocaleString()}\uC790)`, color: '999999', size: 17, font: 'Malgun Gothic' }),
      ],
      spacing: { before: 300, after: 120 },
      border: { bottom: { style: BorderStyle.DOTTED, size: 1, color: C.sep } },
    }));

    // 마크다운 → 텍스트 정리
    const lines = pg.markdown
      .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]+\)/g, '$1')
      .split('\n').map(l => l.trim()).filter(l => l.length > 0);

    const maxLines = 120;
    for (const line of lines.slice(0, maxLines)) {
      docChildren.push(new Paragraph({
        children: [new TextRun({ text: line, color: C.dark, size: 18, font: 'Malgun Gothic' })],
        spacing: { before: 20, after: 20 }, indent: { left: 200 },
      }));
    }
    if (lines.length > maxLines) {
      docChildren.push(new Paragraph({
        children: [new TextRun({ text: `... ${lines.length - maxLines}\uC904 \uC0DD\uB7B5`, color: '999999', size: 17, font: 'Malgun Gothic', italics: true })],
        indent: { left: 200 },
      }));
    }
  }

  const doc = new Document({
    sections: [{
      properties: { page: { margin: { top: 1200, bottom: 1000, left: 1200, right: 1200 } } },
      headers: { default: new Header({ children: [new Paragraph({
        children: [new TextRun({ text: `${TARGET_NAME} \u2014 \uD06C\uB864\uB9C1 \uB370\uC774\uD130 \uBCF4\uACE0\uC11C`, color: '999999', size: 16, font: 'Malgun Gothic' })],
        alignment: AlignmentType.RIGHT,
      })]})},
      footers: { default: new Footer({ children: [new Paragraph({
        children: [
          new TextRun({ text: 'MADMEDSALES \u00B7 ', color: C.secondary, size: 16, font: 'Malgun Gothic' }),
          new TextRun({ children: [PageNumber.CURRENT], color: '999999', size: 16 }),
          new TextRun({ text: ' / ', color: '999999', size: 16 }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], color: '999999', size: 16 }),
        ],
        alignment: AlignmentType.CENTER,
      })]})},
      children: docChildren,
    }],
  });

  const buf = await Packer.toBuffer(doc);
  const docxPath = path.resolve(OUT_DIR, 'forever-gangnam-report.docx');
  fs.writeFileSync(docxPath, buf);
  console.log(`\nDOCX 저장: ${docxPath} (${(buf.length / 1024).toFixed(0)}KB)`);

  // 최종 요약
  console.log('\n' + '='.repeat(50));
  console.log('            최종 결과');
  console.log('='.repeat(50));
  console.log(`총 페이지: ${pages.length}개 (이전: 1개)`);
  console.log(`총 텍스트: ${totalChars.toLocaleString()}\uC790 (이전: 31,773\uC790)`);
  console.log(`장비: ${equipment.length}개 (${equipment.join(', ')})`);
  console.log(`시술 키워드: ${keywords.length}개`);
  console.log(`시술 목록: ${treatments.length}개`);
  console.log(`가격: ${prices.length}건`);
  console.log(`SNS: ${snsLinks.length}개`);
  console.log(`\n\uAC1C\uC120: 1\uD398\uC774\uC9C0 \u2192 ${pages.length}\uD398\uC774\uC9C0, 31,773\uC790 \u2192 ${totalChars.toLocaleString()}\uC790 (${(totalChars / 31773 * 100).toFixed(0)}% \uC99D\uAC00)`);
}

main().catch(console.error);
