/**
 * 단일 병원 의사 보고서 생성
 * 실행: npx tsx scripts/generate-single-hospital-report.ts --hospital "닥터스피부과"
 */
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, BorderStyle, HeadingLevel, AlignmentType, ImageRun, VerticalAlign,
} from 'docx';
import { supabase } from './utils/supabase.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FONT = '맑은 고딕';
const C_PRIMARY = '1B3A5C';
const C_ACCENT = '2E75B6';
const C_GRAY = '666666';
const C_LIGHT = 'F2F6FA';
const C_WHITE = 'FFFFFF';
const C_HDR = '1B3A5C';
const C_ENRICH = '8E44AD';
const BORDER = { style: BorderStyle.SINGLE, size: 1, color: 'D0D5DD' };
const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

const photoCache = new Map<string, Buffer>();

async function downloadPhoto(url: string): Promise<Buffer | null> {
  if (photoCache.has(url)) return photoCache.get(url)!;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length < 500) return null;
    photoCache.set(url, buf);
    return buf;
  } catch { return null; }
}

function hCell(text: string, w?: number): TableCell {
  return new TableCell({
    width: w ? { size: w, type: WidthType.DXA } : undefined,
    shading: { fill: C_HDR }, borders: BORDERS,
    children: [new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { before: 60, after: 60 },
      children: [new TextRun({ text, font: FONT, size: 18, bold: true, color: C_WHITE })],
    })],
  });
}

function gap(): Paragraph {
  return new Paragraph({ spacing: { after: 80 }, children: [] });
}

