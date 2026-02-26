/**
 * 8개 병원 보고서 DOCX 생성
 * 모든 추출 데이터 포함, 깔끔한 표 형식
 */
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, AlignmentType, HeadingLevel, BorderStyle, ShadingType,
  PageBreak, TableOfContents, Header, Footer, PageNumber, NumberFormat,
  type ITableCellOptions, type IParagraphOptions,
} from 'docx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = path.resolve(__dirname, '..', 'output', 'reports-8');

// ── 색상 팔레트 ──
const COLORS = {
  primary: '1B4F72',     // 진한 파랑
  secondary: '2E86C1',   // 중간 파랑
  accent: 'E74C3C',      // 빨강 포인트
  headerBg: '1B4F72',    // 테이블 헤더 배경
  headerText: 'FFFFFF',  // 테이블 헤더 글자
  altRowBg: 'EBF5FB',    // 테이블 교대행 배경
  lightGray: 'F2F3F4',   // 연한 회색
  darkText: '2C3E50',    // 본문 텍스트
  snsColor: '27AE60',    // SNS 링크 색
  separator: 'D5D8DC',   // 구분선
};

// ── 공통 스타일 헬퍼 ──
const noBorder = {
  top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
};

const thinBorder = {
  top: { style: BorderStyle.SINGLE, size: 1, color: COLORS.separator },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: COLORS.separator },
  left: { style: BorderStyle.SINGLE, size: 1, color: COLORS.separator },
  right: { style: BorderStyle.SINGLE, size: 1, color: COLORS.separator },
};

function headerCell(text: string, widthPct?: number): TableCell {
  const opts: ITableCellOptions = {
    children: [new Paragraph({
      children: [new TextRun({ text, bold: true, color: COLORS.headerText, size: 20, font: 'Malgun Gothic' })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 60, after: 60 },
    })],
    shading: { type: ShadingType.CLEAR, fill: COLORS.headerBg },
    borders: thinBorder,
    verticalAlign: 'center' as any,
  };
  if (widthPct) opts.width = { size: widthPct, type: WidthType.PERCENTAGE };
  return new TableCell(opts);
}

function dataCell(text: string, opts?: { bold?: boolean; color?: string; widthPct?: number; shading?: string; alignment?: typeof AlignmentType[keyof typeof AlignmentType] }): TableCell {
  const cellOpts: ITableCellOptions = {
    children: [new Paragraph({
      children: [new TextRun({
        text,
        bold: opts?.bold || false,
        color: opts?.color || COLORS.darkText,
        size: 19,
        font: 'Malgun Gothic',
      })],
      alignment: opts?.alignment || AlignmentType.LEFT,
      spacing: { before: 40, after: 40 },
    })],
    borders: thinBorder,
    verticalAlign: 'center' as any,
  };
  if (opts?.widthPct) cellOpts.width = { size: opts.widthPct, type: WidthType.PERCENTAGE };
  if (opts?.shading) cellOpts.shading = { type: ShadingType.CLEAR, fill: opts.shading };
  return cellOpts as any;
  // Actually need to return TableCell properly
}

// Proper dataCell
function cell(text: string, options?: {
  bold?: boolean; color?: string; widthPct?: number;
  shading?: string; alignment?: (typeof AlignmentType)[keyof typeof AlignmentType];
  size?: number;
}): TableCell {
  const p = new Paragraph({
    children: [new TextRun({
      text,
      bold: options?.bold || false,
      color: options?.color || COLORS.darkText,
      size: options?.size || 19,
      font: 'Malgun Gothic',
    })],
    alignment: options?.alignment || AlignmentType.LEFT,
    spacing: { before: 40, after: 40 },
    indent: { left: 80 },
  });
  const cellOpts: ITableCellOptions = {
    children: [p],
    borders: thinBorder,
    verticalAlign: 'center' as any,
  };
  if (options?.widthPct) cellOpts.width = { size: options.widthPct, type: WidthType.PERCENTAGE };
  if (options?.shading) cellOpts.shading = { type: ShadingType.CLEAR, fill: options.shading };
  return new TableCell(cellOpts);
}

