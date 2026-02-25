/**
 * v5.5 바노바기피부과 사전 주입 테스트 보고서 (DOCX)
 * - 보고서: 종합 요약 + 장비 + 시술 + 가격 + 의사 + 연락처 + 사전 검증
 * - RAW DATA: JSON 전체를 읽기 쉬운 테이블/리스트로 정리
 *
 * 실행: npx tsx scripts/_generate-v55-report-banobagi.ts
 */
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, WidthType,
  TableLayoutType, ShadingType, PageBreak,
} from 'docx';
import { getEquipmentNormalizationMap } from './crawler/dictionary-loader.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================================
// 데이터 로드
// ============================================================
const JSON_PATH = path.resolve(__dirname, '..', 'output', 'v55-test-banobagi.json');
const result = JSON.parse(fs.readFileSync(JSON_PATH, 'utf-8'));
const normMap = getEquipmentNormalizationMap();

// ============================================================
// 유틸
// ============================================================
const BLUE = '2B579A';
const GRAY = '666666';
const GREEN = '28A745';
const ORANGE = 'FD7E14';
const RED = 'DC3545';

function headerCell(text: string, width?: number): TableCell {
  return new TableCell({
    shading: { type: ShadingType.SOLID, color: BLUE },
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    children: [new Paragraph({
      children: [new TextRun({ text, bold: true, color: 'FFFFFF', size: 20, font: 'Malgun Gothic' })],
      alignment: AlignmentType.CENTER,
    })],
  });
}

function subHeaderCell(text: string, width?: number): TableCell {
  return new TableCell({
    shading: { type: ShadingType.SOLID, color: 'E8EDF3' },
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    children: [new Paragraph({
      children: [new TextRun({ text, bold: true, color: '333333', size: 18, font: 'Malgun Gothic' })],
      alignment: AlignmentType.CENTER,
    })],
  });
}

function dataCell(text: string, bold = false, color = '333333'): TableCell {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text: text || '-', bold, size: 18, font: 'Malgun Gothic', color })],
      spacing: { before: 30, after: 30 },
    })],
  });
}

function sectionTitle(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size: 28, font: 'Malgun Gothic', color: BLUE })],
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 400, after: 120 },
  });
}

function subTitle(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size: 22, font: 'Malgun Gothic', color: '333333' })],
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 250, after: 80 },
  });
}

function bodyText(text: string, color = '333333'): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, size: 18, font: 'Malgun Gothic', color })],
    spacing: { before: 40, after: 40 },
  });
}

function labelValue(label: string, value: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({ text: `${label}: `, bold: true, size: 18, font: 'Malgun Gothic', color: '555555' }),
      new TextRun({ text: value, size: 18, font: 'Malgun Gothic' }),
    ],
    spacing: { before: 30, after: 30 },
  });
}

function divider(): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: '\u2501'.repeat(70), color: 'CCCCCC', size: 14 })],
    spacing: { before: 200, after: 200 },
  });
}

function badge(text: string, bgColor: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({
      text: ` ${text} `,
      bold: true, size: 22, font: 'Malgun Gothic', color: 'FFFFFF',
      shading: { type: ShadingType.SOLID, color: bgColor },
    })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 80, after: 120 },
  });
}

function makeTable(rows: TableRow[]): Table {
  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
  });
}

// ============================================================
// 데이터 분류
// ============================================================
const devices = (result.medical_devices || []) as Array<Record<string, unknown>>;
const treatments = (result.treatments || []) as Array<Record<string, unknown>>;
const doctors = (result.doctors || []) as Array<Record<string, unknown>>;
const academics = (result.academic_activities || []) as Array<Record<string, unknown>>;
const events = (result.events || []) as Array<Record<string, unknown>>;
const contact = (result.contact_info || {}) as Record<string, unknown>;
const summary = (result.extraction_summary || {}) as Record<string, unknown>;
const rawPrices = (result.raw_price_texts || []) as string[];
const unregEq = (result.unregistered_equipment || []) as Array<Record<string, unknown>>;
const unregTr = (result.unregistered_treatments || []) as Array<Record<string, unknown>>;

// 장비 분류
const deviceItems = devices.filter(d => d.device_type === 'device');
const injectableItems = devices.filter(d => d.device_type === 'injectable');

// 사전 매칭 분류
const matchedDevices = devices.filter(d => {
  const name = String(d.name || '');
  return normMap.has(name.toLowerCase());
});
const unmatchedDevices = devices.filter(d => {
  const name = String(d.name || '');
  return !normMap.has(name.toLowerCase());
});

