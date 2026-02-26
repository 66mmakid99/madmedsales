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

interface ReportInput {
  hospitalId: string;
  hospitalName: string;
  analysis: AnalysisData;
  ocrRaw: OcrEntry[];
  coverageRaw: string | null;
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
// 2. 마크다운 보고서 생성 (골격 — 포맷 미정)
// ═══════════════════════════════════════════

function buildMarkdownReport(input: ReportInput, config: ReportConfig): string {
  const { analysis } = input;

  // TODO: 사용자가 보고서 포맷을 확정하면 여기에 구현
  // 현재는 기본 골격만 생성

  const lines: string[] = [];

  lines.push(`# ${input.hospitalName} 분석 보고서`);
  lines.push('');
  lines.push(`> 생성일: ${config.date} | 테스트: ${config.testName}`);
  lines.push('');

  // 요약
  const summary = analysis.extraction_summary;
  if (summary) {
    lines.push('## 요약');
    lines.push('');
    lines.push(`| 항목 | 수량 |`);
    lines.push(`|------|------|`);
    lines.push(`| 의사 | ${summary.total_doctors ?? '-'} |`);
    lines.push(`| 장비 | ${summary.total_equipment ?? '-'} |`);
    lines.push(`| 시술 | ${summary.total_treatments ?? '-'} |`);
    lines.push(`| 이벤트 | ${summary.total_events ?? '-'} |`);
    lines.push(`| 가격 공개 | ${summary.price_available_ratio ?? '-'} |`);
    lines.push('');
  }

  // 의사
  if (analysis.doctors.length > 0) {
    lines.push('## 의료진');
    lines.push('');
    for (const doc of analysis.doctors) {
      lines.push(`- **${doc.name}** ${doc.title || ''} ${doc.specialty || ''}`);
    }
    lines.push('');
  }

  // 장비
  if (analysis.medical_devices.length > 0) {
    lines.push('## 보유 장비');
    lines.push('');
    lines.push('| 장비명 | 카테고리 | 타입 | 제조사 |');
    lines.push('|--------|----------|------|--------|');
    for (const dev of analysis.medical_devices) {
      lines.push(`| ${dev.name} | ${dev.subcategory || '-'} | ${dev.device_type} | ${dev.manufacturer || '-'} |`);
    }
    lines.push('');
  }

  // 시술
  if (analysis.treatments.length > 0) {
    lines.push('## 시술 메뉴');
    lines.push('');
    lines.push('| 시술명 | 카테고리 | 정가 | 이벤트가 |');
    lines.push('|--------|----------|------|----------|');
    for (const t of analysis.treatments) {
      const reg = t.regular_price ? `${t.regular_price.toLocaleString()}원` : '-';
      const evt = t.event_price ? `${t.event_price.toLocaleString()}원` : '-';
      lines.push(`| ${t.name} | ${t.category || '-'} | ${reg} | ${evt} |`);
    }
    lines.push('');
  }

  // 이벤트
  if (analysis.events.length > 0) {
    lines.push('## 이벤트');
    lines.push('');
    for (const evt of analysis.events) {
      lines.push(`- **${evt.title}** (${evt.type || '-'}) ${evt.period || ''}`);
    }
    lines.push('');
  }

  // 연락처
  if (analysis.contact_info) {
    const ci = analysis.contact_info;
    lines.push('## 연락처');
    lines.push('');
    if (ci.website_url) lines.push(`- 웹사이트: ${ci.website_url}`);
    if (ci.instagram) lines.push(`- Instagram: ${ci.instagram}`);
    if (ci.blog) lines.push(`- 블로그: ${ci.blog}`);
    if (ci.kakao_channel) lines.push(`- 카카오: ${ci.kakao_channel}`);
    if (ci.youtube) lines.push(`- YouTube: ${ci.youtube}`);
    lines.push('');
  }

  return lines.join('\n');
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
    };

    await generateReport(input, config, seqNo);
    generated++;
  }

  console.log(`\n📊 보고서 생성 완료: ${generated}건 → ${REPORTS_DIR}`);
}

main().catch(console.error);