function kvRow(key: string, value: string, altRow: boolean): TableRow {
  return new TableRow({
    children: [
      cell(key, { bold: true, widthPct: 28, shading: altRow ? COLORS.altRowBg : undefined }),
      cell(value, { widthPct: 72, shading: altRow ? COLORS.altRowBg : undefined }),
    ],
  });
}

function sectionTitle(text: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({ text: '■ ', color: COLORS.accent, size: 24, font: 'Malgun Gothic', bold: true }),
      new TextRun({ text, color: COLORS.primary, size: 24, font: 'Malgun Gothic', bold: true }),
    ],
    spacing: { before: 400, after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: COLORS.secondary } },
  });
}

function bodyText(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, color: COLORS.darkText, size: 18, font: 'Malgun Gothic' })],
    spacing: { before: 40, after: 40 },
    indent: { left: 120 },
  });
}

function emptyLine(): Paragraph {
  return new Paragraph({ spacing: { before: 100, after: 100 } });
}

// ── 보고서 데이터 파싱 ──
interface HospitalData {
  name: string;
  dirName: string;
  url: string;
  method: string;
  textLength: number;
  screenshotCount: number;
  snsLinks: Array<{ text: string; href: string }>;
  pages: Array<{ title: string; content: string }>;
  contactInfo: {
    address?: string;
    phone?: string;
    hours?: string;
    email?: string;
  };
}

const HOSPITAL_META: Record<string, { url: string; method: string }> = {
  '리노보의원_부산_': { url: 'http://www.renovo.co.kr/', method: 'Firecrawl (도쿄)' },
  '벨버티의원_광주_': { url: 'http://velvety.co.kr/', method: 'Firecrawl (도쿄)' },
  '천안이젠의원': { url: 'http://www.ezenskin.co.kr/', method: 'Firecrawl (도쿄)' },
  '포에버의원_신사_': { url: 'https://gn.4-ever.co.kr', method: 'Firecrawl (도쿄)' },
  '부평포에버의원': { url: 'https://www.4-ever.co.kr/', method: 'Firecrawl (도쿄)' },
  '다인피부과': { url: 'http://www.dainskin.co.kr/', method: 'Playwright Fallback' },
  '비에비스나무병원': { url: 'https://www.vievisnamuh.com', method: 'Playwright Fallback' },
  '빈센트의원': { url: 'http://vincent.kr/', method: 'Playwright + JS 네비게이션 순회' },
};

function parseRawText(dirName: string, rawText: string): HospitalData {
  const meta = HOSPITAL_META[dirName] || { url: '', method: '' };
  const name = dirName.replace(/_/g, '(').replace(/\($/, ')').replace(/\(([^)]+)$/, '($1)');

  // Parse pages
  const pages: Array<{ title: string; content: string }> = [];
  const pageBlocks = rawText.split(/\n--- (?:PAGE: |)(.*?) ---\n/);

  if (pageBlocks.length > 1) {
    // Has page separators
    for (let i = 0; i < pageBlocks.length; i++) {
      if (i === 0 && pageBlocks[0].trim()) {
        pages.push({ title: '메인 페이지', content: pageBlocks[0].trim() });
      } else if (i % 2 === 1) {
        const title = pageBlocks[i].trim();
        const content = (pageBlocks[i + 1] || '').trim();
        if (content.length > 30) {
          pages.push({ title: title || `페이지 ${pages.length + 1}`, content });
        }
      }
    }
  } else {
    pages.push({ title: '메인 페이지', content: rawText.trim() });
  }

  // Parse SNS links
  const snsLinks: Array<{ text: string; href: string }> = [];
  const linkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = linkRegex.exec(rawText)) !== null) {
    if (/kakao|naver|instagram|facebook|youtube|blog|tel:|mailto:/i.test(m[2])) {
      snsLinks.push({ text: m[1] || '(링크)', href: m[2] });
    }
  }
  // Also href patterns from text
  const hrefRegex = /(https?:\/\/(?:pf\.kakao|blog\.naver|www\.youtube|www\.instagram|m\.post\.naver)[^\s)]+)/gi;
  while ((m = hrefRegex.exec(rawText)) !== null) {
    if (!snsLinks.some(l => l.href === m![1])) {
      snsLinks.push({ text: '', href: m[1] });
    }
  }
  // tel: patterns
  const telRegex = /(?:TEL|전화|대표전화)[:\s]*([0-9-]{8,15})/gi;
  while ((m = telRegex.exec(rawText)) !== null) {
    if (!snsLinks.some(l => l.href.includes(m![1]))) {
      snsLinks.push({ text: '전화', href: `tel:${m[1]}` });
    }
  }

  // Extract contact info
  const contactInfo: HospitalData['contactInfo'] = {};
  const addrMatch = rawText.match(/(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)[^\n]{5,60}(?:동|로|길|번지)[^\n]{0,30}/);
  if (addrMatch) contactInfo.address = addrMatch[0].trim();
  const phoneMatch = rawText.match(/(?:02|0\d{2})-?\d{3,4}-?\d{4}|1\d{3}-?\d{4}/);
  if (phoneMatch) contactInfo.phone = phoneMatch[0];
  const emailMatch = rawText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  if (emailMatch) contactInfo.email = emailMatch[0];

  // Screenshot count
  const ssDir = path.resolve(REPORTS_DIR, dirName);
  let screenshotCount = 0;
  try {
    screenshotCount = fs.readdirSync(ssDir).filter(f => f.endsWith('.png')).length;
  } catch {}

  return {
    name, dirName, url: meta.url, method: meta.method,
    textLength: rawText.length, screenshotCount,
    snsLinks: snsLinks.filter((v, i, arr) => arr.findIndex(a => a.href === v.href) === i),
    pages, contactInfo,
  };
}

