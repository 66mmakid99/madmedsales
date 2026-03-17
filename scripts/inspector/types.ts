/**
 * Data QA Inspector v2 — 타입 정의
 */

export type HospitalType = 'small' | 'medium' | 'large';
export type InspectorGrade = 'S' | 'A' | 'F' | 'X';

export interface HospitalContext {
  hospitalId: string;
  hospitalName: string;
  totalPages: number;
  imagePages: number;
  httpStatuses: Record<string, number>;  // url -> status code
  hospitalType: HospitalType;
  siteType?: string;  // from site-fingerprint
}

export interface SubScores {
  textScore: number;       // 0~100
  urlCoverageScore: number; // 0~100
  ocrScore: number;        // 0~100
  apiScore: number;        // 0 or 100
}

export interface InspectorResult {
  confidenceScore: number;  // 0~100
  grade: InspectorGrade;
  hospitalType: HospitalType;
  subScores: SubScores;
  missingCorePages: boolean;
  httpStatusSummary: Record<string, number>;
  log: InspectorLog;
  inspectedAt: string;
}

export interface InspectorLog {
  steps: StepLog[];
  summary: string;
  duration_ms: number;
}

export interface StepLog {
  step: string;
  result: string;
  details: Record<string, unknown>;
}

// 병원 유형별 기대값 (기획서 Step 1)
export interface TypeThresholds {
  minTextLength: number;
  minCoreUrls: number;
  apiRequired: boolean;
  expectedTextLength: number;  // text_score 산출 기준
  expectedCoreUrls: number;    // url_coverage_score 산출 기준
}

export const THRESHOLDS: Record<HospitalType, TypeThresholds> = {
  small:  { minTextLength: 500,   minCoreUrls: 1, apiRequired: false, expectedTextLength: 2000,  expectedCoreUrls: 2 },
  medium: { minTextLength: 1500,  minCoreUrls: 2, apiRequired: false, expectedTextLength: 5000,  expectedCoreUrls: 4 },
  large:  { minTextLength: 3000,  minCoreUrls: 3, apiRequired: true,  expectedTextLength: 10000, expectedCoreUrls: 6 },
};

// 점수 → 등급 매핑 (기획서 Step 3)
export const GRADE_THRESHOLDS: { min: number; grade: InspectorGrade }[] = [
  { min: 85, grade: 'S' },
  { min: 60, grade: 'A' },
  { min: 30, grade: 'F' },
  { min: 0,  grade: 'X' },
];

// confidence_score 산출 비중
export const WEIGHTS = {
  text: 0.45,
  url_coverage: 0.30,
  ocr: 0.25,
  api: 0.00,
} as const;

// S등급 게이트: 점수가 85 이상이어도 이 조건 미충족 시 A로 강제 하향
export const S_GRADE_GATES: Record<HospitalType, { minTextScore: number; minUrlCoverage: number }> = {
  small:  { minTextScore: 30, minUrlCoverage: 0 },
  medium: { minTextScore: 50, minUrlCoverage: 0 },
  large:  { minTextScore: 60, minUrlCoverage: 50 },
};

// 핵심 페이지 유형 (main, treatment, doctor, equipment 중 최소 coverage)
export const CORE_PAGE_TYPES = ['main', 'treatment', 'doctor', 'equipment'] as const;
