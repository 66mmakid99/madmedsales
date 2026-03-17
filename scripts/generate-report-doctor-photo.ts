/**
 * 의사 프로필 사진 캡처 구현 보고서 생성 (docx)
 * 실행: npx tsx scripts/generate-report-doctor-photo.ts
 */
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, BorderStyle, HeadingLevel, AlignmentType,
  TableOfContents, PageBreak, Tab,
} from 'docx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// 스타일 헬퍼
// ============================================================
const FONT = '맑은 고딕';
const FONT_CODE = 'Consolas';
const COLOR_PRIMARY = '1B3A5C';
const COLOR_ACCENT = '2E75B6';
const COLOR_GRAY = '666666';
const COLOR_LIGHT_BG = 'F2F6FA';
const COLOR_WHITE = 'FFFFFF';
const COLOR_HEADER_BG = '1B3A5C';
const COLOR_ROW_ALT = 'F7F9FC';

function heading1(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 400, after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: COLOR_ACCENT } },
    children: [new TextRun({ text, font: FONT, size: 28, bold: true, color: COLOR_PRIMARY })],
  });
}

function heading2(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 150 },
    children: [new TextRun({ text, font: FONT, size: 24, bold: true, color: COLOR_ACCENT })],
  });
}

function heading3(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 200, after: 100 },
    children: [new TextRun({ text, font: FONT, size: 22, bold: true, color: COLOR_PRIMARY })],
  });
}

function bodyText(text: string, opts?: { bold?: boolean; italic?: boolean; color?: string }): Paragraph {
  return new Paragraph({
    spacing: { after: 100, line: 340 },
    children: [new TextRun({
      text, font: FONT, size: 20,
      bold: opts?.bold, italics: opts?.italic, color: opts?.color,
    })],
  });
}

function bulletItem(text: string, level = 0): Paragraph {
  return new Paragraph({
    bullet: { level },
    spacing: { after: 60, line: 320 },
    children: [new TextRun({ text, font: FONT, size: 20 })],
  });
}

function codeBlock(lines: string[]): Paragraph[] {
  return lines.map((line, i) => new Paragraph({
    spacing: { after: 0, line: 260 },
    shading: { fill: COLOR_LIGHT_BG },
    indent: { left: 300 },
    children: [new TextRun({ text: line || ' ', font: FONT_CODE, size: 18, color: '333333' })],
  }));
}

function emptyLine(): Paragraph {
  return new Paragraph({ spacing: { after: 100 }, children: [] });
}

// ============================================================
// 테이블 헬퍼
// ============================================================
const BORDER_THIN = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const BORDERS_ALL = { top: BORDER_THIN, bottom: BORDER_THIN, left: BORDER_THIN, right: BORDER_THIN };

function headerCell(text: string, width?: number): TableCell {
  return new TableCell({
    width: width ? { size: width, type: WidthType.DXA } : undefined,
    shading: { fill: COLOR_HEADER_BG },
    borders: BORDERS_ALL,
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 60, after: 60 },
      children: [new TextRun({ text, font: FONT, size: 18, bold: true, color: COLOR_WHITE })],
    })],
  });
}

function dataCell(text: string, opts?: { bold?: boolean; shading?: string; font?: string; size?: number }): TableCell {
  return new TableCell({
    shading: opts?.shading ? { fill: opts.shading } : undefined,
    borders: BORDERS_ALL,
    children: [new Paragraph({
      spacing: { before: 40, after: 40 },
      indent: { left: 80 },
      children: [new TextRun({
        text, font: opts?.font || FONT, size: opts?.size || 18,
        bold: opts?.bold,
      })],
    })],
  });
}