// ── 페이지 콘텐츠를 깔끔하게 정리 ──
function cleanContent(text: string): string[] {
  return text
    .replace(/\[([^\]]*)\]\([^)]+\)/g, '$1')  // 마크다운 링크 제거
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')       // 마크다운 이미지 제거
    .replace(/#{1,6}\s/g, '')                   // 헤딩 마크 제거
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')   // 볼드/이탈릭 제거
    .replace(/\n{4,}/g, '\n\n\n')              // 과도한 줄바꿈 제거
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);
}

// ── 시술/장비 목록 추출 ──
function extractTreatments(rawText: string): string[] {
  const treatments = new Set<string>();
  const keywords = [
    '써마지', 'thermage', '울쎄라', 'ulthera', '인모드', 'inmode',
    '슈링크', '리프팅', '보톡스', '필러', '레이저', '하이푸', 'HIFU',
    '스킨부스터', '쥬베룩', '리쥬란', '엑소좀', '피코', '프락셀',
    'IPL', 'RF', '엘라비에', '덴서티', '코레지', '버츄', '클라리티',
    '에어젯', '코어스컬프', '더블로', '리니어펌', '플라듀오', '바디토닝',
    '지방흡입', '지방이식', '가슴성형', '눈성형', '코성형', '쌍커풀',
    '상안검', '하안검', '안면거상', '이마거상', '제모', '타투',
    '흉터', '여드름', '메디컬', '반영구', '모발이식', '삭센다',
    '윤곽주사', '브이올렛', '체외충격파', 'TORR', '돈지엘', 'PRP',
    '키리엘', '키오머', 'PDRN', '엘씨이밤', '할리우드 스펙트라',
  ];
  const lines = rawText.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    for (const kw of keywords) {
      if (trimmed.toLowerCase().includes(kw.toLowerCase()) && trimmed.length < 60) {
        treatments.add(trimmed);
      }
    }
  }
  return Array.from(treatments).slice(0, 50);
}

