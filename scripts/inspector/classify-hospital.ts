/**
 * Data QA Inspector v2 — Step 0: 병원 컨텍스트 수집 및 유형 분류
 *
 * 페이지 수 기반 분류: 1~5 = small, 6~15 = medium, 16+ = large
 */

import type { HospitalType, HospitalContext } from './types';

export function classifyHospitalType(totalPages: number): HospitalType {
  if (totalPages <= 5) return 'small';
  if (totalPages <= 15) return 'medium';
  return 'large';
}

export interface CrawlPageRow {
  url: string;
  page_type: string;
  char_count: number;
  markdown?: string;
}

export interface CrawlContextInput {
  hospitalId: string;
  hospitalName: string;
  pages: CrawlPageRow[];
  httpStatuses?: Record<string, number>;
  siteType?: string;
}

export function buildHospitalContext(input: CrawlContextInput): HospitalContext {
  const { hospitalId, hospitalName, pages, httpStatuses, siteType } = input;

  const totalPages = pages.length;
  const imagePages = pages.filter(p =>
    p.page_type === 'event' || p.page_type === 'price' ||
    (p.char_count < 200 && totalPages > 1)
  ).length;

  return {
    hospitalId,
    hospitalName,
    totalPages,
    imagePages,
    httpStatuses: httpStatuses || {},
    hospitalType: classifyHospitalType(totalPages),
    siteType,
  };
}