// ============================================================
// 보고서 본문 생성
// ============================================================
async function generateReport(): Promise<void> {
  const children: Paragraph[] = [];

  // ── 표지 ──
  children.push(new Paragraph({ spacing: { before: 2000 }, children: [] }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [new TextRun({ text: 'MADMEDSALES', font: FONT, size: 32, bold: true, color: COLOR_ACCENT })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 100 },
    children: [new TextRun({ text: '의사 프로필 사진 캡처 및 DB 저장', font: FONT, size: 44, bold: true, color: COLOR_PRIMARY })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 60 },
    children: [new TextRun({ text: '구현 보고서', font: FONT, size: 32, color: COLOR_GRAY })],
  }));
  children.push(new Paragraph({ spacing: { before: 600 }, children: [] }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 60 },
    children: [new TextRun({ text: '작성일: 2026-03-02', font: FONT, size: 20, color: COLOR_GRAY })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 60 },
    children: [new TextRun({ text: '대상: recrawl-v5 파이프라인 확장', font: FONT, size: 20, color: COLOR_GRAY })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 60 },
    children: [new TextRun({ text: '상태: 구현 완료 (검증 대기)', font: FONT, size: 20, bold: true, color: COLOR_ACCENT })],
  }));
  children.push(new Paragraph({
    children: [new PageBreak()],
  }));

  // ── 1. 개요 ──
  children.push(heading1('1. 개요'));
  children.push(bodyText(
    '기존 recrawl-v5 파이프라인은 의사 정보(이름, 직함, 학력, 경력, 학술활동)를 텍스트로만 추출하고 있었다. ' +
    '의사 프로필 사진은 캡처/저장하지 않았으며, 모달 전체 스크린샷만 OCR용으로 사용 중이었다.',
  ));
  children.push(emptyLine());
  children.push(bodyText(
    '이번 작업에서는 의사 프로필 사진을 개별 캡처하여 Supabase Storage에 저장하고, ' +
    'DB의 photo_url 컬럼으로 연결하는 기능을 구현하였다.',
    { bold: true },
  ));

  // ── 2. 수정/생성 파일 목록 ──
  children.push(heading1('2. 수정/생성 파일 목록'));

  const fileTable = new Table({
    width: { size: 9500, type: WidthType.DXA },
    rows: [
      new TableRow({ children: [
        headerCell('#', 600), headerCell('파일', 4200), headerCell('유형', 1000), headerCell('변경 내용', 3700),
      ]}),
      new TableRow({ children: [
        dataCell('1'), dataCell('supabase/migrations/027_doctor_photo_url.sql', { font: FONT_CODE, size: 16 }),
        dataCell('신규'), dataCell('photo_url 컬럼 추가'),
      ]}),
      new TableRow({ children: [
        dataCell('2', { shading: COLOR_ROW_ALT }), dataCell('scripts/v5/types.ts', { shading: COLOR_ROW_ALT, font: FONT_CODE, size: 16 }),
        dataCell('수정', { shading: COLOR_ROW_ALT }), dataCell('DoctorV54, AnalysisResult에 photo_url 필드 추가', { shading: COLOR_ROW_ALT }),
      ]}),
      new TableRow({ children: [
        dataCell('3'), dataCell('scripts/v5/doctor-photo.ts', { font: FONT_CODE, size: 16 }),
        dataCell('신규'), dataCell('프로필 사진 추출 핵심 모듈 (~260줄)'),
      ]}),
      new TableRow({ children: [
        dataCell('4', { shading: COLOR_ROW_ALT }), dataCell('scripts/v5/doctor-modal.ts', { shading: COLOR_ROW_ALT, font: FONT_CODE, size: 16 }),
        dataCell('수정', { shading: COLOR_ROW_ALT }), dataCell('모달 캡처 시 사진 추출 연동', { shading: COLOR_ROW_ALT }),
      ]}),
      new TableRow({ children: [
        dataCell('5'), dataCell('scripts/recrawl-v5.ts', { font: FONT_CODE, size: 16 }),
        dataCell('수정'), dataCell('파이프라인 통합 (import, 매핑, fallback, DB 저장)'),
      ]}),
    ],
  });
  children.push(new Paragraph({ children: [] }));

  // ── 3. 파일별 상세 ──
  children.push(heading1('3. 파일별 상세'));

  // 3.1
  children.push(heading2('3.1 마이그레이션 — 027_doctor_photo_url.sql'));
  children.push(...codeBlock([
    'ALTER TABLE sales_hospital_doctors',
    '  ADD COLUMN IF NOT EXISTS photo_url TEXT;',
  ]));
  children.push(emptyLine());
  children.push(bulletItem('기존 데이터 영향 없음 (IF NOT EXISTS + nullable)'));
  children.push(bulletItem('이전 마이그레이션: 026_crm_equipment_source_tracking.sql'));

  // 3.2
  children.push(heading2('3.2 타입 정의 — types.ts'));
  children.push(bodyText('DoctorV54 인터페이스 (line 20):', { bold: true }));
  children.push(...codeBlock(['photo_url?: string | null;']));
  children.push(emptyLine());
  children.push(bodyText('AnalysisResult.doctors (line 185):', { bold: true }));
  children.push(...codeBlock(['photo_url?: string | null;']));
  children.push(emptyLine());
  children.push(bulletItem('양쪽 모두 optional nullable로 선언하여 하위 호환성 유지'));

  // 3.3
  children.push(heading2('3.3 핵심 모듈 — doctor-photo.ts'));
  children.push(bodyText('주요 함수 2개:', { bold: true }));

  const funcTable = new Table({
    width: { size: 9500, type: WidthType.DXA },
    rows: [
      new TableRow({ children: [
        headerCell('함수', 3500), headerCell('용도', 3000), headerCell('진입 조건', 3000),
      ]}),
      new TableRow({ children: [
        dataCell('extractModalDoctorPhoto()', { font: FONT_CODE, size: 16 }),
        dataCell('열린 모달에서 프로필 사진 1장 추출'),
        dataCell('모달이 이미 열린 상태 (Page 객체 전달)'),
      ]}),
      new TableRow({ children: [
        dataCell('extractDoctorPhotosFromPage()', { shading: COLOR_ROW_ALT, font: FONT_CODE, size: 16 }),
        dataCell('의사 목록 페이지에서 카드 기반 다수 추출', { shading: COLOR_ROW_ALT }),
        dataCell('모달 없거나 사진 못 찾은 경우', { shading: COLOR_ROW_ALT }),
      ]}),
    ],
  });

  children.push(emptyLine());
  children.push(heading3('이미지 식별 전략'));
  children.push(bodyText('1단계 — 셀렉터 기반 <img> 태그 탐색 (13개 패턴):', { bold: true }));
  children.push(...codeBlock([
    'img[class*="doctor"], img[class*="profile"], img[class*="photo"],',
    'img[class*="thumb"], .doctor-card img, .doctor-info img,',
    '.doctor-profile img, .staff-card img, .team-card img,',
    'img[alt*="원장"], img[alt*="의사"], img[alt*="doctor"], img[alt*="프로필"]',
  ]));
  children.push(emptyLine());
  children.push(bodyText('2단계 — CSS background-image fallback:', { bold: true }));
  children.push(...codeBlock([
    '[class*="doctor"], [class*="profile"], [class*="photo"],',
    '[class*="staff"], [class*="team"]',
  ]));
  children.push(emptyLine());
  children.push(bodyText('3단계 — element screenshot (최후 수단)', { bold: true }));

  children.push(emptyLine());
  children.push(heading3('검증 조건'));
  children.push(bulletItem('크기: 80px ≤ width ≤ 800px, 80px ≤ height ≤ 800px'));
  children.push(bulletItem('종횡비: 0.4 ~ 1.8'));
  children.push(bulletItem('제외 패턴: logo, icon, btn, arrow, bg, banner, sprite, favicon, badge, sns 등'));
  children.push(bulletItem('최소 파일 크기: 1,000 bytes'));

  children.push(emptyLine());
  children.push(heading3('최적화 및 저장'));
  children.push(bulletItem('sharp: 400px max width, WebP quality 85'));
  children.push(bulletItem('경로: hospital-screenshots/{hospitalId}/doctor_photo_{index}_{timestamp}.webp'));
  children.push(bulletItem('업로드: Supabase Storage hospital-screenshots 버킷 (upsert)'));

  // 3.4
  children.push(heading2('3.4 모달 연동 — doctor-modal.ts'));
  children.push(bulletItem('ModalCaptureResult에 photoUrl?: string 필드 추가'));
  children.push(bulletItem('extractModalDoctorPhoto import 추가'));
  children.push(bulletItem('모달 캡처 루프 내에서 사진 추출 호출'));
  children.push(bulletItem('로그 출력에 사진 추출 여부 표시: "✅ 1/3 홍길동 모달 캡처 + 사진"'));
  children.push(emptyLine());
  children.push(bodyText('처리 흐름:', { bold: true }));
  children.push(...codeBlock([
    '모달 열림 → 전체 스크린샷 → 이름 추출 → sharp 최적화 → Storage 업로드',
    '                                      → extractModalDoctorPhoto() 호출 [추가]',
    '→ captures.push({ ..., photoUrl })',
  ]));

  // 3.5
  children.push(heading2('3.5 파이프라인 통합 — recrawl-v5.ts'));
  children.push(bodyText('3가지 수정 지점:', { bold: true }));
  children.push(emptyLine());

  children.push(bodyText('(A) import 추가 (line 49):', { bold: true }));
  children.push(...codeBlock([
    "import { extractDoctorPhotosFromPage } from './v5/doctor-photo.js';",
  ]));

  children.push(emptyLine());
  children.push(bodyText('(B) 모달 결과 매핑:', { bold: true }));
  children.push(bulletItem('Vision 결과 의사와 기존 의사 매칭 시 cap.photoUrl → existing.photo_url 매핑'));
  children.push(bulletItem('새 의사 추가 시 photo_url: cap.photoUrl || null 포함'));
  children.push(bulletItem('Vision 결과 없어도 이름 매칭으로 사진 연결 (fallback)'));

  children.push(emptyLine());
  children.push(bodyText('(C) 비모달 fallback (의사 이름 검증 직전에 삽입):', { bold: true }));
  children.push(bulletItem('사진 없는 의사 존재 시 doctor 페이지에서 extractDoctorPhotosFromPage() 호출'));
  children.push(bulletItem('이름 매칭으로 photo_url 연결'));

  children.push(emptyLine());
  children.push(bodyText('(D) DB 저장 (saveAnalysis 함수):', { bold: true }));
  children.push(...codeBlock(['photo_url: dr.photo_url || null,']));

  // ── 4. 전체 데이터 흐름 ──
  children.push(new Paragraph({ children: [new PageBreak()] }));
  children.push(heading1('4. 전체 데이터 흐름'));
  children.push(...codeBlock([
    '의사 페이지 감지',
    '  │',
    '  ├─ [경력/학력 비율 30% 미만] → 모달 보강 필요',
    '  │   └─ crawlDoctorModals()',
    '  │       └─ 각 모달에서:',
    '  │           ├─ 전체 스크린샷 → Vision 분석 (기존)',
    '  │           └─ extractModalDoctorPhoto() → photoUrl (신규)',
    '  │       └─ Vision 결과 병합 시 cap.photoUrl → doctor.photo_url',
    '  │',
    '  ├─ [사진 없는 의사 잔존] → 페이지 직접 추출',
    '  │   └─ extractDoctorPhotosFromPage()',
    '  │       ├─ 카드 컨테이너 탐색 → 카드별 img + 이름 매칭',
    '  │       └─ 카드 없으면 → 페이지 전체 후보 순서 매칭',
    '  │',
    '  └─ saveAnalysis()',
    '      └─ sales_hospital_doctors INSERT (photo_url 포함)',
  ]));

  // ── 5. 기술 스택 ──
  children.push(heading1('5. 기술 스택 활용'));

  const techTable = new Table({
    width: { size: 9500, type: WidthType.DXA },
    rows: [
      new TableRow({ children: [
        headerCell('기술', 2000), headerCell('용도', 4500), headerCell('비고', 3000),
      ]}),
      new TableRow({ children: [
        dataCell('Puppeteer'), dataCell('페이지 방문, DOM 탐색, element screenshot'), dataCell('기존 의존성'),
      ]}),
      new TableRow({ children: [
        dataCell('sharp', { shading: COLOR_ROW_ALT }), dataCell('이미지 리사이즈, WebP 변환', { shading: COLOR_ROW_ALT }),
        dataCell('기존 의존성 (v0.34.5)', { shading: COLOR_ROW_ALT }),
      ]}),
      new TableRow({ children: [
        dataCell('Supabase Storage'), dataCell('사진 파일 저장, public URL 생성'), dataCell('기존 hospital-screenshots 버킷'),
      ]}),
      new TableRow({ children: [
        dataCell('TypeScript', { shading: COLOR_ROW_ALT }), dataCell('타입 안전성', { shading: COLOR_ROW_ALT }),
        dataCell('컴파일 확인 완료', { shading: COLOR_ROW_ALT }),
      ]}),
    ],
  });

  // ── 6. 검증 방법 ──
  children.push(heading1('6. 검증 방법'));

  children.push(heading2('6.1 마이그레이션 실행'));
  children.push(...codeBlock(['supabase db push', '# 또는 Supabase SQL Editor에서 직접 실행']));

  children.push(heading2('6.2 단일 병원 테스트'));
  children.push(...codeBlock(['npx tsx scripts/recrawl-v5.ts --name "테스트병원" --ocr']));

  children.push(heading2('6.3 DB 확인'));
  children.push(...codeBlock([
    'SELECT name, photo_url',
    'FROM sales_hospital_doctors',
    'WHERE photo_url IS NOT NULL',
    'ORDER BY created_at DESC',
    'LIMIT 20;',
  ]));

  children.push(heading2('6.4 Storage 확인'));
  children.push(bulletItem('Supabase 대시보드 → Storage → hospital-screenshots 버킷'));
  children.push(bulletItem('doctor_photo_* 패턴 파일 존재 여부 확인'));

  // ── 7. 리스크 ──
  children.push(heading1('7. 리스크 및 제한 사항'));

  const riskTable = new Table({
    width: { size: 9500, type: WidthType.DXA },
    rows: [
      new TableRow({ children: [
        headerCell('항목', 2000), headerCell('설명', 4000), headerCell('대응', 3500),
      ]}),
      new TableRow({ children: [
        dataCell('사진 미탐지'), dataCell('비표준 마크업 사이트에서 셀렉터 불일치'),
        dataCell('13개 셀렉터 + bg-image + screenshot 3단계 fallback'),
      ]}),
      new TableRow({ children: [
        dataCell('이름 매칭 실패', { shading: COLOR_ROW_ALT }),
        dataCell('카드 텍스트에 의사 이름 없는 경우', { shading: COLOR_ROW_ALT }),
        dataCell('순서 기반 매칭 fallback', { shading: COLOR_ROW_ALT }),
      ]}),
      new TableRow({ children: [
        dataCell('대용량 이미지'), dataCell('원본 사이즈 과대'),
        dataCell('sharp 400px 리사이즈 + WebP 압축'),
      ]}),
      new TableRow({ children: [
        dataCell('Puppeteer 추가 실행', { shading: COLOR_ROW_ALT }),
        dataCell('비모달 경로에서 브라우저 추가 기동', { shading: COLOR_ROW_ALT }),
        dataCell('photo 없는 의사 존재할 때만 실행', { shading: COLOR_ROW_ALT }),
      ]}),
      new TableRow({ children: [
        dataCell('기존 데이터'), dataCell('photo_url NULL 상태'),
        dataCell('nullable 컬럼이므로 기존 데이터 영향 없음'),
      ]}),
    ],
  });

  // ── 8. 향후 개선 ──
  children.push(heading1('8. 향후 개선 가능 사항'));
  children.push(bulletItem('얼굴 인식 API 연동으로 사진 품질 검증 강화'));
  children.push(bulletItem('사진 중복 업로드 방지 (content hash 비교)'));
  children.push(bulletItem('사진 CDN 캐싱 최적화'));
  children.push(bulletItem('CRM 대시보드에서 의사 프로필 사진 표시'));

  // ── Document 조립 ──
  // 테이블들을 적절한 위치에 삽입하기 위해 sections 사용
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
        page: {
          margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
        },
      },
      children: [
        // 표지
        ...children.slice(0, children.indexOf(children.find(c => c === children[0])!) + 9),
        // 1. 개요
        ...children.slice(9, 13),
        // 2. 파일 목록
        children[13], // heading
        fileTable,
        emptyLine(),
        // 3. 파일별 상세
        ...children.slice(14, 36),
        // 함수 테이블
        funcTable,
        ...children.slice(36, children.length - 4),
        // 기술 스택 테이블
        techTable,
        emptyLine(),
        // 6~7
        ...children.slice(children.length - 4),
        // 리스크 테이블
        riskTable,
        emptyLine(),
      ],
    }],
  });

  // 위 방식이 복잡하므로, 단순하게 재구성
  const doc2 = new Document({
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
        page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } },
      },
      children: buildAllContent(),
    }],
  });

  const outPath = path.resolve(__dirname, '../docs/REPORT-doctor-photo-implementation.docx');
  const buffer = await Packer.toBuffer(doc2);
  fs.writeFileSync(outPath, buffer);
  console.log(`보고서 생성 완료: ${outPath}`);
}

