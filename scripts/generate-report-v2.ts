/**
 * v2 보고서 생성기
 *
 * 병원별 분석 결과를 새로운 폴더 구조로 패키징:
 *   output/reports/{날짜}-{병원명}-{테스트명}-{분류번호}/
 *     ├── {날짜}-{병원명}-{테스트명}-{분류번호}.md
 *     ├── {날짜}-{병원명}-{테스트명}-{분류번호}.docx
 *     ├── {날짜}-{병원명}-{테스트명}-{분류번호}_raw.txt
 *     └── captures/
 *         ├── page_1_main_001.png
 *         └── ...
 *
 * 실행:
 *   npx tsx scripts/generate-report-v2.ts                    # 전체 병원
 *   npx tsx scripts/generate-report-v2.ts --name "파라다이스"  # 특정 병원
 *   npx tsx scripts/generate-report-v2.ts --test-name "v57"   # 테스트명 지정
 *
 * v2.0 - 2026-02-27
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.env') });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.resolve(__dirname, '..', 'output');
const REPORTS_DIR = path.resolve(OUTPUT_DIR, 'reports');

// ═══════════════════════════════════════════
// 타입
// ═══════════════════════════════════════════

interface AnalysisData {
  hospital_name: string;
  doctors: Array<{
    name: string;
    title?: string;
    specialty?: string;
    career?: string[];
    education?: string[];
    certifications?: string[];
    confidence?: string;
  }>;
  medical_devices: Array<{
    name: string;
    korean_name?: string;
    manufacturer?: string;
    device_type: string;
    subcategory: string;
    description?: string;
    source?: string;
  }>;
  treatments: Array<{
    name: string;
    category?: string;
    regular_price?: number | null;
    event_price?: number | null;
    min_price?: number | null;
    max_price?: number | null;
    price_type?: string | null;
    quantity?: string | null;
    unit?: string | null;
    source?: string;
    body_part?: string | null;
    session_info?: string | null;
    is_package?: boolean;
  }>;
  events: Array<{
    title: string;
    type?: string;
    period?: string;
    discount_info?: string;
    original_price?: number | null;
    event_price?: number | null;
    conditions?: string[];
    source?: string;
  }>;
  contact_info?: {
    email?: string[];
    phone?: Array<string | { number: string }>;
    address?: string;
    kakao_channel?: string;
    naver_booking?: string;
    naver_place?: string;
    instagram?: string;
    facebook?: string;
    youtube?: string;
    blog?: string;
    website_url?: string;
    operating_hours?: string;
  };
  clinic_categories?: Array<{
    name: string;
    treatments?: string[];
  }>;
  unregistered_equipment?: Array<{
    name: string;
    korean_name?: string;
    suggested_category?: string;
    source?: string;
    reason?: string;
  }>;
  unregistered_treatments?: Array<{
    name: string;
    source?: string;
    context?: string;
  }>;
  raw_price_texts?: string[];
  extraction_summary?: Record<string, unknown>;
}

interface OcrEntry {
  source: string;
  text: string;
}

interface SalesProfile {
  overallScore: number;
  grade: 'S' | 'A' | 'B' | 'C';
  axisScores: { investment: number; portfolio: number; scale: number; marketing: number };
  primaryAngle: { angle: string; score: number; reason: string };
  salesAngles: Array<{ angle: string; score: number; reason: string }>;
  rfDevices: string[];
  hifuDevices: string[];
  liftingTreatmentCount: number;
  avgPrice: number | null;
  snsChannels: string[];
  hasTorrRf: boolean;
}

interface ReportInput {
  hospitalId: string;
  hospitalName: string;
  analysis: AnalysisData;
  ocrRaw: OcrEntry[];
  coverageRaw: string | null;
  sales: SalesProfile | null;
}

interface ReportConfig {
  testName: string;
  date: string;
}

// ═══════════════════════════════════════════
// 유틸
// ═══════════════════════════════════════════

/** 파일명에 안전한 문자열로 변환 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, '_')
    .trim();
}

/** 분류번호 생성 (3자리 zero-pad) */
function makeSeqNo(index: number): string {
  return String(index + 1).padStart(3, '0');
}

