/**
 * v5.3 안산엔비의원 단독 크롤링 보고서 (DOCX)
 * 크롤 데이터 + 스크린샷 이미지 전부 포함
 *
 * 실행: npx tsx scripts/_generate-v53-report.ts
 */
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, ImageRun, WidthType,
  TableLayoutType, ShadingType, PageBreak,
} from 'docx';
import { supabase } from './utils/supabase.js';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HOSPITAL_NAME = '안산엔비의원';
const HOSPITAL_ID = '1267b395-1132-4511-a8ba-1afc228a8867';

// ============================================================
// 유틸
// ============================================================
function headerCell(text: string, width?: number): TableCell {
  return new TableCell({
    shading: { type: ShadingType.SOLID, color: '2B579A' },
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
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
    children: [new TextRun({ text, bold: true, size: 28, font: 'Malgun Gothic', color: '2B579A' })],
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
    children: [new TextRun({ text: '━'.repeat(70), color: 'CCCCCC', size: 14 })],
    spacing: { before: 200, after: 200 },
  });
}

function statusBadge(status: string): Paragraph {
  const colorMap: Record<string, string> = {
    pass: '28A745', partial: 'FFC107', insufficient: 'FD7E14',
    fail: 'DC3545', manual_review: 'DC3545', error: 'DC3545',
  };
  const labelMap: Record<string, string> = {
    pass: 'PASS', partial: 'PARTIAL', insufficient: 'INSUFFICIENT',
    fail: 'FAIL', manual_review: 'MANUAL REVIEW', error: 'ERROR',
  };
  return new Paragraph({
    children: [
      new TextRun({ text: '  ', size: 18 }),
      new TextRun({
        text: ` ${labelMap[status] || status.toUpperCase()} `,
        bold: true, size: 24, font: 'Malgun Gothic',
        color: 'FFFFFF',
        shading: { type: ShadingType.SOLID, color: colorMap[status] || '666666' },
      }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { before: 100, after: 200 },
  });
}

// 스크린샷 → PNG
async function screenshotToPng(url: string, maxWidth = 560): Promise<Buffer | null> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    return await sharp(buf).resize(maxWidth, null, { withoutEnlargement: true }).png().toBuffer();
  } catch {
    return null;
  }
}