// ── DOCX 생성 ──
function generateDocx(data: HospitalData): Document {
  const sections: any[] = [];

  // ═══ 표지 ═══
  sections.push(
    new Paragraph({ spacing: { before: 2000 } }),
    new Paragraph({
      children: [new TextRun({ text: 'MADMEDSALES', color: COLORS.secondary, size: 28, font: 'Malgun Gothic' })],
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({ spacing: { before: 200 } }),
    new Paragraph({
      children: [new TextRun({ text: data.name, color: COLORS.primary, size: 52, font: 'Malgun Gothic', bold: true })],
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({
      children: [new TextRun({ text: '크롤링 데이터 보고서', color: COLORS.darkText, size: 28, font: 'Malgun Gothic' })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 200 },
    }),
    new Paragraph({ spacing: { before: 600 } }),
    new Paragraph({
      children: [new TextRun({ text: `생성일: ${new Date().toISOString().slice(0, 10)}`, color: '888888', size: 20, font: 'Malgun Gothic' })],
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({
      children: [new TextRun({ text: `수집 방법: ${data.method}`, color: '888888', size: 20, font: 'Malgun Gothic' })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 80 },
    }),
    new Paragraph({ children: [new PageBreak()] }),
  );

  // ═══ 1. 기본 정보 ═══
  sections.push(sectionTitle('기본 정보'));
  sections.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        kvRow('병원명', data.name, false),
        kvRow('웹사이트', data.url, true),
        kvRow('수집 방법', data.method, false),
        kvRow('텍스트 총량', `${data.textLength.toLocaleString()}자`, true),
        kvRow('스크린샷', `${data.screenshotCount}장`, false),
        kvRow('수집 페이지', `${data.pages.length}개`, true),
        ...(data.contactInfo.address ? [kvRow('주소', data.contactInfo.address, false)] : []),
        ...(data.contactInfo.phone ? [kvRow('대표전화', data.contactInfo.phone, true)] : []),
        ...(data.contactInfo.email ? [kvRow('이메일', data.contactInfo.email, false)] : []),
      ],
    }),
  );

  // ═══ 2. SNS / 연락처 ═══
  if (data.snsLinks.length > 0) {
    sections.push(emptyLine());
    sections.push(sectionTitle('SNS / 연락처 링크'));

    const snsRows = [
      new TableRow({
        children: [
          headerCell('구분', 20),
          headerCell('링크', 80),
        ],
      }),
    ];

    for (let i = 0; i < data.snsLinks.length; i++) {
      const link = data.snsLinks[i];
      let label = link.text || '(링크)';
      if (link.href.includes('kakao')) label = '카카오톡';
      else if (link.href.includes('blog.naver')) label = '네이버 블로그';
      else if (link.href.includes('youtube')) label = '유튜브';
      else if (link.href.includes('instagram')) label = '인스타그램';
      else if (link.href.includes('post.naver')) label = '네이버 포스트';
      else if (link.href.startsWith('tel:')) label = '전화';
      else if (link.href.startsWith('mailto:')) label = '이메일';

      const isAlt = i % 2 === 1;
      snsRows.push(new TableRow({
        children: [
          cell(label, { bold: true, widthPct: 20, shading: isAlt ? COLORS.altRowBg : undefined, color: COLORS.snsColor }),
          cell(link.href, { widthPct: 80, shading: isAlt ? COLORS.altRowBg : undefined, size: 17 }),
        ],
      }));
    }

    sections.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: snsRows,
    }));
  }

  // ═══ 3. 시술/장비 목록 ═══
  const rawText = data.pages.map(p => p.content).join('\n');
  const treatments = extractTreatments(rawText);
  if (treatments.length > 0) {
    sections.push(emptyLine());
    sections.push(sectionTitle('감지된 시술 / 장비 키워드'));

    // 3열 테이블
    const rows: TableRow[] = [
      new TableRow({
        children: [headerCell('#', 10), headerCell('시술/장비명', 45), headerCell('#', 10), headerCell('시술/장비명', 35)],
      }),
    ];
    const half = Math.ceil(treatments.length / 2);
    for (let i = 0; i < half; i++) {
      const left = treatments[i] || '';
      const right = treatments[i + half] || '';
      const isAlt = i % 2 === 1;
      rows.push(new TableRow({
        children: [
          cell(String(i + 1), { widthPct: 10, shading: isAlt ? COLORS.altRowBg : undefined, alignment: AlignmentType.CENTER }),
          cell(left, { widthPct: 45, shading: isAlt ? COLORS.altRowBg : undefined }),
          cell(i + half < treatments.length ? String(i + half + 1) : '', { widthPct: 10, shading: isAlt ? COLORS.altRowBg : undefined, alignment: AlignmentType.CENTER }),
          cell(right, { widthPct: 35, shading: isAlt ? COLORS.altRowBg : undefined }),
        ],
      }));
    }

    sections.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows,
    }));
  }

  // ═══ 4. 페이지별 상세 데이터 ═══
  sections.push(new Paragraph({ children: [new PageBreak()] }));
  sections.push(sectionTitle('페이지별 추출 데이터'));

  for (let pi = 0; pi < data.pages.length; pi++) {
    const pg = data.pages[pi];
    const lines = cleanContent(pg.content);
    if (lines.length === 0) continue;

    // 페이지 헤더
    sections.push(new Paragraph({
      children: [
        new TextRun({ text: `${pi + 1}. `, color: COLORS.accent, size: 22, font: 'Malgun Gothic', bold: true }),
        new TextRun({ text: pg.title, color: COLORS.primary, size: 22, font: 'Malgun Gothic', bold: true }),
        new TextRun({ text: `  (${lines.length}줄, ${pg.content.length.toLocaleString()}자)`, color: '999999', size: 17, font: 'Malgun Gothic' }),
      ],
      spacing: { before: 300, after: 120 },
      border: { bottom: { style: BorderStyle.DOTTED, size: 1, color: COLORS.separator } },
    }));

    // 내용 (최대 200줄로 제한, 너무 길면 잘라냄)
    const maxLines = 200;
    const displayLines = lines.slice(0, maxLines);

    for (const line of displayLines) {
      // 링크 목록 섹션은 스킵
      if (line.startsWith('--- 링크 목록 ---')) break;

      sections.push(new Paragraph({
        children: [new TextRun({
          text: line,
          color: COLORS.darkText,
          size: 18,
          font: 'Malgun Gothic',
        })],
        spacing: { before: 20, after: 20 },
        indent: { left: 200 },
      }));
    }

    if (lines.length > maxLines) {
      sections.push(new Paragraph({
        children: [new TextRun({
          text: `... 이하 ${lines.length - maxLines}줄 생략 (원본 텍스트 파일 참조)`,
          color: '999999', size: 17, font: 'Malgun Gothic', italics: true,
        })],
        spacing: { before: 60, after: 60 },
        indent: { left: 200 },
      }));
    }
  }

  // ═══ Document 생성 ═══
  return new Document({
    styles: {
      default: {
        document: {
          run: { font: 'Malgun Gothic', size: 20, color: COLORS.darkText },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          margin: { top: 1200, bottom: 1000, left: 1200, right: 1200 },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            children: [new TextRun({ text: `${data.name} — 크롤링 데이터 보고서`, color: '999999', size: 16, font: 'Malgun Gothic' })],
            alignment: AlignmentType.RIGHT,
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            children: [
              new TextRun({ text: 'MADMEDSALES · ', color: COLORS.secondary, size: 16, font: 'Malgun Gothic' }),
              new TextRun({ children: [PageNumber.CURRENT], color: '999999', size: 16 }),
              new TextRun({ text: ' / ', color: '999999', size: 16 }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], color: '999999', size: 16 }),
            ],
            alignment: AlignmentType.CENTER,
          })],
        }),
      },
      children: sections,
    }],
  });
}

