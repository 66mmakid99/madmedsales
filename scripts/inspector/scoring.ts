/**
 * Data QA Inspector v2 — Step 1~3: 구조적 검사 + OCR 교차검증 + 신뢰도 점수 산출
 *
 * confidence_score = (text_score * 0.45) + (url_coverage_score * 0.30) + (ocr_score * 0.25) + (api_score * 0.00)
 */

import type {
  HospitalContext, SubScores, InspectorGrade,
  StepLog, TypeThresholds,
} from './types';
import { THRESHOLDS, GRADE_THRESHOLDS, CORE_PAGE_TYPES, WEIGHTS, S_GRADE_GATES } from './types';
import type { CrawlPageRow } from './classify-hospital';

export interface ScoringInput {
  context: HospitalContext;
  pages: CrawlPageRow[];
  totalTextLength: number;
  ocrTextLength: number;
  hasApiData: boolean;
  extractedEquipments: number;
  extractedTreatments: number;
  extractedDoctors: number;
}

export interface ScoringResult {
  subScores: SubScores;
  confidenceScore: number;
  grade: InspectorGrade;
  missingCorePages: boolean;
  stepLogs: StepLog[];
}

function cap100(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** Step 1: 구조적 무결성 검사 */
function computeTextScore(totalTextLength: number, thresholds: TypeThresholds): { score: number; log: StepLog } {
  const ratio = totalTextLength / thresholds.expectedTextLength;
  const score = cap100(ratio * 100);

  return {
    score,
    log: {
      step: 'step1_text_volume',
      result: score >= 50 ? 'pass' : 'warn',
      details: {
        totalTextLength,
        expectedTextLength: thresholds.expectedTextLength,
        minTextLength: thresholds.minTextLength,
        ratio: Math.round(ratio * 100) / 100,
        score,
      },
    },
  };
}

function computeUrlCoverageScore(
  pages: CrawlPageRow[],
  thresholds: TypeThresholds,
): { score: number; missingCorePages: boolean; log: StepLog } {
  const pageTypes = new Set(pages.map(p => p.page_type));
  const coveredCore = CORE_PAGE_TYPES.filter(t => pageTypes.has(t));
  const missingCore = CORE_PAGE_TYPES.filter(t => !pageTypes.has(t));

  const ratio = coveredCore.length / thresholds.expectedCoreUrls;
  const score = cap100(ratio * 100);
  const missingCorePages = missingCore.length > 1; // main + 1개 이상 누락이면 true

  return {
    score,
    missingCorePages,
    log: {
      step: 'step1_url_coverage',
      result: coveredCore.length >= thresholds.minCoreUrls ? 'pass' : 'warn',
      details: {
        totalPages: pages.length,
        coveredCoreTypes: coveredCore,
        missingCoreTypes: missingCore,
        expectedCoreUrls: thresholds.expectedCoreUrls,
        score,
      },
    },
  };
}

/** Step 2: OCR 성실도 교차검증 */
function computeOcrScore(
  context: HospitalContext,
  ocrTextLength: number,
  totalTextLength: number,
): { score: number; log: StepLog } {
  // 이미지 포함 페이지가 없으면 OCR 검증 불필요 → 100점
  if (context.imagePages === 0) {
    return {
      score: 100,
      log: {
        step: 'step2_ocr_check',
        result: 'skip',
        details: { reason: 'no_image_pages', imagePages: 0, score: 100 },
      },
    };
  }

  // 이미지 페이지가 있는 경우: OCR 추출 텍스트량 / 기대량 비교
  // 기대량 = 이미지 페이지당 최소 300자
  const expectedOcrLength = context.imagePages * 300;
  const ratio = ocrTextLength / expectedOcrLength;
  const score = cap100(ratio * 100);

  const isLazyOcr = score < 30;

  return {
    score,
    log: {
      step: 'step2_ocr_check',
      result: isLazyOcr ? 'lazy_ocr' : (score >= 60 ? 'pass' : 'warn'),
      details: {
        imagePages: context.imagePages,
        ocrTextLength,
        expectedOcrLength,
        ratio: Math.round(ratio * 100) / 100,
        isLazyOcr,
        score,
      },
    },
  };
}

/** Step 2.5: API 데이터 점수 */
function computeApiScore(hasApiData: boolean): { score: number; log: StepLog } {
  const score = hasApiData ? 100 : 0;
  return {
    score,
    log: {
      step: 'step2_api_data',
      result: hasApiData ? 'pass' : 'absent',
      details: { hasApiData, score },
    },
  };
}

/** Step 3: 신뢰도 점수 산출 + 등급 매핑 */
function computeConfidenceScore(subScores: SubScores): number {
  const raw =
    subScores.textScore * WEIGHTS.text +
    subScores.urlCoverageScore * WEIGHTS.url_coverage +
    subScores.ocrScore * WEIGHTS.ocr +
    subScores.apiScore * WEIGHTS.api;
  return cap100(raw);
}

function mapGrade(confidenceScore: number): InspectorGrade {
  for (const { min, grade } of GRADE_THRESHOLDS) {
    if (confidenceScore >= min) return grade;
  }
  return 'X';
}

/** 전체 스코어링 파이프라인 */
export function computeInspectorScores(input: ScoringInput): ScoringResult {
  const thresholds = THRESHOLDS[input.context.hospitalType];
  const stepLogs: StepLog[] = [];

  // Step 1a: 텍스트 볼륨
  const text = computeTextScore(input.totalTextLength, thresholds);
  stepLogs.push(text.log);

  // Step 1b: URL 커버리지
  const url = computeUrlCoverageScore(input.pages, thresholds);
  stepLogs.push(url.log);

  // Step 2: OCR 교차검증
  const ocr = computeOcrScore(input.context, input.ocrTextLength, input.totalTextLength);
  stepLogs.push(ocr.log);

  // Step 2.5: API 데이터
  const api = computeApiScore(input.hasApiData);
  stepLogs.push(api.log);

  const subScores: SubScores = {
    textScore: text.score,
    urlCoverageScore: url.score,
    ocrScore: ocr.score,
    apiScore: api.score,
  };

  // Step 3: 종합 점수
  const confidenceScore = computeConfidenceScore(subScores);
  let grade = mapGrade(confidenceScore);

  // S등급 게이트: 병원 유형별 최소 조건 미충족 시 A로 강제 하향
  let gateDowngraded = false;
  if (grade === 'S') {
    const gate = S_GRADE_GATES[input.context.hospitalType];
    const textPass = subScores.textScore >= gate.minTextScore;
    const urlPass = subScores.urlCoverageScore >= gate.minUrlCoverage;
    if (!textPass || !urlPass) {
      grade = 'A';
      gateDowngraded = true;
    }
  }

  stepLogs.push({
    step: 'step3_confidence',
    result: grade,
    details: {
      formula: `(text*${WEIGHTS.text})+(url*${WEIGHTS.url_coverage})+(ocr*${WEIGHTS.ocr})+(api*${WEIGHTS.api})`,
      subScores,
      confidenceScore,
      grade,
      ...(gateDowngraded ? {
        gateDowngraded: true,
        gate: S_GRADE_GATES[input.context.hospitalType],
        reason: `S gate failed: text=${subScores.textScore} url=${subScores.urlCoverageScore}`,
      } : {}),
    },
  });

  return {
    subScores,
    confidenceScore,
    grade,
    missingCorePages: url.missingCorePages,
    stepLogs,
  };
}