// 시술 분류
const singleTreatments = treatments.filter(t => !t.is_package);
const packageTreatments = treatments.filter(t => t.is_package);
const pricedTreatments = treatments.filter(t => t.price && Number(t.price) > 0);

// ============================================================
// 보고서 빌드
// ============================================================
function buildReport(): (Paragraph | Table)[] {
  const c: (Paragraph | Table)[] = [];

  // ─── 표지 ───
  c.push(new Paragraph({ spacing: { before: 1500 } }));
  c.push(new Paragraph({
    children: [new TextRun({ text: '\uBC14\uB178\uBC14\uAE30\uD53C\uBD80\uACFC', bold: true, size: 52, font: 'Malgun Gothic', color: BLUE })],
    alignment: AlignmentType.CENTER,
  }));
  c.push(new Paragraph({
    children: [new TextRun({ text: 'v5.5 \uC0AC\uC804 \uC8FC\uC785 \uD14C\uC2A4\uD2B8 \uBCF4\uACE0\uC11C', size: 36, font: 'Malgun Gothic', color: '444444' })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 200 },
  }));
  c.push(new Paragraph({
    children: [new TextRun({ text: 'Recrawl v5.5 | Dictionary Injection + Gemini 2.5 Flash', size: 22, font: 'Malgun Gothic', color: '888888' })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 150 },
  }));
  c.push(new Paragraph({
    children: [new TextRun({ text: `\uC0DD\uC131\uC77C: ${new Date().toLocaleDateString('ko-KR')} | MADMEDSALES`, size: 20, font: 'Malgun Gothic', color: 'AAAAAA' })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 100 },
  }));
  c.push(badge('v5.5 DICTIONARY INJECTION TEST', GREEN));

  // ─── 1. 종합 요약 ───
  c.push(new Paragraph({ children: [new PageBreak()] }));
  c.push(sectionTitle('1. \uC885\uD569 \uC694\uC57D'));

  c.push(makeTable([
    new TableRow({ children: [headerCell('\uD56D\uBAA9', 40), headerCell('\uACB0\uACFC', 60)] }),
    new TableRow({ children: [dataCell('\uBCD1\uC6D0\uBA85', true), dataCell('\uBC14\uB178\uBC14\uAE30\uD53C\uBD80\uACFC')] }),
    new TableRow({ children: [dataCell('\uD14C\uC2A4\uD2B8 \uBC84\uC804', true), dataCell('v5.5 (\uC0AC\uC804 \uC8FC\uC785)')] }),
    new TableRow({ children: [dataCell('\uD504\uB86C\uD504\uD2B8 \uAE38\uC774', true), dataCell('11,733\uC790 (~3,352 tokens)')] }),
    new TableRow({ children: [dataCell('R1~R6 \uADDC\uCE59 \uC8FC\uC785', true), dataCell('R1=\u2705 R2=\u2705 R3=\u2705 R6=\u2705')] }),
    new TableRow({ children: [dataCell('\uB9C8\uD06C\uB2E4\uC6B4 \uC18C\uC2A4', true), dataCell('50\uD398\uC774\uC9C0, 150,000\uC790')] }),
    new TableRow({ children: [dataCell('Gemini \uBAA8\uB378', true), dataCell('gemini-2.5-flash')] }),
    new TableRow({ children: [dataCell('\uC751\uB2F5 \uC2DC\uAC04', true), dataCell('213.4\uCD08')] }),
    new TableRow({ children: [dataCell('\uC785\uB825 \uD1A0\uD070', true), dataCell('84,711')] }),
    new TableRow({ children: [dataCell('\uCD9C\uB825 \uD1A0\uD070', true), dataCell('16,843')] }),
    new TableRow({ children: [dataCell('Finish Reason', true), dataCell('STOP (\uC815\uC0C1)')] }),
  ]));

  c.push(bodyText(''));
  c.push(makeTable([
    new TableRow({ children: [headerCell('\uCD94\uCD9C \uACB0\uACFC', 40), headerCell('\uAC74\uC218', 30), headerCell('\uBE44\uACE0', 30)] }),
    new TableRow({ children: [dataCell('\uC758\uB8CC\uAE30\uAE30/\uC7A5\uBE44', true), dataCell(`${devices.length}\uAC1C`), dataCell(`device ${deviceItems.length} / injectable ${injectableItems.length}`)] }),
    new TableRow({ children: [dataCell('\uC0AC\uC804 \uB9E4\uCE6D \uC131\uACF5', true), dataCell(`${matchedDevices.length}\uAC1C`), dataCell(`${Math.round(matchedDevices.length / devices.length * 100)}%`)] }),
    new TableRow({ children: [dataCell('\uC0AC\uC804 \uBBF8\uB4F1\uB85D', true), dataCell(`${unmatchedDevices.length}\uAC1C`), dataCell(`${Math.round(unmatchedDevices.length / devices.length * 100)}%`)] }),
    new TableRow({ children: [dataCell('\uC2DC\uC220', true), dataCell(`${treatments.length}\uAC1C`), dataCell(`\uB2E8\uC77C ${singleTreatments.length} / \uD328\uD0A4\uC9C0 ${packageTreatments.length}`)] }),
    new TableRow({ children: [dataCell('\uAC00\uACA9 \uC788\uB294 \uC2DC\uC220', true), dataCell(`${pricedTreatments.length}\uAC1C`), dataCell(`${Math.round(pricedTreatments.length / treatments.length * 100)}%`)] }),
    new TableRow({ children: [dataCell('\uC758\uC0AC', true), dataCell(`${doctors.length}\uBA85`), dataCell('')] }),
    new TableRow({ children: [dataCell('\uD559\uC220\uD65C\uB3D9', true), dataCell(`${academics.length}\uAC1C`), dataCell('')] }),
    new TableRow({ children: [dataCell('\uC774\uBCA4\uD2B8', true), dataCell(`${events.length}\uAC1C`), dataCell('')] }),
    new TableRow({ children: [dataCell('raw_price_texts', true), dataCell(`${rawPrices.length}\uAC1C`), dataCell('\uD30C\uC2F1 \uC2E4\uD328 \uC6D0\uBB38')] }),
    new TableRow({ children: [dataCell('unregistered_equipment', true), dataCell(`${unregEq.length}\uAC1C`), dataCell('')] }),
    new TableRow({ children: [dataCell('unregistered_treatments', true), dataCell(`${unregTr.length}\uAC1C`), dataCell('')] }),
  ]));

  // ─── 2. 장비/의료기기 ───
  c.push(new Paragraph({ children: [new PageBreak()] }));
  c.push(sectionTitle(`2. \uC758\uB8CC\uAE30\uAE30/\uC7A5\uBE44 (${devices.length}\uAC1C)`));

  c.push(subTitle('2-1. \uC0AC\uC804 \uB9E4\uCE6D \uC131\uACF5 (\u2705 ' + matchedDevices.length + '\uAC1C)'));
  if (matchedDevices.length > 0) {
    const rows = [new TableRow({ children: [headerCell('#', 5), headerCell('\uC7A5\uBE44\uBA85', 20), headerCell('\uC815\uADDC\uD654\uBA85', 20), headerCell('\uD0C0\uC785', 12), headerCell('\uC11C\uBE0C', 12), headerCell('\uC124\uBA85', 31)] })];
    matchedDevices.forEach((d, i) => {
      const name = String(d.name || '');
      const norm = normMap.get(name.toLowerCase()) || name;
      rows.push(new TableRow({ children: [
        dataCell(String(i + 1)), dataCell(name, true), dataCell(norm, false, GREEN),
        dataCell(String(d.device_type || '')), dataCell(String(d.subcategory || '')),
        dataCell(String(d.description || '').slice(0, 80) + ((String(d.description || '').length > 80) ? '...' : '')),
      ] }));
    });
    c.push(makeTable(rows));
  }

  c.push(subTitle('2-2. \uC0AC\uC804 \uBBF8\uB4F1\uB85D (\u26A0\uFE0F ' + unmatchedDevices.length + '\uAC1C \u2192 \uC0AC\uC804 \uD655\uC7A5 \uD544\uC694)'));
  if (unmatchedDevices.length > 0) {
    const rows = [new TableRow({ children: [headerCell('#', 5), headerCell('\uC7A5\uBE44\uBA85', 20), headerCell('\uD55C\uAE00\uBA85', 15), headerCell('\uD0C0\uC785', 12), headerCell('\uC11C\uBE0C', 12), headerCell('\uC124\uBA85', 36)] })];
    unmatchedDevices.forEach((d, i) => {
      rows.push(new TableRow({ children: [
        dataCell(String(i + 1)), dataCell(String(d.name || ''), true, ORANGE),
        dataCell(String(d.korean_name || '-')),
        dataCell(String(d.device_type || '')), dataCell(String(d.subcategory || '')),
        dataCell(String(d.description || '').slice(0, 80) + ((String(d.description || '').length > 80) ? '...' : '')),
      ] }));
    });
    c.push(makeTable(rows));
  }

  // ─── 3. 시술 메뉴 ───
  c.push(new Paragraph({ children: [new PageBreak()] }));
  c.push(sectionTitle(`3. \uC2DC\uC220 \uBA54\uB274 (${treatments.length}\uAC1C)`));

  c.push(subTitle(`3-1. \uB2E8\uC77C \uC2DC\uC220 (${singleTreatments.length}\uAC1C)`));
  if (singleTreatments.length > 0) {
    const rows = [new TableRow({ children: [headerCell('#', 5), headerCell('\uC2DC\uC220\uBA85', 25), headerCell('\uCE74\uD14C\uACE0\uB9AC', 20), headerCell('\uBD80\uC704', 20), headerCell('\uAC00\uACA9', 15), headerCell('\uD45C\uC2DC', 15)] })];
    singleTreatments.forEach((t, i) => {
      const cats = Array.isArray(t.category) ? (t.category as string[]).join(', ') : String(t.category || '-');
      const parts = Array.isArray(t.body_part) ? (t.body_part as string[]).join(', ') : String(t.body_part || '-');
      const price = t.price ? `\u20A9${Number(t.price).toLocaleString()}` : '-';
      const display = String(t.price_display || '-');
      rows.push(new TableRow({ children: [
        dataCell(String(i + 1)), dataCell(String(t.name || ''), true),
        dataCell(cats), dataCell(parts), dataCell(price), dataCell(display),
      ] }));
    });
    c.push(makeTable(rows));
  }

  c.push(subTitle(`3-2. \uD328\uD0A4\uC9C0/\uCF64\uBCF4 \uC2DC\uC220 (${packageTreatments.length}\uAC1C)`));
  if (packageTreatments.length > 0) {
    const rows = [new TableRow({ children: [headerCell('#', 5), headerCell('\uD328\uD0A4\uC9C0\uBA85', 25), headerCell('\uD3EC\uD568 \uC2DC\uC220', 30), headerCell('\uCE74\uD14C\uACE0\uB9AC', 20), headerCell('\uAC00\uACA9', 20)] })];
    packageTreatments.forEach((t, i) => {
      const detail = t.package_detail as Record<string, unknown> | null;
      const included = detail?.included_treatments
        ? (detail.included_treatments as string[]).join(' + ')
        : '-';
      const cats = Array.isArray(t.category) ? (t.category as string[]).join(', ') : '-';
      const price = t.price ? `\u20A9${Number(t.price).toLocaleString()}` : '-';
      rows.push(new TableRow({ children: [
        dataCell(String(i + 1)), dataCell(String(t.name || ''), true),
        dataCell(included), dataCell(cats), dataCell(price),
      ] }));
    });
    c.push(makeTable(rows));
  }

  // ─── 4. 가격 정보 ───
  c.push(new Paragraph({ children: [new PageBreak()] }));
  c.push(sectionTitle(`4. \uAC00\uACA9 \uC815\uBCF4`));

  c.push(subTitle(`4-1. \uAC00\uACA9 \uD655\uC778\uB41C \uC2DC\uC220 (${pricedTreatments.length}\uAC1C)`));
  if (pricedTreatments.length > 0) {
    const rows = [new TableRow({ children: [headerCell('#', 5), headerCell('\uC2DC\uC220\uBA85', 30), headerCell('\uAC00\uACA9 (\uC6D0)', 20), headerCell('\uD45C\uC2DC \uAC00\uACA9', 20), headerCell('\uD328\uD0A4\uC9C0', 10), headerCell('\uBD80\uC704', 15)] })];
    pricedTreatments.forEach((t, i) => {
      rows.push(new TableRow({ children: [
        dataCell(String(i + 1)),
        dataCell(String(t.name || ''), true),
        dataCell(`\u20A9${Number(t.price).toLocaleString()}`),
        dataCell(String(t.price_display || '-')),
        dataCell(t.is_package ? 'O' : '-'),
        dataCell(Array.isArray(t.body_part) ? (t.body_part as string[]).join(', ') : '-'),
      ] }));
    });
    c.push(makeTable(rows));
  }

  c.push(subTitle(`4-2. raw_price_texts (${rawPrices.length}\uAC1C) \u2014 \uD30C\uC2F1 \uC2E4\uD328 \uC6D0\uBB38`));
  if (rawPrices.length > 0) {
    const rows = [new TableRow({ children: [headerCell('#', 10), headerCell('\uC6D0\uBB38 \uD14D\uC2A4\uD2B8', 90)] })];
    rawPrices.forEach((p: unknown, i: number) => {
      rows.push(new TableRow({ children: [
        dataCell(String(i + 1)),
        dataCell(typeof p === 'string' ? p : JSON.stringify(p)),
      ] }));
    });
    c.push(makeTable(rows));
  }

  // ─── 5. 의료진 ───
  c.push(new Paragraph({ children: [new PageBreak()] }));
  c.push(sectionTitle(`5. \uC758\uB8CC\uC9C4 (${doctors.length}\uBA85)`));

  for (const dr of doctors) {
    c.push(subTitle(`${dr.name} ${dr.title || ''}`));
    if (dr.specialty) c.push(labelValue('\uC804\uBB38', String(dr.specialty)));
    if (Array.isArray(dr.career) && (dr.career as string[]).length > 0) {
      c.push(labelValue('\uACBD\uB825', (dr.career as string[]).join(' / ')));
    }
    if (Array.isArray(dr.education) && (dr.education as string[]).length > 0) {
      c.push(labelValue('\uD559\uB825', (dr.education as string[]).join(' / ')));
    }
    if (Array.isArray(dr.certifications) && (dr.certifications as string[]).length > 0) {
      c.push(labelValue('\uC790\uACA9', (dr.certifications as string[]).join(' / ')));
    }
    c.push(labelValue('\uC2E0\uB8B0\uB3C4', String(dr.confidence || '-')));
  }

  // 학술활동
  if (academics.length > 0) {
    c.push(subTitle(`\uD559\uC220\uD65C\uB3D9 (${academics.length}\uAC1C)`));
    const rows = [new TableRow({ children: [headerCell('#', 5), headerCell('\uC720\uD615', 15), headerCell('\uC81C\uBAA9', 45), headerCell('\uC758\uC0AC', 15), headerCell('\uC5F0\uB3C4', 10), headerCell('\uCD9C\uCC98', 10)] })];
    academics.forEach((a, i) => {
      rows.push(new TableRow({ children: [
        dataCell(String(i + 1)), dataCell(String(a.type || '-')),
        dataCell(String(a.title || '-')), dataCell(String(a.doctor_name || '-')),
        dataCell(String(a.year || '-')), dataCell(String(a.source_text || '').slice(0, 30)),
      ] }));
    });
    c.push(makeTable(rows));
  }

  // ─── 6. 이벤트 ───
  c.push(sectionTitle(`6. \uC774\uBCA4\uD2B8/\uD504\uB85C\uBAA8\uC158 (${events.length}\uAC1C)`));
  if (events.length === 0) {
    c.push(bodyText('\uCD94\uCD9C\uB41C \uC774\uBCA4\uD2B8 \uB370\uC774\uD130 \uC5C6\uC74C.'));
  } else {
    const rows = [new TableRow({ children: [headerCell('#', 5), headerCell('\uC81C\uBAA9', 25), headerCell('\uC124\uBA85', 30), headerCell('\uAD00\uB828 \uC2DC\uC220', 20), headerCell('\uAC00\uACA9', 20)] })];
    events.forEach((e, i) => {
      const related = Array.isArray(e.related_treatments) ? (e.related_treatments as string[]).join(', ') : '-';
      rows.push(new TableRow({ children: [
        dataCell(String(i + 1)), dataCell(String(e.title || e.name || '-'), true),
        dataCell(String(e.description || '').slice(0, 80)),
        dataCell(related),
        dataCell(e.price ? `\u20A9${Number(e.price).toLocaleString()}` : String(e.price_display || '-')),
      ] }));
    });
    c.push(makeTable(rows));
  }

  // ─── 7. 연락처 ───
  c.push(new Paragraph({ children: [new PageBreak()] }));
  c.push(sectionTitle('7. \uC5F0\uB77D\uCC98'));

  const phones = Array.isArray(contact.phone) ? contact.phone as Array<Record<string, unknown>> : [];
  const emails = Array.isArray(contact.email) ? contact.email as Array<Record<string, unknown>> : [];
  const contactRows = [new TableRow({ children: [headerCell('\uCC44\uB110', 30), headerCell('\uC815\uBCF4', 70)] })];
  if (phones.length > 0) {
    contactRows.push(new TableRow({ children: [dataCell('\uC804\uD654', true), dataCell(phones.map(p => String(p.number || p)).join(', '))] }));
  }
  if (emails.length > 0) {
    contactRows.push(new TableRow({ children: [dataCell('\uC774\uBA54\uC77C', true), dataCell(emails.map(e => String(e.address || e)).join(', '))] }));
  }
  if (contact.kakao_channel) {
    contactRows.push(new TableRow({ children: [dataCell('\uCE74\uCE74\uC624', true), dataCell(String(contact.kakao_channel))] }));
  }
  if (contact.instagram) {
    contactRows.push(new TableRow({ children: [dataCell('\uC778\uC2A4\uD0C0\uADF8\uB7A8', true), dataCell(String(contact.instagram))] }));
  }
  if (contact.youtube) {
    contactRows.push(new TableRow({ children: [dataCell('\uC720\uD29C\uBE0C', true), dataCell(String(contact.youtube))] }));
  }
  if (contact.blog) {
    contactRows.push(new TableRow({ children: [dataCell('\uBE14\uB85C\uADF8', true), dataCell(String(contact.blog))] }));
  }
  if (contact.website) {
    contactRows.push(new TableRow({ children: [dataCell('\uC6F9\uC0AC\uC774\uD2B8', true), dataCell(String(contact.website))] }));
  }
  c.push(makeTable(contactRows));

  // ─── 8. 사전 검증 결과 ───
  c.push(sectionTitle('8. v5.5 \uC0AC\uC804 \uC8FC\uC785 \uAC80\uC99D'));

  c.push(subTitle('8-1. \uD504\uB86C\uD504\uD2B8 \uADDC\uCE59 \uC8FC\uC785 \uD655\uC778'));
  c.push(makeTable([
    new TableRow({ children: [headerCell('\uADDC\uCE59', 20), headerCell('\uC124\uBA85', 50), headerCell('\uC8FC\uC785 \uC5EC\uBD80', 30)] }),
    new TableRow({ children: [dataCell('R1', true), dataCell('\uC7A5\uBE44 \uBD84\uB958 \uADDC\uCE59 + \uC0AC\uC804 \uD14C\uC774\uBE14'), dataCell('\u2705 \uD655\uC778', false, GREEN)] }),
    new TableRow({ children: [dataCell('R2', true), dataCell('\uC2DC\uC220 \uBD84\uB958 \uADDC\uCE59 + \uD0A4\uC6CC\uB4DC \uC0AC\uC804'), dataCell('\u2705 \uD655\uC778', false, GREEN)] }),
    new TableRow({ children: [dataCell('R3', true), dataCell('\uAC00\uACA9 \uBD84\uB958 \uADDC\uCE59 + \uB2E8\uC704 \uC0AC\uC804'), dataCell('\u2705 \uD655\uC778', false, GREEN)] }),
    new TableRow({ children: [dataCell('R6', true), dataCell('\uC678\uBD80 \uCF58\uD150\uCE20 \uCC28\uB2E8 + \uBE14\uB799\uB9AC\uC2A4\uD2B8'), dataCell('\u2705 \uD655\uC778', false, GREEN)] }),
    new TableRow({ children: [dataCell('unregistered_*', true), dataCell('\uBBF8\uB4F1\uB85D \uC7A5\uBE44/\uC2DC\uC220 \uD544\uB4DC'), dataCell('\u2705 \uC2A4\uD0A4\uB9C8 \uD3EC\uD568', false, GREEN)] }),
    new TableRow({ children: [dataCell('raw_price_texts', true), dataCell('\uD30C\uC2F1 \uC2E4\uD328 \uAC00\uACA9 \uC6D0\uBB38'), dataCell('\u2705 \uC2A4\uD0A4\uB9C8 \uD3EC\uD568', false, GREEN)] }),
  ]));

  c.push(subTitle('8-2. \uC0AC\uC804 \uB9E4\uCE6D \uD1B5\uACC4'));
  c.push(labelValue('\uC804\uCCB4 \uC7A5\uBE44', `${devices.length}\uAC1C`));
  c.push(labelValue('\uC0AC\uC804 \uB9E4\uCE6D \uC131\uACF5', `${matchedDevices.length}\uAC1C (${Math.round(matchedDevices.length / devices.length * 100)}%)`));
  c.push(labelValue('\uC0AC\uC804 \uBBF8\uB4F1\uB85D', `${unmatchedDevices.length}\uAC1C (${Math.round(unmatchedDevices.length / devices.length * 100)}%) \u2192 \uC0AC\uC804 \uD655\uC7A5 \uD544\uC694`));
  c.push(bodyText(''));
  c.push(labelValue('\uBBF8\uB4F1\uB85D \uC7A5\uBE44 \uBAA9\uB85D', unmatchedDevices.map(d => String(d.name)).join(', ')));

  c.push(subTitle('8-3. extraction_summary (Gemini \uCD9C\uB825)'));
  for (const [key, value] of Object.entries(summary)) {
    c.push(labelValue(key, String(value)));
  }

  // ─── 9. RAW DATA ───
  c.push(new Paragraph({ children: [new PageBreak()] }));
  c.push(sectionTitle('9. RAW DATA \u2014 \uC7A5\uBE44 \uC804\uCCB4 \uC0C1\uC138'));

  const eqFullRows = [new TableRow({ children: [
    headerCell('#', 4), headerCell('name', 14), headerCell('korean_name', 12),
    headerCell('type', 8), headerCell('sub', 8), headerCell('manufacturer', 10),
    headerCell('source', 6), headerCell('description', 38),
  ] })];
  devices.forEach((d, i) => {
    const name = String(d.name || '');
    const matched = normMap.has(name.toLowerCase());
    eqFullRows.push(new TableRow({ children: [
      dataCell(String(i + 1)),
      dataCell(name, true, matched ? GREEN : ORANGE),
      dataCell(String(d.korean_name || '-')),
      dataCell(String(d.device_type || '')),
      dataCell(String(d.subcategory || '')),
      dataCell(String(d.manufacturer || '-')),
      dataCell(String(d.source || '-')),
      dataCell(String(d.description || '-')),
    ] }));
  });
  c.push(makeTable(eqFullRows));

  c.push(new Paragraph({ children: [new PageBreak()] }));
  c.push(sectionTitle('10. RAW DATA \u2014 \uC2DC\uC220 \uC804\uCCB4 \uC0C1\uC138'));

  const trFullRows = [new TableRow({ children: [
    headerCell('#', 4), headerCell('\uC2DC\uC220\uBA85', 18), headerCell('\uCE74\uD14C\uACE0\uB9AC', 14),
    headerCell('\uBD80\uC704', 12), headerCell('\uAC00\uACA9', 10), headerCell('\uD45C\uC2DC', 10),
    headerCell('PKG', 5), headerCell('\uD3EC\uD568 \uC2DC\uC220', 17), headerCell('\uC138\uC158', 10),
  ] })];
  treatments.forEach((t, i) => {
    const cats = Array.isArray(t.category) ? (t.category as string[]).join(', ') : '-';
    const parts = Array.isArray(t.body_part) ? (t.body_part as string[]).join(', ') : '-';
    const price = t.price ? `\u20A9${Number(t.price).toLocaleString()}` : '-';
    const detail = t.package_detail as Record<string, unknown> | null;
    const included = detail?.included_treatments ? (detail.included_treatments as string[]).join('+') : '-';
    trFullRows.push(new TableRow({ children: [
      dataCell(String(i + 1)), dataCell(String(t.name || ''), true),
      dataCell(cats), dataCell(parts), dataCell(price),
      dataCell(String(t.price_display || '-')),
      dataCell(t.is_package ? 'O' : '-'),
      dataCell(included),
      dataCell(String(t.session_info || '-')),
    ] }));
  });
  c.push(makeTable(trFullRows));

  // ─── 푸터 ───
  c.push(divider());
  c.push(new Paragraph({
    children: [new TextRun({
      text: 'MADMEDSALES | v5.5 Dictionary Injection Test Report',
      size: 16, font: 'Malgun Gothic', color: '999999', italics: true,
    })],
    alignment: AlignmentType.CENTER,
  }));
  c.push(new Paragraph({
    children: [new TextRun({
      text: `\uC0DD\uC131\uC77C\uC2DC: ${new Date().toLocaleString('ko-KR')} | Gemini 2.5 Flash + SA JWT Auth`,
      size: 14, font: 'Malgun Gothic', color: 'BBBBBB',
    })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 40 },
  }));

  return c;
}

