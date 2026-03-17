/**
 * 수집된 의사 데이터 보고서 (docx) 생성
 * JSON 데이터를 읽어서 병원별 의사 프로필을 보고서 형식으로 출력
 * v2.0: 인물 사진 임베딩 + 보강 출처 구분 표시
 *
 * 실행: npx tsx scripts/generate-doctor-data-report.ts
 */
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, BorderStyle, HeadingLevel, AlignmentType, PageBreak,
  ImageRun, VerticalAlign,
} from 'docx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================================
// 스타일 상수
// ============================================================
const FONT = '맑은 고딕';
const FONT_CODE = 'Consolas';
const C_PRIMARY = '1B3A5C';
const C_ACCENT = '2E75B6';
const C_GRAY = '666666';
const C_LIGHT = 'F2F6FA';
const C_WHITE = 'FFFFFF';
const C_HDR = '1B3A5C';
const C_ALT = 'F7F9FC';
const C_GREEN = '27AE60';
const C_ORANGE = 'E67E22';
const C_RED = 'E74C3C';
const C_ENRICH = '8E44AD'; // 보강 데이터 표시 색상 (보라)

const BORDER = { style: BorderStyle.SINGLE, size: 1, color: 'D0D5DD' };
const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

// ============================================================
// 사진 다운로드 캐시
// ============================================================
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
  } catch {
    return null;
  }
}

// ============================================================
// 헬퍼
// ============================================================
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
function dCell(text: string, opts?: { bg?: string; bold?: boolean; font?: string; sz?: number; color?: string }): TableCell {
  return new TableCell({
    shading: opts?.bg ? { fill: opts.bg } : undefined, borders: BORDERS,
    children: [new Paragraph({
      spacing: { before: 40, after: 40 }, indent: { left: 80 },
      children: [new TextRun({
        text, font: opts?.font || FONT, size: opts?.sz || 18,
        bold: opts?.bold, color: opts?.color,
      })],
    })],
  });
}
function h1(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: C_ACCENT } },
    children: [new TextRun({ text, font: FONT, size: 28, bold: true, color: C_PRIMARY })],
  });
}
function h2(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2, spacing: { before: 300, after: 150 },
    children: [new TextRun({ text, font: FONT, size: 24, bold: true, color: C_ACCENT })],
  });
}
function body(text: string, opts?: { bold?: boolean; color?: string; italic?: boolean }): Paragraph {
  return new Paragraph({
    spacing: { after: 80, line: 340 },
    children: [new TextRun({ text, font: FONT, size: 20, bold: opts?.bold, italics: opts?.italic, color: opts?.color })],
  });
}
function bullet(text: string, level = 0): Paragraph {
  return new Paragraph({
    bullet: { level }, spacing: { after: 50, line: 300 },
    children: [new TextRun({ text, font: FONT, size: 19 })],
  });
}
function gap(): Paragraph {
  return new Paragraph({ spacing: { after: 80 }, children: [] });
}

function pctColor(pct: number): string {
  if (pct >= 70) return C_GREEN;
  if (pct >= 40) return C_ORANGE;
  return C_RED;
}

function pctBar(pct: number): string {
  const filled = Math.round(pct / 5);
  return '█'.repeat(filled) + '░'.repeat(20 - filled) + ` ${pct}%`;
}