/** 보고서 폴더명 생성 */
function makeReportDirName(config: ReportConfig, hospitalName: string, seqNo: string): string {
  const safeName = sanitizeFilename(hospitalName);
  return `${config.date}-${safeName}-${config.testName}-${seqNo}`;
}

// ═══════════════════════════════════════════
// 1. Raw 데이터 TXT 생성
// ═══════════════════════════════════════════

function buildRawDataTxt(input: ReportInput): string {
  const lines: string[] = [];
  const { analysis, ocrRaw, coverageRaw } = input;

  lines.push('═══════════════════════════════════════════════════');
  lines.push(`  ${input.hospitalName} — 추출 원본 데이터`);
  lines.push('═══════════════════════════════════════════════════');
  lines.push('');

  // 1. 분석 결과 JSON (전체)
  lines.push('──── [1] analysis.json (Gemini 분류 결과) ────');
  lines.push(JSON.stringify(analysis, null, 2));
  lines.push('');

  // 2. OCR 원본
  if (ocrRaw.length > 0) {
    lines.push('──── [2] ocr_raw.json (이미지 OCR 원본) ────');
    for (const entry of ocrRaw) {
      lines.push(`\n--- ${entry.source} ---`);
      lines.push(entry.text);
    }
    lines.push('');
  }

  // 3. 커버리지 검증 원본
  if (coverageRaw) {
    lines.push('──── [3] coverage_raw.txt (커버리지 검증 로그) ────');
    lines.push(coverageRaw);
    lines.push('');
  }

  return lines.join('\n');
}

// ═══════════════════════════════════════════
// 2. 마크다운 보고서 생성
// ═══════════════════════════════════════════

const ANGLE_LABELS: Record<string, string> = {
  upgrade: '업그레이드',
  portfolio_expand: '포트폴리오 확장',
  premium: '프리미엄 포지셔닝',
  cost_efficiency: '비용 효율',
  new_adoption: '신규 도입',
};

function fmtPrice(p: number | null | undefined): string {
  if (!p) return '-';
  return `${p.toLocaleString()}원`;
}

