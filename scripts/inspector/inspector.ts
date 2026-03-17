/**
 * Data QA Inspector v2 — 메인 Inspector 모듈
 *
 * scv_crawl_validations.issues JSONB에서 크롤링 메타데이터를 읽어
 * 4단계 검증 수행 → confidence_score/inspector_grade 산출 → DB UPDATE
 *
 * 실행: npx tsx scripts/inspector/inspector.ts --all --dry-run
 * 옵션: --hospital-id UUID | --all | --uninspected | --dry-run | --limit N
 */

import { supabase } from '../utils/supabase.js';
import { classifyHospitalType } from './classify-hospital';
import { computeInspectorScores, type ScoringInput } from './scoring';
import type {
  HospitalContext, InspectorResult, InspectorLog, HospitalType,
} from './types';
import { CORE_PAGE_TYPES } from './types';
import type { CrawlPageRow } from './classify-hospital';

// ============================================================
// CLI 인자
// ============================================================
const args = process.argv.slice(2);
const hospitalIdArg = args.includes('--hospital-id') ? args[args.indexOf('--hospital-id') + 1] : null;
const dryRun = args.includes('--dry-run');
const limitArg = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1], 10) : 50;
const uninspectedOnly = args.includes('--uninspected');

// ============================================================
// DB 조회
// ============================================================
interface ValidationRow {
  id: string;
  hospital_id: string;
  crawl_version: string;
  status: string;
  issues: CrawlIssues | null;
  validation_result: Record<string, unknown> | null;
  equipment_coverage: number | null;
  treatment_coverage: number | null;
  doctor_coverage: number | null;
  overall_coverage: number | null;
  inspected_at: string | null;
}

interface CrawlIssues {
  pages_crawled?: number;
  pages_with_text?: number;
  pages_with_screenshots?: number;
  attempted_urls_count?: number;
  doctors_extracted?: number;
  gemini_calls?: number;
  firecrawl_credits?: number;
  ocr_success_count?: number;
  ocr_empty_count?: number;
  intercepted_api_count?: number;
  spa_type?: string;
  renewal_detected?: boolean;
  cross_validation_grade?: string;
  cross_validation_overlap?: number;
  page_type_distribution?: Record<string, number>;
  elapsed_ms?: number;
}

async function getTargetValidations(): Promise<ValidationRow[]> {
  let query = supabase
    .from('scv_crawl_validations')
    .select('id, hospital_id, crawl_version, status, issues, validation_result, equipment_coverage, treatment_coverage, doctor_coverage, overall_coverage, inspected_at');

  // madmedscv_v1만 대상 (v5/v5.4 구버전 제외)
  query = query.eq('crawl_version', 'madmedscv_v1');

  if (hospitalIdArg) {
    query = query.eq('hospital_id', hospitalIdArg);
  } else if (uninspectedOnly) {
    query = query.is('inspected_at', null);
  }

  query = query.order('validated_at', { ascending: false }).limit(limitArg);

  const { data, error } = await query;
  if (error) {
    console.error(`DB 조회 실패: ${error.message}`);
    return [];
  }
  return (data || []) as ValidationRow[];
}

async function getHospitalName(hospitalId: string): Promise<string> {
  const { data } = await supabase
    .from('hospitals')
    .select('name')
    .eq('id', hospitalId)
    .single();
  return data?.name || '(unknown)';
}

async function getDoctorCount(hospitalId: string): Promise<number> {
  const { count } = await supabase
    .from('hospital_doctors')
    .select('id', { count: 'exact', head: true })
    .eq('hospital_id', hospitalId);
  return count || 0;
}

// ============================================================
// issues JSONB → Inspector 입력 변환
// ============================================================
function buildContextFromIssues(
  hospitalId: string,
  hospitalName: string,
  issues: CrawlIssues,
  validationResult: Record<string, unknown> | null,
): HospitalContext {
  const totalPages = issues.pages_crawled || 0;
  const dist = issues.page_type_distribution || {};

  // 이미지 페이지 추정: 전체 - 텍스트 있는 페이지
  const pagesWithText = issues.pages_with_text || 0;
  const imagePages = Math.max(0, totalPages - pagesWithText);

  const siteType = issues.spa_type ||
    (validationResult?.site_type as string) || undefined;

  return {
    hospitalId,
    hospitalName,
    totalPages,
    imagePages,
    httpStatuses: {},
    hospitalType: classifyHospitalType(totalPages),
    siteType,
  };
}

