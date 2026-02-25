/**
 * 3개 테스트 병원의 크롤링 원본 데이터를 Word 파일로 내보내기
 * - 모든 페이지 마크다운 텍스트
 * - OCR 추출 텍스트
 * - 스크린샷 이미지 전부
 * - Gemini 분석 결과 JSON
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, BorderStyle, ImageRun,
  PageBreak,
} from 'docx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

interface ScreenshotEntry {
  url: string;
  position: string;
  order: number;
}

const HOSPITALS = [
  { name: '안산엔비의원', id: '1267b395-1132-4511-a8ba-1afc228a8867' },
  { name: '동안중심의원', id: '7b169807-6d76-4796-a31b-7b35f0437899' },
  { name: '포에버의원(신사)', id: '92f7b52a-66e9-4b1c-a118-6058f89db92e' },
];

// ── 헬퍼 ──
const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const borders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };
const thinBorder = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const cellBorders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };

function heading(text: string, level: typeof HeadingLevel[keyof typeof HeadingLevel] = HeadingLevel.HEADING_1): Paragraph {
  return new Paragraph({ heading: level, children: [new TextRun({ text, font: 'Malgun Gothic', bold: true })] });
}

function para(text: string, opts?: { bold?: boolean; size?: number; color?: string; break?: boolean }): Paragraph {
  return new Paragraph({
    children: [
      ...(opts?.break ? [new PageBreak()] : []),
      new TextRun({
        text,
        font: 'Malgun Gothic',
        size: opts?.size || 20,
        bold: opts?.bold,
        color: opts?.color,
      }),
    ],
  });
}

function emptyLine(): Paragraph {
  return new Paragraph({ children: [] });
}

/** 긴 텍스트를 여러 Paragraph로 분할 (Word는 단일 Run에 텍스트 제한) */
function textBlock(text: string, maxLineLen = 500): Paragraph[] {
  const lines = text.split('\n');
  const paragraphs: Paragraph[] = [];
  for (const line of lines) {
    if (line.trim().length === 0) {
      paragraphs.push(emptyLine());
    } else {
      // 한 줄이 너무 길면 잘라서
      for (let i = 0; i < line.length; i += maxLineLen) {
        paragraphs.push(new Paragraph({
          children: [new TextRun({ text: line.substring(i, i + maxLineLen), font: 'Consolas', size: 16 })],
        }));
      }
    }
  }
  return paragraphs;
}

async function downloadImage(url: string): Promise<Buffer | null> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) return null;
    const arrayBuf = await resp.arrayBuffer();
    return Buffer.from(arrayBuf);
  } catch {
    return null;
  }
}