function buildMarkdownReport(input: ReportInput, config: ReportConfig): string {
  const { analysis, sales } = input;
  const L: string[] = [];

  // ────────────────────────────
  // 헤더
  // ────────────────────────────
  L.push(`# ${input.hospitalName}`);
  L.push('');
  L.push(`| 항목 | 내용 |`);
  L.push(`|------|------|`);
  L.push(`| 생성일 | ${config.date} |`);
  L.push(`| 테스트 | ${config.testName} |`);
  if (sales) {
    L.push(`| 등급 | **${sales.grade}** (${sales.overallScore}점) |`);
    L.push(`| 추천 앵글 | ${ANGLE_LABELS[sales.primaryAngle.angle] || sales.primaryAngle.angle} |`);
  }
  const ci = analysis.contact_info;
  if (ci?.website_url) L.push(`| 웹사이트 | ${ci.website_url} |`);
  if (ci?.address) {
    const addr = typeof ci.address === 'string' ? ci.address : (ci.address as { full_address?: string }).full_address || '';
    if (addr) L.push(`| 주소 | ${addr} |`);
  }
  L.push('');

  // ────────────────────────────
  // 1. 세일즈 브리핑
  // ────────────────────────────
  if (sales) {
    L.push('---');
    L.push('');
    L.push('## 1. 세일즈 브리핑');
    L.push('');

    // 4축 스코어 바
    const ax = sales.axisScores;
    L.push('### 4축 프로파일');
    L.push('');
    L.push(`| 축 | 점수 | 바 |`);
    L.push(`|-----|------|-----|`);
    L.push(`| 투자성향 (35%) | ${ax.investment} | ${'█'.repeat(Math.round(ax.investment / 5))}${'░'.repeat(20 - Math.round(ax.investment / 5))} |`);
    L.push(`| 포트폴리오 (25%) | ${ax.portfolio} | ${'█'.repeat(Math.round(ax.portfolio / 5))}${'░'.repeat(20 - Math.round(ax.portfolio / 5))} |`);
    L.push(`| 규모 (25%) | ${ax.scale} | ${'█'.repeat(Math.round(ax.scale / 5))}${'░'.repeat(20 - Math.round(ax.scale / 5))} |`);
    L.push(`| 마케팅 (15%) | ${ax.marketing} | ${'█'.repeat(Math.round(ax.marketing / 5))}${'░'.repeat(20 - Math.round(ax.marketing / 5))} |`);
    L.push('');

    // 앵글
    L.push('### 추천 영업 앵글');
    L.push('');
    for (let i = 0; i < sales.salesAngles.length; i++) {
      const sa = sales.salesAngles[i];
      const label = ANGLE_LABELS[sa.angle] || sa.angle;
      const prefix = i === 0 ? '**[1순위]**' : `[${i + 1}순위]`;
      L.push(`- ${prefix} **${label}** (${sa.score}점)`);
      L.push(`  - ${sa.reason}`);
    }
    L.push('');

    // TORR RF 현황
    if (sales.hasTorrRf) {
      L.push('> **TORR RF 이미 보유** — 소모품/추가기 영업 또는 다른 지점 확대 타겟');
    }
    L.push('');
  }

  // ────────────────────────────
  // 2. 장비 현황
  // ────────────────────────────
  const devices = (analysis.medical_devices || []).filter(d => d.device_type === 'device');
  const injectables = (analysis.medical_devices || []).filter(d => d.device_type === 'injectable');

  if (devices.length > 0 || injectables.length > 0) {
    L.push('---');
    L.push('');
    L.push('## 2. 장비 현황');
    L.push('');
  }

  if (devices.length > 0) {
    // 카테고리별 그룹핑
    const grouped = new Map<string, typeof devices>();
    for (const d of devices) {
      const cat = d.subcategory || 'other';
      if (!grouped.has(cat)) grouped.set(cat, []);
      grouped.get(cat)!.push(d);
    }

    const catOrder = ['RF_TIGHTENING', 'HIFU', 'RF_MICRONEEDLE', 'LASER', 'IPL', 'BODY', 'SKINBOOSTER', 'OTHER_DEVICE'];
    const catLabels: Record<string, string> = {
      RF_TIGHTENING: 'RF 타이트닝', HIFU: 'HIFU', RF_MICRONEEDLE: 'RF 마이크로니들',
      LASER: '레이저', IPL: 'IPL', BODY: '바디', SKINBOOSTER: '스킨부스터',
      OTHER_DEVICE: '기타', rf: 'RF', hifu: 'HIFU', laser: '레이저', ipl: 'IPL',
      body: '바디', other: '기타', rf_tightening: 'RF',
    };

    L.push(`**보유 장비 ${devices.length}종** (injectable 제외)`);
    L.push('');

    const sortedCats = [...grouped.keys()].sort((a, b) => {
      const ia = catOrder.indexOf(a) >= 0 ? catOrder.indexOf(a) : catOrder.indexOf(a.toUpperCase());
      const ib = catOrder.indexOf(b) >= 0 ? catOrder.indexOf(b) : catOrder.indexOf(b.toUpperCase());
      return (ia >= 0 ? ia : 99) - (ib >= 0 ? ib : 99);
    });

    for (const cat of sortedCats) {
      const devs = grouped.get(cat)!;
      const label = catLabels[cat] || catLabels[cat.toLowerCase()] || cat;
      const names = devs.map(d => {
        const kr = d.korean_name ? ` (${d.korean_name})` : '';
        return `${d.name}${kr}`;
      }).join(', ');
      L.push(`- **${label}**: ${names}`);
    }
    L.push('');

    // RF/HIFU 상세 (영업 핵심)
    if (sales && (sales.rfDevices.length > 0 || sales.hifuDevices.length > 0)) {
      L.push('**리프팅 장비 상세**');
      L.push('');
      L.push('| 장비 | 카테고리 | 설명 |');
      L.push('|------|----------|------|');
      for (const d of devices) {
        const cat = (d.subcategory || '').toUpperCase();
        if (cat.includes('RF') || cat.includes('HIFU')) {
          L.push(`| ${d.name} | ${d.subcategory} | ${d.description || '-'} |`);
        }
      }
      L.push('');
    }
  }

  if (injectables.length > 0) {
    L.push(`**주사제/약제 ${injectables.length}종**`);
    L.push('');
    const injNames = injectables.map(d => {
      const kr = d.korean_name ? ` (${d.korean_name})` : '';
      return `${d.name}${kr}`;
    }).join(', ');
    L.push(injNames);
    L.push('');
  }

  // ────────────────────────────
  // 3. 시술 메뉴
  // ────────────────────────────
  if ((analysis.treatments || []).length > 0) {
    L.push('---');
    L.push('');
    L.push('## 3. 시술 메뉴');
    L.push('');

    // 가격 있는 시술 먼저
    const priced = (analysis.treatments || []).filter(t => t.regular_price || t.event_price);
    const unpriced = (analysis.treatments || []).filter(t => !t.regular_price && !t.event_price);

    if (priced.length > 0) {
      L.push(`### 가격 공개 시술 (${priced.length}건)`);
      L.push('');
      L.push('| 시술명 | 카테고리 | 정가 | 이벤트가 | 단위 |');
      L.push('|--------|----------|------|----------|------|');
      for (const t of priced) {
        const unit = t.quantity && t.unit ? `${t.quantity}${t.unit}` : t.unit || '-';
        L.push(`| ${t.name} | ${t.category || '-'} | ${fmtPrice(t.regular_price)} | ${fmtPrice(t.event_price)} | ${unit} |`);
      }
      L.push('');
    }

    if (unpriced.length > 0) {
      // 카테고리별로 묶어서 간결하게
      const catGroups = new Map<string, string[]>();
      for (const t of unpriced) {
        const cat = t.category || 'other';
        if (!catGroups.has(cat)) catGroups.set(cat, []);
        catGroups.get(cat)!.push(t.name);
      }
      L.push(`### 기타 시술 (${unpriced.length}건, 가격 미공개)`);
      L.push('');
      for (const [cat, names] of catGroups) {
        L.push(`- **${cat}**: ${names.join(', ')}`);
      }
      L.push('');
    }

    // 리프팅 관련 시술 하이라이트
    const liftingKeywords = ['리프팅', '타이트닝', '써마지', '울쎄라', '슈링크', '더블로', '인모드', '올리지오', '텐쎄라', '온다'];
    const liftingTreatments = (analysis.treatments || []).filter(t =>
      liftingKeywords.some(k => t.name.includes(k))
    );
    if (liftingTreatments.length > 0) {
      L.push(`### RF/리프팅 관련 시술 (${liftingTreatments.length}건)`);
      L.push('');
      for (const t of liftingTreatments) {
        const price = t.event_price || t.regular_price;
        L.push(`- ${t.name}${price ? ` — ${fmtPrice(price)}` : ''}`);
      }
      L.push('');
    }
  }

  // ────────────────────────────
  // 4. 의료진
  // ────────────────────────────
  if ((analysis.doctors || []).length > 0) {
    L.push('---');
    L.push('');
    L.push('## 4. 의료진');
    L.push('');
    L.push('| 이름 | 직위 | 전문분야 | 신뢰도 |');
    L.push('|------|------|----------|--------|');
    for (const doc of analysis.doctors) {
      const career = doc.career && doc.career.length > 0 ? doc.career.slice(0, 3).join(', ') : '';
      L.push(`| ${doc.name} | ${doc.title || '-'} | ${doc.specialty || '-'}${career ? ` (${career})` : ''} | ${doc.confidence || '-'} |`);
    }
    L.push('');
  }

  // ────────────────────────────
  // 5. 이벤트/프로모션
  // ────────────────────────────
  if ((analysis.events || []).length > 0) {
    L.push('---');
    L.push('');
    L.push('## 5. 이벤트/프로모션');
    L.push('');
    L.push('| 이벤트명 | 유형 | 기간 | 할인 |');
    L.push('|----------|------|------|------|');
    for (const evt of analysis.events) {
      const discount = evt.discount_info || (evt.event_price ? fmtPrice(evt.event_price) : '-');
      L.push(`| ${evt.title} | ${evt.type || '-'} | ${evt.period || '-'} | ${discount} |`);
    }
    L.push('');
  }

  // ────────────────────────────
  // 6. 클리닉 카테고리
  // ────────────────────────────
  if (analysis.clinic_categories && analysis.clinic_categories.length > 0) {
    L.push('---');
    L.push('');
    L.push('## 6. 클리닉 구성');
    L.push('');
    for (const cat of analysis.clinic_categories) {
      const treats = cat.treatments ? cat.treatments.join(', ') : '';
      L.push(`- **${cat.name}**: ${treats}`);
    }
    L.push('');
  }

  // ────────────────────────────
  // 7. 연락처
  // ────────────────────────────
  if (ci) {
    L.push('---');
    L.push('');
    L.push('## 7. 연락처');
    L.push('');

    const phones = ci.phone || [];
    if (phones.length > 0) {
      const phoneStr = phones.map(p => typeof p === 'string' ? p : p.number).join(', ');
      L.push(`- **전화**: ${phoneStr}`);
    }
    if (ci.kakao_channel) L.push(`- **카카오**: ${ci.kakao_channel}`);
    if (ci.instagram) L.push(`- **Instagram**: ${ci.instagram}`);
    if (ci.youtube) L.push(`- **YouTube**: ${ci.youtube}`);
    if (ci.blog) L.push(`- **블로그**: ${ci.blog}`);
    if (ci.naver_booking) L.push(`- **네이버 예약**: ${ci.naver_booking}`);
    if (ci.facebook) L.push(`- **Facebook**: ${ci.facebook}`);

    const oh = ci.operating_hours;
    if (oh) {
      L.push('');
      L.push('**운영시간**');
      L.push('');
      if (typeof oh === 'string') {
        L.push(oh);
      } else {
        const hours = oh as Record<string, string | null>;
        if (hours.weekday) L.push(`- 평일: ${hours.weekday}`);
        if (hours.saturday) L.push(`- 토요일: ${hours.saturday}`);
        if (hours.sunday) L.push(`- 일요일: ${hours.sunday}`);
        if (hours.lunch_break) L.push(`- 점심: ${hours.lunch_break}`);
      }
    }
    L.push('');
  }

  // ────────────────────────────
  // 푸터
  // ────────────────────────────
  L.push('---');
  L.push('');
  L.push(`*Generated by MADMEDSALES v2 | ${config.date} | ${config.testName}*`);

  return L.join('\n');
}