function buildSyntheticPages(issues: CrawlIssues): CrawlPageRow[] {
  const dist = issues.page_type_distribution || {};
  const pages: CrawlPageRow[] = [];

  for (const [pageType, count] of Object.entries(dist)) {
    for (let i = 0; i < (count as number); i++) {
      pages.push({
        url: `synthetic://${pageType}/${i}`,
        page_type: pageType,
        char_count: 0,  // 개별 char_count 없음 → textScore는 전체 추정치 사용
      });
    }
  }

  return pages;
}

function estimateTotalTextLength(issues: CrawlIssues): number {
  // OCR 성공 수 × 평균 추출 텍스트(약 200자) + 텍스트 페이지 × 평균 1000자
  const ocrChars = (issues.ocr_success_count || 0) * 200;
  const textChars = (issues.pages_with_text || 0) * 1000;
  return ocrChars + textChars;
}

function estimateOcrTextLength(issues: CrawlIssues): number {
  // OCR 성공 수 × 평균 200자, OCR 빈 결과 제외
  const successCount = issues.ocr_success_count || 0;
  const emptyCount = issues.ocr_empty_count || 0;
  const totalOcr = successCount + emptyCount;
  if (totalOcr === 0) return 0;
  return successCount * 200;
}

// ============================================================
// 단일 병원 Inspector 실행
// ============================================================
async function inspectValidation(row: ValidationRow): Promise<InspectorResult | null> {
  const startTime = Date.now();
  const hospitalName = await getHospitalName(row.hospital_id);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`[Inspector] ${hospitalName} (${row.hospital_id})`);
  console.log(`  crawl_version: ${row.crawl_version} | status: ${row.status}`);

  const issues = row.issues || {};

  if (!issues.pages_crawled || issues.pages_crawled === 0) {
    console.log('  크롤링 데이터 없음 → X등급');
    return {
      confidenceScore: 0,
      grade: 'X',
      hospitalType: 'small',
      subScores: { textScore: 0, urlCoverageScore: 0, ocrScore: 0, apiScore: 0 },
      missingCorePages: true,
      httpStatusSummary: {},
      log: {
        steps: [{ step: 'step0_context', result: 'no_data', details: { pages_crawled: 0 } }],
        summary: 'No crawl data found',
        duration_ms: Date.now() - startTime,
      },
      inspectedAt: new Date().toISOString(),
    };
  }

  // Step 0: 컨텍스트 빌드
  const context = buildContextFromIssues(
    row.hospital_id, hospitalName, issues, row.validation_result,
  );
  console.log(`  유형: ${context.hospitalType} (${context.totalPages}p, img:${context.imagePages}p, spa:${context.siteType || '-'})`);

  // 합성 페이지 데이터
  const syntheticPages = buildSyntheticPages(issues);
  const totalTextLength = estimateTotalTextLength(issues);
  const ocrTextLength = estimateOcrTextLength(issues);

  // API 데이터 여부
  const hasApiData = (issues.intercepted_api_count || 0) > 0;

  // 의사 수
  const doctorCount = issues.doctors_extracted ?? await getDoctorCount(row.hospital_id);

  console.log(`  text~${totalTextLength}자 | ocr~${ocrTextLength}자 | api:${hasApiData} | doctors:${doctorCount}`);
  console.log(`  page_types: ${JSON.stringify(issues.page_type_distribution || {})}`);

  // Step 1~3: 스코어링
  const scoringInput: ScoringInput = {
    context,
    pages: syntheticPages,
    totalTextLength,
    ocrTextLength,
    hasApiData,
    extractedEquipments: 0,
    extractedTreatments: 0,
    extractedDoctors: doctorCount,
  };

  const scoring = computeInspectorScores(scoringInput);

  const duration = Date.now() - startTime;
  const log: InspectorLog = {
    steps: [
      { step: 'step0_context', result: 'ok', details: {
        totalPages: context.totalPages,
        imagePages: context.imagePages,
        hospitalType: context.hospitalType,
        siteType: context.siteType || 'unknown',
        totalTextLength,
        ocrTextLength,
        pages_with_text: issues.pages_with_text,
        ocr_success_count: issues.ocr_success_count,
        ocr_empty_count: issues.ocr_empty_count,
        intercepted_api_count: issues.intercepted_api_count,
        cross_validation_grade: issues.cross_validation_grade,
        cross_validation_overlap: issues.cross_validation_overlap,
        doctors_extracted: doctorCount,
      }},
      ...scoring.stepLogs,
    ],
    summary: `${context.hospitalType} hospital, ${scoring.grade} grade (${scoring.confidenceScore}pts)`,
    duration_ms: duration,
  };

  const result: InspectorResult = {
    confidenceScore: scoring.confidenceScore,
    grade: scoring.grade,
    hospitalType: context.hospitalType,
    subScores: scoring.subScores,
    missingCorePages: scoring.missingCorePages,
    httpStatusSummary: {},
    log,
    inspectedAt: new Date().toISOString(),
  };

  console.log(`  => ${result.confidenceScore}/100 → ${result.grade}등급  [text=${scoring.subScores.textScore} url=${scoring.subScores.urlCoverageScore} ocr=${scoring.subScores.ocrScore} api=${scoring.subScores.apiScore}]`);

  return result;
}