async function processHospital(hospital: { name: string; id: string }): Promise<Paragraph[]> {
  const children: Paragraph[] = [];
  const hId = hospital.id;

  console.log(`\n━━━ ${hospital.name} ━━━`);

  // 1. DB에서 크롤 페이지 로드
  const { data: pages, error } = await supabase.from('hospital_crawl_pages')
    .select('url, page_type, markdown, char_count, screenshot_url')
    .eq('hospital_id', hId)
    .order('crawled_at');

  if (error || !pages) {
    console.log(`  ❌ 페이지 로드 실패: ${error?.message}`);
    children.push(para(`페이지 로드 실패: ${error?.message}`));
    return children;
  }

  console.log(`  📄 ${pages.length}페이지 로드`);

  // ── 병원 제목 ──
  children.push(heading(`${hospital.name} — 크롤링 원본 데이터`));
  children.push(para(`Hospital ID: ${hId}`, { size: 18, color: '666666' }));
  children.push(para(`총 ${pages.length}페이지, 추출일: ${new Date().toISOString().substring(0, 10)}`, { size: 18 }));
  children.push(emptyLine());

  // ══════════════════════════════════════════
  // PART 1: 페이지별 마크다운 텍스트 + 스크린샷
  // ══════════════════════════════════════════
  children.push(heading('PART 1: 페이지별 크롤링 데이터 (텍스트 + 이미지)', HeadingLevel.HEADING_2));
  children.push(emptyLine());

  let imgCount = 0;
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    children.push(heading(`페이지 ${i + 1}/${pages.length}: [${p.page_type}] ${p.url}`, HeadingLevel.HEADING_3));
    children.push(para(`글자 수: ${(p.char_count || 0).toLocaleString()}자`, { size: 18, color: '888888' }));
    children.push(emptyLine());

    // 마크다운 텍스트
    if (p.markdown && p.markdown.trim().length > 0) {
      children.push(para('── 마크다운 텍스트 ──', { bold: true, size: 18 }));
      // 매우 긴 마크다운은 잘라서 표시 (Word 한계)
      const mdText = p.markdown.length > 30000
        ? p.markdown.substring(0, 30000) + `\n\n... [${(p.markdown.length - 30000).toLocaleString()}자 생략] ...`
        : p.markdown;
      children.push(...textBlock(mdText));
      children.push(emptyLine());
    } else {
      children.push(para('(마크다운 텍스트 없음)', { color: 'CC0000', size: 18 }));
    }

    // 스크린샷 이미지
    let ssEntries: ScreenshotEntry[] = [];
    try {
      if (p.screenshot_url) {
        ssEntries = typeof p.screenshot_url === 'string'
          ? JSON.parse(p.screenshot_url)
          : p.screenshot_url;
      }
    } catch { /* ignore parse errors */ }

    if (ssEntries.length > 0) {
      children.push(para(`── 스크린샷 (${ssEntries.length}장) ──`, { bold: true, size: 18 }));
      for (const ss of ssEntries) {
        const buf = await downloadImage(ss.url);
        if (buf) {
          imgCount++;
          children.push(para(`[${ss.position}] ${ss.url.split('/').pop()}`, { size: 14, color: '888888' }));
          try {
            children.push(new Paragraph({
              children: [new ImageRun({
                data: buf,
                transformation: { width: 580, height: Math.round(580 * 1.2) },
                type: 'png',
              })],
            }));
          } catch {
            children.push(para(`(이미지 삽입 실패: ${ss.url.split('/').pop()})`, { color: 'CC0000' }));
          }
          children.push(emptyLine());
        } else {
          children.push(para(`(다운로드 실패: ${ss.url})`, { color: 'CC0000', size: 16 }));
        }
      }
    }

    children.push(emptyLine());
    // 페이지 간 구분 (마지막 제외)
    if (i < pages.length - 1 && (i + 1) % 5 === 0) {
      children.push(para('', { break: true }));
    }
  }

  console.log(`  🖼️ 스크린샷 ${imgCount}장 다운로드`);

  // ══════════════════════════════════════════
  // PART 2: OCR 추출 텍스트
  // ══════════════════════════════════════════
  const ocrPath = path.resolve(__dirname, '..', 'output', `${hId}_ocr_raw.json`);
  if (fs.existsSync(ocrPath)) {
    children.push(para('', { break: true }));
    children.push(heading('PART 2: OCR 추출 텍스트 (이미지에서 추출한 원문)', HeadingLevel.HEADING_2));
    children.push(emptyLine());

    const ocrData: Array<{ source: string; text: string }> = JSON.parse(fs.readFileSync(ocrPath, 'utf8'));
    console.log(`  📝 OCR ${ocrData.length}건`);

    for (let i = 0; i < ocrData.length; i++) {
      const ocr = ocrData[i];
      children.push(para(`[OCR ${i + 1}/${ocrData.length}] ${ocr.source}`, { bold: true, size: 18 }));
      if (ocr.text === '텍스트_없음') {
        children.push(para('(텍스트 없음)', { color: '999999' }));
      } else {
        children.push(...textBlock(ocr.text));
      }
      children.push(emptyLine());
    }
  }

  // ══════════════════════════════════════════
  // PART 3: Gemini 분석 결과 JSON
  // ══════════════════════════════════════════
  const analysisPath = path.resolve(__dirname, '..', 'output', `${hId}_analysis.json`);
  if (fs.existsSync(analysisPath)) {
    children.push(para('', { break: true }));
    children.push(heading('PART 3: Gemini 분석 결과 (구조화 JSON)', HeadingLevel.HEADING_2));
    children.push(emptyLine());

    const analysisJson = fs.readFileSync(analysisPath, 'utf8');
    console.log(`  🧠 분석 JSON ${(analysisJson.length / 1024).toFixed(1)}KB`);
    children.push(...textBlock(analysisJson));
    children.push(emptyLine());
  }

  return children;
}

async function main(): Promise<void> {
  console.log('══════════════════════════════════════════');
  console.log('  3개 병원 크롤링 원본 데이터 → Word 내보내기');
  console.log('══════════════════════════════════════════');

  const allSections: Array<{ children: Paragraph[] }> = [];

  for (const h of HOSPITALS) {
    const children = await processHospital(h);
    allSections.push({ children });
  }

  console.log('\n📦 Word 문서 생성 중...');

  const doc = new Document({
    styles: { default: { document: { run: { font: 'Malgun Gothic', size: 20 } } } },
    sections: allSections,
  });

  const outputDir = path.resolve(__dirname, '..', 'output', 'reports');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const outPath = path.resolve(outputDir, `raw_crawl_data_3hospitals_${new Date().toISOString().substring(0, 10).replace(/-/g, '')}.docx`);

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outPath, buffer);

  const sizeMB = (buffer.byteLength / 1024 / 1024).toFixed(1);
  console.log(`\n✅ 완료: ${outPath}`);
  console.log(`   크기: ${sizeMB} MB`);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