// ═══════════════════════════════════════════
// 3. DOCX 생성 (골격 — 라이브러리 의존)
// ═══════════════════════════════════════════

async function buildDocxReport(markdown: string, outputPath: string): Promise<void> {
  // TODO: docx 라이브러리로 변환
  // 현재는 md 내용을 txt로 저장 (placeholder)
  fs.writeFileSync(outputPath, markdown, 'utf-8');
}

// ═══════════════════════════════════════════
// 4. 캡쳐 이미지 다운로드
// ═══════════════════════════════════════════

async function downloadCaptures(
  hospitalId: string,
  capturesDir: string,
): Promise<number> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.log('    ⚠️ SUPABASE 환경변수 없음 — 캡쳐 다운로드 스킵');
    return 0;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // crawl_snapshots에서 screenshot_url 조회
  const { data: snapshots, error } = await supabase
    .from('crawl_snapshots')
    .select('url, page_type, screenshot_url')
    .eq('hospital_id', hospitalId)
    .order('created_at', { ascending: false });

  if (error || !snapshots || snapshots.length === 0) {
    return 0;
  }

  fs.mkdirSync(capturesDir, { recursive: true });

  let downloadCount = 0;

  for (let i = 0; i < snapshots.length; i++) {
    const snap = snapshots[i];
    if (!snap.screenshot_url) continue;

    let entries: Array<{ url: string; position: string; order: number }>;
    try {
      entries = typeof snap.screenshot_url === 'string'
        ? JSON.parse(snap.screenshot_url)
        : snap.screenshot_url;
    } catch {
      continue;
    }

    if (!Array.isArray(entries)) continue;

    for (const entry of entries) {
      if (!entry.url) continue;

      try {
        // Supabase Storage public URL에서 다운로드
        const response = await fetch(entry.url);
        if (!response.ok) continue;

        const buffer = Buffer.from(await response.arrayBuffer());
        const pageType = snap.page_type || 'other';
        const position = entry.position || 'default';
        const filename = `page_${i + 1}_${sanitizeFilename(pageType)}_${sanitizeFilename(position)}.png`;
        const filePath = path.resolve(capturesDir, filename);

        fs.writeFileSync(filePath, buffer);
        downloadCount++;
      } catch {
        // 다운로드 실패 — 스킵
      }
    }
  }

  return downloadCount;
}