// ============================================================
// DB 저장 (기존 row UPDATE)
// ============================================================
async function saveInspectorResult(rowId: string, result: InspectorResult): Promise<void> {
  const { error } = await supabase
    .from('scv_crawl_validations')
    .update({
      confidence_score: result.confidenceScore,
      inspector_grade: result.grade,
      hospital_type: result.hospitalType,
      text_score: result.subScores.textScore,
      url_coverage_score: result.subScores.urlCoverageScore,
      ocr_score: result.subScores.ocrScore,
      api_score: result.subScores.apiScore,
      missing_core_pages: result.missingCorePages,
      http_status_summary: result.httpStatusSummary,
      inspector_log: result.log,
      inspected_at: result.inspectedAt,
    })
    .eq('id', rowId);

  if (error) {
    console.error(`  DB 저장 실패: ${error.message}`);
  } else {
    console.log(`  DB 저장 완료`);
  }
}

// ============================================================
// 메인
// ============================================================
async function main(): Promise<void> {
  console.log('=== Data QA Inspector v2 ===');
  console.log(`모드: ${dryRun ? 'DRY-RUN' : 'LIVE'} | 대상: ${hospitalIdArg || (uninspectedOnly ? 'uninspected' : 'all')} | 제한: ${limitArg}`);

  const validations = await getTargetValidations();
  console.log(`대상: ${validations.length}건`);

  if (validations.length === 0) {
    console.log('검사할 데이터 없음. 종료.');
    return;
  }

  const gradeCount: Record<string, number> = { S: 0, A: 0, F: 0, X: 0 };
  const results: Array<{ name: string; grade: string; score: number }> = [];

  for (const row of validations) {
    const result = await inspectValidation(row);
    if (!result) continue;

    const name = await getHospitalName(row.hospital_id);
    gradeCount[result.grade]++;
    results.push({ name, grade: result.grade, score: result.confidenceScore });

    if (!dryRun) {
      await saveInspectorResult(row.id, result);
    }
  }

  // 요약 리포트
  console.log(`\n${'='.repeat(60)}`);
  console.log('=== Inspector 요약 ===');
  console.log(`S(85~100): ${gradeCount.S}개 → 즉시 투입`);
  console.log(`A(60~79):  ${gradeCount.A}개 → 보수적 투입`);
  console.log(`F(30~59):  ${gradeCount.F}개 → Track1 재추출 필요`);
  console.log(`X(0~29):   ${gradeCount.X}개 → SCV 재크롤링 필요`);
  console.log('');

  for (const grade of ['S', 'A', 'F', 'X']) {
    const list = results.filter(r => r.grade === grade);
    if (list.length > 0) {
      console.log(`[${grade}등급]`);
      for (const r of list) {
        console.log(`  ${r.score}점 — ${r.name}`);
      }
    }
  }

  const retryTargets = results.filter(r => r.grade === 'F' || r.grade === 'X');
  if (retryTargets.length > 0) {
    console.log(`\n재작업 필요: ${retryTargets.length}개 병원`);
  }
  if (dryRun) {
    console.log('(DRY-RUN 모드: DB 저장 안 됨)');
  }
}

main().catch(console.error);