// ============================================================
// 메인
// ============================================================
async function main(): Promise<void> {
  console.log('v5.5 \uBC14\uB178\uBC14\uAE30\uD53C\uBD80\uACFC \uBCF4\uACE0\uC11C \uC0DD\uC131 \uC911...\n');

  console.log(`  \uC7A5\uBE44: ${devices.length}\uAC1C (device ${deviceItems.length} / injectable ${injectableItems.length})`);
  console.log(`  \uC0AC\uC804 \uB9E4\uCE6D: ${matchedDevices.length} / \uBBF8\uB4F1\uB85D: ${unmatchedDevices.length}`);
  console.log(`  \uC2DC\uC220: ${treatments.length}\uAC1C (\uB2E8\uC77C ${singleTreatments.length} / \uD328\uD0A4\uC9C0 ${packageTreatments.length})`);
  console.log(`  \uAC00\uACA9 \uC788\uB294 \uC2DC\uC220: ${pricedTreatments.length}\uAC1C`);
  console.log(`  \uC758\uC0AC: ${doctors.length}\uBA85`);
  console.log(`  \uD559\uC220: ${academics.length}\uAC1C`);
  console.log(`  \uC774\uBCA4\uD2B8: ${events.length}\uAC1C`);
  console.log(`  raw_price_texts: ${rawPrices.length}\uAC1C`);
  console.log('');

  const children = buildReport();

  const doc = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(doc);

  const outDir = path.resolve(__dirname, '..', 'output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const date = new Date().toISOString().split('T')[0];
  const docxPath = path.resolve(outDir, `\uBC14\uB178\uBC14\uAE30\uD53C\uBD80\uACFC_v5.5_\uBCF4\uACE0\uC11C_${date}.docx`);
  fs.writeFileSync(docxPath, buffer);

  console.log(`DOCX \uBCF4\uACE0\uC11C: ${docxPath}`);
  console.log(`  \uD30C\uC77C \uD06C\uAE30: ${(buffer.length / 1024).toFixed(1)}KB`);

  // RAW DATA도 정리된 JSON으로 별도 저장
  const rawData = {
    _meta: {
      hospital: '\uBC14\uB178\uBC14\uAE30\uD53C\uBD80\uACFC',
      version: 'v5.5',
      generated: new Date().toISOString(),
      source_pages: 50,
      source_chars: 150000,
      gemini_model: 'gemini-2.5-flash',
      gemini_tokens_in: 84711,
      gemini_tokens_out: 16843,
      elapsed_sec: 213.4,
    },
    statistics: {
      total_devices: devices.length,
      device_count: deviceItems.length,
      injectable_count: injectableItems.length,
      matched_count: matchedDevices.length,
      unmatched_count: unmatchedDevices.length,
      match_rate: `${Math.round(matchedDevices.length / devices.length * 100)}%`,
      total_treatments: treatments.length,
      single_treatments: singleTreatments.length,
      package_treatments: packageTreatments.length,
      priced_treatments: pricedTreatments.length,
      total_doctors: doctors.length,
      total_academics: academics.length,
      total_events: events.length,
      raw_price_texts_count: rawPrices.length,
    },
    matched_devices: matchedDevices.map(d => ({
      name: d.name,
      normalized: normMap.get(String(d.name || '').toLowerCase()),
      type: d.device_type,
      subcategory: d.subcategory,
    })),
    unmatched_devices: unmatchedDevices.map(d => ({
      name: d.name,
      korean_name: d.korean_name,
      type: d.device_type,
      subcategory: d.subcategory,
      description: d.description,
    })),
    priced_treatments: pricedTreatments.map(t => ({
      name: t.name,
      price: t.price,
      price_display: t.price_display,
      is_package: t.is_package,
      category: t.category,
    })),
    raw_price_texts: rawPrices,
    extraction_summary: summary,
    contact_info: contact,
  };

  const rawPath = path.resolve(outDir, `\uBC14\uB178\uBC14\uAE30\uD53C\uBD80\uACFC_v5.5_RAW_DATA_${date}.json`);
  fs.writeFileSync(rawPath, JSON.stringify(rawData, null, 2), 'utf-8');
  console.log(`RAW DATA: ${rawPath}`);
  console.log(`  \uD30C\uC77C \uD06C\uAE30: ${(fs.statSync(rawPath).size / 1024).toFixed(1)}KB`);
}

main().catch(console.error);