// 이미지 → 보고서에 삽입
function imageBlock(pngBuf: Buffer, width = 540, caption?: string): Paragraph[] {
  const result: Paragraph[] = [];
  // 이미지 사이즈 추정 (4:3 비율 기본, 실제 비율은 sharp에서 유지됨)
  const height = Math.round(width * 0.625);
  result.push(new Paragraph({
    children: [new ImageRun({
      data: pngBuf,
      transformation: { width, height },
      type: 'png',
    })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 80, after: caption ? 20 : 120 },
  }));
  if (caption) {
    result.push(new Paragraph({
      children: [new TextRun({ text: caption, size: 16, font: 'Malgun Gothic', color: '888888', italics: true })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
    }));
  }
  return result;
}

// ============================================================
// 메인
// ============================================================
async function main(): Promise<void> {
  console.log(`📝 ${HOSPITAL_NAME} v5.3 보고서 생성 중...\n`);

  // DB 데이터 로드
  const [pagesRes, doctorsRes, treatmentsRes, equipmentsRes, eventsRes, validationRes] = await Promise.all([
    supabase.from('hospital_crawl_pages')
      .select('url, page_type, char_count, screenshot_url, analysis_method, crawled_at')
      .eq('hospital_id', HOSPITAL_ID).order('crawled_at'),
    supabase.from('hospital_doctors').select('*').eq('hospital_id', HOSPITAL_ID),
    supabase.from('hospital_treatments').select('*').eq('hospital_id', HOSPITAL_ID),
    supabase.from('hospital_equipments').select('*').eq('hospital_id', HOSPITAL_ID),
    supabase.from('hospital_events').select('*').eq('hospital_id', HOSPITAL_ID),
    supabase.from('hospital_crawl_validations')
      .select('*').eq('hospital_id', HOSPITAL_ID).order('created_at', { ascending: false }).limit(1),
  ]);

  const pages = pagesRes.data || [];
  const doctors = doctorsRes.data || [];
  const treatments = treatmentsRes.data || [];
  const equipments = equipmentsRes.data || [];
  const events = eventsRes.data || [];
  const validation = validationRes.data?.[0] || null;

  console.log(`  페이지: ${pages.length}`);
  console.log(`  의사: ${doctors.length}`);
  console.log(`  시술: ${treatments.length}`);
  console.log(`  장비: ${equipments.length}`);
  console.log(`  이벤트: ${events.length}`);
  console.log(`  검증: ${validation?.status || 'N/A'} (${validation?.crawl_version || '-'})`);

  const children: (Paragraph | Table)[] = [];

  // ─── 표지 ───
  children.push(new Paragraph({ spacing: { before: 1500 } }));
  children.push(new Paragraph({
    children: [new TextRun({ text: HOSPITAL_NAME, bold: true, size: 52, font: 'Malgun Gothic', color: '2B579A' })],
    alignment: AlignmentType.CENTER,
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: '크롤링 데이터 수집 보고서', size: 36, font: 'Malgun Gothic', color: '444444' })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 200 },
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: 'Recrawl v5.3 | Firecrawl + Gemini Flash + Vision', size: 22, font: 'Malgun Gothic', color: '888888' })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 150 },
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: `생성일: ${new Date().toLocaleDateString('ko-KR')} | MADMEDSALES`, size: 20, font: 'Malgun Gothic', color: 'AAAAAA' })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 100 },
  }));

  if (validation) {
    children.push(statusBadge(validation.status));
  }

  // ─── 1. 종합 요약 ───
  children.push(new Paragraph({ children: [new PageBreak()] }));
  children.push(sectionTitle('1. 종합 요약'));

  const summaryTable = new Table({
    rows: [
      new TableRow({ children: [headerCell('항목', 40), headerCell('결과', 60)] }),
      new TableRow({ children: [dataCell('병원명', true), dataCell(HOSPITAL_NAME)] }),
      new TableRow({ children: [dataCell('웹사이트', true), dataCell('http://talmostop.com')] }),
      new TableRow({ children: [dataCell('크롤 페이지', true), dataCell(`${pages.length}개`)] }),
      new TableRow({ children: [dataCell('의사', true), dataCell(`${doctors.length}명`)] }),
      new TableRow({ children: [dataCell('시술', true), dataCell(`${treatments.length}개`)] }),
      new TableRow({ children: [dataCell('장비', true), dataCell(`${equipments.length}개`)] }),
      new TableRow({ children: [dataCell('이벤트', true), dataCell(`${events.length}개`)] }),
      new TableRow({ children: [dataCell('크롤 버전', true), dataCell(validation?.crawl_version || '-')] }),
      new TableRow({ children: [dataCell('검증 상태', true), dataCell((validation?.status || '-').toUpperCase())] }),
      new TableRow({ children: [dataCell('커버리지', true), dataCell(`전체 ${validation?.overall_coverage || 0}% (장비 ${validation?.equipment_coverage || 0}% / 시술 ${validation?.treatment_coverage || 0}% / 의사 ${validation?.doctor_coverage || 0}%)`)] }),
      new TableRow({ children: [dataCell('Firecrawl 크레딧', true), dataCell('5')] }),
      new TableRow({ children: [dataCell('Gemini 호출', true), dataCell('6회')] }),
    ],
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
  });
  children.push(summaryTable);

  children.push(bodyText(''));
  children.push(labelValue('분석 방법', 'text → vision fallback (텍스트 분석 빈약 시 스크린샷 Vision 추가)'));
  children.push(labelValue('검증 방식', 'v5.3 2단계: Sanity Check (최소 기대치) + Gemini 커버리지'));
  children.push(labelValue('비고', '장비: 원본 사이트에 텍스트 없음 → 판정 제외(-1). 보강 크롤(/doctor)로 의사 1명 추출.'));

  // ─── 2. 크롤링 페이지 + 스크린샷 ───
  children.push(new Paragraph({ children: [new PageBreak()] }));
  children.push(sectionTitle('2. 크롤링 페이지 및 스크린샷'));
  children.push(bodyText(`총 ${pages.length}개 페이지 크롤 완료. 각 페이지별 다중 스크린샷(스크롤 4장) 캡처.`));

  let ssCount = 0;
  for (let pi = 0; pi < pages.length; pi++) {
    const p = pages[pi];
    children.push(subTitle(`페이지 ${pi + 1}: [${p.page_type}] ${p.url}`));
    children.push(labelValue('텍스트 길이', `${p.char_count.toLocaleString()}자`));
    children.push(labelValue('분석 방법', p.analysis_method));
    if (p.crawled_at) {
      children.push(labelValue('크롤 시각', new Date(p.crawled_at).toLocaleString('ko-KR')));
    }

    // 스크린샷 처리 (v5: JSONB 배열)
    let screenshots: Array<{ url: string; position: string; order: number }> = [];
    if (p.screenshot_url) {
      try {
        const parsed = typeof p.screenshot_url === 'string'
          ? JSON.parse(p.screenshot_url)
          : p.screenshot_url;
        if (Array.isArray(parsed)) {
          screenshots = parsed;
        } else if (typeof parsed === 'string' && parsed.startsWith('http')) {
          screenshots = [{ url: parsed, position: 'default', order: 0 }];
        }
      } catch {
        if (typeof p.screenshot_url === 'string' && p.screenshot_url.startsWith('http')) {
          screenshots = [{ url: p.screenshot_url, position: 'default', order: 0 }];
        }
      }
    }

    if (screenshots.length === 0) {
      children.push(bodyText('  (스크린샷 없음)', '999999'));
      continue;
    }

    console.log(`  📸 페이지 ${pi + 1} [${p.page_type}]: ${screenshots.length}장 다운로드 중...`);

    for (const ss of screenshots) {
      const pngBuf = await screenshotToPng(ss.url);
      if (pngBuf) {
        const posLabel: Record<string, string> = {
          popup: '팝업/상단', top: '상단', mid: '중단', bottom: '하단', default: '기본',
        };
        const caption = `[${p.page_type}] ${posLabel[ss.position] || ss.position} 스크린샷`;
        children.push(...imageBlock(pngBuf, 520, caption));
        ssCount++;
      } else {
        children.push(bodyText(`  (스크린샷 다운로드 실패: ${ss.position})`, 'CC0000'));
      }
    }
  }

  children.push(bodyText(`  총 ${ssCount}장 스크린샷 첨부 완료.`, '2B579A'));

  // ─── 3. 의료진 ───
  children.push(new Paragraph({ children: [new PageBreak()] }));
  children.push(sectionTitle(`3. 의료진 (${doctors.length}명)`));

  if (doctors.length === 0) {
    children.push(bodyText('추출된 의료진 데이터 없음.'));
  } else {
    for (const dr of doctors) {
      children.push(subTitle(`${dr.name} ${dr.title || ''}`));
      if (dr.specialty) children.push(labelValue('전문', dr.specialty));
      if (dr.education) {
        const edu = Array.isArray(dr.education) ? dr.education.join(' / ') : dr.education;
        children.push(labelValue('학력', edu));
      }
      if (dr.career) {
        const career = Array.isArray(dr.career) ? dr.career.join(' / ') : dr.career;
        children.push(labelValue('경력', career));
      }
      if (dr.academic_activity) {
        children.push(labelValue('학술활동', dr.academic_activity));
      }
      if (dr.notes) {
        children.push(labelValue('비고', dr.notes));
      }
    }
  }

  // ─── 4. 장비 ───
  children.push(sectionTitle(`4. 보유 장비 (${equipments.length}개)`));

  if (equipments.length === 0) {
    children.push(bodyText('추출된 장비 데이터 없음.'));
    children.push(bodyText('원본 사이트에 장비 정보가 텍스트로 존재하지 않음 (이미지 배너만 존재).', '888888'));
  } else {
    const eqRows: TableRow[] = [
      new TableRow({ children: [headerCell('장비명'), headerCell('카테고리'), headerCell('제조사')] }),
    ];
    for (const eq of equipments) {
      eqRows.push(new TableRow({
        children: [
          dataCell(eq.equipment_name, true),
          dataCell(eq.equipment_category),
          dataCell(eq.manufacturer || '-'),
        ],
      }));
    }
    children.push(new Table({
      rows: eqRows,
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.FIXED,
    }));
  }

  // ─── 5. 시술 메뉴 ───
  children.push(sectionTitle(`5. 시술 메뉴 (${treatments.length}개)`));

  if (treatments.length === 0) {
    children.push(bodyText('추출된 시술 데이터 없음.'));
  } else {
    const trRows: TableRow[] = [
      new TableRow({ children: [headerCell('시술명'), headerCell('카테고리'), headerCell('가격'), headerCell('프로모션')] }),
    ];
    for (const tr of treatments) {
      const price = tr.price ? `₩${Number(tr.price).toLocaleString()}` : '-';
      const note = tr.price_note ? ` (${tr.price_note})` : '';
      trRows.push(new TableRow({
        children: [
          dataCell(tr.treatment_name, true),
          dataCell(tr.treatment_category),
          dataCell(price + note),
          dataCell(tr.is_promoted ? 'O 프로모션' : '-'),
        ],
      }));
    }
    children.push(new Table({
      rows: trRows,
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.FIXED,
    }));
  }

  // ─── 6. 이벤트 ───
  children.push(sectionTitle(`6. 이벤트/프로모션 (${events.length}개)`));

  if (events.length === 0) {
    children.push(bodyText('추출된 이벤트 데이터 없음.'));
  } else {
    for (const ev of events) {
      children.push(new Paragraph({
        children: [
          new TextRun({ text: `▸ ${ev.title}`, bold: true, size: 20, font: 'Malgun Gothic', color: '2B579A' }),
        ],
        spacing: { before: 120 },
      }));
      if (ev.discount_type || ev.discount_value) {
        children.push(labelValue('할인', `${ev.discount_type || ''} ${ev.discount_value || ''}`));
      }
      if (ev.description) {
        children.push(labelValue('설명', (ev.description as string).substring(0, 200)));
      }
      const related = (ev.related_treatments as string[]) || [];
      if (related.length > 0) {
        children.push(labelValue('관련 시술', related.join(', ')));
      }
    }
  }

  // ─── 7. 검증 결과 ───
  children.push(new Paragraph({ children: [new PageBreak()] }));
  children.push(sectionTitle('7. 검증 결과'));

  if (validation) {
    const vTable = new Table({
      rows: [
        new TableRow({ children: [headerCell('항목', 40), headerCell('결과', 60)] }),
        new TableRow({ children: [dataCell('크롤 버전', true), dataCell(validation.crawl_version)] }),
        new TableRow({ children: [dataCell('상태', true), dataCell(validation.status?.toUpperCase())] }),
        new TableRow({ children: [dataCell('장비 커버리지', true), dataCell(`${validation.equipment_coverage}%`)] }),
        new TableRow({ children: [dataCell('시술 커버리지', true), dataCell(`${validation.treatment_coverage}%`)] }),
        new TableRow({ children: [dataCell('의사 커버리지', true), dataCell(`${validation.doctor_coverage}%`)] }),
        new TableRow({ children: [dataCell('전체 커버리지', true), dataCell(`${validation.overall_coverage}%`)] }),
      ],
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.FIXED,
    });
    children.push(vTable);

    // 누락 항목
    if (validation.missing_equipments?.length > 0) {
      children.push(labelValue('누락 장비', validation.missing_equipments.join(', ')));
    }
    if (validation.missing_treatments?.length > 0) {
      children.push(labelValue('누락 시술', validation.missing_treatments.join(', ')));
    }
    if (validation.missing_doctors?.length > 0) {
      children.push(labelValue('누락 의사', validation.missing_doctors.join(', ')));
    }
    if (validation.issues?.length > 0) {
      children.push(subTitle('이슈'));
      for (const issue of validation.issues) {
        children.push(bodyText(`  - ${issue}`));
      }
    }

    // 검증 상세
    if (validation.validation_result) {
      children.push(subTitle('검증 상세'));
      const vr = validation.validation_result as Record<string, unknown>;
      if (vr.stage) children.push(labelValue('검증 단계', String(vr.stage)));
      if (vr.reason) children.push(labelValue('사유', String(vr.reason)));
    }
  } else {
    children.push(bodyText('검증 데이터 없음.'));
  }

  // ─── 8. v5.3 파이프라인 흐름 ───
  children.push(sectionTitle('8. v5.3 파이프라인 실행 흐름'));
  const flowSteps = [
    '1. URL 수집: mapUrl(2개) + HTML 링크 추출(63개) → 필터 후 3개',
    '2. 다중 스크린샷 크롤: 3페이지 × 4장 스크롤 = 12장 캡처',
    '3. Gemini 텍스트 분석: 3페이지 → 시술 6개, 의사 0명',
    '4. [1단계] Sanity Check: 의사 0명 → INSUFFICIENT',
    '5. [v5.2] 보강 크롤: /doctor 경로 발견 (8,254자)',
    '6. 보강 페이지 분석: 텍스트 빈약 → Vision 추가 → 의사 1명 추출',
    '7. 재검증: 의사 1명 + 시술 9개 → SUFFICIENT',
    '8. [2단계] Gemini 커버리지: 장비 -1%(판정 제외) / 시술 100% / 의사 100%',
    '9. 최종 판정: PASS (전체 100%)',
  ];
  for (const step of flowSteps) {
    children.push(bodyText(step));
  }

  children.push(bodyText(''));
  children.push(labelValue('총 크레딧', '5 (Firecrawl)'));
  children.push(labelValue('총 Gemini 호출', '6회 (텍스트 3 + Vision 1 + 보강 분석 1 + 커버리지 검증 1)'));

  // ─── 푸터 ───
  children.push(divider());
  children.push(new Paragraph({
    children: [new TextRun({
      text: 'MADMEDSALES | TORR RF 병원 데이터 수집 | Recrawl v5.3 보고서',
      size: 16, font: 'Malgun Gothic', color: '999999', italics: true,
    })],
    alignment: AlignmentType.CENTER,
  }));
  children.push(new Paragraph({
    children: [new TextRun({
      text: `생성일시: ${new Date().toLocaleString('ko-KR')} | Firecrawl + Gemini Flash + Gemini Vision`,
      size: 14, font: 'Malgun Gothic', color: 'BBBBBB',
    })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 40 },
  }));

  // ─── DOCX 빌드 ───
  const doc = new Document({
    sections: [{ children }],
  });

  const buffer = await Packer.toBuffer(doc);
  const outDir = path.resolve(__dirname, 'data');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.resolve(outDir, `안산엔비의원_v5.3_보고서_${new Date().toISOString().split('T')[0]}.docx`);
  fs.writeFileSync(outPath, buffer);

  console.log(`\n📄 보고서 저장 완료: ${outPath}`);
  console.log(`   파일 크기: ${(buffer.length / 1024).toFixed(1)}KB`);
  console.log(`   스크린샷: ${ssCount}장 첨부`);
}

main().catch(console.error);