// ═══════════════════════════════════════════
// 5. 메인: 병원별 보고서 생성
// ═══════════════════════════════════════════

async function generateReport(
  input: ReportInput,
  config: ReportConfig,
  seqNo: string,
): Promise<string> {
  const dirName = makeReportDirName(config, input.hospitalName, seqNo);
  const reportDir = path.resolve(REPORTS_DIR, dirName);

  fs.mkdirSync(reportDir, { recursive: true });

  const baseName = dirName;

  // 1. Raw 데이터 TXT
  const rawTxt = buildRawDataTxt(input);
  fs.writeFileSync(path.resolve(reportDir, `${baseName}_raw.txt`), rawTxt, 'utf-8');

  // 2. 마크다운 보고서
  const markdown = buildMarkdownReport(input, config);
  fs.writeFileSync(path.resolve(reportDir, `${baseName}.md`), markdown, 'utf-8');

  // 3. DOCX 보고서
  await buildDocxReport(markdown, path.resolve(reportDir, `${baseName}.docx`));

  // 4. 캡쳐 이미지 다운로드
  const capturesDir = path.resolve(reportDir, 'captures');
  const captureCount = await downloadCaptures(input.hospitalId, capturesDir);

  console.log(`  ✅ ${input.hospitalName} → ${dirName}/ (md+docx+raw+captures:${captureCount})`);

  return reportDir;
}