function buildAllContent(): (Paragraph | Table)[] {
  const c: (Paragraph | Table)[] = [];

  // ═══ 표지 ═══
  c.push(new Paragraph({ spacing: { before: 2400 }, children: [] }));
  c.push(new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 300 },
    children: [new TextRun({ text: 'MADMEDSALES', font: FONT, size: 36, bold: true, color: COLOR_ACCENT })],
  }));
  c.push(new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 200 },
    children: [new TextRun({ text: '의사 프로필 사진 캡처 및 DB 저장', font: FONT, size: 48, bold: true, color: COLOR_PRIMARY })],
  }));
  c.push(new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 100 },
    children: [new TextRun({ text: '구현 보고서', font: FONT, size: 36, color: COLOR_GRAY })],
  }));
  c.push(new Paragraph({ spacing: { before: 800 }, children: [] }));

  const metaLines = [
    ['작성일', '2026-03-02'],
    ['대상', 'recrawl-v5 파이프라인 확장'],
    ['상태', '구현 완료 (검증 대기)'],
  ];
  for (const [k, v] of metaLines) {
    c.push(new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { after: 80 },
      children: [
        new TextRun({ text: `${k}: `, font: FONT, size: 22, bold: true, color: COLOR_GRAY }),
        new TextRun({ text: v, font: FONT, size: 22, color: k === '상태' ? COLOR_ACCENT : COLOR_GRAY, bold: k === '상태' }),
      ],
    }));
  }

  c.push(new Paragraph({ children: [new PageBreak()] }));

  // ═══ 1. 개요 ═══
  c.push(heading1('1. 개요'));
  c.push(bodyText(
    '기존 recrawl-v5 파이프라인은 의사 정보(이름, 직함, 학력, 경력, 학술활동)를 텍스트로만 추출하고 있었다. ' +
    '의사 프로필 사진은 캡처/저장하지 않았으며, 모달 전체 스크린샷만 OCR용으로 사용 중이었다.',
  ));
  c.push(emptyLine());
  c.push(bodyText(
    '이번 작업에서는 의사 프로필 사진을 개별 캡처하여 Supabase Storage에 저장하고, ' +
    'DB의 photo_url 컬럼으로 연결하는 기능을 구현하였다.',
    { bold: true },
  ));

  // ═══ 2. 파일 목록 ═══
  c.push(heading1('2. 수정/생성 파일 목록'));
  c.push(new Table({
    width: { size: 9500, type: WidthType.DXA },
    rows: [
      new TableRow({ children: [
        headerCell('#', 600), headerCell('파일', 4200), headerCell('유형', 900), headerCell('변경 내용', 3800),
      ]}),
      ...([
        ['1', 'supabase/migrations/027_doctor_photo_url.sql', '신규', 'photo_url 컬럼 추가'],
        ['2', 'scripts/v5/types.ts', '수정', 'DoctorV54, AnalysisResult에 photo_url 필드 추가'],
        ['3', 'scripts/v5/doctor-photo.ts', '신규', '프로필 사진 추출 핵심 모듈 (~260줄)'],
        ['4', 'scripts/v5/doctor-modal.ts', '수정', '모달 캡처 시 사진 추출 연동'],
        ['5', 'scripts/recrawl-v5.ts', '수정', '파이프라인 통합 (import, 매핑, fallback, DB 저장)'],
      ] as const).map(([n, file, type, desc], i) => new TableRow({ children: [
        dataCell(n, { shading: i % 2 ? COLOR_ROW_ALT : undefined }),
        dataCell(file, { font: FONT_CODE, size: 16, shading: i % 2 ? COLOR_ROW_ALT : undefined }),
        dataCell(type, { shading: i % 2 ? COLOR_ROW_ALT : undefined }),
        dataCell(desc, { shading: i % 2 ? COLOR_ROW_ALT : undefined }),
      ]})),
    ],
  }));
  c.push(emptyLine());

  // ═══ 3. 파일별 상세 ═══
  c.push(heading1('3. 파일별 상세'));

  // 3.1
  c.push(heading2('3.1 마이그레이션 — 027_doctor_photo_url.sql'));
  c.push(...codeBlock([
    'ALTER TABLE sales_hospital_doctors',
    '  ADD COLUMN IF NOT EXISTS photo_url TEXT;',
  ]));
  c.push(emptyLine());
  c.push(bulletItem('기존 데이터 영향 없음 (IF NOT EXISTS + nullable)'));
  c.push(bulletItem('이전 마이그레이션: 026_crm_equipment_source_tracking.sql'));

  // 3.2
  c.push(heading2('3.2 타입 정의 — types.ts'));
  c.push(bodyText('DoctorV54 인터페이스 (line 20):', { bold: true }));
  c.push(...codeBlock(['photo_url?: string | null;']));
  c.push(emptyLine());
  c.push(bodyText('AnalysisResult.doctors (line 185):', { bold: true }));
  c.push(...codeBlock(['photo_url?: string | null;']));
  c.push(emptyLine());
  c.push(bulletItem('양쪽 모두 optional nullable로 선언하여 하위 호환성 유지'));

  // 3.3
  c.push(heading2('3.3 핵심 모듈 — doctor-photo.ts'));
  c.push(bodyText('주요 함수:', { bold: true }));
  c.push(new Table({
    width: { size: 9500, type: WidthType.DXA },
    rows: [
      new TableRow({ children: [
        headerCell('함수', 3500), headerCell('용도', 3000), headerCell('진입 조건', 3000),
      ]}),
      new TableRow({ children: [
        dataCell('extractModalDoctorPhoto()', { font: FONT_CODE, size: 16 }),
        dataCell('열린 모달에서 프로필 사진 1장 추출'),
        dataCell('모달이 이미 열린 상태'),
      ]}),
      new TableRow({ children: [
        dataCell('extractDoctorPhotosFromPage()', { shading: COLOR_ROW_ALT, font: FONT_CODE, size: 16 }),
        dataCell('의사 목록 페이지에서 카드 기반 다수 추출', { shading: COLOR_ROW_ALT }),
        dataCell('모달 없거나 사진 못 찾은 경우', { shading: COLOR_ROW_ALT }),
      ]}),
    ],
  }));
  c.push(emptyLine());

  c.push(heading3('이미지 식별 전략'));
  c.push(bodyText('1단계 — 셀렉터 기반 <img> 태그 탐색 (13개 패턴):', { bold: true }));
  c.push(...codeBlock([
    'img[class*="doctor"], img[class*="profile"], img[class*="photo"],',
    'img[class*="thumb"], .doctor-card img, .doctor-info img,',
    '.doctor-profile img, .staff-card img, .team-card img,',
    'img[alt*="원장"], img[alt*="의사"], img[alt*="doctor"], img[alt*="프로필"]',
  ]));
  c.push(emptyLine());
  c.push(bodyText('2단계 — CSS background-image fallback:', { bold: true }));
  c.push(...codeBlock([
    '[class*="doctor"], [class*="profile"], [class*="photo"],',
    '[class*="staff"], [class*="team"]',
  ]));
  c.push(emptyLine());
  c.push(bodyText('3단계 — element screenshot (최후 수단)', { bold: true }));
  c.push(emptyLine());

  c.push(heading3('검증 조건'));
  c.push(bulletItem('크기: 80px ≤ width ≤ 800px, 80px ≤ height ≤ 800px'));
  c.push(bulletItem('종횡비: 0.4 ~ 1.8'));
  c.push(bulletItem('제외 패턴: logo, icon, btn, arrow, bg, banner, sprite, favicon, badge, sns 등'));
  c.push(bulletItem('최소 파일 크기: 1,000 bytes'));
  c.push(emptyLine());

  c.push(heading3('최적화 및 저장'));
  c.push(bulletItem('sharp: 400px max width, WebP quality 85'));
  c.push(bulletItem('경로: hospital-screenshots/{hospitalId}/doctor_photo_{index}_{timestamp}.webp'));
  c.push(bulletItem('업로드: Supabase Storage hospital-screenshots 버킷 (upsert)'));

  // 3.4
  c.push(heading2('3.4 모달 연동 — doctor-modal.ts'));
  c.push(bulletItem('ModalCaptureResult에 photoUrl?: string 필드 추가'));
  c.push(bulletItem('extractModalDoctorPhoto import 추가'));
  c.push(bulletItem('모달 캡처 루프 내에서 사진 추출 호출'));
  c.push(bulletItem('로그 출력에 사진 추출 여부 표시'));
  c.push(emptyLine());
  c.push(bodyText('처리 흐름:', { bold: true }));
  c.push(...codeBlock([
    '모달 열림 → 전체 스크린샷 → 이름 추출 → sharp 최적화 → Storage 업로드',
    '                                      → extractModalDoctorPhoto() 호출 [추가]',
    '→ captures.push({ ..., photoUrl })',
  ]));

  // 3.5
  c.push(heading2('3.5 파이프라인 통합 — recrawl-v5.ts'));
  c.push(bodyText('4가지 수정 지점:', { bold: true }));
  c.push(emptyLine());
  c.push(bodyText('(A) import 추가 (line 49):', { bold: true }));
  c.push(...codeBlock(["import { extractDoctorPhotosFromPage } from './v5/doctor-photo.js';"]));
  c.push(emptyLine());
  c.push(bodyText('(B) 모달 결과 매핑:', { bold: true }));
  c.push(bulletItem('Vision 결과 의사와 기존 의사 매칭 시 cap.photoUrl → existing.photo_url 매핑'));
  c.push(bulletItem('새 의사 추가 시 photo_url: cap.photoUrl || null 포함'));
  c.push(bulletItem('Vision 결과 없어도 이름 매칭으로 사진 연결 (fallback)'));
  c.push(emptyLine());
  c.push(bodyText('(C) 비모달 fallback:', { bold: true }));
  c.push(bulletItem('사진 없는 의사 존재 시 doctor 페이지에서 extractDoctorPhotosFromPage() 호출'));
  c.push(bulletItem('이름 매칭으로 photo_url 연결'));
  c.push(emptyLine());
  c.push(bodyText('(D) DB 저장 — saveAnalysis 함수:', { bold: true }));
  c.push(...codeBlock(['photo_url: dr.photo_url || null,']));

  // ═══ 4. 데이터 흐름 ═══
  c.push(new Paragraph({ children: [new PageBreak()] }));
  c.push(heading1('4. 전체 데이터 흐름'));
  c.push(...codeBlock([
    '의사 페이지 감지',
    '  │',
    '  ├─ [경력/학력 비율 30% 미만] → 모달 보강 필요',
    '  │   └─ crawlDoctorModals()',
    '  │       └─ 각 모달에서:',
    '  │           ├─ 전체 스크린샷 → Vision 분석 (기존)',
    '  │           └─ extractModalDoctorPhoto() → photoUrl (신규)',
    '  │       └─ Vision 결과 병합 시 cap.photoUrl → doctor.photo_url',
    '  │',
    '  ├─ [사진 없는 의사 잔존] → 페이지 직접 추출',
    '  │   └─ extractDoctorPhotosFromPage()',
    '  │       ├─ 카드 컨테이너 탐색 → 카드별 img + 이름 매칭',
    '  │       └─ 카드 없으면 → 페이지 전체 후보 순서 매칭',
    '  │',
    '  └─ saveAnalysis()',
    '      └─ sales_hospital_doctors INSERT (photo_url 포함)',
  ]));

  // ═══ 5. 기술 스택 ═══
  c.push(heading1('5. 기술 스택 활용'));
  c.push(new Table({
    width: { size: 9500, type: WidthType.DXA },
    rows: [
      new TableRow({ children: [
        headerCell('기술', 2000), headerCell('용도', 4500), headerCell('비고', 3000),
      ]}),
      ...([
        ['Puppeteer', '페이지 방문, DOM 탐색, element screenshot', '기존 의존성'],
        ['sharp', '이미지 리사이즈, WebP 변환', '기존 의존성 (v0.34.5)'],
        ['Supabase Storage', '사진 파일 저장, public URL 생성', '기존 hospital-screenshots 버킷'],
        ['TypeScript', '타입 안전성', '컴파일 확인 완료'],
      ] as const).map(([tech, usage, note], i) => new TableRow({ children: [
        dataCell(tech, { shading: i % 2 ? COLOR_ROW_ALT : undefined }),
        dataCell(usage, { shading: i % 2 ? COLOR_ROW_ALT : undefined }),
        dataCell(note, { shading: i % 2 ? COLOR_ROW_ALT : undefined }),
      ]})),
    ],
  }));
  c.push(emptyLine());

  // ═══ 6. 검증 ═══
  c.push(heading1('6. 검증 방법'));
  c.push(heading2('6.1 마이그레이션 실행'));
  c.push(...codeBlock(['supabase db push', '# 또는 Supabase SQL Editor에서 직접 실행']));
  c.push(heading2('6.2 단일 병원 테스트'));
  c.push(...codeBlock(['npx tsx scripts/recrawl-v5.ts --name "테스트병원" --ocr']));
  c.push(heading2('6.3 DB 확인'));
  c.push(...codeBlock([
    'SELECT name, photo_url',
    'FROM sales_hospital_doctors',
    'WHERE photo_url IS NOT NULL',
    'ORDER BY created_at DESC',
    'LIMIT 20;',
  ]));
  c.push(heading2('6.4 Storage 확인'));
  c.push(bulletItem('Supabase 대시보드 → Storage → hospital-screenshots 버킷'));
  c.push(bulletItem('doctor_photo_* 패턴 파일 존재 여부 확인'));

  // ═══ 7. 리스크 ═══
  c.push(heading1('7. 리스크 및 제한 사항'));
  c.push(new Table({
    width: { size: 9500, type: WidthType.DXA },
    rows: [
      new TableRow({ children: [
        headerCell('항목', 2000), headerCell('설명', 4000), headerCell('대응', 3500),
      ]}),
      ...([
        ['사진 미탐지', '비표준 마크업 사이트에서 셀렉터 불일치', '13개 셀렉터 + bg-image + screenshot 3단계 fallback'],
        ['이름 매칭 실패', '카드 텍스트에 의사 이름 없는 경우', '순서 기반 매칭 fallback'],
        ['대용량 이미지', '원본 사이즈 과대', 'sharp 400px 리사이즈 + WebP 압축'],
        ['Puppeteer 추가 실행', '비모달 경로에서 브라우저 추가 기동', 'photo 없는 의사 존재할 때만 실행'],
        ['기존 데이터', 'photo_url NULL 상태', 'nullable 컬럼이므로 영향 없음'],
      ] as const).map(([item, desc, resp], i) => new TableRow({ children: [
        dataCell(item, { shading: i % 2 ? COLOR_ROW_ALT : undefined }),
        dataCell(desc, { shading: i % 2 ? COLOR_ROW_ALT : undefined }),
        dataCell(resp, { shading: i % 2 ? COLOR_ROW_ALT : undefined }),
      ]})),
    ],
  }));
  c.push(emptyLine());

  // ═══ 8. 향후 ═══
  c.push(heading1('8. 향후 개선 가능 사항'));
  c.push(bulletItem('얼굴 인식 API 연동으로 사진 품질 검증 강화'));
  c.push(bulletItem('사진 중복 업로드 방지 (content hash 비교)'));
  c.push(bulletItem('사진 CDN 캐싱 최적화'));
  c.push(bulletItem('CRM 대시보드에서 의사 프로필 사진 표시'));

  return c;
}

generateReport().catch(console.error);