// ============================================================
// 의사 프로필 테이블 (사진 포함)
// ============================================================
async function buildDoctorTable(
  d: any,
  hospitalId: string,
): Promise<Table> {
  const edu = Array.isArray(d.education) ? d.education : (d.education ? [d.education] : []);
  const car = Array.isArray(d.career) ? d.career : (d.career ? [d.career] : []);
  const structuredAcademic: Array<{ type: string; title: string; year?: string; source?: string }> = d.structured_academic || [];
  const isEnriched = !!d.enrichment_source;

  const rows: TableRow[] = [];

  // ─── 이름 + 사진 행 ───
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
        text: '🔍 웹 보강 데이터 포함',
        font: FONT, size: 15, italics: true, color: C_ENRICH,
      })],
    }));
  }

  // 사진 셀
  let photoCellChildren: Paragraph[] = [];
  if (d.photo_url) {
    const photoBuf = await downloadPhoto(d.photo_url);
    if (photoBuf) {
      photoCellChildren = [new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 40, after: 40 },
        children: [new ImageRun({
          data: photoBuf,
          transformation: { width: 90, height: 110 },
          type: 'png',
        })],
      })];
    }
  }

  if (photoCellChildren.length === 0) {
    photoCellChildren = [new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 40, after: 40 },
      children: [new TextRun({ text: '사진\n없음', font: FONT, size: 16, color: C_GRAY })],
    })];
  }

  rows.push(new TableRow({ children: [
    new TableCell({
      width: { size: 1600, type: WidthType.DXA },
      borders: BORDERS,
      verticalAlign: VerticalAlign.CENTER,
      children: photoCellChildren,
    }),
    new TableCell({
      borders: BORDERS,
      verticalAlign: VerticalAlign.CENTER,
      children: nameParagraphs,
    }),
  ]}));

  // ─── 학력 ───
  if (edu.length > 0) {
    rows.push(new TableRow({ children: [
      new TableCell({
        width: { size: 1600, type: WidthType.DXA }, shading: { fill: C_LIGHT }, borders: BORDERS,
        children: [new Paragraph({ spacing: { before: 50, after: 50 }, indent: { left: 100 },
          children: [new TextRun({ text: '학력', font: FONT, size: 18, bold: true, color: C_PRIMARY })],
        })],
      }),
      new TableCell({ borders: BORDERS,
        children: edu.map((e: string) => new Paragraph({ spacing: { before: 30, after: 30 }, indent: { left: 100 },
          children: [new TextRun({ text: `• ${e}`, font: FONT, size: 17 })],
        })),
      }),
    ]}));
  }

  // ─── 경력 ───
  if (car.length > 0) {
    rows.push(new TableRow({ children: [
      new TableCell({
        width: { size: 1600, type: WidthType.DXA }, shading: { fill: C_LIGHT }, borders: BORDERS,
        children: [new Paragraph({ spacing: { before: 50, after: 50 }, indent: { left: 100 },
          children: [new TextRun({ text: '경력', font: FONT, size: 18, bold: true, color: C_PRIMARY })],
        })],
      }),
      new TableCell({ borders: BORDERS,
        children: car.map((c: string) => new Paragraph({ spacing: { before: 30, after: 30 }, indent: { left: 100 },
          children: [new TextRun({ text: `• ${c}`, font: FONT, size: 17 })],
        })),
      }),
    ]}));
  }

  // ─── 학술활동 (출처 구분) ───
  if (structuredAcademic.length > 0) {
    const byType = new Map<string, Array<{ title: string; year?: string; source?: string }>>();
    for (const a of structuredAcademic) {
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
        const isWebEnrich = item.source === 'enrich';
        const children: TextRun[] = [
          new TextRun({ text: `• ${label}`, font: FONT, size: 17, color: isWebEnrich ? C_ENRICH : undefined }),
        ];
        if (isWebEnrich) {
          children.push(new TextRun({ text: ' [웹보강]', font: FONT, size: 14, color: C_ENRICH, italics: true }));
        }
        acadParagraphs.push(new Paragraph({
          spacing: { before: 20, after: 20 }, indent: { left: 200 },
          children,
        }));
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
    rows.push(new TableRow({ children: [
      new TableCell({
        width: { size: 1600, type: WidthType.DXA }, shading: { fill: C_LIGHT }, borders: BORDERS,
        children: [new Paragraph({ spacing: { before: 50, after: 50 }, indent: { left: 100 },
          children: [new TextRun({ text: '학술활동', font: FONT, size: 18, bold: true, color: C_PRIMARY })],
        })],
      }),
      new TableCell({ borders: BORDERS,
        children: [new Paragraph({ spacing: { before: 50, after: 50 }, indent: { left: 100 },
          children: [new TextRun({ text: d.academic_activity, font: FONT, size: 17 })],
        })],
      }),
    ]}));
  }

  // 데이터 없는 경우
  if (!d.specialty && edu.length === 0 && car.length === 0 && !d.academic_activity && structuredAcademic.length === 0) {
    rows.push(new TableRow({ children: [
      new TableCell({
        width: { size: 1600, type: WidthType.DXA }, shading: { fill: C_LIGHT }, borders: BORDERS,
        children: [new Paragraph({ spacing: { before: 50, after: 50 }, indent: { left: 100 },
          children: [new TextRun({ text: '비고', font: FONT, size: 18, bold: true, color: C_PRIMARY })],
        })],
      }),
      new TableCell({ borders: BORDERS,
        children: [new Paragraph({ spacing: { before: 50, after: 50 }, indent: { left: 100 },
          children: [new TextRun({ text: '상세 정보 미수집 — 모달/상세 페이지 보강 필요', font: FONT, size: 17, italics: true, color: C_ORANGE })],
        })],
      }),
    ]}));
  }

  return new Table({ width: { size: 9500, type: WidthType.DXA }, rows });
}