// ═══════════════════════════════════════════
// 6. CLI 엔트리포인트
// ═══════════════════════════════════════════

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // 옵션 파싱
  const nameFilter = args.includes('--name')
    ? args[args.indexOf('--name') + 1]
    : null;

  const testName = args.includes('--test-name')
    ? args[args.indexOf('--test-name') + 1]
    : 'v57';

  const skipCaptures = args.includes('--skip-captures');

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  const config: ReportConfig = {
    testName,
    date: today,
  };

  console.log(`📋 보고서 생성기 v2`);
  console.log(`   날짜: ${config.date} | 테스트: ${config.testName}`);
  console.log(`   출력: ${REPORTS_DIR}`);
  if (nameFilter) console.log(`   필터: "${nameFilter}"`);
  if (skipCaptures) console.log(`   캡쳐 다운로드: 스킵`);
  console.log('');

  // 세일즈 리포트 로드 (병원ID → SalesProfile 매핑)
  const salesMap = new Map<string, SalesProfile>();
  const salesPath = path.resolve(OUTPUT_DIR, 'v57-sales-report.json');
  if (fs.existsSync(salesPath)) {
    try {
      const salesData = JSON.parse(fs.readFileSync(salesPath, 'utf-8')) as Array<Record<string, unknown>>;
      for (const s of salesData) {
        salesMap.set(s.hospitalId as string, {
          overallScore: s.overallScore as number,
          grade: s.grade as 'S' | 'A' | 'B' | 'C',
          axisScores: s.axisScores as SalesProfile['axisScores'],
          primaryAngle: s.primaryAngle as SalesProfile['primaryAngle'],
          salesAngles: s.salesAngles as SalesProfile['salesAngles'],
          rfDevices: s.rfDevices as string[],
          hifuDevices: s.hifuDevices as string[],
          liftingTreatmentCount: s.liftingTreatmentCount as number,
          avgPrice: s.avgPrice as number | null,
          snsChannels: s.snsChannels as string[],
          hasTorrRf: s.hasTorrRf as boolean,
        });
      }
      console.log(`   세일즈 데이터: ${salesMap.size}개 병원 로드`);
    } catch {
      console.log('   ⚠️ v57-sales-report.json 로드 실패 — 세일즈 섹션 생략');
    }
  }
  console.log('');

  // output 디렉토리에서 *_analysis.json 파일 수집
  const analysisFiles = fs.readdirSync(OUTPUT_DIR)
    .filter(f => f.endsWith('_analysis.json'))
    .sort();

  if (analysisFiles.length === 0) {
    console.log('❌ output/ 디렉토리에 *_analysis.json 파일이 없습니다.');
    return;
  }

  // 보고서 디렉토리 생성
  fs.mkdirSync(REPORTS_DIR, { recursive: true });

  let seq = 0;
  let generated = 0;

  for (const file of analysisFiles) {
    const hospitalId = file.replace('_analysis.json', '');

    // analysis 파일 로드
    let analysis: AnalysisData;
    try {
      analysis = JSON.parse(fs.readFileSync(path.resolve(OUTPUT_DIR, file), 'utf-8'));
    } catch {
      console.log(`  ⚠️ ${file} 파싱 실패 — 스킵`);
      continue;
    }

    const hospitalName = analysis.hospital_name || hospitalId;

    // 이름 필터
    if (nameFilter && !hospitalName.includes(nameFilter)) continue;

    // OCR 원본 로드
    let ocrRaw: OcrEntry[] = [];
    const ocrPath = path.resolve(OUTPUT_DIR, `${hospitalId}_ocr_raw.json`);
    if (fs.existsSync(ocrPath)) {
      try {
        ocrRaw = JSON.parse(fs.readFileSync(ocrPath, 'utf-8'));
      } catch { /* ignore */ }
    }

    // 커버리지 원본 로드
    let coverageRaw: string | null = null;
    const coveragePath = path.resolve(OUTPUT_DIR, `${hospitalId}_coverage_raw.txt`);
    if (fs.existsSync(coveragePath)) {
      coverageRaw = fs.readFileSync(coveragePath, 'utf-8');
    }

    const seqNo = makeSeqNo(seq);
    seq++;

    const input: ReportInput = {
      hospitalId,
      hospitalName,
      analysis,
      ocrRaw,
      coverageRaw,
      sales: salesMap.get(hospitalId) || null,
    };

    await generateReport(input, config, seqNo);
    generated++;
  }

  console.log(`\n📊 보고서 생성 완료: ${generated}건 → ${REPORTS_DIR}`);
}

main().catch(console.error);