// ── 메인 ──
async function main(): Promise<void> {
  console.log('=== 8개 병원 DOCX 보고서 생성 ===\n');

  const dirs = fs.readdirSync(REPORTS_DIR).filter(d => {
    const p = path.resolve(REPORTS_DIR, d);
    return fs.statSync(p).isDirectory() && fs.existsSync(path.resolve(p, 'raw-text.txt'));
  });

  console.log(`📂 ${dirs.length}개 병원 폴더 발견\n`);

  for (const dirName of dirs) {
    const rawTextPath = path.resolve(REPORTS_DIR, dirName, 'raw-text.txt');
    const rawText = fs.readFileSync(rawTextPath, 'utf-8');

    const data = parseRawText(dirName, rawText);
    console.log(`📋 ${data.name}`);
    console.log(`   텍스트: ${data.textLength.toLocaleString()}자 | 페이지: ${data.pages.length}개 | SNS: ${data.snsLinks.length}개 | 스크린샷: ${data.screenshotCount}장`);

    const doc = generateDocx(data);
    const buf = await Packer.toBuffer(doc);

    const outPath = path.resolve(REPORTS_DIR, dirName, `${dirName}_보고서.docx`);
    fs.writeFileSync(outPath, buf);
    console.log(`   ✅ ${(buf.length / 1024).toFixed(0)}KB → ${outPath}\n`);
  }

  console.log('=== 완료 ===');
}

main().catch(console.error);