// ============================================================
// 메인
// ============================================================
async function main(): Promise<void> {
  const jsonPath = path.resolve(__dirname, '../docs/doctor-data-export.json');
  if (!fs.existsSync(jsonPath)) {
    console.error('먼저 npx tsx scripts/query-doctor-data.ts 실행하세요.');
    return;
  }
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  const { summary, hospitals } = data;

  // 사진 URL 미리 수집 및 다운로드
  const photoUrls: string[] = [];
  for (const h of hospitals) {
    for (const d of h.doctors) {
      if (d.photo_url) photoUrls.push(d.photo_url);
    }
  }
  if (photoUrls.length > 0) {
    console.log(`📸 사진 다운로드 중 (${photoUrls.length}장)...`);
    await Promise.all(photoUrls.map(url => downloadPhoto(url)));
    console.log(`  다운로드 완료: ${photoCache.size}장 성공`);
  }

  const content: (Paragraph | Table)[] = [];

  // ═══ 표지 ═══
  content.push(new Paragraph({ spacing: { before: 2000 }, children: [] }));
  content.push(new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 300 },
    children: [new TextRun({ text: 'MADMEDSALES', font: FONT, size: 36, bold: true, color: C_ACCENT })],
  }));
  content.push(new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 200 },
    children: [new TextRun({ text: '의사 정보 수집 현황 보고서', font: FONT, size: 48, bold: true, color: C_PRIMARY })],
  }));
  content.push(new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 100 },
    children: [new TextRun({ text: 'Doctor Data Collection Report', font: FONT, size: 28, color: C_GRAY, italics: true })],
  }));
  content.push(new Paragraph({ spacing: { before: 600 }, children: [] }));

  const meta = [
    ['생성일', data.generated_at?.split('T')[0] || new Date().toISOString().split('T')[0]],
    ['총 병원 수', `${summary.total_hospitals}개`],
    ['총 의사 수', `${summary.total_doctors}명`],
    ['데이터 소스', 'recrawl-v5 (Firecrawl + Gemini + Modal) + 웹 보강'],
  ];
  if (summary.enriched_doctors > 0) {
    meta.push(['웹 보강 의사', `${summary.enriched_doctors}명`]);
  }
  for (const [k, v] of meta) {
    content.push(new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { after: 80 },
      children: [
        new TextRun({ text: `${k}:  `, font: FONT, size: 22, bold: true, color: C_GRAY }),
        new TextRun({ text: v, font: FONT, size: 22, color: C_PRIMARY }),
      ],
    }));
  }
  content.push(new Paragraph({ children: [new PageBreak()] }));

  // ═══ 1. 수집 요약 ═══
  content.push(h1('1. 수집 현황 요약'));
  content.push(gap());

  const q = summary.quality;
  content.push(new Table({
    width: { size: 9500, type: WidthType.DXA },
    rows: [
      new TableRow({ children: [
        hCell('항목', 2200), hCell('보유 수', 1500), hCell('비율', 1200), hCell('분포', 4600),
      ]}),
      ...([
        ['학력 (Education)', q.education],
        ['경력 (Career)', q.career],
        ['전문분야 (Specialty)', q.specialty],
        ['학술활동 (Academic)', q.academic_activity],
        ['프로필사진 (Photo)', q.photo_url],
      ] as [string, { count: number; pct: number }][]).map(([label, stat], i) =>
        new TableRow({ children: [
          dCell(label, { bold: true, bg: i % 2 ? C_ALT : undefined }),
          dCell(`${stat.count} / ${summary.total_doctors}`, { bg: i % 2 ? C_ALT : undefined }),
          dCell(`${stat.pct}%`, { bold: true, color: pctColor(stat.pct), bg: i % 2 ? C_ALT : undefined }),
          dCell(pctBar(stat.pct), { font: FONT_CODE, sz: 16, color: pctColor(stat.pct), bg: i % 2 ? C_ALT : undefined }),
        ]}),
      ),
    ],
  }));
  content.push(gap());

  // 데이터 품질 분석
  content.push(body('데이터 품질 분석:', { bold: true }));
  if (q.career.pct >= 50) {
    content.push(bullet(`경력 데이터 ${q.career.pct}% 확보 — 과반수 이상 보유`));
  } else {
    content.push(bullet(`경력 데이터 ${q.career.pct}% — 추가 크롤링/모달 보강 필요`));
  }
  if (q.education.pct < 50) {
    content.push(bullet(`학력 데이터 ${q.education.pct}% — 모달 크롤링으로 보강 가능`));
  }
  if (q.photo_url.pct > 0) {
    content.push(bullet(`프로필 사진 ${q.photo_url.count}명 (${q.photo_url.pct}%) 캡처 완료`));
  } else {
    content.push(bullet('프로필 사진: 미수집 상태'));
  }
  if (summary.enriched_doctors > 0) {
    content.push(bullet(`웹 보강 완료: ${summary.enriched_doctors}명 (보라색으로 구분 표시)`));
  }

  // 학술활동 유형별 분포
  const acadBreakdown = summary.academic_type_breakdown as Record<string, number> | undefined;
  if (acadBreakdown && Object.keys(acadBreakdown).length > 0) {
    content.push(gap());
    content.push(body('학술활동 유형별 분포:', { bold: true }));
    const totalAcadItems = Object.values(acadBreakdown).reduce((s, n) => s + n, 0);
    content.push(new Table({
      width: { size: 9500, type: WidthType.DXA },
      rows: [
        new TableRow({ children: [
          hCell('유형', 2400), hCell('건수', 1500), hCell('비율', 1200), hCell('분포', 4400),
        ]}),
        ...Object.entries(acadBreakdown)
          .sort((a, b) => b[1] - a[1])
          .map(([type, count], i) => {
            const pct = Math.round(count / totalAcadItems * 100);
            const bg = i % 2 ? C_ALT : undefined;
            return new TableRow({ children: [
              dCell(type, { bold: true, bg }),
              dCell(`${count}건`, { bg }),
              dCell(`${pct}%`, { bg }),
              dCell(pctBar(pct), { font: FONT_CODE, sz: 16, bg }),
            ]});
          }),
      ],
    }));
  }

  // 보강 출처 범례
  content.push(gap());
  content.push(body('범례:', { bold: true }));
  content.push(new Paragraph({
    spacing: { after: 50 }, indent: { left: 200 },
    children: [
      new TextRun({ text: '■ 기본 텍스트', font: FONT, size: 17, color: '000000' }),
      new TextRun({ text: '  — 크롤링 원본 데이터', font: FONT, size: 17, color: C_GRAY }),
    ],
  }));
  content.push(new Paragraph({
    spacing: { after: 50 }, indent: { left: 200 },
    children: [
      new TextRun({ text: '■ 보라색 텍스트 [웹보강]', font: FONT, size: 17, color: C_ENRICH }),
      new TextRun({ text: '  — 웹 검색으로 보강된 데이터', font: FONT, size: 17, color: C_GRAY }),
    ],
  }));

  // ═══ 2. 병원별 의사 목록 ═══
  content.push(new Paragraph({ children: [new PageBreak()] }));
  content.push(h1('2. 병원별 의사 수집 현황'));
  content.push(body(`총 ${summary.total_hospitals}개 병원의 ${summary.total_doctors}명 의사 정보`));
  content.push(gap());

  const sortedHospitals = [...hospitals].sort((a: any, b: any) => b.doctor_count - a.doctor_count);

  content.push(new Table({
    width: { size: 9500, type: WidthType.DXA },
    rows: [
      new TableRow({ children: [
        hCell('#', 500), hCell('병원명', 3000), hCell('지역', 1400),
        hCell('의사', 800), hCell('학력', 700), hCell('경력', 700), hCell('학술', 700), hCell('사진', 700), hCell('보강', 1000),
      ]}),
      ...sortedHospitals.slice(0, 50).map((h: any, i: number) => {
        const bg = i % 2 ? C_ALT : undefined;
        const eduC = h.doctors.filter((d: any) => d.education && (Array.isArray(d.education) ? d.education.length > 0 : d.education)).length;
        const carC = h.doctors.filter((d: any) => d.career && (Array.isArray(d.career) ? d.career.length > 0 : d.career)).length;
        const acaC = h.doctors.filter((d: any) => d.academic_activity || (d.structured_academic && d.structured_academic.length > 0)).length;
        const phoC = h.doctors.filter((d: any) => d.photo_url).length;
        const enrC = h.doctors.filter((d: any) => d.enrichment_source).length;
        return new TableRow({ children: [
          dCell(String(i + 1), { bg }),
          dCell(h.hospital_name, { bold: true, bg }),
          dCell(h.region || '-', { bg }),
          dCell(String(h.doctor_count), { bg }),
          dCell(String(eduC), { bg, color: eduC > 0 ? C_GREEN : C_RED }),
          dCell(String(carC), { bg, color: carC > 0 ? C_GREEN : C_RED }),
          dCell(String(acaC), { bg, color: acaC > 0 ? C_GREEN : undefined }),
          dCell(String(phoC), { bg, color: phoC > 0 ? C_GREEN : C_GRAY }),
          dCell(enrC > 0 ? `${enrC}명` : '-', { bg, color: enrC > 0 ? C_ENRICH : C_GRAY }),
        ]});
      }),
    ],
  }));

  if (sortedHospitals.length > 50) {
    content.push(body(`  ... 외 ${sortedHospitals.length - 50}개 병원 생략`, { italic: true, color: C_GRAY }));
  }

  // ═══ 3. 상세 프로필 (사진 포함) ═══
  content.push(new Paragraph({ children: [new PageBreak()] }));
  content.push(h1('3. 병원별 의사 상세 프로필'));
  content.push(body('의사 2명 이상 병원 중 상위 병원의 상세 정보 (사진 포함)', { color: C_GRAY }));
  content.push(gap());

  const detailHospitals = sortedHospitals.filter((h: any) => h.doctor_count >= 2).slice(0, 30);

  for (let hi = 0; hi < detailHospitals.length; hi++) {
    const h = detailHospitals[hi];
    if (hi > 0 && hi % 5 === 0) {
      content.push(new Paragraph({ children: [new PageBreak()] }));
    }

    content.push(h2(`${hi + 1}. ${h.hospital_name}`));
    if (h.region || h.website) {
      const parts: TextRun[] = [];
      if (h.region) parts.push(new TextRun({ text: `지역: ${h.region}`, font: FONT, size: 18, color: C_GRAY }));
      if (h.region && h.website) parts.push(new TextRun({ text: '  |  ', font: FONT, size: 18, color: C_GRAY }));
      if (h.website) parts.push(new TextRun({ text: `웹사이트: ${h.website}`, font: FONT, size: 18, color: C_ACCENT }));
      content.push(new Paragraph({ spacing: { after: 100 }, children: parts }));
    }

    // 의사별 프로필 테이블 (사진 임베딩)
    for (const d of h.doctors) {
      const table = await buildDoctorTable(d, h.hospital_id);
      content.push(table);
      content.push(gap());
    }
  }

  // ═══ 4. 데이터 보강 권고 ═══
  content.push(new Paragraph({ children: [new PageBreak()] }));
  content.push(h1('4. 데이터 보강 권고'));
  content.push(gap());

  const noEduHospitals = hospitals.filter((h: any) =>
    h.doctors.every((d: any) => !d.education || (Array.isArray(d.education) && d.education.length === 0))
  );
  const noCareerHospitals = hospitals.filter((h: any) =>
    h.doctors.every((d: any) => !d.career || (Array.isArray(d.career) && d.career.length === 0))
  );

  content.push(body(`학력 데이터 전무 병원: ${noEduHospitals.length}개`, { bold: true }));
  for (const h of noEduHospitals.slice(0, 15)) {
    content.push(bullet(`${h.hospital_name} (의사 ${h.doctor_count}명) — ${h.website || '웹사이트 없음'}`));
  }
  if (noEduHospitals.length > 15) {
    content.push(body(`  ... 외 ${noEduHospitals.length - 15}개 병원`, { italic: true, color: C_GRAY }));
  }
  content.push(gap());

  content.push(body(`경력 데이터 전무 병원: ${noCareerHospitals.length}개`, { bold: true }));
  for (const h of noCareerHospitals.slice(0, 15)) {
    content.push(bullet(`${h.hospital_name} (의사 ${h.doctor_count}명) — ${h.website || '웹사이트 없음'}`));
  }
  if (noCareerHospitals.length > 15) {
    content.push(body(`  ... 외 ${noCareerHospitals.length - 15}개 병원`, { italic: true, color: C_GRAY }));
  }
  content.push(gap());

  content.push(h2('권고 사항'));
  content.push(bullet('학력/경력 미수집 병원 대상 recrawl-v5 --ocr 모드로 재크롤링 권장'));
  content.push(bullet('웹 보강 데이터(보라색)는 검색 기반이므로 교차 검증 필요'));
  content.push(bullet('학술활동 구조화 완료 — 학회정회원/임원/논문/수상 등 유형별 분류'));
  content.push(bullet('의사 1명 병원은 원장 단독 운영으로 상세 정보 부족할 수 있음'));

  // ═══ Document ═══
  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: FONT, size: 20 },
          paragraph: { spacing: { line: 320 } },
        },
      },
    },
    sections: [{
      properties: {
        page: { margin: { top: 1200, bottom: 1200, left: 1200, right: 1200 } },
      },
      children: content,
    }],
  });

  const outPath = path.resolve(__dirname, '../docs/의사정보_수집현황_보고서.docx');
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outPath, buffer);
  console.log(`보고서 생성 완료: ${outPath}`);
  console.log(`  - 병원 ${hospitals.length}개 / 의사 ${summary.total_doctors}명`);
  console.log(`  - 상세 프로필: 상위 ${detailHospitals.length}개 병원`);
  console.log(`  - 사진 임베딩: ${photoCache.size}장`);
}

main().catch(console.error);