async function buildDoctorProfile(d: {
  name: string; title: string; specialty: string | null;
  education: string[] | string | null; career: string[] | string | null;
  academic_activity: string | null; photo_url: string | null;
  enrichment_source: string | null;
  structured_academic: Array<{ type: string; title: string; year: string | null; source: string }>;
}): Promise<Table> {
  const edu = Array.isArray(d.education) ? d.education : (d.education ? [d.education] : []);
  const car = Array.isArray(d.career) ? d.career : (d.career ? [d.career] : []);
  const isEnriched = !!d.enrichment_source;
  const rows: TableRow[] = [];

  // 이름 + 사진 행
  const nameParagraphs: Paragraph[] = [
    new Paragraph({
      spacing: { before: 60, after: 40 }, indent: { left: 100 },
      children: [
        new TextRun({ text: d.name, font: FONT, size: 22, bold: true }),
        new TextRun({ text: `  ${d.title}`, font: FONT, size: 18, color: C_GRAY }),
      ],
    }),
  ];
  if (d.specialty) {
    nameParagraphs.push(new Paragraph({
      spacing: { before: 20, after: 40 }, indent: { left: 100 },
      children: [
        new TextRun({ text: '전문분야: ', font: FONT, size: 17, color: C_GRAY }),
        new TextRun({ text: d.specialty, font: FONT, size: 17 }),
      ],
    }));
  }
  if (isEnriched) {
    nameParagraphs.push(new Paragraph({
      spacing: { before: 20, after: 20 }, indent: { left: 100 },
      children: [new TextRun({
        text: '웹 보강 데이터 포함', font: FONT, size: 15, italics: true, color: C_ENRICH,
      })],
    }));
  }

  // 사진 셀
  let photoCellChildren: Paragraph[] = [];
  if (d.photo_url) {
    const photoBuf = await downloadPhoto(d.photo_url);
    if (photoBuf) {
      photoCellChildren = [new Paragraph({
        alignment: AlignmentType.CENTER, spacing: { before: 40, after: 40 },
        children: [new ImageRun({ data: photoBuf, transformation: { width: 90, height: 110 }, type: 'png' })],
      })];
    }
  }
  if (photoCellChildren.length === 0) {
    photoCellChildren = [new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { before: 40, after: 40 },
      children: [new TextRun({ text: '사진\n없음', font: FONT, size: 16, color: C_GRAY })],
    })];
  }

  rows.push(new TableRow({ children: [
    new TableCell({ width: { size: 1600, type: WidthType.DXA }, borders: BORDERS, verticalAlign: VerticalAlign.CENTER, children: photoCellChildren }),
    new TableCell({ borders: BORDERS, verticalAlign: VerticalAlign.CENTER, children: nameParagraphs }),
  ]}));

  const addField = (label: string, items: string[]): void => {
    if (items.length === 0) return;
    rows.push(new TableRow({ children: [
      new TableCell({
        width: { size: 1600, type: WidthType.DXA }, shading: { fill: C_LIGHT }, borders: BORDERS,
        children: [new Paragraph({ spacing: { before: 50, after: 50 }, indent: { left: 100 },
          children: [new TextRun({ text: label, font: FONT, size: 18, bold: true, color: C_PRIMARY })],
        })],
      }),
      new TableCell({ borders: BORDERS,
        children: items.map((e) => new Paragraph({ spacing: { before: 30, after: 30 }, indent: { left: 100 },
          children: [new TextRun({ text: `• ${e}`, font: FONT, size: 17 })],
        })),
      }),
    ]}));
  };

  addField('학력', edu);
  addField('경력', car);

  // 학술활동
  if (d.structured_academic.length > 0) {
    const byType = new Map<string, Array<{ title: string; year: string | null; source: string }>>();
    for (const a of d.structured_academic) {
      const items = byType.get(a.type) || [];
      items.push({ title: a.title, year: a.year, source: a.source });
      byType.set(a.type, items);
    }
    const acadParagraphs: Paragraph[] = [];
    for (const [type, items] of byType) {
      acadParagraphs.push(new Paragraph({
        spacing: { before: 40, after: 20 }, indent: { left: 100 },
        children: [new TextRun({ text: `[${type}]`, font: FONT, size: 16, bold: true, color: C_ACCENT })],
      }));
      for (const item of items) {
        const label = item.year ? `${item.title} (${item.year})` : item.title;
        const isWeb = item.source === 'enrich';
        const children: TextRun[] = [
          new TextRun({ text: `• ${label}`, font: FONT, size: 17, color: isWeb ? C_ENRICH : undefined }),
        ];
        if (isWeb) children.push(new TextRun({ text: ' [웹보강]', font: FONT, size: 14, color: C_ENRICH, italics: true }));
        acadParagraphs.push(new Paragraph({ spacing: { before: 20, after: 20 }, indent: { left: 200 }, children }));
      }
    }
    rows.push(new TableRow({ children: [
      new TableCell({
        width: { size: 1600, type: WidthType.DXA }, shading: { fill: C_LIGHT }, borders: BORDERS,
        children: [new Paragraph({ spacing: { before: 50, after: 50 }, indent: { left: 100 },
          children: [new TextRun({ text: '학술활동', font: FONT, size: 18, bold: true, color: C_PRIMARY })],
        })],
      }),
      new TableCell({ borders: BORDERS, children: acadParagraphs }),
    ]}));
  } else if (d.academic_activity) {
    addField('학술활동', [d.academic_activity]);
  }

  return new Table({ width: { size: 9500, type: WidthType.DXA }, rows });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const idx = args.indexOf('--hospital');
  const filter = idx >= 0 ? args[idx + 1] : '닥터스피부과';

  // DB에서 해당 병원 의사 조회
  const { data: hospitals } = await supabase
    .from('hospitals')
    .select('id, name, website, sido, sigungu')
    .ilike('name', `%${filter}%`);

  if (!hospitals || hospitals.length === 0) {
    console.log(`병원 "${filter}" 없음`);
    return;
  }

  const content: (Paragraph | Table)[] = [];

  // 표지
  content.push(new Paragraph({ spacing: { before: 1500 }, children: [] }));
  content.push(new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 300 },
    children: [new TextRun({ text: 'MADMEDSALES', font: FONT, size: 36, bold: true, color: C_ACCENT })],
  }));
  content.push(new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 200 },
    children: [new TextRun({ text: `${filter} 의사 정보 보고서`, font: FONT, size: 44, bold: true, color: C_PRIMARY })],
  }));
  content.push(new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 600 },
    children: [new TextRun({ text: new Date().toISOString().split('T')[0], font: FONT, size: 24, color: C_GRAY })],
  }));

  let totalDoctors = 0;
  let totalPhotos = 0;

  for (const hosp of hospitals) {
    const { data: doctors } = await supabase
      .from('sales_hospital_doctors')
      .select('name, title, specialty, education, career, academic_activity, photo_url, enrichment_source')
      .eq('hospital_id', hosp.id);

    if (!doctors || doctors.length === 0) continue;

    // 학술활동
    const { data: academics } = await supabase
      .from('doctor_academic_activities')
      .select('doctor_name, activity_type, title, year, source')
      .eq('hospital_id', hosp.id);

    const acadByDoc = new Map<string, Array<{ type: string; title: string; year: string | null; source: string }>>();
    for (const a of (academics || [])) {
      const arr = acadByDoc.get(a.doctor_name) || [];
      arr.push({ type: a.activity_type, title: a.title, year: a.year, source: a.source });
      acadByDoc.set(a.doctor_name, arr);
    }

    totalDoctors += doctors.length;
    const photoCount = doctors.filter(d => d.photo_url).length;
    totalPhotos += photoCount;

    // 사진 미리 다운로드
    const photoUrls = doctors.filter(d => d.photo_url).map(d => d.photo_url!);
    if (photoUrls.length > 0) {
      console.log(`  📸 사진 다운로드 (${photoUrls.length}장)...`);
      await Promise.all(photoUrls.map(url => downloadPhoto(url)));
    }

    // 병원 헤더
    content.push(new Paragraph({
      heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: C_ACCENT } },
      children: [new TextRun({ text: hosp.name, font: FONT, size: 28, bold: true, color: C_PRIMARY })],
    }));

    const region = [hosp.sido, hosp.sigungu].filter(Boolean).join(' ');
    content.push(new Paragraph({
      spacing: { after: 80 },
      children: [
        new TextRun({ text: `지역: ${region || '-'}`, font: FONT, size: 18, color: C_GRAY }),
        new TextRun({ text: `  |  웹사이트: ${hosp.website || '-'}`, font: FONT, size: 18, color: C_ACCENT }),
        new TextRun({ text: `  |  의사: ${doctors.length}명`, font: FONT, size: 18, color: C_GRAY }),
        new TextRun({ text: `  |  사진: ${photoCount}명`, font: FONT, size: 18, color: photoCount > 0 ? '27AE60' : 'E74C3C' }),
      ],
    }));
    content.push(gap());

    // 의사별 프로필
    for (const d of doctors) {
      const table = await buildDoctorProfile({
        ...d,
        structured_academic: acadByDoc.get(d.name) || [],
      });
      content.push(table);
      content.push(gap());
    }
  }

  // 요약
  content.push(new Paragraph({
    spacing: { before: 200 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({
      text: `총 ${totalDoctors}명 의사 | 사진 ${totalPhotos}명 (${totalDoctors > 0 ? Math.round(totalPhotos / totalDoctors * 100) : 0}%)`,
      font: FONT, size: 20, color: C_GRAY, italics: true,
    })],
  }));

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: 20 }, paragraph: { spacing: { line: 320 } } } } },
    sections: [{ properties: { page: { margin: { top: 1200, bottom: 1200, left: 1200, right: 1200 } } }, children: content }],
  });

  const safeName = filter.replace(/[/\\?%*:|"<>]/g, '_');
  const outPath = path.resolve(__dirname, `../docs/${safeName}_의사보고서.docx`);
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outPath, buffer);
  console.log(`\n보고서 생성 완료: ${outPath}`);
  console.log(`  의사 ${totalDoctors}명 | 사진 ${totalPhotos}명 | ${photoCache.size}장 다운로드`);
}

main().catch(console.error);
