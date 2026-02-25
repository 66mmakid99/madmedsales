/**
 * V4 테스트 3개 병원 데이터 추출 보고서 (DOCX)
 * 이미지 포함
 */
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, ImageRun, WidthType,
  TableLayoutType, ShadingType,
} from 'docx';
import { supabase } from './utils/supabase.js';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const targets = [
  { name: '안산엔비의원', hid: '1267b395-1132-4511-a8ba-1afc228a8867' },
  { name: '동안중심의원', hid: '7b169807-6d76-4796-a31b-7b35f0437899' },
  { name: '포에버의원(신사)', hid: '92f7b52a-66e9-4b1c-a118-6058f89db92e' },
];

// ============================================================
// 유틸
// ============================================================
function headerCell(text: string): TableCell {
  return new TableCell({
    shading: { type: ShadingType.SOLID, color: '2B579A' },
    children: [new Paragraph({
      children: [new TextRun({ text, bold: true, color: 'FFFFFF', size: 20, font: 'Malgun Gothic' })],
      alignment: AlignmentType.CENTER,
    })],
    verticalAlign: 'center' as unknown as undefined,
  });
}

function dataCell(text: string, bold = false): TableCell {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text: text || '-', bold, size: 18, font: 'Malgun Gothic' })],
      spacing: { before: 40, after: 40 },
    })],
  });
}

function sectionTitle(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size: 24, font: 'Malgun Gothic', color: '2B579A' })],
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 100 },
  });
}

function subTitle(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size: 22, font: 'Malgun Gothic', color: '333333' })],
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 200, after: 80 },
  });
}

function bodyText(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, size: 18, font: 'Malgun Gothic' })],
    spacing: { before: 40, after: 40 },
  });
}

function divider(): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: '━'.repeat(60), color: 'CCCCCC', size: 16 })],
    spacing: { before: 200, after: 200 },
  });
}

// 스크린샷을 PNG 버퍼로 변환 (docx는 WebP 미지원)
async function screenshotToPng(url: string): Promise<Buffer | null> {
  try {
    const resp = await fetch(url);
    const webpBuf = Buffer.from(await resp.arrayBuffer());
    return await sharp(webpBuf).resize(600, null, { withoutEnlargement: true }).png().toBuffer();
  } catch {
    return null;
  }
}

// ============================================================
// 메인
// ============================================================
async function main(): Promise<void> {
  console.log('📝 V4 테스트 보고서 생성 중...\n');

  const sections: Paragraph[] = [];

  // 표지
  sections.push(new Paragraph({ spacing: { before: 2000 } }));
  sections.push(new Paragraph({
    children: [new TextRun({ text: 'TORR RF 병원 데이터 수집 보고서', bold: true, size: 44, font: 'Malgun Gothic', color: '2B579A' })],
    alignment: AlignmentType.CENTER,
  }));
  sections.push(new Paragraph({
    children: [new TextRun({ text: 'Recrawl v4: Firecrawl + Gemini Vision', size: 28, font: 'Malgun Gothic', color: '666666' })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 200 },
  }));
  sections.push(new Paragraph({
    children: [new TextRun({ text: `테스트 대상: 3개 병원 | 생성일: ${new Date().toLocaleDateString('ko-KR')}`, size: 22, font: 'Malgun Gothic', color: '999999' })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 100 },
  }));
  sections.push(new Paragraph({ spacing: { before: 400 } }));

  // 요약 테이블
  sections.push(sectionTitle('1. 테스트 결과 요약'));

  const summaryRows: TableRow[] = [
    new TableRow({
      children: [headerCell('병원명'), headerCell('페이지'), headerCell('의사'), headerCell('시술'), headerCell('장비'), headerCell('이벤트'), headerCell('분석방법')],
    }),
  ];

  const allData: Array<{
    name: string;
    pages: Array<{ url: string; page_type: string; char_count: number; screenshot_url: string | null; analysis_method: string }>;
    doctors: Array<Record<string, unknown>>;
    treatments: Array<Record<string, unknown>>;
    equipments: Array<Record<string, unknown>>;
    events: Array<Record<string, unknown>>;
  }> = [];

  for (const t of targets) {
    const { data: pages } = await supabase.from('hospital_crawl_pages')
      .select('url, page_type, char_count, screenshot_url, analysis_method')
      .eq('hospital_id', t.hid).order('crawled_at');
    const { data: doctors } = await supabase.from('hospital_doctors')
      .select('*').eq('hospital_id', t.hid);
    const { data: treatments } = await supabase.from('hospital_treatments')
      .select('*').eq('hospital_id', t.hid);
    const { data: equipments } = await supabase.from('hospital_equipments')
      .select('*').eq('hospital_id', t.hid);
    const { data: events } = await supabase.from('hospital_events')
      .select('*').eq('hospital_id', t.hid);

    const methods = [...new Set((pages || []).map(p => p.analysis_method))].join(', ');

    allData.push({
      name: t.name,
      pages: pages || [],
      doctors: doctors || [],
      treatments: treatments || [],
      equipments: equipments || [],
      events: events || [],
    });

    summaryRows.push(new TableRow({
      children: [
        dataCell(t.name, true),
        dataCell(String(pages?.length || 0)),
        dataCell(String(doctors?.length || 0)),
        dataCell(String(treatments?.length || 0)),
        dataCell(String(equipments?.length || 0)),
        dataCell(String(events?.length || 0)),
        dataCell(methods),
      ],
    }));

    console.log(`  ✅ ${t.name}: 의사${doctors?.length}, 시술${treatments?.length}, 장비${equipments?.length}, 이벤트${events?.length}`);
  }

  sections.push(new Table({
    rows: summaryRows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
  }));

  sections.push(bodyText(''));
  sections.push(bodyText('• text: 마크다운 텍스트 기반 Gemini 분석'));
  sections.push(bodyText('• vision: 스크린샷 이미지 기반 Gemini Vision 분석'));
  sections.push(bodyText('• both: 텍스트 분석 후 결과 0건 → Vision 추가 분석'));

  // 각 병원 상세
  let hospitalIdx = 0;
  for (const d of allData) {
    hospitalIdx++;
    sections.push(divider());
    sections.push(sectionTitle(`${hospitalIdx + 1}. ${d.name}`));

    // 크롤 페이지 + 스크린샷
    sections.push(subTitle('📄 크롤링 페이지'));

    for (const p of d.pages) {
      sections.push(bodyText(`[${p.page_type}] ${p.url} (${p.char_count.toLocaleString()}자, ${p.analysis_method})`));

      if (p.screenshot_url) {
        console.log(`  📸 ${d.name} - ${p.page_type} 스크린샷 다운로드...`);
        const pngBuf = await screenshotToPng(p.screenshot_url);
        if (pngBuf) {
          sections.push(new Paragraph({
            children: [new ImageRun({
              data: pngBuf,
              transformation: { width: 560, height: Math.round(560 * 0.625) },
              type: 'png',
            })],
            spacing: { before: 80, after: 120 },
          }));
        }
      }
    }

    // 의사
    if (d.doctors.length > 0) {
      sections.push(subTitle(`👨‍⚕️ 의료진 (${d.doctors.length}명)`));

      const drRows: TableRow[] = [
        new TableRow({ children: [headerCell('이름'), headerCell('직함'), headerCell('학력'), headerCell('경력'), headerCell('학술활동')] }),
      ];

      for (const dr of d.doctors) {
        const edu = Array.isArray(dr.education) ? (dr.education as string[]).join(', ') : (dr.education as string || '-');
        const career = Array.isArray(dr.career) ? (dr.career as string[]).join(', ') : (dr.career as string || '-');
        drRows.push(new TableRow({
          children: [
            dataCell(dr.name as string, true),
            dataCell(dr.title as string),
            dataCell(edu),
            dataCell(career),
            dataCell(dr.academic_activity as string || '-'),
          ],
        }));
      }

      sections.push(new Table({
        rows: drRows,
        width: { size: 100, type: WidthType.PERCENTAGE },
        layout: TableLayoutType.FIXED,
      }));
    }

    // 장비
    if (d.equipments.length > 0) {
      sections.push(subTitle(`🔬 보유 장비 (${d.equipments.length}개)`));

      const eqRows: TableRow[] = [
        new TableRow({ children: [headerCell('장비명'), headerCell('카테고리'), headerCell('제조사')] }),
      ];
      for (const eq of d.equipments) {
        eqRows.push(new TableRow({
          children: [
            dataCell(eq.equipment_name as string, true),
            dataCell(eq.equipment_category as string),
            dataCell(eq.manufacturer as string || '-'),
          ],
        }));
      }
      sections.push(new Table({
        rows: eqRows,
        width: { size: 100, type: WidthType.PERCENTAGE },
        layout: TableLayoutType.FIXED,
      }));
    }

    // 시술
    if (d.treatments.length > 0) {
      sections.push(subTitle(`💉 시술 메뉴 (${d.treatments.length}개)`));

      const trRows: TableRow[] = [
        new TableRow({ children: [headerCell('시술명'), headerCell('카테고리'), headerCell('가격'), headerCell('프로모션'), headerCell('콤보')] }),
      ];
      for (const tr of d.treatments) {
        const price = tr.price ? `₩${Number(tr.price).toLocaleString()}` : '-';
        const note = tr.price_note ? ` (${tr.price_note})` : '';
        trRows.push(new TableRow({
          children: [
            dataCell(tr.treatment_name as string, true),
            dataCell(tr.treatment_category as string),
            dataCell(price + note),
            dataCell((tr.is_promoted as boolean) ? '⭐ 프로모션' : '-'),
            dataCell(tr.combo_with as string || '-'),
          ],
        }));
      }
      sections.push(new Table({
        rows: trRows,
        width: { size: 100, type: WidthType.PERCENTAGE },
        layout: TableLayoutType.FIXED,
      }));
    }

    // 이벤트
    if (d.events.length > 0) {
      sections.push(subTitle(`🎉 이벤트/할인 (${d.events.length}개)`));

      for (const ev of d.events) {
        sections.push(new Paragraph({
          children: [
            new TextRun({ text: `▸ ${ev.title as string}`, bold: true, size: 20, font: 'Malgun Gothic' }),
          ],
          spacing: { before: 100 },
        }));
        if (ev.discount_type || ev.discount_value) {
          sections.push(bodyText(`  할인: ${ev.discount_type || ''} ${ev.discount_value || ''}`));
        }
        if (ev.description) {
          const desc = (ev.description as string).replace(/\n/g, ' ').substring(0, 100);
          sections.push(bodyText(`  설명: ${desc}`));
        }
        const related = ev.related_treatments as string[] || [];
        if (related.length > 0) {
          sections.push(bodyText(`  관련 시술: ${related.slice(0, 5).join(', ')}${related.length > 5 ? ` 외 ${related.length - 5}개` : ''}`));
        }
      }
    }

    // 데이터 없는 항목 표시
    if (d.doctors.length === 0) sections.push(bodyText('👨‍⚕️ 의료진: 추출 데이터 없음'));
    if (d.equipments.length === 0) sections.push(bodyText('🔬 보유 장비: 추출 데이터 없음'));
    if (d.treatments.length === 0) sections.push(bodyText('💉 시술 메뉴: 추출 데이터 없음'));
    if (d.events.length === 0) sections.push(bodyText('🎉 이벤트: 추출 데이터 없음'));
  }

  // 푸터
  sections.push(divider());
  sections.push(new Paragraph({
    children: [new TextRun({
      text: 'MADMEDSALES — Recrawl v4 테스트 보고서 | Firecrawl + Gemini Flash + Gemini Vision',
      size: 16, font: 'Malgun Gothic', color: '999999', italics: true,
    })],
    alignment: AlignmentType.CENTER,
  }));

  // DOCX 생성
  const doc = new Document({
    sections: [{ children: sections }],
  });

  const buffer = await Packer.toBuffer(doc);
  const outPath = path.resolve(__dirname, 'data', 'v4-test3', 'TORR_RF_V4_테스트_보고서.docx');
  fs.writeFileSync(outPath, buffer);

  console.log(`\n📄 보고서 저장 완료: ${outPath}`);
  console.log(`   파일 크기: ${(buffer.length / 1024).toFixed(1)}KB`);
}

main().catch(console.error);
